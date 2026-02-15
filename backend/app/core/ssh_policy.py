import base64
import hashlib
import io
import os
import socket
from dataclasses import dataclass

import paramiko


@dataclass
class SshPolicyError(Exception):
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


def normalize_target_host(host: str) -> str:
    if host in ["localhost", "127.0.0.1"]:
        return "host.docker.internal"
    return host


def _get_host_key_policy_mode() -> str:
    mode = os.getenv("SSH_HOST_KEY_POLICY", "reject").strip().lower()
    if mode not in {"reject", "accept-new"}:
        return "reject"
    return mode


def _get_known_hosts_path() -> str | None:
    value = os.getenv("SSH_KNOWN_HOSTS_PATH", "").strip()
    return value or None


def _build_ssh_client() -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    known_hosts_path = _get_known_hosts_path()
    if known_hosts_path:
        try:
            known_hosts_dir = os.path.dirname(known_hosts_path)
            if known_hosts_dir:
                os.makedirs(known_hosts_dir, exist_ok=True)
            if not os.path.exists(known_hosts_path):
                with open(known_hosts_path, "a", encoding="utf-8"):
                    pass
            client.load_host_keys(known_hosts_path)
        except Exception:
            # Invalid/missing custom known_hosts should not crash startup.
            # Also avoid AutoAddPolicy persistence errors when path is unusable.
            client._host_keys_filename = None
            pass

    policy_mode = _get_host_key_policy_mode()
    if policy_mode == "accept-new":
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
    return client


def _parse_private_key(private_key: str):
    key_file = io.StringIO(private_key)
    parsers = [
        paramiko.RSAKey.from_private_key,
        paramiko.Ed25519Key.from_private_key,
        paramiko.ECDSAKey.from_private_key,
        paramiko.PKey.from_private_key,
    ]
    last_error: Exception | None = None
    for parser in parsers:
        try:
            key_file.seek(0)
            return parser(key_file)
        except Exception as error:
            last_error = error
            continue
    raise SshPolicyError("ssh_private_key_invalid", f"Invalid private key format: {last_error}")


def _fingerprint_sha256(server_key: paramiko.PKey) -> str:
    digest = hashlib.sha256(server_key.asbytes()).digest()
    return base64.b64encode(digest).decode("ascii").rstrip("=")


def _fingerprint_md5(server_key: paramiko.PKey) -> str:
    digest = server_key.get_fingerprint().hex()
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def _normalize_md5_fingerprint(value: str) -> str:
    raw = value.strip().lower().replace("md5:", "").replace("-", "").replace(":", "")
    if len(raw) != 32:
        raise SshPolicyError("ssh_host_key_invalid_fingerprint", "Invalid MD5 fingerprint format")
    return ":".join(raw[i : i + 2] for i in range(0, len(raw), 2))


def _verify_fingerprint(expected: str, server_key: paramiko.PKey) -> None:
    expected_value = (expected or "").strip()
    if not expected_value:
        return

    if expected_value.upper().startswith("SHA256:"):
        actual = _fingerprint_sha256(server_key)
        expected_sha256 = expected_value.split("SHA256:", 1)[1].strip().rstrip("=")
        if actual != expected_sha256:
            raise SshPolicyError(
                "ssh_host_key_mismatch",
                f"Host key mismatch. expected=SHA256:{expected_sha256}, actual=SHA256:{actual}",
            )
        return

    expected_md5 = _normalize_md5_fingerprint(expected_value)
    actual_md5 = _fingerprint_md5(server_key)
    if actual_md5 != expected_md5:
        raise SshPolicyError(
            "ssh_host_key_mismatch",
            f"Host key mismatch. expected=MD5:{expected_md5}, actual=MD5:{actual_md5}",
        )


def map_ssh_error(error: Exception) -> tuple[str, str]:
    msg = str(error)
    if isinstance(error, SshPolicyError):
        return error.code, error.message
    if "not found in known_hosts" in msg:
        return "ssh_host_key_untrusted", msg

    bad_host_key_exc = getattr(paramiko, "BadHostKeyException", None)
    if isinstance(bad_host_key_exc, type) and isinstance(error, bad_host_key_exc):
        return "ssh_host_key_mismatch", msg

    auth_exc = getattr(paramiko, "AuthenticationException", None)
    if isinstance(auth_exc, type) and isinstance(error, auth_exc):
        return "ssh_auth_failed", msg

    ssh_exc = getattr(paramiko, "SSHException", None)
    if isinstance(ssh_exc, type) and isinstance(error, ssh_exc):
        return "ssh_connection_failed", msg

    return "ssh_connection_failed", msg


def connect_ssh(
    host: str,
    port: int,
    username: str,
    auth_method: str,
    password: str | None = None,
    private_key: str | None = None,
    host_fingerprint: str | None = None,
    timeout: int = 10,
) -> paramiko.SSHClient:
    if host_fingerprint:
        return _connect_ssh_with_pre_auth_fingerprint(
            host=host,
            port=port,
            username=username,
            auth_method=auth_method,
            password=password,
            private_key=private_key,
            host_fingerprint=host_fingerprint,
            timeout=timeout,
        )

    client = _build_ssh_client()
    target_host = normalize_target_host(host)
    try:
        if auth_method == "key" and private_key:
            pkey = _parse_private_key(private_key)
            client.connect(
                target_host,
                port=port,
                username=username,
                pkey=pkey,
                timeout=timeout,
                auth_timeout=timeout,
                banner_timeout=timeout,
                look_for_keys=False,
                allow_agent=False,
            )
        else:
            client.connect(
                target_host,
                port=port,
                username=username,
                password=password,
                timeout=timeout,
                auth_timeout=timeout,
                banner_timeout=timeout,
                look_for_keys=False,
                allow_agent=False,
            )

        if host_fingerprint:
            transport = client.get_transport()
            if not transport:
                raise SshPolicyError("ssh_connection_failed", "SSH transport not established")
            server_key = transport.get_remote_server_key()
            _verify_fingerprint(host_fingerprint, server_key)
    except Exception:
        client.close()
        raise
    return client


def _connect_ssh_with_pre_auth_fingerprint(
    host: str,
    port: int,
    username: str,
    auth_method: str,
    password: str | None,
    private_key: str | None,
    host_fingerprint: str,
    timeout: int,
) -> paramiko.SSHClient:
    target_host = normalize_target_host(host)
    sock: socket.socket | None = None
    transport: paramiko.Transport | None = None
    try:
        sock = socket.create_connection((target_host, port), timeout=timeout)
        transport = paramiko.Transport(sock)
        transport.start_client(timeout=timeout)

        server_key = transport.get_remote_server_key()
        _verify_fingerprint(host_fingerprint, server_key)

        if auth_method == "key" and private_key:
            pkey = _parse_private_key(private_key)
            transport.auth_publickey(username, pkey)
        else:
            transport.auth_password(username, password=password or "")

        if not transport.is_authenticated():
            raise SshPolicyError("ssh_auth_failed", "SSH authentication failed")

        client = paramiko.SSHClient()
        client._transport = transport
        return client
    except Exception:
        if transport:
            transport.close()
        if sock:
            try:
                sock.close()
            except Exception:
                pass
        raise
