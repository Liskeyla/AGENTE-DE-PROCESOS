from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, safe_rollback
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import ChatMessage, AgentQuestion, QuestionStatus
from app.schemas import ChatRequest, ChatResponse, QuestionAnswer, QuestionResponse
from app.services.agent_orchestrator import AgentOrchestrator
from app.api.projects import _get_project

router = APIRouter()


@router.post("/{project_id}/chat", response_model=ChatResponse)
async def send_message(
    project_id: UUID,
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    try:
        agent = AgentOrchestrator(db)
        msg = await agent.chat(project_id, data.message)
        return ChatResponse(
            id=msg.id, role=msg.role.value, content=msg.content,
            message_type=msg.message_type.value, metadata=msg.metadata_,
            created_at=msg.created_at,
        )
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/analyze")
async def start_analysis(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    try:
        from app.services.pipeline import IntegratedPipeline
        pipeline = IntegratedPipeline(db)
        result = await pipeline.run_full_pipeline(project_id, use_llm=True)
        return result
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(
            status_code=503,
            detail=f"Error en el análisis: {str(e)[:300]}",
        )


@router.get("/{project_id}/chat", response_model=list[ChatResponse])
async def get_chat_history(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at)
    )
    messages = result.scalars().all()
    return [
        ChatResponse(
            id=m.id, role=m.role.value, content=m.content,
            message_type=m.message_type.value, metadata=m.metadata_,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.get("/{project_id}/questions", response_model=list[QuestionResponse])
async def get_questions(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    result = await db.execute(
        select(AgentQuestion)
        .where(AgentQuestion.project_id == project_id)
        .order_by(AgentQuestion.created_at)
    )
    return result.scalars().all()


@router.post("/{project_id}/questions/{question_id}/answer")
async def answer_question(
    project_id: UUID,
    question_id: UUID,
    data: QuestionAnswer,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    agent = AgentOrchestrator(db)
    result = await agent.answer_question(project_id, question_id, data.answer)
    return result
