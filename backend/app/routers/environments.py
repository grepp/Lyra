from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from ..database import get_db
from ..models import Environment
from ..schemas import EnvironmentCreate, EnvironmentResponse
from ..tasks import create_environment_task
import docker

router = APIRouter(
    prefix="/environments",
    tags=["environments"],
)


@router.post("/", response_model=EnvironmentResponse, status_code=status.HTTP_201_CREATED)
async def create_environment(env: EnvironmentCreate, db: AsyncSession = Depends(get_db)):
    # Logic to find available ports and GPUs will go here
    # For now, we will mock these values

    # Mock allocation (In real logic, we should scan available ports)
    # Using random ports to avoid conflict for demo
    import random
    import pynvml

    # Real GPU Allocation Logic
    gpu_indices = []
    if env.gpu_count > 0:
        total_gpus = 0
        try:
            pynvml.nvmlInit()
            total_gpus = pynvml.nvmlDeviceGetCount()
            pynvml.nvmlShutdown()
        except Exception:
            # If NVML fails, assume 0 or handle accordingly
            raise HTTPException(status_code=500, detail="Failed to detect GPUs on host")

        # Find currently used GPUs
        result = await db.execute(select(Environment).where(Environment.status.in_(["running", "building"])))
        active_envs = result.scalars().all()
        used_indices = set()
        for active in active_envs:
            if active.gpu_indices:
                used_indices.update(active.gpu_indices)

        # Find available indices
        available_indices = [i for i in range(total_gpus) if i not in used_indices]

        if len(available_indices) < env.gpu_count:
            raise HTTPException(
                status_code=400,
                detail=f"Not enough GPUs available. Requested: {env.gpu_count}, Available: {len(available_indices)}",
            )

        # Allocate
        gpu_indices = available_indices[: env.gpu_count]

    mock_gpu_indices = gpu_indices
    mock_ssh_port = random.randint(20000, 25000)
    mock_jupyter_port = random.randint(25001, 30000)
    mock_code_port = random.randint(30001, 35000)

    # In a real implementation, we would lock rows to prevent race conditions

    new_env = Environment(
        name=env.name,
        container_user=env.container_user,
        root_password=env.root_password,
        dockerfile_content=env.dockerfile_content,
        mount_config=[m.dict() for m in env.mount_config],
        gpu_indices=mock_gpu_indices,
        ssh_port=mock_ssh_port,
        jupyter_port=mock_jupyter_port,
        code_port=mock_code_port,
        status="building",
    )

    db.add(new_env)
    await db.commit()
    await db.refresh(new_env)

    # Trigger Celery Task
    create_environment_task.delay(new_env.id)

    return new_env


@router.get("/", response_model=List[EnvironmentResponse])
async def read_environments(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).offset(skip).limit(limit))
    envs = result.scalars().all()

    client = docker.from_env()
    status_changed = False
    env_responses = []

    for env in envs:
        container_name = f"lyra-{env.name}-{env.id}"
        container_id: str | None = None

        try:
            container = client.containers.get(container_name)
            container_id = container.short_id or (container.id[:12] if container.id else None)
            state_info = container.attrs.get('State', {})
            container_status = container.status
            state_status = state_info.get('Status', '')
            exit_code = state_info.get('ExitCode')
            oom_killed = state_info.get('OOMKilled', False)
            error_msg = state_info.get('Error', "")

            if container_status == 'running':
                if env.status == 'starting':
                    new_status = 'running'
                elif env.status == 'stopping':
                    new_status = 'stopping'
                elif env.status != 'running':
                    new_status = 'running'
                else:
                    new_status = env.status
            else:
                if env.status == 'stopping':
                    if state_status in ['created', 'restarting', 'starting']:
                        new_status = 'stopping'
                    elif exit_code is None:
                        new_status = 'stopped'
                    elif exit_code in [0, 143]:
                        new_status = 'stopped'
                    elif exit_code == 137:
                        if oom_killed or str(error_msg).strip():
                            new_status = 'error'
                        else:
                            new_status = 'stopped'
                    else:
                        new_status = 'error'
                elif env.status == 'starting':
                    if state_status in ['created', 'restarting', 'starting'] and exit_code is None:
                        new_status = 'starting'
                    elif exit_code is None:
                        new_status = 'stopped'
                    elif exit_code in [0, 143]:
                        new_status = 'stopped'
                    elif exit_code == 137:
                        if oom_killed or str(error_msg).strip():
                            new_status = 'error'
                        else:
                            new_status = 'stopped'
                    else:
                        new_status = 'error'
                else:
                    if exit_code is None:
                        new_status = 'stopped'
                    elif exit_code in [0, 143]:
                        new_status = 'stopped'
                    elif exit_code == 137:
                        if oom_killed or str(error_msg).strip():
                            new_status = 'error'
                        else:
                            new_status = 'stopped'
                    else:
                        new_status = 'error'

            if env.status != new_status:
                env.status = new_status
                status_changed = True
        except docker.errors.NotFound:
            if env.status in ['running', 'stopping', 'starting']:
                env.status = 'stopped'
                status_changed = True
        except Exception as e:
            print(f"Error checking container status: {e}")

        env_dict = {**env.__dict__, "container_id": container_id}
        env_dict.pop("_sa_instance_state", None)
        env_responses.append(env_dict)

    if status_changed:
        await db.commit()

    return env_responses


