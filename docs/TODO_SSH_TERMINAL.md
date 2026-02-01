---
description: Set up a comprehensive guide to implement SSH forwarding from the backend container to the host or target environments.
---
# TODO: Implement SSH Forwarding for Terminal

Currently, the terminal feature connects directly to the backend container's shell (`/bin/bash`).
The goal is to allow users to connect to:
1. The **Host Machine** (where the app is running).
2. The **Target Environments** (provisioned containers) via SSH.

## Tasks

### 1. SSH Client Setup in Backend
- Ensure `openssh-client` is installed in the backend Docker image.
- Configure SSH keys or password handling (using `paramiko` or similar library might be better than raw `ssh` command for WebSocket tunneling).

### 2. Backend Router Update (`routers/terminal.py`)
- Modify the WebSocket handler to accept a target (e.g., `?target=host` or `?target=env_id`).
- Instead of spawning `/bin/bash` with `pty.openpty()`:
    - **For Host**: Spawn `ssh user@host.docker.internal` (requires host config).
    - **For Environments**: Spawn `ssh root@<container_ip> -p 22` (or use internal Docker network DNS).

### 3. Frontend Update (`TerminalPage.tsx`)
- Add a dropdown or selector to choose the target (Host vs. Specific Environment).
- Pass the selection as a query parameter in the WebSocket URL (e.g., `ws://.../terminal/ws?target=<selection>`).

### 4. Security Considerations
- Managing SSH keys securely (volume mounting keys vs. storing in DB).
- preventing unauthorized access to arbitrary hosts.
