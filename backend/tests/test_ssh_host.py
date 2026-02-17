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

from app.core import ssh_host


def test_resolve_ssh_target_host_maps_localhost_variants():
    assert ssh_host.resolve_ssh_target_host("localhost") == "host.docker.internal"
    assert ssh_host.resolve_ssh_target_host("127.0.0.1") == "host.docker.internal"
    assert ssh_host.resolve_ssh_target_host("10.0.0.2") == "10.0.0.2"


def test_connect_host_ssh_applies_localhost_mapping(monkeypatch):
    captured = {}

    async def _fake_load_host_ssh_settings(_db):
        return ssh_host.HostSshSettings(
            host="localhost",
            port=22,
            username="root",
            auth_method="password",
            password="pw",
            host_fingerprint="SHA256:abc",
        )

    def _fake_connect_ssh(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(ssh_host, "load_host_ssh_settings", _fake_load_host_ssh_settings)
    monkeypatch.setattr(ssh_host, "connect_ssh", _fake_connect_ssh)

    result = asyncio.run(ssh_host.connect_host_ssh(db=object(), private_key="key", timeout=7))

    assert result is not None
    assert captured["host"] == "host.docker.internal"
    assert captured["port"] == 22
    assert captured["username"] == "root"
    assert captured["private_key"] == "key"
    assert captured["timeout"] == 7
