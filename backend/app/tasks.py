from .worker import celery_app
from .database import DATABASE_URL
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .models import Environment
import docker
import tempfile
import os


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
