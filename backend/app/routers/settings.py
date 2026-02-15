from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from ..database import get_db
from ..models import Setting
from ..schemas import SettingResponse, SettingUpdate
from typing import List
from ..core.settings_policy import (
    is_allowed_setting_key,
    validate_setting_key_for_read,
    validate_setting_key_for_write,
)

router = APIRouter(
    prefix="/settings",
    tags=["settings"],
)


@router.get("/", response_model=List[SettingResponse])
async def get_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting))
    settings = result.scalars().all()
    return [setting for setting in settings if is_allowed_setting_key(setting.key)]


@router.get("/{key}", response_model=SettingResponse)
async def get_setting(key: str, db: AsyncSession = Depends(get_db)):
    validate_setting_key_for_read(key)

    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalars().first()

    if not setting:
        if key == "app_name":
            return {"key": "app_name", "value": "Lyra"}
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting


@router.put("/{key}", response_model=SettingResponse)
async def update_setting(key: str, setting_update: SettingUpdate, db: AsyncSession = Depends(get_db)):
    validate_setting_key_for_write(key)

    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalars().first()

    if not setting:
        # If not found, create it (could be useful for first time)
        setting = Setting(key=key, value=setting_update.value)
        db.add(setting)
    else:
        setting.value = setting_update.value

    await db.commit()
    await db.refresh(setting)
    return setting
