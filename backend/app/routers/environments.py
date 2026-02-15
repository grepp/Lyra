from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text
from typing import List
from ..database import get_db
from ..models import Environment, Setting
from ..core.security import SecretCipherError, SecretKeyError, encrypt_secret
from ..schemas import (
    CustomPortAllocateRequest,
    CustomPortAllocateResponse,
    CustomPortMapping,
    EnvironmentCreate,
    EnvironmentResponse,
)
from ..tasks import create_environment_task
import docker
import secrets
import time
import random
import logging
from sqlalchemy.exc import IntegrityError
import json

router = APIRouter(
    prefix="/environments",
    tags=["environments"],
)

JUPYTER_LAUNCH_TTL_SECONDS = 60
jupyter_launch_tickets: dict[str, dict[str, str | float | bool]] = {}
MAX_PORT_ALLOCATION_RETRIES = 8
CUSTOM_HOST_PORT_RANGE = (35001, 60000)
CUSTOM_CONTAINER_PORT_RANGE = (10000, 20000)
RESERVED_CONTAINER_PORTS = {22, 8080, 8888}
GPU_ALLOCATION_LOCK_KEY = 93821
GPU_OCCUPIED_STATUSES = {"creating", "building", "running", "starting"}
logger = logging.getLogger(__name__)


def _is_name_unique_violation(error: IntegrityError) -> bool:
    text = f"{error}".lower()
    if error.orig is not None:
        text += f" {error.orig}".lower()
    return "environments_name_key" in text or ("duplicate key value" in text and "(name)" in text)


def _cleanup_expired_jupyter_tickets():
    now = time.time()
    expired = [
        ticket
        for ticket, meta in jupyter_launch_tickets.items()
        if meta.get("used") or float(meta.get("expires_at", 0)) < now
    ]
    for ticket in expired:
        jupyter_launch_tickets.pop(ticket, None)


def _detect_total_gpus() -> int:
    import pynvml

    try:
        pynvml.nvmlInit()
        total_gpus = pynvml.nvmlDeviceGetCount()
        pynvml.nvmlShutdown()
        return int(total_gpus)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to detect GPUs on host") from exc


async def _collect_used_gpu_indices(db: AsyncSession) -> set[int]:
    result = await db.execute(select(Environment).where(Environment.status.in_(GPU_OCCUPIED_STATUSES)))
    active_envs = result.scalars().all()
    used_indices: set[int] = set()
    for active in active_envs:
        if active.status not in GPU_OCCUPIED_STATUSES:
            continue
        if active.gpu_indices:
            used_indices.update(active.gpu_indices)
    return used_indices


async def _get_jupyter_token(db: AsyncSession, environment_id: str) -> str | None:
    key = f"jupyter_token:{environment_id}"
    result = await db.execute(select(Setting).where(Setting.key == key))
    token_setting = result.scalars().first()
    return token_setting.value if token_setting else None


def _normalize_custom_ports(raw_ports) -> list[dict]:
    if not raw_ports:
        return []
    normalized = []
    for item in raw_ports:
        if isinstance(item, CustomPortMapping):
            host_port = int(item.host_port)
            container_port = int(item.container_port)
        elif isinstance(item, dict):
            host_port = int(item.get("host_port"))
            container_port = int(item.get("container_port"))
        else:
            continue
        normalized.append({"host_port": host_port, "container_port": container_port})
    return normalized


async def _get_custom_ports_map(db: AsyncSession) -> dict[str, list[dict]]:
    result = await db.execute(select(Setting).where(Setting.key.like("custom_ports:%")))
    settings = result.scalars().all()
    custom_ports_map: dict[str, list[dict]] = {}
    for setting in settings:
        try:
            env_id = setting.key.split("custom_ports:", 1)[1]
            parsed = json.loads(setting.value)
            custom_ports_map[env_id] = _normalize_custom_ports(parsed)
        except Exception:
            continue
    return custom_ports_map


async def _get_custom_ports_for_environment(db: AsyncSession, environment_id: str) -> list[dict]:
    result = await db.execute(select(Setting).where(Setting.key == f"custom_ports:{environment_id}"))
    setting = result.scalars().first()
    if not setting:
        return []
    try:
        parsed = json.loads(setting.value)
        return _normalize_custom_ports(parsed)
    except Exception:
        return []


