from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import WorkerServer
from .security import SecretCipherError, SecretKeyError, decrypt_secret


WORKER_HEALTH_HEALTHY = "healthy"
WORKER_HEALTH_UNREACHABLE = "unreachable"
WORKER_HEALTH_AUTH_FAILED = "auth_failed"
WORKER_HEALTH_MISCONFIGURED = "misconfigured"
WORKER_HEALTH_API_MISMATCH = "api_mismatch"
WORKER_HEALTH_REQUEST_FAILED = "request_failed"
WORKER_HEALTH_INACTIVE = "inactive"
WORKER_HEALTH_UNKNOWN = "unknown"


@dataclass
class WorkerConnectionConfig:
    id: str
    name: str
    base_url: str
    api_token: str
    is_active: bool


@dataclass
class WorkerHealthResult:
    status: str
    message: str
    http_status: int | None = None
    latency_ms: int | None = None


class WorkerRequestError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 503):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_worker_base_url(base_url: str) -> str:
    return (base_url or "").strip().rstrip("/")


def _resolve_worker_timeout() -> float:
    raw = (os.getenv("LYRA_WORKER_HTTP_TIMEOUT", "") or "").strip()
    try:
        value = float(raw) if raw else 5.0
    except ValueError:
        value = 5.0
    if value < 1.0:
        return 1.0
    if value > 30.0:
        return 30.0
    return value


def _build_worker_api_url(base_url: str, path: str) -> str:
    normalized = normalize_worker_base_url(base_url)
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{normalized}{path}"


async def _request_worker_health(base_url: str, api_token: str, timeout: float) -> tuple[int, dict[str, Any]]:
    url = _build_worker_api_url(base_url, "/api/worker/health")
    headers = {"Authorization": f"Bearer {api_token}"}

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url, headers=headers)
    payload: dict[str, Any] = {}
    try:
        payload = response.json() if response.content else {}
    except Exception:
        payload = {}
    return response.status_code, payload


