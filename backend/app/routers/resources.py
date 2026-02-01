from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from ..database import get_db
from ..models import Environment
from typing import List, Dict
import pynvml
import logging

router = APIRouter(
    prefix="/resources",
    tags=["resources"],
)

logger = logging.getLogger("uvicorn")

def get_total_gpus():
    try:
        pynvml.nvmlInit()
        return pynvml.nvmlDeviceGetCount()
    except pynvml.NVMLError as e:
        logger.warning(f"NVML Init failed: {e}. Using mock GPU count.")
        return 0 # Mock for development/mac
    except Exception as e:
        logger.warning(f"Failed to get GPU count: {e}. Using mock GPU count.")
        return 0

@router.get("/gpu")
async def get_gpu_availability(db: AsyncSession = Depends(get_db)):
    total_gpus = get_total_gpus()
    
    # Query used GPUs
    # We consider 'running' and 'building' status as occupying the GPUs
    result = await db.execute(
        select(Environment.gpu_indices).where(
            Environment.status.in_(['running', 'building'])
        )
    )
    
    used_indices = set()
    rows = result.scalars().all()
    for indices in rows:
        for idx in indices:
            used_indices.add(idx)
            
    used_count = len(used_indices)
    
    # Maximum allocatable is simply total - used, 
    # but strictly speaking we should look for contiguous blocks or specific indices.
    # For this slider feature, we just return the count.
    
    available_count = max(0, total_gpus - used_count)
    
    return {
        "total": total_gpus,
        "used": used_count,
        "available": available_count,
        "used_indices": list(used_indices)
    }
