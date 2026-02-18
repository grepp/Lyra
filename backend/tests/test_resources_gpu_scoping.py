import asyncio
import uuid
from types import SimpleNamespace

from app.routers import resources as resources_router


class _ScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _ExecuteResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _ScalarResult(self._items)


class _FakeDb:
    def __init__(self, envs):
        self._envs = list(envs)

    async def execute(self, stmt, *_args, **_kwargs):
        sql = str(stmt)
        envs = self._envs
        if "worker_server_id IS NULL" in sql:
            envs = [env for env in envs if getattr(env, "worker_server_id", None) is None]
        if "status IN" in sql:
            envs = [env for env in envs if getattr(env, "status", None) in {"running", "building"}]
        return _ExecuteResult(envs)


def _env(status: str, gpu_indices, worker_server_id=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        gpu_indices=list(gpu_indices),
        worker_server_id=worker_server_id,
    )


def test_get_gpu_resources_scopes_to_host_only(monkeypatch):
    worker_id = uuid.uuid4()
    db = _FakeDb(
        [
            _env("running", [0], worker_server_id=None),
            _env("building", [2], worker_server_id=None),
            _env("running", [1], worker_server_id=worker_id),
            _env("stopped", [3], worker_server_id=None),
        ]
    )

    monkeypatch.setattr(resources_router.pynvml, "nvmlInit", lambda: None)
    monkeypatch.setattr(resources_router.pynvml, "nvmlShutdown", lambda: None)
    monkeypatch.setattr(resources_router.pynvml, "nvmlDeviceGetCount", lambda: 4)

    result = asyncio.run(resources_router.get_gpu_resources(db=db))

    assert result["total"] == 4
    assert result["used"] == 2
    assert result["used_indices"] == [0, 2]
    assert result["available_indices"] == [1, 3]