def _get_docker_used_ports() -> set[int]:
    used_ports: set[int] = set()
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        for container in containers:
            ports = container.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
            for bindings in ports.values():
                if not bindings:
                    continue
                for binding in bindings:
                    host_port = binding.get("HostPort")
                    if host_port and str(host_port).isdigit():
                        used_ports.add(int(host_port))
    except Exception:
        # Docker query failures are tolerated; runtime run() retry still handles conflicts.
        pass
    return used_ports


def _pick_free_port(start: int, end: int, blocked_ports: set[int]) -> int:
    candidates = list(range(start, end + 1))
    random.shuffle(candidates)
    for port in candidates:
        if port in blocked_ports:
            continue
        return port
    raise HTTPException(
        status_code=503,
        detail=f"No available host ports in range {start}-{end}",
    )


async def _allocate_ports(db: AsyncSession) -> tuple[int, int, int]:
    result = await db.execute(select(Environment.ssh_port, Environment.jupyter_port, Environment.code_port))
    rows = result.all()
    blocked_ports: set[int] = set()
    for ssh_port, jupyter_port, code_port in rows:
        blocked_ports.add(ssh_port)
        blocked_ports.add(jupyter_port)
        blocked_ports.add(code_port)

    custom_ports_map = await _get_custom_ports_map(db)
    for mappings in custom_ports_map.values():
        for mapping in mappings:
            host_port = mapping.get("host_port")
            if isinstance(host_port, int):
                blocked_ports.add(host_port)

    blocked_ports.update(_get_docker_used_ports())

    ssh_port = _pick_free_port(20000, 25000, blocked_ports)
    blocked_ports.add(ssh_port)
    jupyter_port = _pick_free_port(25001, 30000, blocked_ports)
    blocked_ports.add(jupyter_port)
    code_port = _pick_free_port(30001, 35000, blocked_ports)
    return ssh_port, jupyter_port, code_port


async def _collect_blocked_host_ports(db: AsyncSession) -> set[int]:
    blocked_ports: set[int] = set()
    result = await db.execute(select(Environment.ssh_port, Environment.jupyter_port, Environment.code_port))
    rows = result.all()
    for ssh_port, jupyter_port, code_port in rows:
        blocked_ports.add(ssh_port)
        blocked_ports.add(jupyter_port)
        blocked_ports.add(code_port)

    custom_ports_map = await _get_custom_ports_map(db)
    for mappings in custom_ports_map.values():
        for mapping in mappings:
            host_port = mapping.get("host_port")
            if isinstance(host_port, int):
                blocked_ports.add(host_port)

    blocked_ports.update(_get_docker_used_ports())
    return blocked_ports


def _validate_custom_ports(custom_ports: list[dict]):
    host_ports = set()
    container_ports = set()
    for mapping in custom_ports:
        host_port = mapping["host_port"]
        container_port = mapping["container_port"]
        if host_port in host_ports:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "duplicate_custom_host_port",
                    "message": f"Duplicate host port in custom mappings: {host_port}",
                },
            )
        if container_port in container_ports:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "duplicate_custom_container_port",
                    "message": f"Duplicate container port in custom mappings: {container_port}",
                },
            )
        if container_port in RESERVED_CONTAINER_PORTS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "reserved_container_port",
                    "message": f"Container port {container_port} is reserved",
                },
            )
        host_ports.add(host_port)
        container_ports.add(container_port)


async def _allocate_custom_port_mappings(
    db: AsyncSession,
    count: int,
    current_ports: list[dict] | None = None,
) -> list[dict]:
    if count <= 0:
        return []
    blocked_host_ports = await _collect_blocked_host_ports(db)
    existing = _normalize_custom_ports(current_ports or [])
    for mapping in existing:
        blocked_host_ports.add(mapping["host_port"])

    blocked_container_ports = set(RESERVED_CONTAINER_PORTS)
    for mapping in existing:
        blocked_container_ports.add(mapping["container_port"])

    mappings: list[dict] = []
    host_start, host_end = CUSTOM_HOST_PORT_RANGE
    container_start, container_end = CUSTOM_CONTAINER_PORT_RANGE
    for _ in range(count):
        host_port = _pick_free_port(host_start, host_end, blocked_host_ports)
        blocked_host_ports.add(host_port)
        container_port = _pick_free_port(container_start, container_end, blocked_container_ports)
        blocked_container_ports.add(container_port)
        mappings.append({"host_port": host_port, "container_port": container_port})

    return mappings


