from sqlalchemy import Column, String, Integer, Text, DateTime, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from .database import Base
import uuid


class Environment(Base):
    __tablename__ = "environments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    container_user = Column(String(50), default='root')
    root_password = Column(String(50), default='admin')
    status = Column(String(50), default='building')  # building, running, stopped, error
    gpu_indices = Column(ARRAY(Integer), nullable=False)
    ssh_port = Column(Integer, unique=True, nullable=False)
    jupyter_port = Column(Integer, unique=True, nullable=False)
    code_port = Column(Integer, unique=True, nullable=False)
    mount_config = Column(JSONB, nullable=True)  # List of {host_path, container_path, mode}
    dockerfile_content = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Template(Base):
    __tablename__ = "templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    content = Column(Text, nullable=False)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