@router.get("/{environment_id}", response_model=EnvironmentResponse)
async def read_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    return env


@router.get("/{environment_id}/logs")
async def get_environment_logs(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    client = docker.from_env()
    container_name = f"lyra-{env.name}-{env.id}"

    try:
        # Check if container exists (even if stopped/exited)
        container = client.containers.get(container_name)
        logs = container.logs(tail=50)
        logs_text = logs.decode('utf-8').strip() if logs else ""

        if not logs_text:
            state = container.attrs.get('State', {})
            exit_code = state.get('ExitCode')
            error_msg = state.get('Error', "")

            if error_msg:
                return {"logs": error_msg}
            if exit_code is not None:
                return {"logs": f"Container exited with code: {exit_code}, but no logs were produced."}

            return {"logs": "No logs produced by this container."}

        return {"logs": logs_text}
    except docker.errors.NotFound:
        if env.status == "error":
            return {
                "logs": "No container was created for this environment. Build may have failed before container start. Check backend worker logs for the full build error."  # noqa: E501
            }
        return {"logs": "Container not found. It may have been removed or not started yet."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    # Try to remove container
    try:
        client = docker.from_env()
        container_name = f"lyra-{env.name}-{env.id}"
        try:
            container = client.containers.get(container_name)
            container.remove(force=True)
        except docker.errors.NotFound:
            pass  # Container already gone
    except Exception as e:
        print(f"Error removing container: {e}")

    await db.delete(env)
    await db.commit()

    return None


@router.post("/{environment_id}/start", status_code=status.HTTP_200_OK)
async def start_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    container_name = f"lyra-{env.name}-{env.id}"
    client = docker.from_env()

    try:
        container = client.containers.get(container_name)
        if container.status == "running":
            env.status = "running"
            await db.commit()
            return {"message": "Environment is already running"}

        env.status = "starting"
        await db.commit()
        container.start()
        env.status = "running"
        await db.commit()
        return {"message": f"Environment {env.name} started"}
    except docker.errors.NotFound:
        env.status = "error"
        await db.commit()
        raise HTTPException(status_code=409, detail="Container not found. Please recreate the environment.")
    except Exception as e:
        env.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{environment_id}/stop", status_code=status.HTTP_200_OK)
async def stop_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    container_name = f"lyra-{env.name}-{env.id}"
    client = docker.from_env()

    try:
        container = client.containers.get(container_name)
        if container.status != "running":
            env.status = "stopped"
            await db.commit()
            return {"message": "Environment is already stopped"}

        env.status = "stopping"
        await db.commit()
        container.stop(timeout=0)
        return {"message": f"Environment {env.name} is stopping"}
    except docker.errors.NotFound:
        env.status = "stopped"
        await db.commit()
        return {"message": "Container not found. Environment marked as stopped."}
    except Exception as e:
        env.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))
