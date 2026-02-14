from .worker import celery_app
from .database import DATABASE_URL
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .models import Environment, Setting
import docker
import tempfile
import os
import secrets
import random
import json


# Sync database setup for Celery
# Replace 'postgresql+asyncpg' with 'postgresql' for sync driver if needed,
# but usually we use a separate sync URL string.
SYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg", "postgresql")
engine = create_engine(SYNC_DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
CONTAINER_RUN_PORT_RETRIES = 3
CUSTOM_HOST_PORT_RANGE = (35001, 60000)


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
        # If Docker inspection fails, run() retry logic will still handle conflicts.
        pass
    return used_ports


def _pick_free_port(start: int, end: int, blocked_ports: set[int]) -> int:
    candidates = list(range(start, end + 1))
    random.shuffle(candidates)
    for port in candidates:
        if port in blocked_ports:
            continue
        return port
    raise RuntimeError(f"No available host ports in range {start}-{end}")


def _allocate_ports(db, exclude_environment_id=None):
    query = db.query(Environment.ssh_port, Environment.jupyter_port, Environment.code_port)
    if exclude_environment_id is not None:
        query = query.filter(Environment.id != exclude_environment_id)
    rows = query.all()

    blocked_ports = set()
    for ssh_port, jupyter_port, code_port in rows:
        blocked_ports.add(ssh_port)
        blocked_ports.add(jupyter_port)
        blocked_ports.add(code_port)

    custom_port_settings = db.query(Setting).filter(Setting.key.like("custom_ports:%")).all()
    for setting in custom_port_settings:
        try:
            mappings = json.loads(setting.value)
        except Exception:
            continue
        for mapping in mappings or []:
            host_port = mapping.get("host_port")
            if isinstance(host_port, int):
                blocked_ports.add(host_port)
            elif isinstance(host_port, str) and host_port.isdigit():
                blocked_ports.add(int(host_port))

    blocked_ports.update(_get_docker_used_ports())

    ssh_port = _pick_free_port(20000, 25000, blocked_ports)
    blocked_ports.add(ssh_port)
    jupyter_port = _pick_free_port(25001, 30000, blocked_ports)
    blocked_ports.add(jupyter_port)
    code_port = _pick_free_port(30001, 35000, blocked_ports)
    return ssh_port, jupyter_port, code_port


def _allocate_custom_host_ports(db, count: int, exclude_environment_id=None):
    blocked_ports = _get_docker_used_ports()
    rows = db.query(Environment.ssh_port, Environment.jupyter_port, Environment.code_port).all()
    for ssh_port, jupyter_port, code_port in rows:
        blocked_ports.add(ssh_port)
        blocked_ports.add(jupyter_port)
        blocked_ports.add(code_port)

    custom_port_settings = db.query(Setting).filter(Setting.key.like("custom_ports:%")).all()
    for setting in custom_port_settings:
        if exclude_environment_id is not None and setting.key == f"custom_ports:{exclude_environment_id}":
            continue
        try:
            mappings = json.loads(setting.value)
        except Exception:
            continue
        for mapping in mappings or []:
            host_port = mapping.get("host_port")
            if isinstance(host_port, int):
                blocked_ports.add(host_port)
            elif isinstance(host_port, str) and host_port.isdigit():
                blocked_ports.add(int(host_port))

    host_start, host_end = CUSTOM_HOST_PORT_RANGE
    allocated = []
    for _ in range(count):
        host_port = _pick_free_port(host_start, host_end, blocked_ports)
        blocked_ports.add(host_port)
        allocated.append(host_port)
    return allocated


@celery_app.task(bind=True)
def create_environment_task(self, environment_id):
    db = SessionLocal()
    env = db.query(Environment).filter(Environment.id == environment_id).first()

    if not env:
        return f"Environment {environment_id} not found"

    try:
        # Update status to building
        env.status = "building"
        db.commit()

        print(f"[Task] Processing environment {env.id}")
        print(f"[Task] Dockerfile content length: {len(env.dockerfile_content) if env.dockerfile_content else 0}")

        client = docker.from_env()

        # 1. Build Image from user-provided Dockerfile
        image_name = f"lyra-custom-{str(env.id)}"

        if env.dockerfile_content:
            print(f"[Task] Building custom image {image_name}...")
            try:
                with tempfile.TemporaryDirectory() as temp_dir:
                    dockerfile_path = os.path.join(temp_dir, 'Dockerfile')
                    with open(dockerfile_path, 'w') as f:
                        f.write(env.dockerfile_content)

                    # Build image
                    # Note: This might block for a while
                    client.images.build(path=temp_dir, tag=image_name, rm=True)
                print("[Task] Custom image built successfully.")
            except Exception as build_error:
                print(f"[Task] Build failed: {build_error}")
                env.status = "error"
                db.commit()
                return f"Failed to build image: {str(build_error)}"
        else:
            # Fallback if no content provided
            image_name = "python:3.11-slim"
            try:
                client.images.get(image_name)
            except docker.errors.ImageNotFound:
                client.images.pull(image_name)

        # 2. Run Container
        # Basic container configuration
        token_key = f"jupyter_token:{env.id}"
        token_setting = db.query(Setting).filter(Setting.key == token_key).first()
        if not token_setting:
            token_setting = Setting(key=token_key, value=secrets.token_urlsafe(32))
            db.add(token_setting)
            db.commit()
        jupyter_token = token_setting.value

        custom_ports_key = f"custom_ports:{env.id}"
        custom_ports_setting = db.query(Setting).filter(Setting.key == custom_ports_key).first()
        custom_ports = []
        if custom_ports_setting:
            try:
                custom_ports = json.loads(custom_ports_setting.value) or []
            except Exception:
                custom_ports = []

        container_config = {
            "image": image_name,
            "name": f"lyra-{env.name}-{env.id}",  # Ensure unique name
            "detach": True,
            "environment": {
                "JUPYTER_TOKEN": jupyter_token
            },
            "ports": {
                '22/tcp': env.ssh_port,
                '8888/tcp': env.jupyter_port,
                '8080/tcp': env.code_port
            },
            # Keep container running with SSHD
            # Installing SSH server on the fly for demo purposes (NOT for production)
            "command": (
                "sh -c \""
                "apt-get update && "
                "apt-get install -y openssh-server python3-pip curl && "
                "mkdir -p /var/run/sshd && "
                f"echo 'root:{env.root_password}' | chpasswd && "
                "echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && "
                "python3 -m pip install --no-cache-dir jupyterlab && "
                "curl -fsSL https://code-server.dev/install.sh -o /tmp/install-code-server.sh && "
                "sh /tmp/install-code-server.sh && "
                "/usr/sbin/sshd && "
                "(code-server --bind-addr 0.0.0.0:8080 --auth none /root >/tmp/code-server.log 2>&1 &) && "
                "python3 -m jupyterlab --ip=0.0.0.0 --port=8888 --no-browser --allow-root "
                "--ServerApp.token=\"$JUPYTER_TOKEN\" "
                "--NotebookApp.token=\"$JUPYTER_TOKEN\"\""
            )
        }

        # Add DeviceRequests if GPUs are requested and we are not mocking
        # In this Mac environment (no Nvidia), we skip device_requests if env.gpu_indices is empty or mock.
        # But if we want to simulate "claiming" them, we just don't pass them to docker if they don't exist.

        if env.gpu_indices:
            # Add DeviceRequests for NVIDIA GPUs with specific indices
            # Convert indices to string for device_ids
            gpu_ids = [str(i) for i in env.gpu_indices]

            device_requests = [
                docker.types.DeviceRequest(
                    device_ids=gpu_ids,
                    capabilities=[["gpu"]],
                    driver="nvidia"
                )
            ]
            container_config["device_requests"] = device_requests
            # Note: Explicitly assigning specific GPU indices (e.g. device_ids=["0", "1"])
            # works if capabilities=[["gpu"]]. For simplicity with 'count', we assume generic allocation.
            # If we want specific indices, device_requests are constructed as above.

        # 3. Configure Volumes
        volumes = {}
        if env.mount_config:
            for mount in env.mount_config:
                # mount is expected to be a dict from JSONB
                host_path = mount.get('host_path')
                container_path = mount.get('container_path')
                mode = mount.get('mode', 'rw')

                if host_path and container_path:
                    volumes[host_path] = {'bind': container_path, 'mode': mode}

        if volumes:
            container_config['volumes'] = volumes

        for attempt in range(CONTAINER_RUN_PORT_RETRIES):
            ports_config = {
                '22/tcp': env.ssh_port,
                '8888/tcp': env.jupyter_port,
                '8080/tcp': env.code_port
            }
            for mapping in custom_ports:
                container_port = mapping.get("container_port")
                host_port = mapping.get("host_port")
                if container_port is None or host_port is None:
                    continue
                ports_config[f"{int(container_port)}/tcp"] = int(host_port)
            container_config["ports"] = ports_config
            try:
                client.containers.run(**container_config)
                break
            except docker.errors.APIError as run_error:
                message = str(run_error).lower()
                is_port_conflict = "port is already allocated" in message or "address already in use" in message
                if not is_port_conflict or attempt == CONTAINER_RUN_PORT_RETRIES - 1:
                    raise
                new_ssh_port, new_jupyter_port, new_code_port = _allocate_ports(db, exclude_environment_id=env.id)
                env.ssh_port = new_ssh_port
                env.jupyter_port = new_jupyter_port
                env.code_port = new_code_port
                if custom_ports:
                    new_custom_host_ports = _allocate_custom_host_ports(
                        db, len(custom_ports), exclude_environment_id=env.id
                    )
                    for idx, mapping in enumerate(custom_ports):
                        mapping["host_port"] = new_custom_host_ports[idx]
                    if custom_ports_setting:
                        custom_ports_setting.value = json.dumps(custom_ports)
                db.commit()

        env.status = "running"
        db.commit()

        return f"Environment {env.name} created successfully"

    except Exception as e:
        env.status = "error"
        db.commit()
        return f"Error creating environment: {str(e)}"
    finally:
        db.close()
