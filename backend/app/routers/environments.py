from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from ..database import get_db
from ..models import Environment, Setting
from ..schemas import (
    CustomPortAllocateRequest,
    CustomPortAllocateResponse,
    CustomPortMapping,
    EnvironmentCreate,
    EnvironmentResponse,
)
from ..tasks import create_environment_task
import docker
import secrets
import time
import random
from sqlalchemy.exc import IntegrityError
import json

router = APIRouter(
    prefix="/environments",
    tags=["environments"],
)

JUPYTER_LAUNCH_TTL_SECONDS = 60
jupyter_launch_tickets: dict[str, dict[str, str | float | bool]] = {}
MAX_PORT_ALLOCATION_RETRIES = 8
CUSTOM_HOST_PORT_RANGE = (35001, 60000)
CUSTOM_CONTAINER_PORT_RANGE = (10000, 20000)
RESERVED_CONTAINER_PORTS = {22, 8080, 8888}


def _cleanup_expired_jupyter_tickets():
    now = time.time()
    expired = [
        ticket
        for ticket, meta in jupyter_launch_tickets.items()
        if meta.get("used") or float(meta.get("expires_at", 0)) < now
    ]
    for ticket in expired:
        jupyter_launch_tickets.pop(ticket, None)


async def _get_jupyter_token(db: AsyncSession, environment_id: str) -> str | None:
    key = f"jupyter_token:{environment_id}"
    result = await db.execute(select(Setting).where(Setting.key == key))
    token_setting = result.scalars().first()
    return token_setting.value if token_setting else None


def _normalize_custom_ports(raw_ports) -> list[dict]:
    if not raw_ports:
        return []
    normalized = []
    for item in raw_ports:
        if isinstance(item, CustomPortMapping):
            host_port = int(item.host_port)
            container_port = int(item.container_port)
        elif isinstance(item, dict):
            host_port = int(item.get("host_port"))
            container_port = int(item.get("container_port"))
        else:
            continue
        normalized.append({"host_port": host_port, "container_port": container_port})
    return normalized


async def _get_custom_ports_map(db: AsyncSession) -> dict[str, list[dict]]:
    result = await db.execute(select(Setting).where(Setting.key.like("custom_ports:%")))
    settings = result.scalars().all()
    custom_ports_map: dict[str, list[dict]] = {}
    for setting in settings:
        try:
            env_id = setting.key.split("custom_ports:", 1)[1]
            parsed = json.loads(setting.value)
            custom_ports_map[env_id] = _normalize_custom_ports(parsed)
        except Exception:
            continue
    return custom_ports_map


async def _get_custom_ports_for_environment(db: AsyncSession, environment_id: str) -> list[dict]:
    result = await db.execute(select(Setting).where(Setting.key == f"custom_ports:{environment_id}"))
    setting = result.scalars().first()
    if not setting:
        return []
    try:
        parsed = json.loads(setting.value)
        return _normalize_custom_ports(parsed)
    except Exception:
        return []


def _get_docker_used_ports() -> set[int]:
    used_ports: set[int] = set()
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        for container in containers:
            ports = container.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
            for bindings in ports.values():
                if not bindings:
                    continue
                for binding in bindings:
                    host_port = binding.get("HostPort")
                    if host_port and str(host_port).isdigit():
                        used_ports.add(int(host_port))
    except Exception:
        # Docker query failures are tolerated; runtime run() retry still handles conflicts.
        pass
    return used_ports


def _pick_free_port(start: int, end: int, blocked_ports: set[int]) -> int:
    candidates = list(range(start, end + 1))
    random.shuffle(candidates)
    for port in candidates:
        if port in blocked_ports:
            continue
        return port
    raise HTTPException(
        status_code=503,
        detail=f"No available host ports in range {start}-{end}",
    )


async def _allocate_ports(db: AsyncSession) -> tuple[int, int, int]:
    result = await db.execute(select(Environment.ssh_port, Environment.jupyter_port, Environment.code_port))
    rows = result.all()
    blocked_ports: set[int] = set()
    for ssh_port, jupyter_port, code_port in rows:
        blocked_ports.add(ssh_port)
        blocked_ports.add(jupyter_port)
        blocked_ports.add(code_port)

    custom_ports_map = await _get_custom_ports_map(db)
    for mappings in custom_ports_map.values():
        for mapping in mappings:
            host_port = mapping.get("host_port")
            if isinstance(host_port, int):
                blocked_ports.add(host_port)

    blocked_ports.update(_get_docker_used_ports())

    ssh_port = _pick_free_port(20000, 25000, blocked_ports)
    blocked_ports.add(ssh_port)
    jupyter_port = _pick_free_port(25001, 30000, blocked_ports)
    blocked_ports.add(jupyter_port)
    code_port = _pick_free_port(30001, 35000, blocked_ports)
    return ssh_port, jupyter_port, code_port


