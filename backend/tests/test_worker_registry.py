import asyncio
import sys
import types
import uuid

import httpx
if "paramiko" not in sys.modules:
    paramiko_stub = types.ModuleType("paramiko")

    class _Dummy:
        @staticmethod
        def from_private_key(*_args, **_kwargs):
            return object()

    paramiko_stub.SSHClient = type("SSHClient", (), {})
    paramiko_stub.AutoAddPolicy = type("AutoAddPolicy", (), {})
    paramiko_stub.RejectPolicy = type("RejectPolicy", (), {})
    paramiko_stub.RSAKey = _Dummy
    paramiko_stub.Ed25519Key = _Dummy
    paramiko_stub.ECDSAKey = _Dummy
    paramiko_stub.PKey = _Dummy
    paramiko_stub.Transport = type("Transport", (), {})
    paramiko_stub.BadHostKeyException = type("BadHostKeyException", (Exception,), {})
    paramiko_stub.AuthenticationException = type("AuthenticationException", (Exception,), {})
    paramiko_stub.SSHException = type("SSHException", (Exception,), {})
    sys.modules["paramiko"] = paramiko_stub

from app.core import worker_registry
from app.models import WorkerServer


class _FakeDb:
    def __init__(self):
        self.flush_calls = 0

    async def flush(self):
        self.flush_calls += 1


def test_normalize_worker_base_url():
    assert worker_registry.normalize_worker_base_url(" https://worker-1.local/ ") == "https://worker-1.local"
    assert worker_registry.normalize_worker_base_url("http://127.0.0.1:8000///") == "http://127.0.0.1:8000"
    assert worker_registry.normalize_worker_base_url("") == ""


def test_check_worker_health_healthy(monkeypatch):
    async def _fake_request(_base_url, _api_token, _timeout):
        return 200, {"status": "ok", "role": "worker"}

    monkeypatch.setattr(worker_registry, "_request_worker_health", _fake_request)
    cfg = worker_registry.WorkerConnectionConfig(
        id="1",
        name="worker-1",
        base_url="http://worker.local",
        api_token="token",
    )
    result = asyncio.run(worker_registry.check_worker_health(cfg))
    assert result.status == worker_registry.WORKER_HEALTH_HEALTHY


def test_check_worker_health_auth_failed(monkeypatch):
    async def _fake_request(_base_url, _api_token, _timeout):
        return 401, {"detail": "Invalid worker API token"}

    monkeypatch.setattr(worker_registry, "_request_worker_health", _fake_request)
    cfg = worker_registry.WorkerConnectionConfig(
        id="1",
        name="worker-1",
        base_url="http://worker.local",
        api_token="bad-token",
    )
    result = asyncio.run(worker_registry.check_worker_health(cfg))
    assert result.status == worker_registry.WORKER_HEALTH_AUTH_FAILED


def test_check_worker_health_api_mismatch(monkeypatch):
    async def _fake_request(_base_url, _api_token, _timeout):
        return 200, {"status": "ok", "role": "main"}

    monkeypatch.setattr(worker_registry, "_request_worker_health", _fake_request)
    cfg = worker_registry.WorkerConnectionConfig(
        id="1",
        name="worker-1",
        base_url="http://worker.local",
        api_token="token",
    )
    result = asyncio.run(worker_registry.check_worker_health(cfg))
    assert result.status == worker_registry.WORKER_HEALTH_API_MISMATCH


def test_build_worker_connection_config_decrypts_token(monkeypatch):
    monkeypatch.setattr(worker_registry, "decrypt_secret", lambda _value: "plain-token")
    worker = WorkerServer(
        name="worker-1",
        base_url="http://worker.local/",
        api_token_encrypted="encrypted-token",
    )
    cfg = worker_registry.build_worker_connection_config(worker)
    assert cfg.base_url == "http://worker.local"
    assert cfg.api_token == "plain-token"


def test_check_worker_health_retries_once_on_connect_error(monkeypatch):
    calls = {"count": 0}

    async def _fake_request(_base_url, _api_token, _timeout):
        calls["count"] += 1
        if calls["count"] == 1:
            raise httpx.ConnectError("connect failed")
        return 200, {"status": "ok", "role": "worker"}

    monkeypatch.setattr(worker_registry, "_request_worker_health", _fake_request)
    cfg = worker_registry.WorkerConnectionConfig(
        id="1",
        name="worker-1",
        base_url="http://worker.local",
        api_token="token",
    )
    result = asyncio.run(worker_registry.check_worker_health(cfg))
    assert calls["count"] == 2
    assert result.status == worker_registry.WORKER_HEALTH_HEALTHY


def test_refresh_worker_health_uses_cache(monkeypatch):
    calls = {"count": 0}
    db = _FakeDb()
    worker = WorkerServer(
        id=uuid.uuid4(),
        name="worker-1",
        base_url="http://worker.local",
        api_token_encrypted="enc",
    )

    def _fake_build(_worker):
        return worker_registry.WorkerConnectionConfig(
            id=str(_worker.id),
            name=_worker.name,
            base_url=_worker.base_url,
            api_token="token",
        )

    async def _fake_check(_config, timeout=None):
        calls["count"] += 1
        return worker_registry.WorkerHealthResult(status=worker_registry.WORKER_HEALTH_HEALTHY, message="ok")

    monkeypatch.setattr(worker_registry, "build_worker_connection_config", _fake_build)
    monkeypatch.setattr(worker_registry, "check_worker_health", _fake_check)

    first = asyncio.run(worker_registry.refresh_worker_health(db, worker, use_cache=True))
    second = asyncio.run(worker_registry.refresh_worker_health(db, worker, use_cache=True))

    assert first.status == worker_registry.WORKER_HEALTH_HEALTHY
    assert second.status == worker_registry.WORKER_HEALTH_HEALTHY
    assert calls["count"] == 1
    assert db.flush_calls == 1
