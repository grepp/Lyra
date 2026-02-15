# Server Setup Instructions

This guide contains only the required steps to deploy Lyra on a server.

## 1) Prepare `.env`

```bash
cp .env.sample .env
```

Set required values:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGE_THIS_DB_PASSWORD
POSTGRES_DB=lyra

DATABASE_URL=postgresql+asyncpg://postgres:CHANGE_THIS_DB_PASSWORD@db/lyra
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0

APP_SECRET_KEY=REPLACE_WITH_VALID_FERNET_KEY
ALLOW_ORIGINS=http://YOUR_SERVER_IP,https://YOUR_DOMAIN
SSH_HOST_KEY_POLICY=reject
SSH_KNOWN_HOSTS_PATH=/root/.ssh/known_hosts
```

Notes:
- `APP_SECRET_KEY` must be a valid Fernet key.
- `ALLOW_ORIGINS` must exactly match browser origin(s) used to access Lyra.
- `POSTGRES_PASSWORD` and `DATABASE_URL` must match.

## 2) Run services

CPU:

```bash
docker compose up -d --build
```

GPU:

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

## 3) Verify deployment

```bash
docker compose ps
```

## 4) SSH trust bootstrap (required when `SSH_HOST_KEY_POLICY=reject`)

Register host key in backend container:

```bash
docker compose exec backend sh -lc 'mkdir -p /root/.ssh && ssh-keyscan -H <SSH_HOST> >> /root/.ssh/known_hosts'
```

Example:

```bash
docker compose exec backend sh -lc 'mkdir -p /root/.ssh && ssh-keyscan -H host.docker.internal >> /root/.ssh/known_hosts'
```

Optional fingerprint pinning:
1. Get fingerprint:
```bash
ssh-keyscan <SSH_HOST> | ssh-keygen -lf -
```
2. Save SHA256 fingerprint to setting key `ssh_host_fingerprint` (for example `SHA256:...`).
