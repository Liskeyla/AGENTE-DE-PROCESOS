from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.projects import _get_project
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.project import Document, ProcessModel
from app.models.user import Organization, User
from app.schemas import OrgChartResponse
from app.services.local_analyzer import LocalAnalyzer
from app.services.org_chart_service import OrgChartService

router = APIRouter()


@router.get("/{project_id}/org-chart", response_model=OrgChartResponse)
async def get_org_chart(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)

    model_result = await db.execute(
        select(ProcessModel).where(
            ProcessModel.project_id == project_id,
            ProcessModel.parent_id.is_(None),
        ).order_by(ProcessModel.created_at.desc()).limit(1)
    )
    process_model = model_result.scalar_one_or_none()
    if not process_model or not process_model.model_data:
        raise HTTPException(
            status_code=400,
            detail="No hay análisis del proceso. Sube y analiza la entrevista primero.",
        )

    consolidated = process_model.model_data
    if consolidated.get("org_chart"):
        return consolidated["org_chart"]

    docs_result = await db.execute(
        select(Document).where(
            Document.project_id == project_id,
            Document.extracted_text.isnot(None),
        )
    )
    documents = docs_result.scalars().all()
    extractions = []
    for doc in documents:
        extractions.append(LocalAnalyzer.extract_from_text(
            doc.extracted_text or "",
            doc.filename,
            doc.source_type.value,
            doc.area,
        ))

    org = await db.get(Organization, current_user.organization_id)
    org_name = org.name if org else "Empresa"
    chart = OrgChartService.build_from_consolidated(consolidated, org_name, extractions)
    return chart
