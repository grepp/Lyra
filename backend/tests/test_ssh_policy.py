from app.core.ssh_policy import SshPolicyError, connect_ssh, map_ssh_error, normalize_target_host


def test_normalize_target_host_for_localhost():
    assert normalize_target_host("localhost") == "host.docker.internal"
    assert normalize_target_host("127.0.0.1") == "host.docker.internal"
    assert normalize_target_host("example.com") == "example.com"


def test_map_ssh_error_for_policy_error():
    code, message = map_ssh_error(SshPolicyError("ssh_host_key_mismatch", "mismatch"))
    assert code == "ssh_host_key_mismatch"
    assert message == "mismatch"


def test_map_ssh_error_for_untrusted_known_hosts():
    code, _ = map_ssh_error(Exception("Server 'host' not found in known_hosts"))
    assert code == "ssh_host_key_untrusted"


def test_connect_ssh_uses_pre_auth_path_when_fingerprint_provided(monkeypatch):
    called = {"value": False}

    def _fake_pre_auth(**_kwargs):
        called["value"] = True
        return object()

    monkeypatch.setattr("app.core.ssh_policy._connect_ssh_with_pre_auth_fingerprint", _fake_pre_auth)

    connect_ssh(
        host="example.com",
        port=22,
        username="root",
        auth_method="password",
        password="pw",
        host_fingerprint="SHA256:abc",
        timeout=5,
    )

    assert called["value"] is True
