from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID
from datetime import datetime


class MountConfig(BaseModel):
    host_path: str
    container_path: str
    mode: str = "rw"


class EnvironmentBase(BaseModel):
    name: str
    container_user: str = "root"
    root_password: str = "admin"
    dockerfile_content: Optional[str] = None
    mount_config: List[MountConfig] = []


class EnvironmentCreate(EnvironmentBase):
    pass


class EnvironmentResponse(EnvironmentBase):
    id: UUID
    status: str
    gpu_indices: List[int]
    ssh_port: int
    jupyter_port: int
    code_port: int
    created_at: datetime

    class Config:
        from_attributes = True


class SettingBase(BaseModel):
    key: str
    value: str


class SettingUpdate(BaseModel):
    value: str


class SettingResponse(SettingBase):
    class Config:
        from_attributes = True
