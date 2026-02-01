from fastapi import APIRouter
import pynvml
import random


router = APIRouter(
    prefix="/resources",
    tags=["resources"],
)


@router.get("/gpu")
async def get_gpu_resources():
    # In a real implementation, we would use pynvml to check actual GPU availability
    # For demo on Mac/Non-GPU host, we mock the response

    try:
        pynvml.nvmlInit()
        device_count = pynvml.nvmlDeviceGetCount()
        pynvml.nvmlShutdown()

        return {
            "available": device_count,
            "total": device_count,
            "used": 0
        }
    except Exception:
        # Mocking 4 GPUs for demo
        return {
            "available": 4,
            "total": 4,
            "used": 0
        }


@router.get("/nodes")
async def get_node_resources():
    return [
        {
            "id": "node-1",
            "name": "Local Node",
            "status": "online",
            "gpus": 4,
            "load": random.randint(10, 80)
        }
    ]
