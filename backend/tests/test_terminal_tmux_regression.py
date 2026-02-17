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

from app.routers import terminal


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
    def __init__(self, out: str):
        self._out = out
        self.closed = False

    def exec_command(self, _command: str, timeout: int = 20):
        return None, _FakeStream(self._out), _FakeStream("")

    def close(self):
        self.closed = True


def test_list_tmux_sessions_maps_common_host_error(monkeypatch):
    async def _fake_connect_terminal_ssh(_db, _private_key=None):
        raise RuntimeError("ssh missing")

    monkeypatch.setattr(terminal, "_connect_terminal_ssh", _fake_connect_terminal_ssh)
    monkeypatch.setattr(
        terminal,
        "map_host_ssh_error",
        lambda _err: ("ssh_host_not_configured", "Host server is not configured."),
    )

    result = asyncio.run(
        terminal.list_tmux_sessions(
            req=terminal.TmuxSessionListRequest(privateKey=None),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "ssh_host_not_configured"


def test_list_tmux_sessions_parses_formatted_output(monkeypatch):
    out = "lyra_a\\t1\\t2\nlyra_b\\t0\\t1\n__FALLBACK__\n"
    ssh_client = _FakeSshClient(out=out)

    async def _fake_connect_terminal_ssh(_db, _private_key=None):
        return ssh_client

    monkeypatch.setattr(terminal, "_connect_terminal_ssh", _fake_connect_terminal_ssh)

    result = asyncio.run(
        terminal.list_tmux_sessions(
            req=terminal.TmuxSessionListRequest(privateKey=None),
            db=object(),
        )
    )

    assert result["status"] == "success"
    assert result["installed"] is True
    assert [item["name"] for item in result["sessions"]] == ["lyra_a", "lyra_b"]
    assert ssh_client.closed is True


def test_kill_tmux_sessions_returns_not_installed_when_missing(monkeypatch):
    ssh_client = _FakeSshClient(out="__NO_TMUX__")

    async def _fake_connect_terminal_ssh(_db, _private_key=None):
        return ssh_client

    monkeypatch.setattr(terminal, "_connect_terminal_ssh", _fake_connect_terminal_ssh)

    result = asyncio.run(
        terminal.kill_tmux_sessions(
            req=terminal.TmuxSessionKillRequest(privateKey=None, session_names=["sess_a"]),
            db=object(),
        )
    )

    assert result["status"] == "error"
    assert result["code"] == "tmux_not_installed"
    assert ssh_client.closed is True
