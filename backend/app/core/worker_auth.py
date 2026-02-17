import os
import secrets

from fastapi import Header, HTTPException, status


WORKER_ROLE = "worker"
MAIN_ROLE = "main"
_WORKER_RUNTIME_TOKEN: str | None = None


def get_node_role() -> str:
    return os.getenv("LYRA_NODE_ROLE", MAIN_ROLE).strip().lower() or MAIN_ROLE


def ensure_worker_api_token() -> str:
    # Only worker nodes need this token.
    if get_node_role() != WORKER_ROLE:
        return ""

    global _WORKER_RUNTIME_TOKEN
    if _WORKER_RUNTIME_TOKEN:
        return _WORKER_RUNTIME_TOKEN

    _WORKER_RUNTIME_TOKEN = secrets.token_urlsafe(32)
    print("[Lyra][Worker] Generated runtime worker API token.")
    print(f"[Lyra][Worker] Token: {_WORKER_RUNTIME_TOKEN}")
    return _WORKER_RUNTIME_TOKEN


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
