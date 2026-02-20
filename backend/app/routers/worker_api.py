from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Awaitable, Callable

from ..core.worker_auth import require_worker_api_auth, require_worker_role
from ..database import get_db
from ..models import Environment
from ..routers import environments as env_router
from ..routers import resources as resource_router
from ..schemas import EnvironmentCreate
from ..schemas import EnvironmentRootPasswordResetRequest


router = APIRouter(
    prefix="/worker",
    tags=["worker-api"],
    dependencies=[Depends(require_worker_role), Depends(require_worker_api_auth)],
)


def _ok(data: dict, message: str = "OK") -> dict:
    return {"status": "ok", "code": "ok", "message": message, "data": data}


def _raise_normalized_worker_http_error(error: HTTPException, fallback_code: str = "worker_request_failed") -> None:
    detail = error.detail
    if isinstance(detail, dict):
        code = str(detail.get("code") or fallback_code).strip() or fallback_code
        message = str(detail.get("message") or detail.get("detail") or "Worker request failed").strip()
    else:
        code = fallback_code
        message = str(detail or "Worker request failed").strip()
    raise HTTPException(status_code=error.status_code, detail={"code": code, "message": message})


async def _run_worker_action(
    action: Callable[[], Awaitable[dict]],
    *,
    fallback_code: str,
    success_message: str,
) -> dict:
    try:
        data = await action()
    except HTTPException as error:
        _raise_normalized_worker_http_error(error, fallback_code=fallback_code)
    return _ok(data, message=success_message)


@router.get("/health")
async def worker_health():
    return _ok({"role": "worker"}, message="Worker is healthy")


