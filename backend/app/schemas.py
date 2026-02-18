from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime


class MountConfig(BaseModel):
    host_path: str
    container_path: str
    mode: str = "rw"


class CustomPortMapping(BaseModel):
    host_port: int
    container_port: int


class EnvironmentBase(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z0-9-]+$")
    worker_server_id: Optional[UUID] = None
    container_user: str = "root"
    dockerfile_content: Optional[str] = None
    enable_jupyter: bool = True
    enable_code_server: bool = True
    mount_config: List[MountConfig] = []
    custom_ports: List[CustomPortMapping] = []
    gpu_count: int = 0
    selected_gpu_indices: List[int] = []


class EnvironmentCreate(EnvironmentBase):
    root_password: str
    dockerfile_content: str


class EnvironmentResponse(EnvironmentBase):
    id: UUID
    status: str
    gpu_indices: List[int]
    ssh_port: int
    jupyter_port: int
    code_port: int
    worker_server_name: Optional[str] = None
    worker_server_base_url: Optional[str] = None
    worker_error_code: Optional[str] = None
    worker_error_message: Optional[str] = None
    created_at: datetime
    container_id: str | None = None

    class Config:
        from_attributes = True


class CustomPortAllocateRequest(BaseModel):
    count: int = 1
    current_ports: List[CustomPortMapping] = []


class CustomPortAllocateResponse(BaseModel):
    mappings: List[CustomPortMapping]


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


class WorkerServerBase(BaseModel):
    name: str
    base_url: str


class WorkerServerCreate(WorkerServerBase):
    api_token: str


class WorkerServerUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_token: Optional[str] = None


class WorkerServerResponse(WorkerServerBase):
    id: UUID
    last_health_status: str
    last_health_checked_at: Optional[datetime] = None
    last_error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
