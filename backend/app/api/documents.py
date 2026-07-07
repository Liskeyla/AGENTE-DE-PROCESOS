import os
import shutil
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.core.database import get_db, safe_rollback, commit_checkpoint
from app.models.user import User
from app.models.project import (
    Document, DocumentChunk, Project, FileType, SourceType, ProcessingStatus,
)
from app.schemas import DocumentResponse
from app.services.document_processor import DocumentProcessor
from app.services.rag_service import RAGService
from app.api.projects import _get_project

router = APIRouter()
processor = DocumentProcessor()


@router.post("/{project_id}/documents", response_model=DocumentResponse)
async def upload_document(
    project_id: UUID,
    file: UploadFile = File(...),
    source_type: str = Form("other"),
    area: str = Form(None),
    participants: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)

    file_type_str = processor.detect_file_type(file.filename)
    if not file_type_str:
        raise HTTPException(status_code=400, detail="Tipo de archivo no soportado")

    content = await file.read()
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=f"Archivo excede {settings.MAX_FILE_SIZE_MB}MB")

    upload_dir = processor.ensure_upload_dir(str(project_id))
    file_path = os.path.join(upload_dir, file.filename)
    with open(file_path, "wb") as f:
        f.write(content)

    participants_list = [p.strip() for p in participants.split(",") if p.strip()] if participants else []

    doc = Document(
        project_id=project_id,
        filename=file.filename,
        file_type=FileType(file_type_str),
        file_path=file_path,
        file_size=len(content),
        source_type=SourceType(source_type) if source_type in [e.value for e in SourceType] else SourceType.OTHER,
        area=area,
        participants=participants_list,
        processing_status=ProcessingStatus.PROCESSING,
    )
    db.add(doc)
    await db.flush()

    try:
        raw_text = processor.extract_text(file_path, file_type_str)
        cleaned = processor.clean_text(raw_text)
        doc.extracted_text = cleaned
        doc.processing_status = ProcessingStatus.COMPLETED

        chunks = processor.chunk_text(cleaned)
        rag = RAGService()
        embedding_ids = await rag.index_chunks(project_id, doc.id, chunks)

        for chunk_data in chunks:
            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=chunk_data["index"],
                content=chunk_data["content"],
                embedding_id=embedding_ids[chunk_data["index"]] if chunk_data["index"] < len(embedding_ids) else None,
            )
            db.add(chunk)

    except Exception as e:
        doc.processing_status = ProcessingStatus.FAILED
        doc.metadata_ = {"error": str(e)}

    await db.flush()
    doc_id = doc.id

    # Persistir documento antes del análisis largo (evita database locked en SQLite)
    await commit_checkpoint(db)

    # Análisis automático al cargar documento
    if doc.processing_status == ProcessingStatus.COMPLETED and doc.extracted_text:
        try:
            from app.services.pipeline import IntegratedPipeline
            doc = await db.get(Document, doc_id)
            pipeline = IntegratedPipeline(db)
            await pipeline.on_document_uploaded(project_id, doc)
        except Exception as e:
            await safe_rollback(db)
            try:
                doc = await db.get(Document, doc_id)
                if doc:
                    doc.metadata_ = {**(doc.metadata_ or {}), "analysis_warning": str(e)[:300]}
                    await db.flush()
            except Exception:
                pass

    doc = await db.get(Document, doc_id)
    return doc


@router.get("/{project_id}/documents", response_model=list[DocumentResponse])
async def list_documents(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    result = await db.execute(
        select(Document).where(Document.project_id == project_id).order_by(Document.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/{project_id}/documents/{document_id}")
async def delete_document(
    project_id: UUID,
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    doc = await db.get(Document, document_id)
    if not doc or doc.project_id != project_id:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    await db.delete(doc)
    return {"message": "Documento eliminado"}
