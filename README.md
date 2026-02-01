# Lyra

[![Backend CI](https://github.com/hololee/Lyra/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/hololee/Lyra/actions/workflows/backend-ci.yml)
[![Frontend CI](https://github.com/hololee/Lyra/actions/workflows/frontend-ci.yml/badge.svg)](https://github.com/hololee/Lyra/actions/workflows/frontend-ci.yml)

Lyra is a web application designed to manage GPU-enabled build environments and containers effortlessly.

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.11+ (for local development)
- Node.js 20+ (for local development)

### Running with Docker Compose
To start the entire stack (Frontend, Backend, Database, Redis, and Worker):

```bash
docker-compose up -d --build
```

- **Frontend**: [http://localhost](http://localhost)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Project Structure

```text
.
├── backend/               # FastAPI + Celery + SQLAlchemy
│   ├── app/               # Application logic (routers, models, tasks)
│   ├── tests/             # Pytest suite
│   └── Dockerfile         # Python environment definition
├── frontend/              # React + Vite + TailwindCSS
│   ├── src/               # Application components and pages
│   └── Dockerfile         # Nginx-based frontend deployment
├── docs/                  # Project documentation & TODOs
├── .github/workflows/     # GitHub Actions CI/CD pipelines
├── .pre-commit-config.yaml# Local CI check configuration
└── docker-compose.yml     # Service orchestration
```

---

## Local Development & CI

### Pre-commit Hooks
This project uses `pre-commit` to ensure code quality locally. To set it up:

```bash
pip install pre-commit
pre-commit install
```

Now, every `git commit` will automatically run linting (`flake8`, `eslint`) and tests (`pytest`).

### Manual CI Run
You can manually run all checks across the codebase:
```bash
pre-commit run --all-files
```

### Database Migrations
This project uses **Alembic** for handling database schema changes.

**Create a new migration** (after modifying `models.py`):
```bash
docker compose exec backend alembic revision --autogenerate -m "Description of changes"
```

**Apply migrations to DB**:
```bash
docker compose exec backend alembic upgrade head
```
