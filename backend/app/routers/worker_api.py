from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.worker_auth import require_worker_api_auth, require_worker_role
from ..database import get_db
from ..routers import environments as env_router
from ..routers import resources as resource_router
from ..schemas import EnvironmentCreate


router = APIRouter(
    prefix="/worker",
    tags=["worker-api"],
    dependencies=[Depends(require_worker_role), Depends(require_worker_api_auth)],
)


@router.get("/health")
async def worker_health():
    return {"status": "ok", "role": "worker"}


@router.get("/gpu")
async def worker_gpu_resources(db: AsyncSession = Depends(get_db)):
    return await resource_router.get_gpu_resources(db=db)


@router.post("/environments")
async def worker_create_environment(env: EnvironmentCreate, db: AsyncSession = Depends(get_db)):
    # Worker nodes should always create local containers.
    env.worker_server_id = None
    return await env_router.create_environment(env=env, db=db)


@router.get("/environments")
async def worker_list_environments(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    return await env_router.read_environments(skip=skip, limit=limit, db=db)


@router.get("/environments/{environment_id}")
async def worker_get_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.read_environment(environment_id=environment_id, db=db)


@router.get("/environments/{environment_id}/logs")
async def worker_get_environment_logs(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.get_environment_logs(environment_id=environment_id, db=db)


@router.post("/environments/{environment_id}/start")
async def worker_start_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.start_environment(environment_id=environment_id, db=db)


@router.post("/environments/{environment_id}/stop")
async def worker_stop_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.stop_environment(environment_id=environment_id, db=db)


@router.delete("/environments/{environment_id}")
async def worker_delete_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.delete_environment(environment_id=environment_id, db=db)


@router.post("/environments/{environment_id}/jupyter/launch")
async def worker_create_jupyter_launch_url(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.create_jupyter_launch_url(environment_id=environment_id, db=db)


@router.post("/environments/{environment_id}/code/launch")
async def worker_create_code_launch_url(environment_id: str, db: AsyncSession = Depends(get_db)):
    return await env_router.create_code_launch_url(environment_id=environment_id, db=db)
