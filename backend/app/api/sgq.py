from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.projects import _get_project
from app.core.database import get_db, safe_rollback
from app.core.security import get_current_user
from app.models.user import User
from app.schemas import (
    SgqCompleteDraftsResponse,
    SgqComponentGenerateResponse,
    SgqDiagnosisResponse,
    SgqDocumentResponse,
    SgqStatusResponse,
)
from app.services.sgq_docx_export import build_consolidated_sgq_docx
from app.services.sgq_engine import SgqEngine, SgqEngineError

router = APIRouter()


@router.get("/{project_id}/sgq/status", response_model=SgqStatusResponse)
async def sgq_status(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    engine = SgqEngine(db)
    return await engine.get_status(project)


@router.get("/{project_id}/sgq/diagnosis", response_model=SgqDiagnosisResponse)
async def get_diagnosis(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    engine = SgqEngine(db)
    diagnosis = await engine.get_diagnosis(project)
    if not diagnosis:
        raise HTTPException(
            status_code=404,
            detail="No se ha ejecutado el diagnóstico SGQ. Ejecute POST /sgq/diagnose primero.",
        )
    return diagnosis


@router.post("/{project_id}/sgq/diagnose", response_model=SgqDiagnosisResponse)
async def run_diagnosis(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    try:
        engine = SgqEngine(db)
        diagnosis = await engine.run_diagnosis(project)
        await db.commit()
        return diagnosis
    except SgqEngineError as e:
        await safe_rollback(db)
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/{project_id}/sgq/generate/{component_type}",
    response_model=SgqComponentGenerateResponse,
)
async def generate_component(
    project_id: UUID,
    component_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    try:
        engine = SgqEngine(db)
        doc = await engine.generate_component(project, component_type)
        await db.commit()
        return doc
    except SgqEngineError as e:
        await safe_rollback(db)
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/{project_id}/sgq/complete-drafts",
    response_model=SgqCompleteDraftsResponse,
)
async def complete_drafts(
    project_id: UUID,
    force: bool = False,
    max_documents: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Completa borradores SGQ con la información de la entrevista.
    Orden: mapa de procesos y diagramas de flujo (estilo Bizagi) primero; luego el resto.
    Por defecto solo rellena los incompletos (Sin iniciar / bajo %). force=true regenera todos.
    """
    project = await _get_project(db, project_id, current_user)
    try:
        engine = SgqEngine(db)
        result = await engine.complete_drafts(
            project, force=force, max_documents=max_documents,
        )
        await db.commit()
        return result
    except SgqEngineError as e:
        await safe_rollback(db)
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}/sgq/knowledge-state")
async def get_knowledge_state(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    engine = SgqEngine(db)
    return await engine.get_knowledge_state(project)


@router.get("/{project_id}/sgq/documents", response_model=dict)
async def list_documents(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    engine = SgqEngine(db)
    return await engine.list_documents(project)


@router.get("/{project_id}/sgq/documents/export-docx")
async def export_documents_docx(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Descarga un único Word (.docx) con todos los documentos SGC ordenados."""
    project = await _get_project(db, project_id, current_user)
    engine = SgqEngine(db)
    documents = await engine.list_documents(project)

    org_name = "Organización"
    try:
        knowledge = await engine.get_knowledge_state(project)
        profile = (knowledge.get("knowledge_state") or {}).get("org_profile") or {}
        if isinstance(profile, dict) and profile.get("org_name"):
            org_name = str(profile["org_name"]).strip() or org_name
    except Exception:
        pass

    try:
        payload, filename, _count = build_consolidated_sgq_docx(
            project_name=project.name or "Proyecto",
            organization_name=org_name,
            documents=documents or {},
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo generar el Word consolidado: {e}",
        )

    return Response(
        content=payload,
        media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get(
    "/{project_id}/sgq/documents/{component_type}",
    response_model=SgqDocumentResponse,
)
async def get_document(
    project_id: UUID,
    component_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project(db, project_id, current_user)
    engine = SgqEngine(db)
    doc = await engine.get_document(project, component_type)
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no generado aún.")
    return doc
