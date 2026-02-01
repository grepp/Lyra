from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from ..database import get_db
from ..models import Environment
import pynvml
import random


router = APIRouter(
    prefix="/resources",
    tags=["resources"],
)


@router.get("/gpu")
async def get_gpu_resources(db: AsyncSession = Depends(get_db)):
    # 1. Get total GPUs from System
    total_gpus = 0
    try:
        pynvml.nvmlInit()
        total_gpus = pynvml.nvmlDeviceGetCount()
        pynvml.nvmlShutdown()
    except Exception as e:
        print(f"Failed to initialize NVML: {e}")
        # For testing purposes on non-GPU environment
        # total_gpus = 0
        pass

    # 2. Get Used GPUs from Database
    # Find environments that are 'running' or 'building'
    result = await db.execute(
        select(Environment).where(Environment.status.in_(["running", "building"]))
    )
    active_envs = result.scalars().all()

    used_indices = set()
    for env in active_envs:
        if env.gpu_indices:
            used_indices.update(env.gpu_indices)

    used_count = len(used_indices)
    available = total_gpus - used_count
    if available < 0:
        available = 0

    return {
        "available": available,
        "total": total_gpus,
        "used": used_count
    }


@router.get("/nodes")
async def get_node_resources():
    return [
        {
            "id": "node-1",
            "name": "Local Node",
            "status": "online",
            "gpus": 0,
            "load": random.randint(10, 80)
        }
    ]
