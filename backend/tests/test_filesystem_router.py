import asyncio
import sys
import types

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

from app.routers import filesystem as fs_router


class _FakeChannel:
    def recv_exit_status(self):
        return 0


class _FakeStream:
    def __init__(self, payload: str):
        self._payload = payload.encode("utf-8")
        self.channel = _FakeChannel()

    def read(self):
        return self._payload


class _FakeSshClient:
    def __init__(self, out: str = "", err: str = ""):
        self._out = out
        self._err = err
        self.closed = False

    def exec_command(self, _command: str, timeout: int = 10):
        return None, _FakeStream(self._out), _FakeStream(self._err)

    def close(self):
        self.closed = True


def test_list_host_directory_success_sorted_and_truncated(monkeypatch):
    output = "\n".join(
        [
            "__PATH__:/tmp/work",
            "z-file\t/tmp/work/z-file\tf\t1\t0",
            "a-dir\t/tmp/work/a-dir\td\t1\t1",
            "b-dir\t/tmp/work/b-dir\td\t1\t0",
        ]
    )
    ssh_client = _FakeSshClient(out=output)

    async def _fake_connect_host_ssh(_db, **_kwargs):
        return ssh_client

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)
    monkeypatch.setattr(fs_router, "MAX_HOST_FS_ENTRIES", 2)

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/tmp/work"),
            db=object(),
        )
    )

    assert result["status"] == "success"
    assert result["path"] == "/tmp/work"
    assert result["parent"] == "/tmp"
    assert result["truncated"] is True
    assert [entry["name"] for entry in result["entries"]] == ["a-dir", "b-dir"]
    assert all(entry["is_dir"] for entry in result["entries"])
    assert ssh_client.closed is True


def test_list_host_directory_returns_path_not_found(monkeypatch):
    ssh_client = _FakeSshClient(out="__ERR__:NOT_FOUND")

    async def _fake_connect_host_ssh(_db, **_kwargs):
        return ssh_client

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/nope"),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "path_not_found"
    assert ssh_client.closed is True


def test_list_host_directory_returns_permission_denied(monkeypatch):
    ssh_client = _FakeSshClient(out="__ERR__:PERMISSION_DENIED")

    async def _fake_connect_host_ssh(_db, **_kwargs):
        return ssh_client

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/root/secret"),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "permission_denied"
    assert ssh_client.closed is True


def test_list_host_directory_maps_ssh_config_error(monkeypatch):
    async def _fake_connect_host_ssh(_db, **_kwargs):
        raise RuntimeError("not configured")

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)
    monkeypatch.setattr(
        fs_router,
        "map_host_ssh_error",
        lambda _error: ("ssh_host_not_configured", "Host server is not configured."),
    )

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/"),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "ssh_not_configured"


def test_list_host_directory_maps_host_key_error(monkeypatch):
    async def _fake_connect_host_ssh(_db, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)
    monkeypatch.setattr(
        fs_router,
        "map_host_ssh_error",
        lambda _error: ("ssh_host_key_untrusted", "host key failure"),
    )

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/"),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "ssh_host_key_failed"


def test_list_host_directory_maps_ssh_auth_failed(monkeypatch):
    async def _fake_connect_host_ssh(_db, **_kwargs):
        raise RuntimeError("auth failed")

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)
    monkeypatch.setattr(
        fs_router,
        "map_host_ssh_error",
        lambda _error: ("ssh_auth_failed", "auth failed"),
    )

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/"),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "ssh_auth_failed"


def test_list_host_directory_maps_unknown_error_to_browse_failed(monkeypatch):
    async def _fake_connect_host_ssh(_db, **_kwargs):
        raise RuntimeError("unknown")

    monkeypatch.setattr(fs_router, "connect_host_ssh", _fake_connect_host_ssh)
    monkeypatch.setattr(
        fs_router,
        "map_host_ssh_error",
        lambda _error: ("ssh_connection_failed", "unknown"),
    )

    result = asyncio.run(
        fs_router.list_host_directory(
            req=fs_router.HostFsListRequest(path="/"),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "browse_failed"
