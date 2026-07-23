from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import Project
from app.schemas import ProjectCreate, ProjectUpdate, ProjectResponse

router = APIRouter()


@router.post("", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_name = (data.name or "").strip()
    project = Project(
        organization_id=current_user.organization_id,
        name=org_name,
        description=data.description,
        created_by=current_user.id,
        methodology={
            "mode": "iso_adaptive_interview",
            "iso_interview": {
                "active": False,
                "completed": False,
                "onboarding_step": "awaiting_ready",
                "org_profile": {"org_name": org_name} if org_name else {},
                "progress_percent": 0,
                "answers_count": 0,
            },
        },
    )
    db.add(project)
    await db.flush()
    return project


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Project)
        .where(Project.organization_id == current_user.organization_id)
        .order_by(Project.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    if data.name is not None:
        project.name = data.name
    if data.description is not None:
        project.description = data.description
    await db.flush()
    return project


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    await db.delete(project)
    return {"message": "Proyecto eliminado"}


async def _get_project(db: AsyncSession, project_id: UUID, user: User) -> Project:
    project = await db.get(Project, project_id)
    if not project or project.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return project