async def _collect_blocked_host_ports(db: AsyncSession) -> set[int]:
    blocked_ports: set[int] = set()
    result = await db.execute(select(Environment.ssh_port, Environment.jupyter_port, Environment.code_port))
    rows = result.all()
    for ssh_port, jupyter_port, code_port in rows:
        blocked_ports.add(ssh_port)
        blocked_ports.add(jupyter_port)
        blocked_ports.add(code_port)

    custom_ports_map = await _get_custom_ports_map(db)
    for mappings in custom_ports_map.values():
        for mapping in mappings:
            host_port = mapping.get("host_port")
            if isinstance(host_port, int):
                blocked_ports.add(host_port)

    blocked_ports.update(_get_docker_used_ports())
    return blocked_ports


def _validate_custom_ports(custom_ports: list[dict]):
    host_ports = set()
    container_ports = set()
    for mapping in custom_ports:
        host_port = mapping["host_port"]
        container_port = mapping["container_port"]
        if host_port in host_ports:
            raise HTTPException(status_code=400, detail=f"Duplicate host port in custom mappings: {host_port}")
        if container_port in container_ports:
            raise HTTPException(status_code=400, detail=f"Duplicate container port in custom mappings: {container_port}")
        if container_port in RESERVED_CONTAINER_PORTS:
            raise HTTPException(status_code=400, detail=f"Container port {container_port} is reserved")
        host_ports.add(host_port)
        container_ports.add(container_port)


async def _allocate_custom_port_mappings(
    db: AsyncSession,
    count: int,
    current_ports: list[dict] | None = None,
) -> list[dict]:
    if count <= 0:
        return []
    blocked_host_ports = await _collect_blocked_host_ports(db)
    existing = _normalize_custom_ports(current_ports or [])
    for mapping in existing:
        blocked_host_ports.add(mapping["host_port"])

    blocked_container_ports = set(RESERVED_CONTAINER_PORTS)
    for mapping in existing:
        blocked_container_ports.add(mapping["container_port"])

    mappings: list[dict] = []
    host_start, host_end = CUSTOM_HOST_PORT_RANGE
    container_start, container_end = CUSTOM_CONTAINER_PORT_RANGE
    for _ in range(count):
        host_port = _pick_free_port(host_start, host_end, blocked_host_ports)
        blocked_host_ports.add(host_port)
        container_port = _pick_free_port(container_start, container_end, blocked_container_ports)
        blocked_container_ports.add(container_port)
        mappings.append({"host_port": host_port, "container_port": container_port})

    return mappings


@router.post("/ports/allocate", response_model=CustomPortAllocateResponse)
async def allocate_custom_ports(payload: CustomPortAllocateRequest, db: AsyncSession = Depends(get_db)):
    count = payload.count if payload.count > 0 else 1
    mappings = await _allocate_custom_port_mappings(db, count=count, current_ports=payload.current_ports)
    return {"mappings": mappings}


@router.post("/", response_model=EnvironmentResponse, status_code=status.HTTP_201_CREATED)
async def create_environment(env: EnvironmentCreate, db: AsyncSession = Depends(get_db)):
    # Logic to find available ports and GPUs will go here
    # For now, we will mock these values

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

    custom_ports = _normalize_custom_ports(env.custom_ports)
    _validate_custom_ports(custom_ports)
    blocked_host_ports = await _collect_blocked_host_ports(db)
    for mapping in custom_ports:
        if mapping["host_port"] in blocked_host_ports:
            raise HTTPException(
                status_code=409,
                detail=f"Custom host port {mapping['host_port']} is already in use. Please regenerate ports.",
            )

    new_env = None
    for _ in range(MAX_PORT_ALLOCATION_RETRIES):
        ssh_port, jupyter_port, code_port = await _allocate_ports(db)
        candidate_env = Environment(
            name=env.name,
            container_user=env.container_user,
            root_password=env.root_password,
            dockerfile_content=env.dockerfile_content,
            mount_config=[m.dict() for m in env.mount_config],
            gpu_indices=gpu_indices,
            ssh_port=ssh_port,
            jupyter_port=jupyter_port,
            code_port=code_port,
            status="building",
        )

        db.add(candidate_env)
        try:
            await db.commit()
            await db.refresh(candidate_env)
            new_env = candidate_env
            break
        except IntegrityError:
            await db.rollback()

    if new_env is None:
        raise HTTPException(
            status_code=503,
            detail="Failed to allocate unique ports after several retries. Please try again.",
        )

    jupyter_token = secrets.token_urlsafe(32)
    db.add(Setting(key=f"jupyter_token:{new_env.id}", value=jupyter_token))
    db.add(Setting(key=f"custom_ports:{new_env.id}", value=json.dumps(custom_ports)))
    await db.commit()

    # Trigger Celery Task
    create_environment_task.delay(new_env.id)

    env_dict = {**new_env.__dict__, "custom_ports": custom_ports}
    env_dict.pop("_sa_instance_state", None)
    return env_dict


