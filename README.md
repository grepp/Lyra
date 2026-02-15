# Lyra

[![Backend CI](https://github.com/hololee/Lyra/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/hololee/Lyra/actions/workflows/backend-ci.yml)
[![Frontend CI](https://github.com/hololee/Lyra/actions/workflows/frontend-ci.yml/badge.svg)](https://github.com/hololee/Lyra/actions/workflows/frontend-ci.yml)

Lyra is a web application designed to manage GPU-enabled build environments and containers effortlessly.

![Project Screenshot](imgs/screenshot.png)

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.11+ (for local development)
- Node.js 20+ (for local development)

### Running with Docker Compose

**Default (CPU-only):**
```bash
docker-compose up -d --build
```

**With GPU Support (NVIDIA):**
```bash
docker-compose -f docker-compose.gpu.yml up -d --build
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

`Environment` now includes optional service flags in API payloads:
- `enable_jupyter` (default: `true`)
- `enable_code_server` (default: `true`)

---

## i18n Guide

Frontend supports `en` and `ko` with default language `en`.

- Language selection is persisted in browser storage key `lyra.language`.
- Common/static page text uses domain keys such as `settings.*`, `templates.*`, `terminal.*`.
- Toast/error/status/dynamic user messages use `feedback.*`.

### Error Message Policy

- Do not render raw server errors directly.
- Use i18n fallback formatting for dynamic API errors:
  - `withApiMessage(t, 'feedback.<domain>.<event>', serverMessage)`
- If server message is missing, fallback key `feedback.common.unknownError` is used.

### Translation Workflow

1. Add key/value in `frontend/src/i18n/locales/en/common.ts`
2. Add matching key/value in `frontend/src/i18n/locales/ko/common.ts`
3. Replace UI string with `t('...')` in page/component code
4. Run i18n checks + lint/build

### i18n Checks

```bash
npm --prefix frontend run i18n:scan
npm --prefix frontend run i18n:keys
npm --prefix frontend run lint
npm --prefix frontend run build
```

### Managed Dockerfile Behavior

- Provisioning service checkboxes (`JupyterLab`, `code-server`) add/remove managed Dockerfile blocks automatically.
- Managed blocks are read-only in the editor. User edits are preserved only in the user-authored Dockerfile area.
- Template save stores only the user-authored Dockerfile area; managed blocks are excluded.
- On environment creation, the final Dockerfile is composed from:
  - user-authored Dockerfile content
  - currently selected managed service blocks

### Service Installation Policy

- Runtime auto-install in worker is disabled for Jupyter and code-server.
- Required tools must be installed at image build time through Dockerfile (including managed blocks).
- Worker starts services conditionally by feature flags:
  - `enable_jupyter`
  - `enable_code_server`
- Jupyter launch API returns `409` when Jupyter is disabled for that environment.
- Exposed host ports follow enabled services:
  - SSH is always exposed
  - Jupyter/code-server ports are exposed only when enabled

---

## Theme Guide

### Theme Policy

- Supported app themes: `dark`, `light`
- Persisted key: `lyra.theme` (browser `localStorage`)
- Default theme: `dark`
- Terminal (`xterm`) is intentionally fixed to dark for readability/consistency

### Theme Structure

- Theme state/provider:
  - `frontend/src/context/ThemeContext.tsx`
- Global tokens:
  - `frontend/src/index.css`
  - Core tokens: `--bg`, `--bg-elevated`, `--surface`, `--border`, `--text`, `--text-muted`, `--primary`, `--danger`, `--success`, `--overlay`
  - Terminal tokens: `--terminal-bg`, `--terminal-border`
- App-level wiring:
  - `frontend/src/main.tsx` (initial theme class apply)
  - `frontend/src/App.tsx` (provider usage)

### Third-Party Theming Rules

- Monaco Editor (`@monaco-editor/react`)
  - Use `vs-dark` when app theme is dark
  - Use `vs` when app theme is light
  - Applied in:
    - `frontend/src/pages/Provisioning.tsx`
    - `frontend/src/pages/Templates.tsx`
- xterm
  - Always dark theme (not bound to app light/dark toggle)
  - Applied in:
    - `frontend/src/pages/TerminalPage.tsx`

---

## Verification Checklist

Run before opening a PR:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

Manual checks:

1. Toggle `Settings > General > Theme` (`dark`/`light`) and verify layout colors update on:
   - Dashboard
   - Provisioning
   - Settings
   - Templates
2. Verify Monaco switches with app theme in:
   - Provisioning Dockerfile editor
   - Templates detail modal editor
3. Verify Terminal page remains visually stable with fixed dark terminal area in both app themes.
4. Verify key interactions remain unchanged:
   - Environment create/start/stop/delete
   - Template load/save/delete
   - SSH settings save/test
5. Verify managed Dockerfile behavior:
   - Toggle Jupyter/code-server checkboxes and confirm managed blocks are added/removed in Dockerfile editor.
   - Confirm managed block text cannot be edited directly (auto-restored).
   - Save template and confirm managed block markers are not included in template Dockerfile content.
6. Verify service flag behavior:
   - Dashboard Access shows `-` per disabled service.
   - Jupyter launch returns `409` when Jupyter is disabled for the environment.
