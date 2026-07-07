import re
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import (
    AgentQuestion, AgentState, BpmnDiagram, ChatMessage, DiagramType,
    Document, MessageRole, MessageType, ProcessModel, Project,
    ProjectStatus, QuestionCategory, QuestionPriority, QuestionStatus,
    ModelType,
)
from app.services.local_analyzer import LocalAnalyzer
from app.services.llm_service import LLMError
from app.services.bpmn_generator import BpmnGenerator
from app.services.org_chart_service import OrgChartService
from app.models.user import Organization
from app.core.database import commit_checkpoint, flush_with_retry, safe_rollback

# Import base orchestrator methods
from app.services.agent_orchestrator import AgentOrchestrator as BaseOrchestrator


class IntegratedPipeline:
    """Pipeline integrado: documentos → extracción → consolidación → chat → BPMN → análisis."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.agent = BaseOrchestrator(db)
        self.local = LocalAnalyzer()
        self.bpmn = BpmnGenerator()

    async def _checkpoint(self) -> None:
        await commit_checkpoint(self.db)

    async def on_document_uploaded(self, project_id: UUID, document: Document) -> dict:
        """Se ejecuta automáticamente al subir un documento."""
        project = await self.db.get(Project, project_id)
        await self.agent._update_state(project, AgentState.INGESTING, ProjectStatus.ANALYZING)

        await self.agent._add_message(
            project_id, MessageRole.ASSISTANT,
            f"Documento **{document.filename}** cargado y procesado ({document.file_type.value.upper()}, "
            f"{document.file_size // 1024} KB). Iniciando análisis automático...",
            MessageType.TEXT,
        )

        return await self.run_full_pipeline(project_id, use_llm=True)

    async def run_full_pipeline(self, project_id: UUID, use_llm: bool = True) -> dict:
        """Pipeline completo integrado con fallback local."""
        project = await self.db.get(Project, project_id)
        result = {"mode": "llm", "steps": {}}

        try:
            await self._checkpoint()

            # 1. Extracción
            try:
                if use_llm:
                    extraction = await self._extract_with_fallback(project_id)
                    result["mode"] = extraction.get("mode", "llm")
                else:
                    extraction = await self._extract_local(project_id)
                    result["mode"] = "local"
            except Exception as e:
                await safe_rollback(self.db)
                extraction = await self._extract_local(project_id)
                result["mode"] = "local"
                result["llm_warning"] = str(e)[:200]

            result["steps"]["extraction"] = extraction
            await self._checkpoint()
            project = await self.db.get(Project, project_id)

            if not extraction.get("extractions"):
                await self.agent._add_message(
                    project_id, MessageRole.ASSISTANT,
                    "No se encontró texto en los documentos. Verifica que el archivo no esté vacío o protegido.",
                    MessageType.TEXT,
                )
                if project:
                    await self.agent._update_state(project, AgentState.IDLE, ProjectStatus.DRAFT)
                return result

            # 2. Consolidación
            consolidated = await self._consolidate_with_fallback(
                project_id, extraction["extractions"], use_llm=use_llm and result["mode"] == "llm"
            )
            for ext in extraction.get("extractions", []):
                if ext.get("source_document") and not consolidated.get("source_filename"):
                    consolidated["source_filename"] = ext["source_document"]
            consolidated = await self._attach_org_chart(project_id, consolidated, extraction.get("extractions", []))
            result["steps"]["consolidated"] = consolidated
            await self._checkpoint()

            # 3. Preguntas
            questions = await self._questions_with_fallback(
                project_id, consolidated, use_llm=use_llm and result["mode"] == "llm"
            )
            result["steps"]["questions"] = len(questions)
            await self._checkpoint()

            activities = consolidated.get("consolidated_activities", [])

            # 4. Primer diagrama inicial
            diagram = None
            try:
                diagram = await self._generate_initial_diagram(
                    project_id, consolidated, use_llm=use_llm and result["mode"] == "llm",
                )
            except Exception as e:
                result["steps"]["diagram_error"] = str(e)[:300]
                await self.agent._add_message(
                    project_id, MessageRole.ASSISTANT,
                    f"**Error al generar el diagrama BPMN:** {str(e)[:200]}\n\n"
                    "Presiona **Analizar** de nuevo o usa **Regenerar diagrama** en la pestaña BPMN.",
                    MessageType.TEXT,
                    {"error": str(e)[:300]},
                )
            result["steps"]["bpmn_id"] = str(diagram.id) if diagram else None
            result["steps"]["initial_diagram"] = True
            await self._checkpoint()

            mode_label = "IA (Gemini)" if result["mode"] == "llm" else "análisis local"
            await self.agent._add_message(
                project_id, MessageRole.ASSISTANT,
                f"Análisis completado con **{mode_label}**.\n"
                f"- Actividades detectadas: {len(activities)}\n"
                f"- Áreas: {len(consolidated.get('macro_flow', {}).get('areas_involved', []))}\n"
                f"- Preguntas generadas: {len(questions)}\n"
                f"- **Primer diagrama BPMN:** generado desde el documento\n\n"
                f"Revisa el diagrama en la pestaña **BPMN**. Luego usa el **chat** para refinarlo "
                f"y al final genera el **diagrama Bizagi**.",
                MessageType.EXTRACTION,
                {"activities_count": len(activities), "mode": result["mode"], "diagram_id": result["steps"].get("bpmn_id")},
            )

            project = await self.db.get(Project, project_id)
            if project:
                await self.agent._update_state(
                    project,
                    AgentState.QUESTIONING if questions else AgentState.MODELING,
                    ProjectStatus.QUESTIONING if questions else ProjectStatus.MODELING,
                )
            await self._checkpoint()
            return result

        except Exception:
            await safe_rollback(self.db)
            raise

    async def _extract_with_fallback(self, project_id: UUID) -> dict:
        try:
            data = await self.agent.run_extraction(project_id)
            data["mode"] = "llm"
            return data
        except (LLMError, Exception):
            return await self._extract_local(project_id)

    async def _extract_local(self, project_id: UUID) -> dict:
        project = await self.db.get(Project, project_id)
        await self.agent._update_state(project, AgentState.EXTRACTING, ProjectStatus.ANALYZING)

        result = await self.db.execute(
            select(Document).where(
                Document.project_id == project_id,
                Document.extracted_text.isnot(None),
            )
        )
        documents = result.scalars().all()
        all_extractions = []

        for doc in documents:
            extraction = self.local.extract_from_text(
                doc.extracted_text or "",
                doc.filename,
                doc.source_type.value,
                doc.area,
            )
            all_extractions.append(extraction)

        return {"extractions": all_extractions, "documents_analyzed": len(documents), "mode": "local"}

    async def _attach_org_chart(self, project_id: UUID, consolidated: dict, extractions: list) -> dict:
        project = await self.db.get(Project, project_id)
        org_name = "Empresa"
        if project:
            org = await self.db.get(Organization, project.organization_id)
            if org:
                org_name = org.name
        chart = OrgChartService.build_from_consolidated(consolidated, org_name, extractions)
        consolidated["org_chart"] = chart

        model_result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.parent_id.is_(None),
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        pm = model_result.scalar_one_or_none()
        if pm:
            pm.model_data = consolidated
            await commit_checkpoint(self.db)
        return consolidated

    async def _consolidate_with_fallback(self, project_id: UUID, extractions: list, use_llm: bool) -> dict:
        project = await self.db.get(Project, project_id)
        await self.agent._update_state(project, AgentState.CONSOLIDATING)

        if use_llm:
            try:
                return await self.agent.run_consolidation(project_id, extractions)
            except (LLMError, Exception):
                pass

        consolidated = self.local.consolidate(extractions)
        model = ProcessModel(
            project_id=project_id,
            model_type=ModelType.MACRO,
            name=consolidated.get("process_name", "Proceso Consolidado"),
            model_data=consolidated,
            confidence_score=consolidated.get("completeness_score", 0.0),
        )
        self.db.add(model)
        await commit_checkpoint(self.db)
        return consolidated

    async def _questions_with_fallback(self, project_id: UUID, consolidated: dict, use_llm: bool) -> list:
        project = await self.db.get(Project, project_id)
        await self.agent._update_state(project, AgentState.QUESTIONING, ProjectStatus.QUESTIONING)

        if use_llm:
            try:
                return await self.agent.generate_questions(project_id)
            except (LLMError, Exception):
                pass

        questions_data = self.local.generate_questions(consolidated)
        saved = []
        for q in questions_data:
            try:
                cat = QuestionCategory(q.get("category", "missing_info"))
            except ValueError:
                cat = QuestionCategory.MISSING_INFO
            try:
                pri = QuestionPriority(q.get("priority", "medium"))
            except ValueError:
                pri = QuestionPriority.MEDIUM
            question = AgentQuestion(
                project_id=project_id,
                category=cat,
                priority=pri,
                question=q["question"],
                context=q.get("context"),
            )
            self.db.add(question)
            saved.append(q)

        await commit_checkpoint(self.db)

        if saved:
            first = saved[0]
            await self.agent._add_message(
                project_id, MessageRole.ASSISTANT,
                f"**Pregunta para mejorar el diagrama ({first.get('priority', 'medium')}):** {first['question']}\n\n"
                f"Responde aquí en el chat; el diagrama BPMN se actualizará automáticamente.",
                MessageType.QUESTION,
                {"question_index": 0, "total": len(saved)},
            )

        return saved

    async def _generate_initial_diagram(
        self, project_id: UUID, consolidated: dict, use_llm: bool = False,
    ) -> Optional[BpmnDiagram]:
        """Genera o actualiza el primer diagrama BPMN a partir de los datos analizados del documento."""
        project = await self.db.get(Project, project_id)
        if project:
            await self.agent._update_state(project, AgentState.MODELING, ProjectStatus.MODELING)

        diagram_type = "detailed"
        model_data = None
        llm_used = False
        if use_llm:
            await commit_checkpoint(self.db)
            try:
                model_data = await self.bpmn.generate_from_llm(consolidated, diagram_type)
                if model_data and model_data.get("process", {}).get("elements"):
                    llm_used = True
            except (LLMError, Exception):
                model_data = None

        if not model_data or not model_data.get("process", {}).get("elements"):
            model_data = self.local.build_bpmn_model(consolidated, diagram_type)

        bpmn_xml = self.bpmn.model_to_bpmn_xml(model_data)
        process_name = consolidated.get("process_name", "Proceso")
        diagram_name = f"{process_name} (detallado)"

        model_result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.parent_id.is_(None),
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        consolidated_pm = model_result.scalar_one_or_none()

        bpmn_pm_result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.parent_id.isnot(None),
                ProcessModel.model_type == ModelType.DETAILED,
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        bpmn_pm = bpmn_pm_result.scalar_one_or_none()

        if bpmn_pm:
            bpmn_pm.model_data = model_data
            bpmn_pm.name = diagram_name
            process_model_id = bpmn_pm.id
        elif consolidated_pm:
            bpmn_pm = ProcessModel(
                project_id=project_id,
                model_type=ModelType.DETAILED,
                name=diagram_name,
                model_data=model_data,
                parent_id=consolidated_pm.id,
            )
            self.db.add(bpmn_pm)
            await commit_checkpoint(self.db)
            process_model_id = bpmn_pm.id
        else:
            process_model_id = None

        existing_result = await self.db.execute(
            select(BpmnDiagram).where(
                BpmnDiagram.project_id == project_id,
                BpmnDiagram.diagram_type == DiagramType.DETAILED,
            ).order_by(BpmnDiagram.created_at.desc()).limit(1)
        )
        existing = existing_result.scalar_one_or_none()
        if not existing:
            existing_result = await self.db.execute(
                select(BpmnDiagram).where(
                    BpmnDiagram.project_id == project_id,
                    BpmnDiagram.name.like("%(inicial)%"),
                ).limit(1)
            )
            existing = existing_result.scalar_one_or_none()

        elements = model_data.get("process", {}).get("elements", [])
        activity_count = len([
            e for e in elements
            if e.get("type") not in ("startEvent", "endEvent")
        ])
        if not activity_count:
            activity_count = len(consolidated.get("consolidated_activities", []))

        if existing:
            existing.bpmn_xml = bpmn_xml
            existing.name = diagram_name
            existing.process_model_id = process_model_id
            existing.diagram_type = DiagramType.DETAILED
            diagram = existing
        else:
            diagram = BpmnDiagram(
                project_id=project_id,
                process_model_id=process_model_id,
                diagram_type=DiagramType.DETAILED,
                name=diagram_name,
                bpmn_xml=bpmn_xml,
            )
            self.db.add(diagram)

        await commit_checkpoint(self.db)

        source_label = "IA (Gemini)" if llm_used else "análisis local"
        source_doc = consolidated.get("source_filename", "entrevista")
        await self.agent._add_message(
            project_id, MessageRole.ASSISTANT,
            f"**Diagrama detallado generado** ({source_label}) a partir del análisis de **{source_doc}**.\n"
            f"- Nombre: {diagram_name}\n"
            f"- Actividades en el diagrama: {activity_count}\n\n"
            f"Abre la pestaña **BPMN** para ver el flujo paso a paso. "
            f"Luego refínalo por **chat**.",
            MessageType.BPMN,
            {"diagram_id": str(diagram.id), "is_initial": True, "activity_count": activity_count, "llm_used": llm_used},
        )

        return diagram

    async def ensure_initial_diagram(self, project_id: UUID, use_llm: bool = False) -> Optional[BpmnDiagram]:
        """Genera el diagrama inicial si hay modelo consolidado pero no hay diagrama BPMN."""
        existing = await self.db.execute(
            select(BpmnDiagram).where(BpmnDiagram.project_id == project_id).limit(1)
        )
        if existing.scalar_one_or_none():
            return None

        model_result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.parent_id.is_(None),
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        consolidated_pm = model_result.scalar_one_or_none()
        if not consolidated_pm:
            extractions = await self._extract_local(project_id)
            if not extractions.get("extractions"):
                return None
            consolidated = await self._consolidate_with_fallback(
                project_id, extractions["extractions"], use_llm=False,
            )
        else:
            consolidated = consolidated_pm.model_data

        return await self._generate_initial_diagram(project_id, consolidated, use_llm=use_llm)

    async def regenerate_initial_diagram(self, project_id: UUID, use_llm: bool = False) -> Optional[BpmnDiagram]:
        """Regenera el diagrama inicial aunque ya exista uno."""
        model_result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.parent_id.is_(None),
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        consolidated_pm = model_result.scalar_one_or_none()
        if not consolidated_pm:
            extractions = await self._extract_local(project_id)
            if not extractions.get("extractions"):
                return None
            consolidated = await self._consolidate_with_fallback(
                project_id, extractions["extractions"], use_llm=False,
            )
        else:
            consolidated = consolidated_pm.model_data

        return await self._generate_initial_diagram(project_id, consolidated, use_llm=use_llm)