async def _request_worker_json(
    *,
    base_url: str,
    api_token: str,
    method: str,
    path: str,
    timeout: float,
    payload: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    url = _build_worker_api_url(base_url, path)
    headers = {"Authorization": f"Bearer {api_token}"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.request(method=method.upper(), url=url, headers=headers, json=payload)

    body: dict[str, Any] = {}
    try:
        body = response.json() if response.content else {}
    except Exception:
        body = {}
    return response.status_code, body


def build_worker_connection_config(worker: WorkerServer) -> WorkerConnectionConfig:
    token = decrypt_secret(worker.api_token_encrypted)
    return WorkerConnectionConfig(
        id=str(worker.id),
        name=worker.name,
        base_url=normalize_worker_base_url(worker.base_url),
        api_token=token,
        is_active=bool(worker.is_active),
    )


async def check_worker_health(config: WorkerConnectionConfig, timeout: float | None = None) -> WorkerHealthResult:
    if not config.is_active:
        return WorkerHealthResult(status=WORKER_HEALTH_INACTIVE, message="Worker is inactive")
    if not config.base_url:
        return WorkerHealthResult(status=WORKER_HEALTH_MISCONFIGURED, message="Worker base URL is empty")
    if not config.api_token:
        return WorkerHealthResult(status=WORKER_HEALTH_MISCONFIGURED, message="Worker API token is empty")

    request_timeout = timeout if timeout is not None else _resolve_worker_timeout()
    started_at = _now_utc()
    try:
        http_status, payload = await _request_worker_health(config.base_url, config.api_token, request_timeout)
    except httpx.TimeoutException:
        return WorkerHealthResult(status=WORKER_HEALTH_UNREACHABLE, message="Worker request timed out")
    except httpx.ConnectError:
        return WorkerHealthResult(status=WORKER_HEALTH_UNREACHABLE, message="Failed to connect to worker")
    except httpx.HTTPError as error:
        return WorkerHealthResult(status=WORKER_HEALTH_REQUEST_FAILED, message=f"Worker HTTP error: {error}")
    except Exception as error:  # noqa: BLE001
        return WorkerHealthResult(status=WORKER_HEALTH_REQUEST_FAILED, message=f"Worker request failed: {error}")

    latency_ms = int((_now_utc() - started_at).total_seconds() * 1000)

    if http_status in {401, 403}:
        return WorkerHealthResult(
            status=WORKER_HEALTH_AUTH_FAILED,
            message="Worker authentication failed",
            http_status=http_status,
            latency_ms=latency_ms,
        )

    if http_status != 200:
        return WorkerHealthResult(
            status=WORKER_HEALTH_REQUEST_FAILED,
            message=f"Worker responded with unexpected status: {http_status}",
            http_status=http_status,
            latency_ms=latency_ms,
        )

    if payload.get("status") != "ok" or payload.get("role") != "worker":
        return WorkerHealthResult(
            status=WORKER_HEALTH_API_MISMATCH,
            message="Worker health payload mismatch",
            http_status=http_status,
            latency_ms=latency_ms,
        )

    return WorkerHealthResult(
        status=WORKER_HEALTH_HEALTHY,
        message="Worker is healthy",
        http_status=http_status,
        latency_ms=latency_ms,
    )


async def refresh_worker_health(db: AsyncSession, worker: WorkerServer) -> WorkerHealthResult:
    checked_at = _now_utc()
    try:
        config = build_worker_connection_config(worker)
    except (SecretCipherError, SecretKeyError) as error:
        result = WorkerHealthResult(status=WORKER_HEALTH_MISCONFIGURED, message=str(error))
    except Exception as error:  # noqa: BLE001
        result = WorkerHealthResult(status=WORKER_HEALTH_MISCONFIGURED, message=f"Worker config error: {error}")
    else:
        result = await check_worker_health(config)

    worker.last_health_status = result.status
    worker.last_health_checked_at = checked_at
    worker.last_error_message = None if result.status == WORKER_HEALTH_HEALTHY else result.message
    await db.flush()
    return result


async def refresh_all_worker_health(db: AsyncSession) -> list[tuple[WorkerServer, WorkerHealthResult]]:
    result = await db.execute(select(WorkerServer))
    workers = result.scalars().all()
    output: list[tuple[WorkerServer, WorkerHealthResult]] = []

    for worker in workers:
        health = await refresh_worker_health(db, worker)
        output.append((worker, health))

    return output


async def call_worker_api(
    worker: WorkerServer,
    *,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    try:
        config = build_worker_connection_config(worker)
    except (SecretCipherError, SecretKeyError) as error:
        raise WorkerRequestError("worker_misconfigured", str(error), status_code=503) from error
    except Exception as error:  # noqa: BLE001
        raise WorkerRequestError("worker_misconfigured", f"Worker config error: {error}", status_code=503) from error

    request_timeout = timeout if timeout is not None else _resolve_worker_timeout()
    try:
        http_status, body = await _request_worker_json(
            base_url=config.base_url,
            api_token=config.api_token,
            method=method,
            path=path,
            timeout=request_timeout,
            payload=payload,
        )
    except httpx.TimeoutException as error:
        raise WorkerRequestError("worker_unreachable", "Worker request timed out", status_code=503) from error
    except httpx.ConnectError as error:
        raise WorkerRequestError("worker_unreachable", "Failed to connect to worker", status_code=503) from error
    except httpx.HTTPError as error:
        raise WorkerRequestError("worker_request_failed", f"Worker HTTP error: {error}", status_code=503) from error
    except Exception as error:  # noqa: BLE001
        raise WorkerRequestError("worker_request_failed", f"Worker request failed: {error}", status_code=503) from error

    if http_status in {401, 403}:
        raise WorkerRequestError("worker_auth_failed", "Worker authentication failed", status_code=502)
    if http_status >= 400:
        detail = ""
        if isinstance(body, dict):
            detail = str(body.get("detail") or body.get("message") or "").strip()
        if not detail:
            detail = f"Worker responded with status {http_status}"
        raise WorkerRequestError("worker_request_failed", detail, status_code=502)
    if not isinstance(body, dict):
        raise WorkerRequestError("worker_api_mismatch", "Worker response payload is invalid", status_code=502)

    return body
