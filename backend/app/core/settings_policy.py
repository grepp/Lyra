from fastapi import HTTPException

ALLOWED_SETTING_KEYS = {
    "app_name",
    "favicon_data_url",
    "dashboard_announcement_markdown",
    "ssh_port",
    "ssh_host",
    "ssh_username",
    "ssh_auth_method",
    "ssh_password",
    "ssh_host_fingerprint",
}

INTERNAL_SETTING_KEY_PREFIXES = (
    "jupyter_token:",
    "custom_ports:",
)


def _invalid_setting_key() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"code": "invalid_setting_key", "message": "Setting key must be a non-empty trimmed string"},
    )


def _protected_setting_key() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={"code": "protected_setting_key", "message": "This setting key is protected and cannot be accessed"},
    )


def _unsupported_setting_key() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"code": "unsupported_setting_key", "message": "This setting key is not supported for direct update"},
    )


def _validate_base_key(key: str) -> None:
    if not isinstance(key, str):
        raise _invalid_setting_key()
    if not key.strip() or key != key.strip():
        raise _invalid_setting_key()


def is_internal_setting_key(key: str) -> bool:
    return any(key.startswith(prefix) for prefix in INTERNAL_SETTING_KEY_PREFIXES)


def is_allowed_setting_key(key: str) -> bool:
    return key in ALLOWED_SETTING_KEYS


def validate_setting_key_for_read(key: str) -> None:
    _validate_base_key(key)
    if is_internal_setting_key(key):
        raise _protected_setting_key()
    if not is_allowed_setting_key(key):
        raise _unsupported_setting_key()


def validate_setting_key_for_write(key: str) -> None:
    _validate_base_key(key)
    if is_internal_setting_key(key):
        raise _protected_setting_key()
    if not is_allowed_setting_key(key):
        raise _unsupported_setting_key()