@router.post("/ports/allocate", response_model=CustomPortAllocateResponse)
async def allocate_custom_ports(payload: CustomPortAllocateRequest, db: AsyncSession = Depends(get_db)):
    count = payload.count if payload.count > 0 else 1
    mappings = await _allocate_custom_port_mappings(db, count=count, current_ports=payload.current_ports)
    return {"mappings": mappings}


@router.post("/", response_model=EnvironmentResponse, status_code=status.HTTP_201_CREATED)
async def create_environment(env: EnvironmentCreate, db: AsyncSession = Depends(get_db)):
    if not env.dockerfile_content or not env.dockerfile_content.strip():
        raise HTTPException(
            status_code=400,
            detail={"code": "dockerfile_required", "message": "Dockerfile content is required"},
        )

    existing = await db.execute(select(Environment).where(Environment.name == env.name))
    if existing.scalars().first():
        raise HTTPException(
            status_code=409,
            detail={"code": "duplicate_environment_name", "message": "Environment name already exists"},
        )

    try:
        encrypted_root_password = encrypt_secret(env.root_password)
    except SecretKeyError as error:
        raise HTTPException(
            status_code=500,
            detail={"code": "security_key_missing", "message": str(error)},
        ) from error
    except SecretCipherError as error:
        raise HTTPException(
            status_code=500,
            detail={"code": "password_encryption_failed", "message": str(error)},
        ) from error

    # GPU allocation logic
    gpu_indices: list[int] = []
    requested_indices = [int(idx) for idx in (env.selected_gpu_indices or [])]
    if requested_indices:
        if len(set(requested_indices)) != len(requested_indices):
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_gpu_selection", "message": "Duplicate GPU indices are not allowed"},
            )

        total_gpus = _detect_total_gpus()
        invalid = sorted(idx for idx in requested_indices if idx < 0 or idx >= total_gpus)
        if invalid:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_gpu_selection", "message": f"Invalid GPU indices: {invalid}"},
            )

        gpu_indices = sorted(requested_indices)
    elif env.gpu_count > 0:
        total_gpus = _detect_total_gpus()
        used_indices = await _collect_used_gpu_indices(db)
        available_indices = [i for i in range(total_gpus) if i not in used_indices]
        if len(available_indices) < env.gpu_count:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "gpu_capacity_insufficient",
                    "message": f"Not enough GPUs available. Requested: {env.gpu_count}, Available: {len(available_indices)}",
                },
            )
        gpu_indices = available_indices[: env.gpu_count]

    custom_ports = _normalize_custom_ports(env.custom_ports)
    _validate_custom_ports(custom_ports)
    blocked_host_ports = await _collect_blocked_host_ports(db)
    for mapping in custom_ports:
        if mapping["host_port"] in blocked_host_ports:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "custom_host_port_conflict",
                    "message": f"Custom host port {mapping['host_port']} is already in use. Please regenerate ports.",
                },
            )

    await db.rollback()

    new_env = None
    jupyter_token = secrets.token_urlsafe(32)
    for _ in range(MAX_PORT_ALLOCATION_RETRIES):
        try:
            async with db.begin():
                # Serialize GPU allocation + environment insert.
                await db.execute(
                    text("SELECT pg_advisory_xact_lock(:lock_key)"),
                    {"lock_key": GPU_ALLOCATION_LOCK_KEY},
                )

                if requested_indices:
                    latest_used_indices = await _collect_used_gpu_indices(db)
                    conflicted = sorted(idx for idx in requested_indices if idx in latest_used_indices)
                    if conflicted:
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "code": "gpu_already_allocated",
                                "message": f"Requested GPUs are already in use: {conflicted}",
                            },
                        )
                    gpu_indices = sorted(requested_indices)
                elif env.gpu_count > 0:
                    total_gpus = _detect_total_gpus()
                    latest_used_indices = await _collect_used_gpu_indices(db)
                    available_indices = [i for i in range(total_gpus) if i not in latest_used_indices]
                    if len(available_indices) < env.gpu_count:
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "code": "gpu_already_allocated",
                                "message": "Not enough GPUs available at creation time",
                            },
                        )
                    gpu_indices = available_indices[: env.gpu_count]

                try:
                    ssh_port, jupyter_port, code_port = await _allocate_ports(db)
                except HTTPException as port_error:
                    if port_error.status_code == 503:
                        raise HTTPException(
                            status_code=503,
                            detail={
                                "code": "port_allocation_failed",
                                "message": "Failed to allocate unique ports. Please try again.",
                            },
                        ) from port_error
                    raise

                candidate_env = Environment(
                    name=env.name,
                    container_user=env.container_user,
                    root_password="__redacted__",
                    root_password_encrypted=encrypted_root_password,
                    dockerfile_content=env.dockerfile_content,
                    enable_jupyter=env.enable_jupyter,
                    enable_code_server=env.enable_code_server,
                    mount_config=[m.dict() for m in env.mount_config],
                    gpu_indices=gpu_indices,
                    ssh_port=ssh_port,
                    jupyter_port=jupyter_port,
                    code_port=code_port,
                    status="creating",
                )
                db.add(candidate_env)
                await db.flush()

                db.add(Setting(key=f"jupyter_token:{candidate_env.id}", value=jupyter_token))
                db.add(Setting(key=f"custom_ports:{candidate_env.id}", value=json.dumps(custom_ports)))
                new_env = candidate_env

            break
        except IntegrityError as error:
            await db.rollback()
            if _is_name_unique_violation(error):
                raise HTTPException(
                    status_code=409,
                    detail={"code": "duplicate_environment_name", "message": "Environment name already exists"},
                ) from error

    if new_env is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "port_allocation_failed",
                "message": "Failed to allocate unique ports after several retries. Please try again.",
            },
        )

    try:
        create_environment_task.delay(str(new_env.id))
    except Exception as enqueue_error:
        compensation_done = False
        try:
            async with db.begin():
                rollback_env = await db.execute(select(Environment).where(Environment.id == new_env.id))
                env_to_remove = rollback_env.scalars().first()
                if env_to_remove:
                    token_result = await db.execute(
                        select(Setting).where(Setting.key == f"jupyter_token:{new_env.id}")
                    )
                    token_setting = token_result.scalars().first()
                    if token_setting:
                        await db.delete(token_setting)

                    custom_ports_result = await db.execute(
                        select(Setting).where(Setting.key == f"custom_ports:{new_env.id}")
                    )
                    custom_ports_setting = custom_ports_result.scalars().first()
                    if custom_ports_setting:
                        await db.delete(custom_ports_setting)

                    await db.delete(env_to_remove)
                compensation_done = True
        except Exception:
            await db.rollback()

        if not compensation_done:
            try:
                async with db.begin():
                    failed_env_result = await db.execute(select(Environment).where(Environment.id == new_env.id))
                    failed_env = failed_env_result.scalars().first()
                    if failed_env:
                        failed_env.status = "error"
            except Exception:
                await db.rollback()

        raise HTTPException(
            status_code=503,
            detail={
                "code": "task_enqueue_failed",
                "message": "Failed to enqueue provisioning task. Please try again.",
            },
        ) from enqueue_error

    async with db.begin():
        refreshed = await db.execute(select(Environment).where(Environment.id == new_env.id))
        created_env = refreshed.scalars().first()
        if created_env:
            created_env.status = "building"
            new_env = created_env

    env_dict = {**new_env.__dict__, "custom_ports": custom_ports}
    env_dict.pop("_sa_instance_state", None)
    return env_dict


