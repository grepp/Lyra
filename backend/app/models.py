from sqlalchemy import Column, String, Integer, Text, DateTime, ARRAY, Boolean, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
import uuid


class WorkerServer(Base):
    __tablename__ = "worker_servers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, nullable=False)
    base_url = Column(Text, unique=True, nullable=False)
    api_token_encrypted = Column(Text, nullable=False)
    last_health_status = Column(String(32), nullable=False, server_default=text("'unknown'"))
    last_health_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    environments = relationship("Environment", back_populates="worker_server")


class Environment(Base):
    __tablename__ = "environments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), unique=True, nullable=False)
    worker_server_id = Column(UUID(as_uuid=True), ForeignKey("worker_servers.id"), nullable=True)
    container_user = Column(String(50), default='root')
    root_password = Column(String(50), nullable=False)
    root_password_encrypted = Column(Text, nullable=True)
    status = Column(String(50), default='building')  # building, running, stopped, error
    gpu_indices = Column(ARRAY(Integer), nullable=False)
    ssh_port = Column(Integer, unique=True, nullable=False)
    jupyter_port = Column(Integer, unique=True, nullable=False)
    code_port = Column(Integer, unique=True, nullable=False)
    enable_jupyter = Column(Boolean, nullable=False, server_default=text("true"))
    enable_code_server = Column(Boolean, nullable=False, server_default=text("true"))
    mount_config = Column(JSONB, nullable=True)  # List of {host_path, container_path, mode}
    dockerfile_content = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    worker_server = relationship("WorkerServer", back_populates="environments")


class Template(Base):
    __tablename__ = "templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    config = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
