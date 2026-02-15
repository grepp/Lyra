import asyncio
import uuid

import docker

from app.routers import environments as env_router


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
        self._envs = envs
        self.commit_called = False

    async def execute(self, *_args, **_kwargs):
        return _ExecuteResult(self._envs)

    async def commit(self):
        self.commit_called = True


class _EnvRow:
    def __init__(self, name: str, status: str):
        self.id = uuid.uuid4()
        self.name = name
        self.status = status


class _Container:
    def __init__(self, status: str = "running", exit_code=None, oom_killed=False, error_msg="", short_id="abc123def456"):
        self.status = status
        self.short_id = short_id
        self.id = short_id
        self.attrs = {
            "State": {
                "Status": status,
                "ExitCode": exit_code,
                "OOMKilled": oom_killed,
                "Error": error_msg,
            }
        }


class _ContainerStore:
    def __init__(self, mapping):
        self._mapping = mapping

    def get(self, name):
        value = self._mapping[name]
        if isinstance(value, Exception):
            raise value
        return value


class _DockerClient:
    def __init__(self, mapping):
        self.containers = _ContainerStore(mapping)


def test_read_environments_returns_db_rows_when_docker_daemon_unavailable(monkeypatch):
    env = _EnvRow(name="degraded-test", status="running")
    db = _FakeDb([env])

    async def _fake_custom_ports_map(_db):
        return {}

    monkeypatch.setattr(env_router, "_get_custom_ports_map", _fake_custom_ports_map)
    monkeypatch.setattr(env_router.docker, "from_env", lambda: (_ for _ in ()).throw(docker.errors.DockerException("down")))

    result = asyncio.run(env_router.read_environments(skip=0, limit=100, db=db))

    assert len(result) == 1
    assert result[0]["id"] == env.id
    assert result[0]["status"] == "running"
    assert result[0]["container_id"] is None
    assert db.commit_called is False


def test_read_environments_handles_per_environment_docker_failures(monkeypatch):
    env_ok = _EnvRow(name="ok-env", status="building")
    env_fail = _EnvRow(name="fail-env", status="running")
    db = _FakeDb([env_ok, env_fail])

    async def _fake_custom_ports_map(_db):
        return {}

    ok_name = f"lyra-{env_ok.name}-{env_ok.id}"
    fail_name = f"lyra-{env_fail.name}-{env_fail.id}"
    client = _DockerClient(
        {
            ok_name: _Container(status="running"),
            fail_name: docker.errors.DockerException("inspect failed"),
        }
    )

    monkeypatch.setattr(env_router, "_get_custom_ports_map", _fake_custom_ports_map)
    monkeypatch.setattr(env_router.docker, "from_env", lambda: client)

    result = asyncio.run(env_router.read_environments(skip=0, limit=100, db=db))

    assert len(result) == 2
    assert env_ok.status == "running"
    assert env_fail.status == "running"
    assert db.commit_called is True
