from .worker import celery_app
from .database import DATABASE_URL
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .models import Environment
import docker
import time


# Sync database setup for Celery
# Replace 'postgresql+asyncpg' with 'postgresql' for sync driver if needed,
# but usually we use a separate sync URL string.
SYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg", "postgresql")
engine = create_engine(SYNC_DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)


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

        client = docker.from_env()

        # 1. Build Image (Mocking build process or using actual content)
        # In real app, write dockerfile_content to a temp folder and build
        # image_tag = f"lyra-env-{str(env.id)}"

        # detailed implementation omitted for brevity, simulating build delay
        time.sleep(5)

        # 2. Run Container
        # For demo purposes, we use python:3.11-slim directly instead of building custom image
        # This speeds up the process and avoids complex build errors in this environment
        image_name = "python:3.11-slim"

        # Pull image if not exists
        try:
            client.images.get(image_name)
        except docker.errors.ImageNotFound:
            client.images.pull(image_name)

        # Basic container configuration
        container_config = {
            "image": image_name,
            "name": f"lyra-{env.name}-{env.id}",  # Ensure unique name
            "detach": True,
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
                "apt-get install -y openssh-server python3-pip && "
                "mkdir -p /var/run/sshd && "
                f"echo 'root:{env.root_password}' | chpasswd && "
                "echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && "
                "pip3 install jupyterlab && "
                "/usr/sbin/sshd && "
                "jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root\""
            )
        }

        # Add DeviceRequests if GPUs are requested and we are not mocking
        # In this Mac environment (no Nvidia), we skip device_requests if env.gpu_indices is empty or mock.
        # But if we want to simulate "claiming" them, we just don't pass them to docker if they don't exist.

        if env.gpu_indices:
            # Only add if we are on a linux host with nvidia runtime,
            # otherwise this will fail on Mac.
            # We check client info or just Wrap in try-except for the run.
            pass

        client.containers.run(**container_config)

        env.status = "running"
        db.commit()

        return f"Environment {env.name} created successfully"

    except Exception as e:
        env.status = "error"
        db.commit()
        return f"Error creating environment: {str(e)}"
    finally:
        db.close()
