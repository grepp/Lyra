from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from ..database import get_db
from ..models import Template
from ..schemas import TemplateCreate, TemplateResponse
import uuid

router = APIRouter(
    prefix="/templates",
    tags=["templates"],
)


@router.post("/", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(template: TemplateCreate, db: AsyncSession = Depends(get_db)):
    new_template = Template(
        name=template.name,
        description=template.description,
        config=template.config
    )
    db.add(new_template)
    await db.commit()
    await db.refresh(new_template)
    return new_template


@router.get("/", response_model=List[TemplateResponse])
async def read_templates(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Template).order_by(Template.created_at.desc()).offset(skip).limit(limit))
    return result.scalars().all()


@router.get("/{template_id}", response_model=TemplateResponse)
async def read_template(template_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uuid_id = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    result = await db.execute(select(Template).where(Template.id == uuid_id))
    template = result.scalars().first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uuid_id = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    result = await db.execute(select(Template).where(Template.id == uuid_id))
    template = result.scalars().first()
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.delete(template)
    await db.commit()
    return None