def _resolve_environment_status(
    current_status: str,
    container_status: str,
    state_status: str,
    exit_code,
    oom_killed: bool,
    error_msg: str,
) -> str:
    if container_status == "running":
        if current_status == "starting":
            return "running"
        if current_status == "stopping":
            return "stopping"
        if current_status != "running":
            return "running"
        return current_status

    if current_status == "stopping":
        if state_status in ["created", "restarting", "starting"]:
            return "stopping"
        return "stopped"

    if current_status == "starting":
        if state_status in ["created", "restarting", "starting"] and exit_code is None:
            return "starting"
        if exit_code is None:
            return "stopped"
        if exit_code in [0, 143]:
            return "stopped"
        if exit_code == 137:
            if oom_killed or str(error_msg).strip():
                return "error"
            return "stopped"
        return "error"

    if exit_code is None:
        return "stopped"
    if exit_code in [0, 143]:
        return "stopped"
    if exit_code == 137:
        if oom_killed or str(error_msg).strip():
            return "error"
        return "stopped"
    return "error"


@router.get("/", response_model=List[EnvironmentResponse])
async def read_environments(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).offset(skip).limit(limit))
    envs = result.scalars().all()
    custom_ports_map = await _get_custom_ports_map(db)

    client = None
    docker_available = True
    try:
        client = docker.from_env()
    except docker.errors.DockerException as error:
        docker_available = False
        logger.warning("Docker daemon unavailable while reading environments: %s", error)
    except Exception as error:
        docker_available = False
        logger.warning("Unexpected Docker client initialization failure: %s", error)

    status_changed = False
    env_responses = []

    for env in envs:
        container_name = f"lyra-{env.name}-{env.id}"
        container_id: str | None = None

        if docker_available and client is not None:
            try:
                container = client.containers.get(container_name)
                container_id = container.short_id or (container.id[:12] if container.id else None)
                state_info = container.attrs.get("State", {})
                new_status = _resolve_environment_status(
                    current_status=env.status,
                    container_status=container.status,
                    state_status=state_info.get("Status", ""),
                    exit_code=state_info.get("ExitCode"),
                    oom_killed=state_info.get("OOMKilled", False),
                    error_msg=state_info.get("Error", ""),
                )
                if env.status != new_status:
                    env.status = new_status
                    status_changed = True
            except docker.errors.NotFound:
                if env.status in ["running", "stopping", "starting"]:
                    env.status = "stopped"
                    status_changed = True
            except docker.errors.DockerException as error:
                logger.warning(
                    "Docker status lookup failed for env %s. Falling back to DB status: %s",
                    env.id,
                    error,
                )
            except Exception as error:
                logger.warning(
                    "Unexpected status resolution failure for env %s. Falling back to DB status: %s",
                    env.id,
                    error,
                )

        env_dict = {
            **env.__dict__,
            "container_id": container_id,
            "custom_ports": custom_ports_map.get(str(env.id), []),
        }
        env_dict.pop("_sa_instance_state", None)
        env_responses.append(env_dict)

    if status_changed and docker_available:
        await db.commit()

    return env_responses


