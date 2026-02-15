import os

from cryptography.fernet import Fernet, InvalidToken


class SecretKeyError(RuntimeError):
    pass


class SecretCipherError(RuntimeError):
    pass


def _get_fernet() -> Fernet:
    key = os.getenv("APP_SECRET_KEY", "").strip()
    if not key:
        raise SecretKeyError("APP_SECRET_KEY is required")
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as error:
        raise SecretKeyError("APP_SECRET_KEY is invalid for Fernet") from error


def require_secret_key() -> None:
    _get_fernet()


def encrypt_secret(value: str) -> str:
    if value is None:
        raise SecretCipherError("Cannot encrypt empty secret")
    try:
        token = _get_fernet().encrypt(value.encode("utf-8"))
        return token.decode("utf-8")
    except SecretKeyError:
        raise
    except Exception as error:
        raise SecretCipherError("Secret encryption failed") from error


def decrypt_secret(value: str) -> str:
    if not value:
        raise SecretCipherError("Encrypted secret is empty")
    try:
        plain = _get_fernet().decrypt(value.encode("utf-8"))
        return plain.decode("utf-8")
    except SecretKeyError:
        raise
    except InvalidToken as error:
        raise SecretCipherError("Encrypted secret is invalid") from error
    except Exception as error:
        raise SecretCipherError("Secret decryption failed") from error
