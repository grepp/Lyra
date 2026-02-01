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
    mock_gpu_indices = [0]
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
        status="building"
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
    return result.scalars().all()


@router.get("/{environment_id}", response_model=EnvironmentResponse)
async def read_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    return env


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
