from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.database import get_db
from app.core.worker_auth import require_worker_api_auth, require_worker_role
from app.routers import worker_api
from app.routers import environments as env_router
from app.routers import resources as resource_router
from app.schemas import EnvironmentRootPasswordResetRequest


def _build_client():
    app = FastAPI()
    app.include_router(worker_api.router, prefix="/api")

    async def _fake_db():
        yield object()

    app.dependency_overrides[get_db] = _fake_db
    app.dependency_overrides[require_worker_role] = lambda: None
    app.dependency_overrides[require_worker_api_auth] = lambda: None
    return TestClient(app)


def test_worker_health_returns_standard_envelope():
    client = _build_client()
    response = client.get("/api/worker/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["code"] == "ok"
    assert body["data"]["role"] == "worker"


def test_worker_gpu_returns_standard_envelope(monkeypatch):
    async def _fake_gpu(*, db):
        return {"total_gpus": 1, "used_gpus": 0, "available_gpus": 1, "gpu_details": []}

    monkeypatch.setattr(resource_router, "get_gpu_resources", _fake_gpu)

    client = _build_client()
    response = client.get("/api/worker/gpu")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["code"] == "ok"
    assert body["data"]["total_gpus"] == 1


def test_worker_start_normalizes_http_exception(monkeypatch):
    async def _fake_start(*, environment_id, db):
        raise HTTPException(
            status_code=409,
            detail={"code": "environment_not_running", "message": "Environment must be running"},
        )

    monkeypatch.setattr(env_router, "start_environment", _fake_start)

    client = _build_client()
    response = client.post("/api/worker/environments/11111111-1111-1111-1111-111111111111/start")

    assert response.status_code == 409
    body = response.json()
    assert body["detail"]["code"] == "environment_not_running"
    assert body["detail"]["message"] == "Environment must be running"


def test_worker_root_password_reset_envelope(monkeypatch):
    async def _fake_reset(*, environment_id, payload: EnvironmentRootPasswordResetRequest, db):
        assert environment_id == "11111111-1111-1111-1111-111111111111"
        assert payload.new_password == "newpass123"
        return {"message": "Root password updated"}

    monkeypatch.setattr(env_router, "reset_environment_root_password", _fake_reset)

    client = _build_client()
    response = client.post(
        "/api/worker/environments/11111111-1111-1111-1111-111111111111/accounts/root/reset-password",
        json={"new_password": "newpass123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["code"] == "ok"
    assert body["data"]["message"] == "Root password updated"


def test_worker_root_password_reset_normalizes_error(monkeypatch):
    async def _fake_reset(*, environment_id, payload: EnvironmentRootPasswordResetRequest, db):
        del environment_id, payload, db
        raise HTTPException(
            status_code=409,
            detail={"code": "env_not_running", "message": "Environment must be running"},
        )

    monkeypatch.setattr(env_router, "reset_environment_root_password", _fake_reset)

    client = _build_client()
    response = client.post(
        "/api/worker/environments/11111111-1111-1111-1111-111111111111/accounts/root/reset-password",
        json={"new_password": "newpass123"},
    )

    assert response.status_code == 409
    body = response.json()
    assert body["detail"]["code"] == "env_not_running"
    assert body["detail"]["message"] == "Environment must be running"
