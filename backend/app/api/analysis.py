from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.agent_orchestrator import AgentOrchestrator
from app.services.local_analyzer import LocalAnalyzer
from app.services.llm_service import LLMError
from app.models.project import ProcessAnalysis, ProcessModel, AnalysisType
from app.schemas import AnalysisResponse
from app.api.projects import _get_project

router = APIRouter()


@router.post("/{project_id}/analysis/{analysis_type}", response_model=AnalysisResponse)
async def run_analysis(
    project_id: UUID,
    analysis_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    try:
        agent = AgentOrchestrator(db)
        await agent.run_process_analysis(project_id, analysis_type)
    except (LLMError, Exception):
        model_result = await db.execute(
            select(ProcessModel).where(ProcessModel.project_id == project_id)
            .order_by(ProcessModel.created_at.desc()).limit(1)
        )
        process_model = model_result.scalar_one_or_none()
        consolidated = process_model.model_data if process_model else {}
        content = {
            "summary": f"Análisis {analysis_type} basado en {len(consolidated.get('consolidated_activities', []))} actividades",
            "activities": consolidated.get("consolidated_activities", []),
            "areas": consolidated.get("macro_flow", {}).get("areas_involved", []),
            "mode": "local",
        }
        analysis = ProcessAnalysis(
            project_id=project_id,
            analysis_type=AnalysisType(analysis_type),
            content=content,
            recommendations=[{"text": "Revisar actividades manuales para automatización", "priority": "medium"}],
            risks=consolidated.get("macro_flow", {}).get("critical_points", []),
        )
        db.add(analysis)
        await db.flush()

    result = await db.execute(
        select(ProcessAnalysis)
        .where(ProcessAnalysis.project_id == project_id, ProcessAnalysis.analysis_type == analysis_type)
        .order_by(ProcessAnalysis.created_at.desc()).limit(1)
    )
    analysis = result.scalar_one_or_none()
    return analysis


@router.get("/{project_id}/analysis", response_model=list[AnalysisResponse])
async def list_analyses(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    result = await db.execute(
        select(ProcessAnalysis).where(ProcessAnalysis.project_id == project_id)
        .order_by(ProcessAnalysis.created_at.desc())
    )
    return result.scalars().all()
