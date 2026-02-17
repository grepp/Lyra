from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..models import Setting
from .ssh_policy import connect_ssh, map_ssh_error


@dataclass
class HostSshSettings:
    host: str
    port: int
    username: str
    auth_method: str
    password: str | None
    host_fingerprint: str | None


@dataclass
class HostSshConfigError(Exception):
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


async def _get_setting_value(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalars().first()
    return setting.value if setting else default


def _parse_ssh_port(value: str, default: int = 22) -> int:
    return int(value) if value.isdigit() else default


def resolve_ssh_target_host(host: str) -> str:
    if host in {"localhost", "127.0.0.1"}:
        return "host.docker.internal"
    return host


async def load_host_ssh_settings(db: AsyncSession) -> HostSshSettings:
    ssh_host = await _get_setting_value(db, "ssh_host")
    ssh_port = _parse_ssh_port(await _get_setting_value(db, "ssh_port", "22"))
    ssh_user = await _get_setting_value(db, "ssh_username")
    ssh_auth_method = await _get_setting_value(db, "ssh_auth_method", "password")
    ssh_password = await _get_setting_value(db, "ssh_password")
    ssh_host_fingerprint = await _get_setting_value(db, "ssh_host_fingerprint")

    if not ssh_host or not ssh_user:
        raise HostSshConfigError(
            code="ssh_host_not_configured",
            message="Host server is not configured.",
        )

    return HostSshSettings(
        host=ssh_host,
        port=ssh_port,
        username=ssh_user,
        auth_method=ssh_auth_method,
        password=ssh_password or None,
        host_fingerprint=ssh_host_fingerprint or None,
    )


async def connect_host_ssh(
    db: AsyncSession,
    *,
    private_key: str | None = None,
    timeout: int = 10,
):
    settings = await load_host_ssh_settings(db)
    return connect_ssh(
        host=resolve_ssh_target_host(settings.host),
        port=settings.port,
        username=settings.username,
        auth_method=settings.auth_method,
        password=settings.password,
        private_key=private_key,
        host_fingerprint=settings.host_fingerprint,
        timeout=timeout,
    )


def map_host_ssh_error(error: Exception) -> tuple[str, str]:
    if isinstance(error, HostSshConfigError):
        return error.code, error.message
    return map_ssh_error(error)
