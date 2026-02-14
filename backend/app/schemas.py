from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime


class MountConfig(BaseModel):
    host_path: str
    container_path: str
    mode: str = "rw"


class EnvironmentBase(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z0-9-]+$")
    container_user: str = "root"
    root_password: str = "admin"
    dockerfile_content: Optional[str] = None
    mount_config: List[MountConfig] = []
    gpu_count: int = 0


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
    container_id: str | None = None

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


class TemplateBase(BaseModel):
    name: str
    description: Optional[str] = None
    config: Dict[str, Any]


class TemplateCreate(TemplateBase):
    pass


class TemplateResponse(TemplateBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True
