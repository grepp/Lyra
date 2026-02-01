from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routers import environments, terminal, resources
import os


app = FastAPI(title="GPU-VibeManager", version="0.1.0")

# CORS
origins = os.getenv("ALLOW_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get("/")
def read_root():
    return {"message": "Welcome to GPU-VibeManager API"}


app.include_router(environments.router)
app.include_router(terminal.router)
app.include_router(resources.router)