@router.get("/gpu")
async def worker_gpu_resources(db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        return await resource_router.get_gpu_resources(db=db)

    return await _run_worker_action(
        _action,
        fallback_code="gpu_resources_failed",
        success_message="GPU resources loaded",
    )


@router.get("/resources/docker/images/unused")
async def worker_list_unused_images(mode: str = "dangling"):
    async def _action() -> dict:
        return await resource_router.list_unused_images(mode=mode)

    return await _run_worker_action(
        _action,
        fallback_code="list_unused_images_failed",
        success_message="Unused images loaded",
    )


@router.post("/resources/docker/images/prune")
async def worker_prune_unused_images(payload: dict):
    async def _action() -> dict:
        return await resource_router.prune_unused_images(payload=payload)

    return await _run_worker_action(
        _action,
        fallback_code="prune_unused_images_failed",
        success_message="Unused images cleanup completed",
    )


@router.get("/resources/docker/volumes/unused")
async def worker_list_unused_volumes():
    async def _action() -> dict:
        return await resource_router.list_unused_volumes()

    return await _run_worker_action(
        _action,
        fallback_code="list_unused_volumes_failed",
        success_message="Unused volumes loaded",
    )


@router.post("/resources/docker/volumes/prune")
async def worker_prune_unused_volumes(payload: dict):
    async def _action() -> dict:
        return await resource_router.prune_unused_volumes(payload=payload)

    return await _run_worker_action(
        _action,
        fallback_code="prune_unused_volumes_failed",
        success_message="Unused volumes cleanup completed",
    )


@router.get("/resources/docker/build-cache")
async def worker_get_build_cache_summary():
    async def _action() -> dict:
        return await resource_router.get_build_cache_summary()

    return await _run_worker_action(
        _action,
        fallback_code="get_build_cache_failed",
        success_message="Build cache summary loaded",
    )


@router.post("/resources/docker/build-cache/prune")
async def worker_prune_build_cache(payload: dict):
    async def _action() -> dict:
        return await resource_router.prune_build_cache(payload=payload)

    return await _run_worker_action(
        _action,
        fallback_code="prune_build_cache_failed",
        success_message="Build cache cleanup completed",
    )


@router.post("/environments")
async def worker_create_environment(env: EnvironmentCreate, db: AsyncSession = Depends(get_db)):
    # Worker nodes should always create local containers.
    env.worker_server_id = None

    async def _action() -> dict:
        return await env_router.create_environment(env=env, db=db)

    return await _run_worker_action(
        _action,
        fallback_code="create_environment_failed",
        success_message="Environment created",
    )


@router.get("/environments")
async def worker_list_environments(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        environments = await env_router.read_environments(skip=skip, limit=limit, db=db)
        return {"environments": environments}

    return await _run_worker_action(
        _action,
        fallback_code="list_environments_failed",
        success_message="Environments loaded",
    )


@router.get("/environments/{environment_id}")
async def worker_get_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        return await env_router.read_environment(environment_id=environment_id, db=db)

    return await _run_worker_action(
        _action,
        fallback_code="get_environment_failed",
        success_message="Environment loaded",
    )


@router.get("/environments/{environment_id}/logs")
async def worker_get_environment_logs(environment_id: str, db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        return await env_router.get_environment_logs(environment_id=environment_id, db=db)

    return await _run_worker_action(
        _action,
        fallback_code="get_environment_logs_failed",
        success_message="Environment logs loaded",
    )


@router.post("/environments/{environment_id}/start")
async def worker_start_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        return await env_router.start_environment(environment_id=environment_id, db=db)

    return await _run_worker_action(
        _action,
        fallback_code="start_environment_failed",
        success_message="Environment started",
    )


@router.post("/environments/{environment_id}/stop")
async def worker_stop_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        return await env_router.stop_environment(environment_id=environment_id, db=db)

    return await _run_worker_action(
        _action,
        fallback_code="stop_environment_failed",
        success_message="Environment stopped",
    )


@router.delete("/environments/{environment_id}")
async def worker_delete_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    async def _action() -> dict:
        await env_router.delete_environment(environment_id=environment_id, db=db)
        return {}

    return await _run_worker_action(
        _action,
        fallback_code="delete_environment_failed",
        success_message="Environment deleted",
    )


@router.post("/environments/{environment_id}/accounts/root/reset-password")
async def worker_reset_root_password(
    environment_id: str,
    payload: EnvironmentRootPasswordResetRequest,
    db: AsyncSession = Depends(get_db),
):
    async def _action() -> dict:
        return await env_router.reset_environment_root_password(environment_id=environment_id, payload=payload, db=db)

    return await _run_worker_action(
        _action,
        fallback_code="reset_failed",
        success_message="Root password updated",
    )


@router.post("/environments/{environment_id}/jupyter/launch")
async def worker_create_jupyter_launch_url(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(
            status_code=404, detail={"code": "environment_not_found", "message": "Environment not found"}
        )
    if not env.enable_jupyter:
        raise HTTPException(
            status_code=409, detail={"code": "jupyter_disabled", "message": "Jupyter is disabled for this environment"}
        )
    if env.status != "running" and not env_router._is_host_environment_running_now(env):
        raise HTTPException(
            status_code=409, detail={"code": "environment_not_running", "message": "Environment must be running"}
        )
    if env.status != "running":
        env.status = "running"
        await db.commit()

    token = await env_router._get_jupyter_token(db, str(env.id))
    if not token:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "jupyter_token_missing",
                "message": "Jupyter token is not configured. Recreate the environment.",
            },
        )

    return _ok({"launch_url": f"/?token={token}", "port": env.jupyter_port}, message="Jupyter launch URL created")


@router.post("/environments/{environment_id}/code/launch")
async def worker_create_code_launch_url(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(
            status_code=404, detail={"code": "environment_not_found", "message": "Environment not found"}
        )
    if not env.enable_code_server:
        raise HTTPException(
            status_code=409,
            detail={"code": "code_server_disabled", "message": "code-server is disabled for this environment"},
        )
    if env.status != "running" and not env_router._is_host_environment_running_now(env):
        raise HTTPException(
            status_code=409, detail={"code": "environment_not_running", "message": "Environment must be running"}
        )
    if env.status != "running":
        env.status = "running"
        await db.commit()

    return _ok({"launch_url": "/", "port": env.code_port}, message="Code launch URL created")
