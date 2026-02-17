from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routers import environments, terminal, resources, settings, templates, filesystem, worker_api, worker_servers
from .models import Setting
from .core.security import require_secret_key
from .core.worker_auth import WORKER_ROLE, ensure_worker_api_token, get_node_role
from sqlalchemy.future import select
from contextlib import asynccontextmanager
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_worker_api_token()
    require_secret_key()

    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed default settings
    from .database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        # Check if app_name exists
        result = await session.execute(select(Setting).where(Setting.key == "app_name"))
        if not result.scalars().first():
            session.add(Setting(key="app_name", value="Lyra"))
            await session.commit()

    yield
    # Shutdown (if needed)


app = FastAPI(
    title="Lyra",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

# CORS
origins = os.getenv("ALLOW_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
def read_root():
    return {"message": "Welcome to Lyra API"}


app.include_router(worker_api.router, prefix="/api")

if get_node_role() != WORKER_ROLE:
    app.include_router(environments.router, prefix="/api")
    app.include_router(terminal.router, prefix="/api")
    app.include_router(resources.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(templates.router, prefix="/api")
    app.include_router(filesystem.router, prefix="/api")
    app.include_router(worker_servers.router, prefix="/api")