@router.get("/{environment_id}", response_model=EnvironmentResponse)
async def read_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    custom_ports = await _get_custom_ports_for_environment(db, str(env.id))
    env_dict = {**env.__dict__, "custom_ports": custom_ports}
    env_dict.pop("_sa_instance_state", None)
    return env_dict


@router.get("/{environment_id}/logs")
async def get_environment_logs(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    client = docker.from_env()
    container_name = f"lyra-{env.name}-{env.id}"

    try:
        # Check if container exists (even if stopped/exited)
        container = client.containers.get(container_name)
        logs = container.logs(tail=50)
        logs_text = logs.decode('utf-8').strip() if logs else ""

        if not logs_text:
            state = container.attrs.get('State', {})
            exit_code = state.get('ExitCode')
            error_msg = state.get('Error', "")

            if error_msg:
                return {"logs": error_msg}
            if exit_code is not None:
                return {"logs": f"Container exited with code: {exit_code}, but no logs were produced."}

            return {"logs": "No logs produced by this container."}

        return {"logs": logs_text}
    except docker.errors.NotFound:
        if env.status == "error":
            return {
                "logs": "No container was created for this environment. Build may have failed before container start. Check backend worker logs for the full build error."  # noqa: E501
            }
        return {"logs": "Container not found. It may have been removed or not started yet."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{environment_id}/jupyter/launch")
async def create_jupyter_launch_url(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    if not env.enable_jupyter:
        raise HTTPException(status_code=409, detail="Jupyter is disabled for this environment")
    if env.status != "running":
        raise HTTPException(status_code=409, detail="Environment must be running")

    token = await _get_jupyter_token(db, str(env.id))
    if not token:
        raise HTTPException(status_code=409, detail="Jupyter token is not configured. Recreate the environment.")

    _cleanup_expired_jupyter_tickets()
    launch_ticket = secrets.token_urlsafe(24)
    jupyter_launch_tickets[launch_ticket] = {
        "environment_id": str(env.id),
        "expires_at": time.time() + JUPYTER_LAUNCH_TTL_SECONDS,
        "used": False,
    }

    return {"launch_url": f"/api/environments/{environment_id}/jupyter/launch/{launch_ticket}"}


@router.get("/{environment_id}/jupyter/launch/{launch_ticket}")
async def launch_jupyter_with_ticket(
    environment_id: str, launch_ticket: str, request: Request, db: AsyncSession = Depends(get_db)
):
    _cleanup_expired_jupyter_tickets()
    ticket_meta = jupyter_launch_tickets.get(launch_ticket)
    if not ticket_meta:
        raise HTTPException(status_code=404, detail="Launch ticket not found or expired")
    if ticket_meta.get("used"):
        raise HTTPException(status_code=410, detail="Launch ticket already used")
    if ticket_meta.get("environment_id") != environment_id:
        raise HTTPException(status_code=400, detail="Launch ticket does not match environment")
    if float(ticket_meta.get("expires_at", 0)) < time.time():
        jupyter_launch_tickets.pop(launch_ticket, None)
        raise HTTPException(status_code=410, detail="Launch ticket expired")

    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    if not env.enable_jupyter:
        raise HTTPException(status_code=409, detail="Jupyter is disabled for this environment")
    if env.status != "running":
        raise HTTPException(status_code=409, detail="Environment must be running")

    token = await _get_jupyter_token(db, str(env.id))
    if not token:
        raise HTTPException(status_code=409, detail="Jupyter token is not configured. Recreate the environment.")

    ticket_meta["used"] = True

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.url.hostname or "localhost"
    redirect_url = f"{scheme}://{host}:{env.jupyter_port}/?token={token}"
    return RedirectResponse(url=redirect_url, status_code=307)


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    # Try to remove container
    try:
        client = docker.from_env()
        container_name = f"lyra-{env.name}-{env.id}"
        try:
            container = client.containers.get(container_name)
            container.remove(force=True)
        except docker.errors.NotFound:
            pass  # Container already gone
    except Exception as e:
        print(f"Error removing container: {e}")

    token_key = f"jupyter_token:{env.id}"
    token_result = await db.execute(select(Setting).where(Setting.key == token_key))
    token_setting = token_result.scalars().first()
    if token_setting:
        await db.delete(token_setting)

    custom_ports_key = f"custom_ports:{env.id}"
    custom_ports_result = await db.execute(select(Setting).where(Setting.key == custom_ports_key))
    custom_ports_setting = custom_ports_result.scalars().first()
    if custom_ports_setting:
        await db.delete(custom_ports_setting)

    await db.delete(env)
    await db.commit()
    _cleanup_expired_jupyter_tickets()

    return None


@router.post("/{environment_id}/start", status_code=status.HTTP_200_OK)
async def start_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    container_name = f"lyra-{env.name}-{env.id}"
    client = docker.from_env()

    try:
        container = client.containers.get(container_name)
        if container.status == "running":
            env.status = "running"
            await db.commit()
            return {"message": "Environment is already running"}

        env.status = "starting"
        await db.commit()
        container.start()
        env.status = "running"
        await db.commit()
        return {"message": f"Environment {env.name} started"}
    except docker.errors.NotFound:
        env.status = "error"
        await db.commit()
        raise HTTPException(status_code=409, detail="Container not found. Please recreate the environment.")
    except Exception as e:
        env.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{environment_id}/stop", status_code=status.HTTP_200_OK)
async def stop_environment(environment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == environment_id))
    env = result.scalars().first()
    if env is None:
        raise HTTPException(status_code=404, detail="Environment not found")

    container_name = f"lyra-{env.name}-{env.id}"
    client = docker.from_env()

    try:
        container = client.containers.get(container_name)
        if container.status != "running":
            env.status = "stopped"
            await db.commit()
            return {"message": "Environment is already stopped"}

        env.status = "stopping"
        await db.commit()
        container.stop(timeout=0)
        return {"message": f"Environment {env.name} is stopping"}
    except docker.errors.NotFound:
        env.status = "stopped"
        await db.commit()
        return {"message": "Container not found. Environment marked as stopped."}
    except Exception as e:
        env.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))
