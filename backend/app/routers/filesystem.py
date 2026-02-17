import posixpath
import shlex

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.ssh_host import connect_host_ssh, map_host_ssh_error
from ..database import get_db


router = APIRouter(
    prefix="/filesystem",
    tags=["filesystem"],
)

MAX_HOST_FS_ENTRIES = 500


class HostFsListRequest(BaseModel):
    path: str | None = "/"
    privateKey: str | None = None


def _normalize_host_path(path: str | None) -> str:
    value = (path or "").strip()
    if not value:
        return "/"
    normalized = posixpath.normpath(value)
    if normalized in {"", "."}:
        return "/"
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized


def _resolve_parent_path(path: str) -> str:
    if path == "/":
        return "/"
    parent = posixpath.dirname(path.rstrip("/"))
    return parent or "/"


def _map_filesystem_error(code: str, message: str) -> tuple[str, str]:
    if code == "ssh_host_not_configured":
        return "ssh_not_configured", message
    if code == "ssh_auth_failed":
        return "ssh_auth_failed", message
    if code in {"ssh_host_key_untrusted", "ssh_host_key_mismatch", "ssh_host_key_invalid_fingerprint"}:
        return "ssh_host_key_failed", message
    return "browse_failed", message


def _build_list_command(path: str) -> str:
    target = shlex.quote(path)
    return (
        f"TARGET={target}; "
        "if [ -n \"${ZSH_VERSION:-}\" ]; then setopt nonomatch; fi; "
        "if [ ! -e \"$TARGET\" ]; then echo '__ERR__:NOT_FOUND'; exit 0; fi; "
        "if [ ! -d \"$TARGET\" ]; then echo '__ERR__:NOT_DIRECTORY'; exit 0; fi; "
        "if [ ! -r \"$TARGET\" ]; then echo '__ERR__:PERMISSION_DENIED'; exit 0; fi; "
        "RESOLVED=$(cd \"$TARGET\" 2>/dev/null && pwd -P); "
        "if [ -z \"$RESOLVED\" ]; then RESOLVED=\"$TARGET\"; fi; "
        "printf '__PATH__:%s\\n' \"$RESOLVED\"; "
        "for ITEM in \"$RESOLVED\"/* \"$RESOLVED\"/.[!.]* \"$RESOLVED\"/..?*; do "
        "[ -e \"$ITEM\" ] || continue; "
        "NAME=$(basename \"$ITEM\"); "
        "if [ ! -d \"$ITEM\" ]; then continue; fi; "
        "TYPE='d'; "
        "if [ -r \"$ITEM\" ]; then R='1'; else R='0'; fi; "
        "if [ -w \"$ITEM\" ]; then W='1'; else W='0'; fi; "
        "printf '%s\\t%s\\t%s\\t%s\\t%s\\n' \"$NAME\" \"$ITEM\" \"$TYPE\" \"$R\" \"$W\"; "
        "done"
    )


def _exec_ssh_command(ssh_client, command: str, timeout: int = 10):
    _stdin, stdout, stderr = ssh_client.exec_command(command, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="ignore")
    err = stderr.read().decode("utf-8", errors="ignore")
    return exit_code, out.strip(), err.strip()


@router.post("/host/list")
async def list_host_directory(req: HostFsListRequest, db: AsyncSession = Depends(get_db)):
    normalized_path = _normalize_host_path(req.path)
    ssh_client = None

    try:
        ssh_client = await connect_host_ssh(
            db,
            private_key=req.privateKey,
            timeout=10,
        )
        command = _build_list_command(normalized_path)
        _exit_code, out, err = _exec_ssh_command(ssh_client, command, timeout=10)
        output = out or err

        if output.startswith("__ERR__:NOT_FOUND") or output.startswith("__ERR__:NOT_DIRECTORY"):
            return {
                "status": "error",
                "code": "path_not_found",
                "message": f"Path not found: {normalized_path}",
            }
        if output.startswith("__ERR__:PERMISSION_DENIED"):
            return {
                "status": "error",
                "code": "permission_denied",
                "message": f"Permission denied: {normalized_path}",
            }

        lines = output.splitlines() if output else []
        resolved_path = normalized_path
        entries_raw: list[dict] = []

        for line in lines:
            if line.startswith("__PATH__:"):
                resolved_path = _normalize_host_path(line.split("__PATH__:", 1)[1].strip())
                continue
            parts = line.split("\t")
            if len(parts) < 5:
                continue
            name, entry_path, entry_type, readable, writable = parts[:5]
            if entry_type != "d":
                continue
            entries_raw.append(
                {
                    "name": name,
                    "path": _normalize_host_path(entry_path),
                    "is_dir": entry_type == "d",
                    "readable": readable == "1",
                    "writable": writable == "1",
                }
            )

        entries_sorted = sorted(entries_raw, key=lambda item: (not item["is_dir"], item["name"].lower()))
        truncated = len(entries_sorted) > MAX_HOST_FS_ENTRIES
        entries = entries_sorted[:MAX_HOST_FS_ENTRIES]

        return {
            "status": "success",
            "path": resolved_path,
            "parent": _resolve_parent_path(resolved_path),
            "entries": entries,
            "truncated": truncated,
        }
    except Exception as error:
        code, message = map_host_ssh_error(error)
        mapped_code, mapped_message = _map_filesystem_error(code, message)
        return {"status": "error", "code": mapped_code, "message": mapped_message}
    finally:
        if ssh_client:
            ssh_client.close()
