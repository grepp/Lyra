import asyncio
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.sql.elements import TextClause

from app.models import Environment, Setting
from app.routers import environments as env_router
from app.schemas import EnvironmentCreate


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


class _FakeBegin:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeDb:
    def __init__(self):
        self.env_by_id: dict[uuid.UUID, Environment] = {}
        self.env_by_name: dict[str, Environment] = {}
        self.settings_by_key: dict[str, Setting] = {}
        self.rollback_called = 0

    def begin(self):
        return _FakeBegin()

    async def rollback(self):
        self.rollback_called += 1

    async def commit(self):
        return None

    async def flush(self):
        for env in self.env_by_name.values():
            if env.id is None:
                env.id = uuid.uuid4()
                self.env_by_id[env.id] = env

    async def delete(self, obj):
        if isinstance(obj, Environment):
            if obj.id in self.env_by_id:
                self.env_by_id.pop(obj.id, None)
            else:
                remove_id = None
                for existing_id, existing_env in self.env_by_id.items():
                    if existing_env is obj:
                        remove_id = existing_id
                        break
                if remove_id is not None:
                    self.env_by_id.pop(remove_id, None)
            self.env_by_name.pop(obj.name, None)
        if isinstance(obj, Setting):
            self.settings_by_key.pop(obj.key, None)

    def add(self, obj):
        if isinstance(obj, Environment):
            self.env_by_name[obj.name] = obj
            if obj.id is not None:
                self.env_by_id[obj.id] = obj
            return
        if isinstance(obj, Setting):
            self.settings_by_key[obj.key] = obj

    async def execute(self, stmt, *_args, **_kwargs):
        if isinstance(stmt, TextClause):
            return _ExecuteResult([])

        sql = str(stmt)
        params = stmt.compile().params

        if "FROM environments" in sql:
            if "environments.name" in sql:
                name = params.get("name_1")
                item = self.env_by_name.get(name)
                return _ExecuteResult([item] if item else [])

            env_id = None
            for key, value in params.items():
                if key.startswith("id_"):
                    env_id = value
                    break
            item = None
            if env_id is not None:
                item = self.env_by_id.get(env_id)
                if item is None:
                    env_id_str = str(env_id)
                    for existing_id, existing_env in self.env_by_id.items():
                        if str(existing_id) == env_id_str:
                            item = existing_env
                            break
            if item is None and self.env_by_id:
                # Fallback for SQLAlchemy UUID bind/render differences in fake session.
                item = next(iter(self.env_by_id.values()))
            return _ExecuteResult([item] if item else [])

        if "FROM settings" in sql and "settings.key" in sql:
            key = params.get("key_1")
            item = self.settings_by_key.get(key)
            return _ExecuteResult([item] if item else [])

        return _ExecuteResult([])


def test_create_environment_rolls_back_rows_when_transaction_step_fails(monkeypatch):
    db = _FakeDb()
    payload = EnvironmentCreate(
        name="txn-rollback-test",
        container_user="root",
        root_password="pw",
        dockerfile_content="FROM python:3.11-slim\nRUN echo ok\n",
        mount_config=[],
        custom_ports=[],
        gpu_count=0,
        selected_gpu_indices=[],
        enable_jupyter=True,
        enable_code_server=True,
    )

    async def _fake_blocked_ports(_db):
        return set()

    async def _fake_allocate_ports(_db):
        raise HTTPException(
            status_code=503,
            detail={"code": "port_allocation_failed", "message": "simulated"},
        )

    monkeypatch.setattr(env_router, "_collect_blocked_host_ports", _fake_blocked_ports)
    monkeypatch.setattr(env_router, "_allocate_ports", _fake_allocate_ports)
    monkeypatch.setattr(env_router, "encrypt_secret", lambda _v: "encrypted-secret")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(env_router.create_environment(payload, db=db))

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "port_allocation_failed"
    assert db.rollback_called >= 1
    assert db.env_by_id == {}
    assert db.env_by_name == {}
    assert db.settings_by_key == {}


def test_create_environment_rolls_back_rows_when_enqueue_fails(monkeypatch):
    db = _FakeDb()
    payload = EnvironmentCreate(
        name="txn-enqueue-fail-test",
        container_user="root",
        root_password="pw",
        dockerfile_content="FROM python:3.11-slim\nRUN echo ok\n",
        mount_config=[],
        custom_ports=[],
        gpu_count=0,
        selected_gpu_indices=[],
        enable_jupyter=True,
        enable_code_server=True,
    )

    async def _fake_blocked_ports(_db):
        return set()

    async def _fake_allocate_ports(_db):
        return (20001, 25001, 30001)

    class _FakeDelay:
        @staticmethod
        def delay(_value):
            raise RuntimeError("enqueue failed")

    monkeypatch.setattr(env_router, "_collect_blocked_host_ports", _fake_blocked_ports)
    monkeypatch.setattr(env_router, "_allocate_ports", _fake_allocate_ports)
    monkeypatch.setattr(env_router, "encrypt_secret", lambda _v: "encrypted-secret")
    monkeypatch.setattr(env_router, "create_environment_task", _FakeDelay)
    monkeypatch.setattr(env_router.secrets, "token_urlsafe", lambda _n: "fixed-token")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(env_router.create_environment(payload, db=db))

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "task_enqueue_failed"
    assert db.rollback_called >= 1


def test_worker_create_environment_cleans_up_remote_when_local_persist_fails(monkeypatch):
    db = _FakeDb()
    worker_id = uuid.uuid4()
    remote_env_id = uuid.uuid4()
    payload = EnvironmentCreate(
        name="txn-worker-cleanup-test",
        worker_server_id=worker_id,
        container_user="root",
        root_password="pw",
        dockerfile_content="FROM python:3.11-slim\nRUN echo ok\n",
        mount_config=[],
        custom_ports=[],
        gpu_count=0,
        selected_gpu_indices=[],
        enable_jupyter=True,
        enable_code_server=True,
    )

    async def _fake_assert_worker_ready(_db, _worker_id):
        return SimpleNamespace(id=worker_id)

    cleanup_calls: list[str] = []

    async def _fake_call_worker_api(worker, *, method, path, payload=None, timeout=None):
        del worker, payload, timeout
        if method == "POST" and path == "/api/worker/environments":
            return {
                "id": str(remote_env_id),
                "status": "building",
                "gpu_indices": [],
                "custom_ports": [],
            }
        if method == "DELETE" and path == f"/api/worker/environments/{remote_env_id}":
            cleanup_calls.append(path)
            return {"status": "deleted"}
        raise AssertionError(f"unexpected worker api call: {method} {path}")

    async def _fake_allocate_remote_surrogate_ports(_db):
        raise HTTPException(
            status_code=503,
            detail={"code": "port_allocation_failed", "message": "simulated"},
        )

    monkeypatch.setattr(env_router, "_assert_worker_is_ready", _fake_assert_worker_ready)
    monkeypatch.setattr(env_router, "call_worker_api", _fake_call_worker_api)
    monkeypatch.setattr(env_router, "_allocate_remote_surrogate_ports", _fake_allocate_remote_surrogate_ports)
    monkeypatch.setattr(env_router, "encrypt_secret", lambda _v: "encrypted-secret")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(env_router.create_environment(payload, db=db))

    assert exc.value.status_code == 503
    assert cleanup_calls == [f"/api/worker/environments/{remote_env_id}"]
