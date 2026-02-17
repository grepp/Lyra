from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
import asyncio
import logging
from ..database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from ..models import Setting
import json
from pydantic import BaseModel
from typing import Optional
import re
from ..core.ssh_policy import connect_ssh, map_ssh_error
from ..core.ssh_host import connect_host_ssh, map_host_ssh_error


router = APIRouter(
    prefix="/terminal",
    tags=["terminal"],
)


logger = logging.getLogger("uvicorn")


class SshTestRequest(BaseModel):
    host: str
    port: int
    username: str
    authMethod: str
    password: Optional[str] = None
    privateKey: Optional[str] = None
    hostFingerprint: Optional[str] = None


class TmuxSessionListRequest(BaseModel):
    privateKey: Optional[str] = None


class TmuxSessionKillRequest(BaseModel):
    privateKey: Optional[str] = None
    session_names: list[str]


@router.post("/test-ssh")
async def test_ssh_connection(req: SshTestRequest, db: AsyncSession = Depends(get_db)):
    try:
        configured_fingerprint = await get_setting_value(db, "ssh_host_fingerprint")
        fingerprint = req.hostFingerprint if req.hostFingerprint is not None else configured_fingerprint
        ssh_client = connect_ssh(
            host=req.host,
            port=req.port,
            username=req.username,
            auth_method=req.authMethod,
            password=req.password,
            private_key=req.privateKey,
            host_fingerprint=fingerprint,
            timeout=5,
        )
        ssh_client.close()
        return {"status": "success", "message": "Successfully connected to host."}
    except Exception as e:
        code, message = map_ssh_error(e)
        return {"status": "error", "code": code, "message": message}


