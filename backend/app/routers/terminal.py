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
from ..core.ssh_policy import connect_ssh, map_ssh_error


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


@router.websocket("/ws")
async def websocket_terminal(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket.accept()

    ssh_host = await get_setting_value(db, "ssh_host")
    ssh_port_str = await get_setting_value(db, "ssh_port", "22")
    ssh_port = int(ssh_port_str) if ssh_port_str.isdigit() else 22
    ssh_user = await get_setting_value(db, "ssh_username")
    ssh_auth_method = await get_setting_value(db, "ssh_auth_method", "password")
    ssh_password = await get_setting_value(db, "ssh_password")
    ssh_host_fingerprint = await get_setting_value(db, "ssh_host_fingerprint")

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
        cols = init_data.get("cols", 80)
        rows = init_data.get("rows", 24)

        if ssh_host and ssh_user:
            target_host = ssh_host
            if target_host in ["localhost", "127.0.0.1"]:
                target_host = "host.docker.internal"

            try:
                ssh_client = connect_ssh(
                    host=target_host,
                    port=ssh_port,
                    username=ssh_user,
                    auth_method=ssh_auth_method,
                    password=ssh_password,
                    private_key=ssh_key,
                    host_fingerprint=ssh_host_fingerprint,
                    timeout=10,
                )

                chan = ssh_client.invoke_shell(term='xterm-256color', width=cols, height=rows)
                chan.setblocking(0)
                await websocket.send_text(f"\x1b[32mConnected to host {ssh_host} via SSH\x1b[0m\r\n")
            except Exception as e:
                code, message = map_ssh_error(e)
                logger.error("SSH connection failed: %s (%s)", message, code)
                await _send_ws_error(websocket, code, f"SSH Connection Failed: {message}")
                await websocket.close()
                return
        else:
            await _send_ws_error(
                websocket,
                "ssh_host_not_configured",
                "Error: Host server not configured. Please check terminal settings.",
            )
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
