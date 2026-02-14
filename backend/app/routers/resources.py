import docker
from fastapi import APIRouter, Depends, HTTPException, Query
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
    result = await db.execute(select(Environment).where(Environment.status.in_(["running", "building"])))
    active_envs = result.scalars().all()

    used_indices = set()
    for env in active_envs:
        if env.gpu_indices:
            used_indices.update(env.gpu_indices)

    used_count = len(used_indices)
    available = total_gpus - used_count
    if available < 0:
        available = 0

    return {"available": available, "total": total_gpus, "used": used_count}


@router.get("/nodes")
async def get_node_resources():
    return [{"id": "node-1", "name": "Local Node", "status": "online", "gpus": 0, "load": random.randint(10, 80)}]


def _format_image_tags(tags):
    if not tags:
        return ["<none>:<none>"]
    return tags


def _collect_used_docker_resources(client):
    used_image_ids = set()
    used_volume_names = set()

    containers = client.containers.list(all=True)
    for container in containers:
        try:
            image_id = container.image.id
            if image_id:
                used_image_ids.add(image_id)
        except Exception:
            pass

        mounts = container.attrs.get("Mounts", []) or []
        for mount in mounts:
            if mount.get("Type") == "volume":
                name = mount.get("Name")
                if name:
                    used_volume_names.add(name)

    return used_image_ids, used_volume_names


def _list_unused_images(client, mode: str):
    used_image_ids, _ = _collect_used_docker_resources(client)
    images = client.images.list(all=True)
    candidates = []
    for image in images:
        image_id = image.id
        tags = _format_image_tags(image.tags)
        is_dangling = all(tag == "<none>:<none>" for tag in tags)

        if image_id in used_image_ids:
            continue
        if mode == "dangling" and not is_dangling:
            continue

        candidates.append(
            {
                "id": image_id,
                "short_id": image.short_id,
                "tags": tags,
                "is_dangling": is_dangling,
                "size": int(image.attrs.get("Size", 0) or 0),
            }
        )
    return candidates


@router.get("/docker/images/unused")
async def list_unused_images(mode: str = Query(default="dangling", pattern="^(dangling|unused)$")):
    try:
        client = docker.from_env()
        candidates = _list_unused_images(client, mode=mode)
        return {"mode": mode, "count": len(candidates), "images": candidates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/docker/images/prune")
async def prune_unused_images(payload: dict):
    mode = str(payload.get("mode", "dangling"))
    if mode not in {"dangling", "unused"}:
        raise HTTPException(status_code=400, detail="mode must be dangling or unused")
    selected_ids = set(payload.get("image_ids") or [])

    try:
        client = docker.from_env()
        candidates = _list_unused_images(client, mode=mode)
        candidate_map = {img["id"]: img for img in candidates}
        target_ids = selected_ids if selected_ids else set(candidate_map.keys())

        removed = []
        skipped = []
        for image_id in target_ids:
            image_meta = candidate_map.get(image_id)
            if not image_meta:
                skipped.append({"id": image_id, "reason": "Not an unused image candidate"})
                continue
            try:
                client.images.remove(image=image_id, force=False, noprune=False)
                removed.append(image_meta)
            except Exception as e:
                skipped.append({"id": image_id, "reason": str(e)})

        return {
            "mode": mode,
            "removed_count": len(removed),
            "skipped_count": len(skipped),
            "removed": removed,
            "skipped": skipped,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/docker/volumes/unused")
async def list_unused_volumes():
    try:
        client = docker.from_env()
        _, used_volume_names = _collect_used_docker_resources(client)
        volumes = client.volumes.list()

        candidates = []
        for volume in volumes:
            name = volume.name
            if name in used_volume_names:
                continue
            # Docker named volumes only; bind mounts are not returned here.
            candidates.append(
                {
                    "name": name,
                    "mountpoint": volume.attrs.get("Mountpoint", ""),
                    "driver": volume.attrs.get("Driver", ""),
                    "scope": volume.attrs.get("Scope", ""),
                    "created_at": volume.attrs.get("CreatedAt", ""),
                }
            )

        return {"count": len(candidates), "volumes": candidates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/docker/volumes/prune")
async def prune_unused_volumes(payload: dict):
    selected_names = set(payload.get("volume_names") or [])

    try:
        client = docker.from_env()
        _, used_volume_names = _collect_used_docker_resources(client)
        volumes = client.volumes.list()
        candidate_names = {v.name for v in volumes if v.name not in used_volume_names}
        target_names = selected_names if selected_names else candidate_names

        removed = []
        skipped = []
        for volume_name in target_names:
            if volume_name not in candidate_names:
                skipped.append({"name": volume_name, "reason": "Not an unused volume candidate"})
                continue
            try:
                vol = client.volumes.get(volume_name)
                vol.remove(force=False)
                removed.append({"name": volume_name})
            except Exception as e:
                skipped.append({"name": volume_name, "reason": str(e)})

        return {"removed_count": len(removed), "skipped_count": len(skipped), "removed": removed, "skipped": skipped}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/docker/build-cache")
async def get_build_cache_summary():
    try:
        client = docker.from_env()
        data = client.api.df()
        build_cache = data.get("BuildCache", []) or []
        total_size = sum(int(item.get("Size", 0) or 0) for item in build_cache)
        return {"count": len(build_cache), "size": total_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/docker/build-cache/prune")
async def prune_build_cache(payload: dict):
    prune_all = bool(payload.get("all", True))
    try:
        client = docker.from_env()
        try:
            result = client.api.prune_builds(all=prune_all)
        except TypeError:
            # Older API client compatibility
            result = client.api.prune_builds()
        reclaimed = int(result.get("SpaceReclaimed", 0) or 0)
        return {"space_reclaimed": reclaimed, "raw": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