async def get_setting_value(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalars().first()
    return setting.value if setting else default


async def _send_ws_error(websocket: WebSocket, code: str, message: str):
    await websocket.send_text(json.dumps({"type": "error", "code": code, "message": message}))


def _sanitize_session_key(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:64]
    return cleaned or None


def _sanitize_tmux_session_name(raw: str) -> Optional[str]:
    value = (raw or "").strip()
    if not value:
        return None
    if len(value) > 128:
        return None
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        return None
    return value


async def _connect_terminal_ssh(db: AsyncSession, private_key: Optional[str] = None):
    return await connect_host_ssh(
        db,
        private_key=private_key,
        timeout=10,
    )


def _exec_ssh_command(ssh_client, command: str, timeout: int = 20):
    stdin, stdout, stderr = ssh_client.exec_command(command, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="ignore")
    err = stderr.read().decode("utf-8", errors="ignore")
    return exit_code, out.strip(), err.strip()


_TMUX_BIN_SNIPPET = (
    "TMUX_BIN=\"\"; "
    "if command -v bash >/dev/null 2>&1; then "
    "TMUX_BIN=\"$(bash -lc 'command -v tmux' 2>/dev/null | head -n1)\"; "
    "fi; "
    "if [ -z \"$TMUX_BIN\" ]; then TMUX_BIN=\"$(command -v tmux 2>/dev/null || true)\"; fi; "
    "if [ -z \"$TMUX_BIN\" ] && [ -x /usr/bin/tmux ]; then TMUX_BIN=/usr/bin/tmux; fi; "
    "if [ -z \"$TMUX_BIN\" ] && [ -x /usr/local/bin/tmux ]; then TMUX_BIN=/usr/local/bin/tmux; fi; "
    "if [ -z \"$TMUX_BIN\" ] && [ -x /bin/tmux ]; then TMUX_BIN=/bin/tmux; fi; "
    "if [ -z \"$TMUX_BIN\" ] && [ -x /opt/homebrew/bin/tmux ]; then TMUX_BIN=/opt/homebrew/bin/tmux; fi; "
    "if [ -z \"$TMUX_BIN\" ] && [ -x /snap/bin/tmux ]; then TMUX_BIN=/snap/bin/tmux; fi; "
)


@router.post("/tmux/sessions/list")
async def list_tmux_sessions(req: TmuxSessionListRequest, db: AsyncSession = Depends(get_db)):
    ssh_client = None
    try:
        ssh_client = await _connect_terminal_ssh(db, req.privateKey)
        cmd = (
            f"{_TMUX_BIN_SNIPPET}"
            "if [ -z \"$TMUX_BIN\" ]; then echo __NO_TMUX__; exit 0; fi; "
            "$TMUX_BIN list-sessions -F '#{session_name}\\t#{session_attached}\\t#{session_windows}' 2>/dev/null || true; "
            "echo __FALLBACK__; "
            "$TMUX_BIN ls 2>/dev/null || true"
        )
        _, out, _ = _exec_ssh_command(ssh_client, cmd, timeout=20)
        if "__NO_TMUX__" in out:
            return {"status": "success", "installed": False, "sessions": []}

        lines = out.splitlines()
        fallback_index = next((idx for idx, line in enumerate(lines) if line.strip() == "__FALLBACK__"), -1)
        formatted_lines = lines[:fallback_index] if fallback_index >= 0 else lines
        fallback_lines = lines[fallback_index + 1 :] if fallback_index >= 0 else []

        sessions_by_name: dict[str, dict] = {}
        for line in formatted_lines:
            line = line.strip()
            if not line:
                continue
            # Some tmux versions/shell contexts can return literal "\t"
            # instead of an actual tab character in formatted output.
            normalized_line = line.replace("\\t", "\t")
            parts = normalized_line.split("\t")
            if len(parts) < 1:
                continue
            name = _sanitize_tmux_session_name(parts[0]) or parts[0]
            attached = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
            windows = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
            sessions_by_name[name] = {"name": name, "attached": attached, "windows": windows}

        # Fallback for older tmux output style:
        # "<name>: <n> windows (created ...)"
        for line in fallback_lines:
            line = line.strip()
            if not line:
                continue
            if ":" not in line:
                continue
            raw_name = line.split(":", 1)[0].strip()
            name = _sanitize_tmux_session_name(raw_name)
            if not name:
                continue
            if name in sessions_by_name:
                continue
            windows = 0
            match = re.search(r":\s*(\d+)\s+windows?", line)
            if match:
                try:
                    windows = int(match.group(1))
                except Exception:
                    windows = 0
            sessions_by_name[name] = {"name": name, "attached": 0, "windows": windows}

        sessions = sorted(sessions_by_name.values(), key=lambda item: item["name"])
        return {"status": "success", "installed": True, "sessions": sessions}
    except Exception as e:
        code, message = map_host_ssh_error(e)
        return {"status": "error", "code": code, "message": message}
    finally:
        if ssh_client:
            ssh_client.close()


@router.post("/tmux/sessions/kill")
async def kill_tmux_sessions(req: TmuxSessionKillRequest, db: AsyncSession = Depends(get_db)):
    targets = []
    for name in req.session_names:
        safe = _sanitize_tmux_session_name(name)
        if safe:
            targets.append(safe)

    if not targets:
        return {"status": "error", "code": "tmux_session_invalid", "message": "No valid session names were provided."}

    ssh_client = None
    try:
        ssh_client = await _connect_terminal_ssh(db, req.privateKey)
        check_cmd = f"{_TMUX_BIN_SNIPPET}if [ -z \"$TMUX_BIN\" ]; then echo __NO_TMUX__; fi"
        _, check_out, _ = _exec_ssh_command(ssh_client, check_cmd, timeout=10)
        if "__NO_TMUX__" in check_out:
            return {"status": "error", "code": "tmux_not_installed", "message": "tmux is not installed on host."}

        removed = []
        skipped = []
        for session_name in targets:
            code, out, err = _exec_ssh_command(
                ssh_client,
                f"{_TMUX_BIN_SNIPPET}if [ -z \"$TMUX_BIN\" ]; then echo __NO_TMUX__; exit 1; fi; $TMUX_BIN kill-session -t '{session_name}'",  # noqa: E501
                timeout=10,
            )
            if code == 0:
                removed.append(session_name)
            else:
                skipped.append(
                    {
                        "name": session_name,
                        "reason": err or out or "kill failed",
                    }
                )

        return {
            "status": "success",
            "removed_count": len(removed),
            "skipped_count": len(skipped),
            "removed": removed,
            "skipped": skipped,
        }
    except Exception as e:
        code, message = map_host_ssh_error(e)
        return {"status": "error", "code": code, "message": message}
    finally:
        if ssh_client:
            ssh_client.close()


@router.websocket("/ws")
async def websocket_terminal(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket.accept()

    ssh_client = None
    chan = None

    try:
        # Wait for INIT message from client
        init_raw = await websocket.receive_text()
        init_data = json.loads(init_raw)

        if init_data.get("type") != "INIT":
            await websocket.close()
            return

        ssh_key = init_data.get("privateKey")
        session_key = _sanitize_session_key(init_data.get("sessionKey"))
        cols = init_data.get("cols", 80)
        rows = init_data.get("rows", 24)

        try:
            ssh_client = await connect_host_ssh(
                db,
                private_key=ssh_key,
                timeout=10,
            )
            chan = ssh_client.invoke_shell(term='xterm-256color', width=cols, height=rows)
            chan.setblocking(0)
            await websocket.send_text("\x1b[32mConnected via SSH\x1b[0m\r\n")
            if session_key:
                chan.send(
                    f"{_TMUX_BIN_SNIPPET}"
                    f"if [ -n \"$TMUX_BIN\" ]; then \"$TMUX_BIN\" new-session -A -s {session_key}; "
                    "else echo '[tmux not found: session persistence disabled]'; fi\n"
                )
        except Exception as e:
            code, message = map_host_ssh_error(e)
            logger.error("SSH connection failed: %s (%s)", message, code)
            await _send_ws_error(websocket, code, f"SSH Connection Failed: {message}")
            await websocket.close()
            return

        async def write_to_backend():
            while True:
                try:
                    data = await websocket.receive_text()
                    if data.startswith("RESIZE:"):
                        _, dims = data.split(":")
                        r, c = map(int, dims.split(","))
                        if chan:
                            chan.resize_pty(width=c, height=r)
                    else:
                        if chan:
                            chan.send(data)
                except (WebSocketDisconnect, Exception):
                    break

        async def read_from_backend():
            while True:
                try:
                    if chan:
                        if chan.recv_ready():
                            data = chan.recv(10240)
                            if not data:
                                break
                            await websocket.send_bytes(data)
                        else:
                            await asyncio.sleep(0.01)

                    if chan and chan.exit_status_ready():
                        break
                except Exception:
                    break

        writer_task = asyncio.create_task(write_to_backend())
        reader_task = asyncio.create_task(read_from_backend())

        await asyncio.wait(
            [writer_task, reader_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        writer_task.cancel()
        reader_task.cancel()

    except Exception as e:
        logger.error(f"Terminal error: {e}")
    finally:
        if chan:
            chan.close()
        if ssh_client:
            ssh_client.close()
        try:
            await websocket.close()
        except Exception:
            pass
