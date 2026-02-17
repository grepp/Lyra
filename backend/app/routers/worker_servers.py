from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..core.security import SecretCipherError, SecretKeyError, encrypt_secret
from ..core.worker_registry import (
    WORKER_HEALTH_HEALTHY,
    WorkerRequestError,
    call_worker_api,
    refresh_worker_health,
)
from ..database import get_db
from ..models import Environment, WorkerServer
from ..schemas import WorkerServerCreate, WorkerServerResponse, WorkerServerUpdate


router = APIRouter(
    prefix="/worker-servers",
    tags=["worker-servers"],
)


def _normalize_base_url(base_url: str) -> str:
    return (base_url or "").strip().rstrip("/")


def _is_unique_violation(error: IntegrityError, key: str) -> bool:
    text = f"{error}".lower()
    if error.orig is not None:
        text += f" {error.orig}".lower()
    if key == "name":
        return "uq_worker_servers_name" in text or ("duplicate key value" in text and "(name)" in text)
    if key == "base_url":
        return "uq_worker_servers_base_url" in text or ("duplicate key value" in text and "(base_url)" in text)
    return False


async def _assert_worker_ready(db: AsyncSession, worker_id: str) -> WorkerServer:
    result = await db.execute(select(WorkerServer).where(WorkerServer.id == worker_id))
    worker = result.scalars().first()
    if not worker:
        raise HTTPException(status_code=404, detail={"code": "worker_not_found", "message": "Worker server not found"})
    if not worker.is_active:
        raise HTTPException(status_code=409, detail={"code": "worker_inactive", "message": "Worker server is inactive"})
    health = await refresh_worker_health(db, worker)
    await db.commit()
    if health.status != WORKER_HEALTH_HEALTHY:
        raise HTTPException(status_code=503, detail={"code": "worker_unreachable", "message": health.message})
    return worker


def _map_worker_request_error(error: WorkerRequestError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )


@router.get("/", response_model=list[WorkerServerResponse])
async def list_worker_servers(
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WorkerServer).order_by(WorkerServer.created_at.asc(), WorkerServer.name.asc()))
    workers = result.scalars().all()
    if refresh:
        for worker in workers:
            await refresh_worker_health(db, worker)
        await db.commit()
    return workers


@router.post("/", response_model=WorkerServerResponse, status_code=status.HTTP_201_CREATED)
async def create_worker_server(payload: WorkerServerCreate, db: AsyncSession = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=400, detail={"code": "worker_name_required", "message": "Worker name is required"}
        )

    base_url = _normalize_base_url(payload.base_url)
    if not base_url:
        raise HTTPException(
            status_code=400, detail={"code": "worker_base_url_required", "message": "Worker base URL is required"}
        )

    api_token = (payload.api_token or "").strip()
    if not api_token:
        raise HTTPException(
            status_code=400, detail={"code": "worker_api_token_required", "message": "Worker API token is required"}
        )

    try:
        encrypted_token = encrypt_secret(api_token)
    except SecretKeyError as error:
        raise HTTPException(status_code=500, detail={"code": "security_key_missing", "message": str(error)}) from error
    except SecretCipherError as error:
        raise HTTPException(
            status_code=500, detail={"code": "token_encryption_failed", "message": str(error)}
        ) from error

    worker = WorkerServer(
        name=name,
        base_url=base_url,
        api_token_encrypted=encrypted_token,
        is_active=payload.is_active,
    )
    db.add(worker)

    try:
        await db.flush()
        await refresh_worker_health(db, worker)
        await db.commit()
        await db.refresh(worker)
        return worker
    except IntegrityError as error:
        await db.rollback()
        if _is_unique_violation(error, "name"):
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_worker_name", "message": "Worker server name already exists"},
            ) from error
        if _is_unique_violation(error, "base_url"):
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_worker_base_url", "message": "Worker server base URL already exists"},
            ) from error
        raise


@router.put("/{worker_id}", response_model=WorkerServerResponse)
async def update_worker_server(worker_id: str, payload: WorkerServerUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WorkerServer).where(WorkerServer.id == worker_id))
    worker = result.scalars().first()
    if not worker:
        raise HTTPException(status_code=404, detail={"code": "worker_not_found", "message": "Worker server not found"})

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(
                status_code=400,
                detail={"code": "worker_name_required", "message": "Worker name is required"},
            )
        worker.name = name

    if payload.base_url is not None:
        base_url = _normalize_base_url(payload.base_url)
        if not base_url:
            raise HTTPException(
                status_code=400,
                detail={"code": "worker_base_url_required", "message": "Worker base URL is required"},
            )
        worker.base_url = base_url

    if payload.is_active is not None:
        worker.is_active = payload.is_active

    if payload.api_token is not None:
        api_token = payload.api_token.strip()
        if not api_token:
            raise HTTPException(
                status_code=400,
                detail={"code": "worker_api_token_required", "message": "Worker API token is required"},
            )
        try:
            worker.api_token_encrypted = encrypt_secret(api_token)
        except SecretKeyError as error:
            raise HTTPException(
                status_code=500, detail={"code": "security_key_missing", "message": str(error)}
            ) from error
        except SecretCipherError as error:
            raise HTTPException(
                status_code=500, detail={"code": "token_encryption_failed", "message": str(error)}
            ) from error

    try:
        await db.flush()
        await refresh_worker_health(db, worker)
        await db.commit()
        await db.refresh(worker)
        return worker
    except IntegrityError as error:
        await db.rollback()
        if _is_unique_violation(error, "name"):
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_worker_name", "message": "Worker server name already exists"},
            ) from error
        if _is_unique_violation(error, "base_url"):
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_worker_base_url", "message": "Worker server base URL already exists"},
            ) from error
        raise


@router.post("/{worker_id}/health-check", response_model=WorkerServerResponse)
async def check_worker_server_health(worker_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WorkerServer).where(WorkerServer.id == worker_id))
    worker = result.scalars().first()
    if not worker:
        raise HTTPException(status_code=404, detail={"code": "worker_not_found", "message": "Worker server not found"})

    await refresh_worker_health(db, worker)
    await db.commit()
    await db.refresh(worker)
    return worker


@router.get("/{worker_id}/gpu")
async def get_worker_gpu_resources(worker_id: str, db: AsyncSession = Depends(get_db)):
    worker = await _assert_worker_ready(db, worker_id)
    try:
        return await call_worker_api(
            worker,
            method="GET",
            path="/api/worker/gpu",
        )
    except WorkerRequestError as error:
        raise _map_worker_request_error(error) from error


@router.delete("/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_worker_server(worker_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WorkerServer).where(WorkerServer.id == worker_id))
    worker = result.scalars().first()
    if not worker:
        raise HTTPException(status_code=404, detail={"code": "worker_not_found", "message": "Worker server not found"})

    env_result = await db.execute(select(Environment.id).where(Environment.worker_server_id == worker.id).limit(1))
    if env_result.scalars().first():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "worker_server_in_use",
                "message": "Worker server is assigned to environments. Reassign or delete those environments first.",
            },
        )

    await db.delete(worker)
    await db.commit()
    return None
