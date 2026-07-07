from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import (
    Document, AgentQuestion, ProcessModel, ProcessAnalysis, BpmnDiagram,
    QuestionStatus, Project,
)
from app.schemas import DashboardMetrics
from app.api.projects import _get_project

router = APIRouter()


@router.get("/{project_id}/dashboard", response_model=DashboardMetrics)
async def get_dashboard(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)

    doc_count = await db.execute(
        select(func.count()).select_from(Document).where(Document.project_id == project_id)
    )

    pending_q = await db.execute(
        select(func.count()).select_from(AgentQuestion).where(
            AgentQuestion.project_id == project_id,
            AgentQuestion.status == QuestionStatus.PENDING,
        )
    )

    model_result = await db.execute(
        select(ProcessModel).where(
            ProcessModel.project_id == project_id,
            ProcessModel.parent_id.is_(None),
        ).order_by(ProcessModel.created_at.desc()).limit(1)
    )
    process_model = model_result.scalar_one_or_none()

    if not process_model:
        model_result = await db.execute(
            select(ProcessModel).where(ProcessModel.project_id == project_id)
            .order_by(ProcessModel.created_at.desc()).limit(1)
        )
        process_model = model_result.scalar_one_or_none()

    diagram_count = await db.execute(
        select(func.count()).select_from(BpmnDiagram).where(BpmnDiagram.project_id == project_id)
    )

    activities = []
    areas = set()
    systems = set()
    manual_count = 0
    auto_count = 0
    completeness = 0.0

    if process_model and process_model.model_data:
        data = process_model.model_data
        activities = data.get("consolidated_activities", data.get("subprocesses", []))
        areas.update(data.get("macro_flow", {}).get("areas_involved", []))
        systems.update(data.get("macro_flow", {}).get("systems_involved", []))
        completeness = data.get("completeness_score", 0.0)

        for act in activities:
            if isinstance(act, dict):
                if act.get("is_manual"):
                    manual_count += 1
                if act.get("is_automated"):
                    auto_count += 1

    risks_count = 0
    analysis_result = await db.execute(
        select(ProcessAnalysis).where(ProcessAnalysis.project_id == project_id)
    )
    for analysis in analysis_result.scalars().all():
        risks_count += len(analysis.risks or [])

    maturity = 1
    if completeness > 0.3:
        maturity = 2
    if completeness > 0.5:
        maturity = 3
    if completeness > 0.7:
        maturity = 4
    if completeness > 0.85:
        maturity = 5

    return DashboardMetrics(
        total_documents=doc_count.scalar() or 0,
        total_activities=len(activities),
        manual_activities=manual_count,
        automated_activities=auto_count,
        automatable_activities=max(0, manual_count - auto_count),
        areas_involved=list(areas),
        systems_involved=list(systems),
        risks_identified=risks_count,
        pending_questions=pending_q.scalar() or 0,
        completeness_score=completeness,
        iso_compliance_score=min(completeness * 100, 100),
        bpm_maturity_level=maturity,
        total_bpmn_diagrams=diagram_count.scalar() or 0,
        agent_state=project.agent_state.value,
        project_status=project.status.value,
    )
