# Third-Party Licenses

Last updated: 2026-02-14

This repository is licensed under MIT (`LICENSE`), but it uses third-party software under multiple licenses.

## Project License

- Project: MIT

## Frontend Direct Dependencies

Source: `frontend/package.json` + installed metadata in `frontend/node_modules`

| Package | Version | License |
|---|---:|---|
| @eslint/js | 9.39.2 | MIT |
| @monaco-editor/react | 4.7.0 | MIT |
| @tailwindcss/postcss | 4.1.18 | MIT |
| @types/node | 24.10.9 | MIT |
| @types/react | 19.2.10 | MIT |
| @types/react-dom | 19.2.3 | MIT |
| @vitejs/plugin-react | 5.1.2 | MIT |
| autoprefixer | 10.4.24 | MIT |
| axios | 1.13.4 | MIT |
| clsx | 2.1.1 | MIT |
| eslint | 9.39.2 | MIT |
| eslint-plugin-react-hooks | 7.0.1 | MIT |
| eslint-plugin-react-refresh | 0.4.26 | MIT |
| framer-motion | 12.29.2 | MIT |
| globals | 16.5.0 | MIT |
| lucide-react | 0.563.0 | ISC |
| postcss | 8.5.6 | MIT |
| react | 19.2.4 | MIT |
| react-dom | 19.2.4 | MIT |
| react-router-dom | 7.13.0 | MIT |
| tailwind-merge | 3.4.0 | MIT |
| tailwindcss | 4.1.18 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| typescript-eslint | 8.54.0 | MIT |
| vite | 7.3.1 | MIT |
| xterm | 5.3.0 | MIT |
| xterm-addon-fit | 0.8.0 | MIT |

## Backend Direct Dependencies

Source: `backend/requirements.txt` + backend environment license scan

| Package | Version | License |
|---|---:|---|
| fastapi | 0.128.0 | MIT |
| uvicorn | 0.40.0 | BSD-3-Clause |
| sqlalchemy | 2.0.46 | MIT |
| asyncpg | 0.31.0 | Apache-2.0 |
| celery | 5.6.2 | BSD-3-Clause |
| redis | 7.1.0 | MIT |
| docker | 7.1.0 | Apache-2.0 |
| nvidia-ml-py | 13.590.48 | BSD License |
| python-multipart | 0.0.22 | Apache-2.0 |
| websockets | 16.0 | BSD-3-Clause |
| psycopg2-binary | 2.9.11 | LGPL |
| pytest | 9.0.2 | MIT |
| httpx | 0.28.1 | BSD License |
| ptyprocess | 0.7.0 | ISC |
| paramiko | 4.0.0 | LGPL-2.1 |
| alembic | 1.18.3 | MIT |

## Additional Transitive Licenses Requiring Attention

The following transitive dependencies include reciprocal/copyleft-style licenses.

### Frontend (transitive)

| Package | Version | License |
|---|---:|---|
| dompurify | 3.2.7 | (MPL-2.0 OR Apache-2.0) |
| lightningcss | 1.30.2 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.30.2 | MPL-2.0 |

### Backend (transitive or indirect at runtime)

| Package | Version | License |
|---|---:|---|
| certifi | 2026.1.4 | MPL-2.0 |
| paramiko | 4.0.0 | LGPL-2.1 |
| psycopg2-binary | 2.9.11 | LGPL |

## Notes

- This document is for engineering visibility and is not legal advice.
- Licenses can change when dependency versions change.
- Re-generate and review this file when `package-lock.json` or `backend/requirements.txt` changes.
