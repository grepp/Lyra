import os
import secrets
from pathlib import Path

from fastapi import Header, HTTPException, status


WORKER_ROLE = "worker"
MAIN_ROLE = "main"
_WORKER_RUNTIME_TOKEN: str | None = None
DEFAULT_WORKER_TOKEN_FILE = "/var/lib/lyra/worker/worker_api_token"


def get_node_role() -> str:
    return os.getenv("LYRA_NODE_ROLE", MAIN_ROLE).strip().lower() or MAIN_ROLE


def ensure_worker_api_token() -> str:
    # Only worker nodes need this token.
    if get_node_role() != WORKER_ROLE:
        return ""

    global _WORKER_RUNTIME_TOKEN
    if _WORKER_RUNTIME_TOKEN:
        return _WORKER_RUNTIME_TOKEN

    token_file = _resolve_worker_token_file()
    loaded = _load_worker_token(token_file)
    if loaded:
        _WORKER_RUNTIME_TOKEN = loaded
        print("[Lyra][Worker] Loaded runtime worker API token from Docker volume.")
        print(f"[Lyra][Worker] Token: {_WORKER_RUNTIME_TOKEN}")
        return _WORKER_RUNTIME_TOKEN

    _WORKER_RUNTIME_TOKEN = secrets.token_urlsafe(32)
    _persist_worker_token(token_file, _WORKER_RUNTIME_TOKEN)
    print("[Lyra][Worker] Generated runtime worker API token and persisted it to Docker volume.")
    print(f"[Lyra][Worker] Token: {_WORKER_RUNTIME_TOKEN}")
    return _WORKER_RUNTIME_TOKEN


def _resolve_worker_token_file() -> Path:
    raw = (os.getenv("LYRA_WORKER_RUNTIME_TOKEN_FILE", DEFAULT_WORKER_TOKEN_FILE) or "").strip()
    if not raw:
        raw = DEFAULT_WORKER_TOKEN_FILE
    return Path(raw)


def _load_worker_token(path: Path) -> str:
    try:
        if not path.exists():
            return ""
        token = path.read_text(encoding="utf-8").strip()
        return token
    except Exception as error:  # noqa: BLE001
        print(f"[Lyra][Worker] Failed to read worker token file '{path}': {error}")
        return ""


def _persist_worker_token(path: Path, token: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        try:
            path.chmod(0o600)
        except Exception:
            pass
    except Exception as error:  # noqa: BLE001
        print(f"[Lyra][Worker] Failed to persist worker token file '{path}': {error}")


def require_worker_role() -> None:
    if get_node_role() != WORKER_ROLE:
        # Hide worker endpoints when this node is not running in worker mode.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        return ""
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2:
        return ""
    scheme, token = parts
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def require_worker_api_auth(authorization: str | None = Header(default=None)) -> None:
    expected = ensure_worker_api_token().strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Worker API token is not configured",
        )

    provided = _extract_bearer_token(authorization)
    if not provided or provided != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid worker API token",
        )
