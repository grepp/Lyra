import asyncio
import uuid
from types import SimpleNamespace

import docker
import pytest
from fastapi import HTTPException

from app.core.worker_registry import WORKER_HEALTH_HEALTHY, WorkerHealthResult, WorkerRequestError
from app.routers import environments as env_router
from app.routers import worker_servers as worker_servers_router


class _ScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items

    def first(self):
        return self._items[0] if self._items else None


class _ExecuteResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _ScalarResult(self._items)

    def all(self):
        return self._items


class _FakeDb:
    def __init__(self, envs=None, workers=None):
        self._envs = list(envs or [])
        self._workers = list(workers or [])
        self.commit_called = False

    async def execute(self, stmt, *_args, **_kwargs):
        sql = str(stmt)
        params = stmt.compile().params

        if "FROM environments" in sql:
            if "WHERE environments.id" in sql:
                wanted = str(params.get("id_1"))
                for env in self._envs:
                    if str(env.id) == wanted:
                        return _ExecuteResult([env])
                return _ExecuteResult([])
            return _ExecuteResult(self._envs)

        if "FROM worker_servers" in sql:
            if "WHERE worker_servers.id" in sql:
                wanted_ids = set()
                for key, value in params.items():
                    if not key.startswith("id_") or value is None:
                        continue
                    if isinstance(value, (list, tuple, set)):
                        wanted_ids.update(str(item) for item in value)
                    else:
                        wanted_ids.add(str(value))
                if wanted_ids:
                    matched = [worker for worker in self._workers if str(worker.id) in wanted_ids]
                    return _ExecuteResult(matched)
                wanted = str(params.get("id_1"))
                for worker in self._workers:
                    if str(worker.id) == wanted:
                        return _ExecuteResult([worker])
                return _ExecuteResult([])
            return _ExecuteResult(self._workers)

        return _ExecuteResult([])

    async def commit(self):
        self.commit_called = True

    async def flush(self):
        return None


def _env(name: str, status: str, worker_server_id=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        name=name,
        status=status,
        worker_server_id=worker_server_id,
        container_user="root",
        gpu_indices=[],
        ssh_port=20001,
        jupyter_port=25001,
        code_port=30001,
        enable_jupyter=True,
        enable_code_server=True,
        mount_config=[],
        created_at=None,
    )


def _worker(name: str):
    return SimpleNamespace(
        id=uuid.uuid4(),
        name=name,
        is_active=True,
        base_url=f"http://{name}.local:8000",
        last_health_status="unknown",
        last_error_message=None,
    )


def test_read_environments_multi_worker_mixed_health(monkeypatch):
    worker_ok = _worker("worker-ok")
    worker_down = _worker("worker-down")

    local_env = _env("local-env", "running")
    remote_ok = _env("remote-ok", "building", worker_server_id=worker_ok.id)
    remote_down = _env("remote-down", "running", worker_server_id=worker_down.id)

    db = _FakeDb(envs=[local_env, remote_ok, remote_down], workers=[worker_ok, worker_down])

    async def _fake_custom_ports_map(_db):
        return {}

    async def _fake_refresh_health(_db, worker):
        if str(worker.id) == str(worker_ok.id):
            worker.last_health_status = WORKER_HEALTH_HEALTHY
            worker.last_error_message = None
            return WorkerHealthResult(status=WORKER_HEALTH_HEALTHY, message="ok")
        worker.last_health_status = "unreachable"
        worker.last_error_message = "connect failed"
        return WorkerHealthResult(status="unreachable", message="connect failed")

    async def _fake_call_worker_api(worker, *, method, path, payload=None, timeout=None):
        assert method == "GET"
        assert payload is None
        assert timeout is None
        if str(worker.id) != str(worker_ok.id):
            raise WorkerRequestError("worker_unreachable", "connect failed", status_code=503)
        return {"status": "running", "container_id": "abcdef1234567890"}

    monkeypatch.setattr(env_router, "_get_custom_ports_map", _fake_custom_ports_map)
    monkeypatch.setattr(env_router, "refresh_worker_health", _fake_refresh_health)
    monkeypatch.setattr(env_router, "call_worker_api", _fake_call_worker_api)
    monkeypatch.setattr(env_router.docker, "from_env", lambda: (_ for _ in ()).throw(docker.errors.DockerException("down")))

    result = asyncio.run(env_router.read_environments(skip=0, limit=100, db=db))

    assert len(result) == 3
    by_name = {row["name"]: row for row in result}

    assert by_name["local-env"]["worker_server_name"] is None
    assert by_name["local-env"]["worker_error_code"] is None

    assert by_name["remote-ok"]["worker_server_name"] == "worker-ok"
    assert by_name["remote-ok"]["worker_error_code"] is None
    assert by_name["remote-ok"]["status"] == "running"
    assert by_name["remote-ok"]["container_id"] == "abcdef123456"

    assert by_name["remote-down"]["worker_server_name"] == "worker-down"
    assert by_name["remote-down"]["worker_error_code"] == "worker_health_unreachable"
    assert by_name["remote-down"]["worker_error_message"] == "connect failed"
    assert by_name["remote-down"]["status"] == "error"
    assert db.commit_called is True


def test_read_environment_worker_error_payload(monkeypatch):
    worker = _worker("worker-fail")
    env = _env("remote-env", "running", worker_server_id=worker.id)
    db = _FakeDb(envs=[env], workers=[worker])

    async def _fake_call_worker_api(_worker, *, method, path, payload=None, timeout=None):
        assert method == "GET"
        assert path.endswith(f"/{env.id}")
        raise WorkerRequestError("worker_request_failed", "upstream error", status_code=502)

    monkeypatch.setattr(env_router, "call_worker_api", _fake_call_worker_api)

    result = asyncio.run(env_router.read_environment(environment_id=str(env.id), db=db))

    assert result["worker_server_name"] == "worker-fail"
    assert result["worker_error_code"] == "worker_request_failed"
    assert result["worker_error_message"] == "upstream error"
    assert result["status"] == "error"
    assert db.commit_called is True


def test_worker_gpu_proxy_maps_worker_error(monkeypatch):
    worker = _worker("gpu-worker")
    db = _FakeDb(workers=[worker])

    async def _fake_assert_ready(_db, worker_id):
        assert str(worker_id) == str(worker.id)
        return worker

    async def _fake_call_worker_api(_worker, *, method, path, payload=None, timeout=None):
        assert method == "GET"
        assert path == "/api/worker/gpu"
        raise WorkerRequestError("worker_auth_failed", "Invalid worker API token", status_code=502)

    monkeypatch.setattr(worker_servers_router, "_assert_worker_ready", _fake_assert_ready)
    monkeypatch.setattr(worker_servers_router, "call_worker_api", _fake_call_worker_api)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(worker_servers_router.get_worker_gpu_resources(worker_id=str(worker.id), db=db))

    http_exc = exc.value
    assert getattr(http_exc, "status_code", None) == 502
    assert getattr(http_exc, "detail", {}).get("code") == "worker_auth_failed"
