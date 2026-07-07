from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, safe_rollback
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import BpmnDiagram, ProcessModel, ModelType, DiagramType
from app.schemas import BpmnGenerateRequest, BpmnDiagramResponse
from app.services.bpmn_generator import BpmnGenerator
from app.services.local_analyzer import LocalAnalyzer
from app.services.llm_service import LLMError
from app.services.agent_orchestrator import AgentOrchestrator
from app.api.projects import _get_project

router = APIRouter()


@router.post("/{project_id}/bpmn/generate", response_model=BpmnDiagramResponse)
async def generate_bpmn(
    project_id: UUID,
    data: BpmnGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)

    if data.regenerate_initial:
        from app.services.pipeline import IntegratedPipeline
        pipeline = IntegratedPipeline(db)
        diagram = await pipeline.regenerate_initial_diagram(project_id, use_llm=True)
        if not diagram:
            raise HTTPException(status_code=400, detail="No hay documentos analizados para regenerar el diagrama.")
        return diagram

    if data.finalize_bizagi:
        from app.services.bpmn_refiner import BpmnRefiner
        model_result = await db.execute(
            select(ProcessModel).where(ProcessModel.project_id == project_id)
            .order_by(ProcessModel.created_at.desc()).limit(1)
        )
        if not model_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="No hay modelo de proceso. Ejecute el análisis primero.")
        try:
            refiner = BpmnRefiner(db)
            return await refiner.finalize_bizagi(project_id)
        except Exception as e:
            await safe_rollback(db)
            raise HTTPException(status_code=503, detail=f"Error generando diagrama Bizagi: {str(e)[:300]}")

    model_result = await db.execute(
        select(ProcessModel).where(ProcessModel.project_id == project_id)
        .order_by(ProcessModel.created_at.desc()).limit(1)
    )
    process_model = model_result.scalar_one_or_none()
    if not process_model:
        raise HTTPException(status_code=400, detail="No hay modelo de proceso. Ejecute el análisis primero.")

    generator = BpmnGenerator()
    try:
        llm_model = await generator.generate_from_llm(
            process_model.model_data, data.diagram_type
        )
    except (LLMError, Exception):
        llm_model = LocalAnalyzer.build_bpmn_model(
            process_model.model_data, data.diagram_type
        )

    validation_errors = generator.validate_model(llm_model)
    bpmn_xml = generator.model_to_bpmn_xml(llm_model)

    diagram = BpmnDiagram(
        project_id=project_id,
        process_model_id=process_model.id,
        diagram_type=DiagramType(data.diagram_type),
        name=llm_model.get("process", {}).get("name", f"Diagrama {data.diagram_type}"),
        bpmn_xml=bpmn_xml,
    )
    db.add(diagram)

    detailed_model = ProcessModel(
        project_id=project_id,
        model_type=ModelType(data.diagram_type) if data.diagram_type in [e.value for e in ModelType] else ModelType.MACRO,
        name=diagram.name,
        model_data=llm_model,
        parent_id=process_model.id,
    )
    db.add(detailed_model)
    await db.flush()

    agent = AgentOrchestrator(db)
    from app.models.project import MessageRole, MessageType
    await agent._add_message(
        project_id, MessageRole.ASSISTANT,
        f"Diagrama BPMN **{diagram.name}** generado exitosamente."
        + (f" Advertencias: {', '.join(validation_errors)}" if validation_errors else ""),
        MessageType.BPMN,
        {"diagram_id": str(diagram.id), "validation_errors": validation_errors},
    )

    return diagram


@router.get("/{project_id}/bpmn", response_model=list[BpmnDiagramResponse])
async def list_diagrams(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    result = await db.execute(
        select(BpmnDiagram).where(BpmnDiagram.project_id == project_id)
        .order_by(BpmnDiagram.created_at.desc())
    )
    return result.scalars().all()


@router.post("/{project_id}/bpmn/regenerate-initial", response_model=BpmnDiagramResponse)
async def regenerate_initial_diagram(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Regenera el primer diagrama BPMN desde el modelo consolidado existente."""
    await _get_project(db, project_id, current_user)
    try:
        from app.services.pipeline import IntegratedPipeline
        pipeline = IntegratedPipeline(db)
        diagram = await pipeline.regenerate_initial_diagram(project_id, use_llm=True)
        if not diagram:
            raise HTTPException(
                status_code=400,
                detail="No se pudo regenerar. Verifica que haya documentos analizados.",
            )
        return diagram
    except HTTPException:
        raise
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=503, detail=f"Error regenerando diagrama: {str(e)[:300]}")


@router.post("/{project_id}/bpmn/finalize-bizagi", response_model=BpmnDiagramResponse)
async def finalize_bizagi(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Genera el diagrama final en formato compatible con Bizagi Modeler."""
    await _get_project(db, project_id, current_user)

    model_result = await db.execute(
        select(ProcessModel).where(ProcessModel.project_id == project_id)
        .order_by(ProcessModel.created_at.desc()).limit(1)
    )
    if not model_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="No hay modelo de proceso. Ejecute el análisis primero.")

    from app.services.bpmn_refiner import BpmnRefiner
    try:
        refiner = BpmnRefiner(db)
        diagram = await refiner.finalize_bizagi(project_id)
        return diagram
    except Exception as e:
        await safe_rollback(db)
        raise HTTPException(status_code=503, detail=f"Error generando diagrama Bizagi: {str(e)[:300]}")


@router.get("/{project_id}/bpmn/{diagram_id}")
async def get_diagram(
    project_id: UUID,
    diagram_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    diagram = await db.get(BpmnDiagram, diagram_id)
    if not diagram or diagram.project_id != project_id:
        raise HTTPException(status_code=404, detail="Diagrama no encontrado")
    return BpmnDiagramResponse(
        id=diagram.id, diagram_type=diagram.diagram_type.value,
        name=diagram.name, bpmn_xml=diagram.bpmn_xml,
        version=diagram.version, created_at=diagram.created_at,
    )


@router.get("/{project_id}/bpmn/{diagram_id}/export")
async def export_diagram(
    project_id: UUID,
    diagram_id: UUID,
    format: str = "bpmn",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_project(db, project_id, current_user)
    diagram = await db.get(BpmnDiagram, diagram_id)
    if not diagram or diagram.project_id != project_id:
        raise HTTPException(status_code=404, detail="Diagrama no encontrado")

    if format == "bpmn":
        return Response(
            content=diagram.bpmn_xml,
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{diagram.name}.bpmn"'},
        )
    if format == "bizagi":
        if diagram.name.endswith("Bizagi") and diagram.bpmn_xml:
            bizagi_xml = diagram.bpmn_xml
        else:
            from app.services.bpmn_refiner import BpmnRefiner
            refiner = BpmnRefiner(db)
            model = await refiner.get_current_bpmn_model(project_id)
            generator = BpmnGenerator()
            bizagi_xml = generator.model_to_bizagi_xml(model)
        safe_name = diagram.name.replace(" ", "_")
        return Response(
            content=bizagi_xml,
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.bpmn"'},
        )
    raise HTTPException(status_code=400, detail=f"Formato '{format}' no soportado. Use 'bpmn' o 'bizagi'.")