@router.get("/", response_model=List[EnvironmentResponse])
async def read_environments(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).offset(skip).limit(limit))
    envs = result.scalars().all()
    custom_ports_map = await _get_custom_ports_map(db)

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

        env_dict = {
            **env.__dict__,
            "container_id": container_id,
            "custom_ports": custom_ports_map.get(str(env.id), []),
        }
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
    custom_ports = await _get_custom_ports_for_environment(db, str(env.id))
    env_dict = {**env.__dict__, "custom_ports": custom_ports}
    env_dict.pop("_sa_instance_state", None)
    return env_dict


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


@router.post("/{environment_id}/jupyter/launch")
async def create_jupyter_launch_url(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    if env.status != "running":
        raise HTTPException(status_code=409, detail="Environment must be running")

    token = await _get_jupyter_token(db, str(env.id))
    if not token:
        raise HTTPException(status_code=409, detail="Jupyter token is not configured. Recreate the environment.")

    _cleanup_expired_jupyter_tickets()
    launch_ticket = secrets.token_urlsafe(24)
    jupyter_launch_tickets[launch_ticket] = {
        "environment_id": str(env.id),
        "expires_at": time.time() + JUPYTER_LAUNCH_TTL_SECONDS,
        "used": False,
    }

    return {"launch_url": f"/api/environments/{environment_id}/jupyter/launch/{launch_ticket}"}


@router.get("/{environment_id}/jupyter/launch/{launch_ticket}")
async def launch_jupyter_with_ticket(
    environment_id: str, launch_ticket: str, request: Request, db: AsyncSession = Depends(get_db)
):
    _cleanup_expired_jupyter_tickets()
    ticket_meta = jupyter_launch_tickets.get(launch_ticket)
    if not ticket_meta:
        raise HTTPException(status_code=404, detail="Launch ticket not found or expired")
    if ticket_meta.get("used"):
        raise HTTPException(status_code=410, detail="Launch ticket already used")
    if ticket_meta.get("environment_id") != environment_id:
        raise HTTPException(status_code=400, detail="Launch ticket does not match environment")
    if float(ticket_meta.get("expires_at", 0)) < time.time():
        jupyter_launch_tickets.pop(launch_ticket, None)
        raise HTTPException(status_code=410, detail="Launch ticket expired")

    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    if env.status != "running":
        raise HTTPException(status_code=409, detail="Environment must be running")

    token = await _get_jupyter_token(db, str(env.id))
    if not token:
        raise HTTPException(status_code=409, detail="Jupyter token is not configured. Recreate the environment.")

    ticket_meta["used"] = True

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.url.hostname or "localhost"
    redirect_url = f"{scheme}://{host}:{env.jupyter_port}/?token={token}"
    return RedirectResponse(url=redirect_url, status_code=307)


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

    token_key = f"jupyter_token:{env.id}"
    token_result = await db.execute(select(Setting).where(Setting.key == token_key))
    token_setting = token_result.scalars().first()
    if token_setting:
        await db.delete(token_setting)

    custom_ports_key = f"custom_ports:{env.id}"
    custom_ports_result = await db.execute(select(Setting).where(Setting.key == custom_ports_key))
    custom_ports_setting = custom_ports_result.scalars().first()
    if custom_ports_setting:
        await db.delete(custom_ports_setting)

    await db.delete(env)
    await db.commit()
    _cleanup_expired_jupyter_tickets()

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
