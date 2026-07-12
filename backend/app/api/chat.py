from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, safe_rollback
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import ChatMessage
from app.schemas import ChatResponse
from app.services.conversational_chat import ConversationalChatService
from app.services.document_processor import DocumentProcessor
from app.services.llm_service import LLMError
from app.api.projects import _get_project

import aiofiles
import os

router = APIRouter()


def _to_response(msg: ChatMessage) -> ChatResponse:
    return ChatResponse(
        id=msg.id,
        role=msg.role.value,
        content=msg.content,
        message_type=msg.message_type.value,
        metadata=msg.metadata_,
        created_at=msg.created_at,
    )


@router.post("/{project_id}/chat/start-interview", response_model=ChatResponse)
async def start_interview(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    try:
        chat = ConversationalChatService(db)
        msg = await chat.start_interview(project_id)
        await db.commit()
        return _to_response(msg)
    except LLMError as e:
        await safe_rollback(db)
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}/chat/interview-status")
async def interview_status(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    chat = ConversationalChatService(db)
    return chat.get_status(project)


@router.post("/{project_id}/chat", response_model=list[ChatResponse])
async def send_message(
    project_id: UUID,
    message: str = Form(""),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    try:
        user_text = message.strip()
        attachment_note = ""

        if file and file.filename:
            upload_dir = os.path.join(settings.UPLOAD_DIR, str(project_id))
            os.makedirs(upload_dir, exist_ok=True)
            safe_name = file.filename.replace("..", "").replace("/", "").replace("\\", "")
            file_path = os.path.join(upload_dir, safe_name)
            content = await file.read()
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(content)

            processor = DocumentProcessor()
            ext = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else "txt"
            try:
                extracted = processor.extract_text(file_path, ext)
                attachment_note = f"{safe_name}:\n{extracted[:8000]}"
                if not user_text:
                    user_text = f"Adjunto el archivo {safe_name} con información del proceso."
            except Exception as e:
                attachment_note = f"{safe_name} (no se pudo extraer texto: {str(e)[:100]})"

        if not user_text and not attachment_note:
            raise HTTPException(status_code=400, detail="Envía un mensaje o adjunta un archivo.")

        chat = ConversationalChatService(db)
        msg = await chat.send_message(project_id, user_text, attachment_note)
        await db.commit()
        return [_to_response(msg)]
    except HTTPException:
        raise
    except LLMError as e:
        await safe_rollback(db)
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=500, detail=str(e))


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
    return [_to_response(m) for m in result.scalars().all()]


@router.delete("/{project_id}/chat")
async def clear_chat_history(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    result = await db.execute(
        select(ChatMessage).where(ChatMessage.project_id == project_id)
    )
    for msg in result.scalars().all():
        await db.delete(msg)
    await db.commit()
    return {"deleted": True}
