import json
import re
from pathlib import Path
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import (
    BpmnDiagram, ChatMessage, DiagramType, MessageRole, MessageType,
    ModelType, ProcessModel, Project, AgentState, ProjectStatus,
)
from app.core.database import commit_checkpoint
from app.services.bpmn_generator import BpmnGenerator
from app.services.local_analyzer import LocalAnalyzer
from app.services.llm_service import LLMError, LLMService

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class BpmnRefiner:
    """Refina el modelo BPMN mediante chat y genera exportación Bizagi."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMService()
        self.bpmn = BpmnGenerator()
        self.local = LocalAnalyzer()

    def _load_prompt(self, name: str) -> str:
        return (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")

    async def get_consolidated_model(self, project_id: UUID) -> Optional[ProcessModel]:
        result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.model_type == ModelType.MACRO,
                ProcessModel.parent_id.is_(None),
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    async def get_bpmn_process_model(self, project_id: UUID) -> Optional[ProcessModel]:
        result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.parent_id.isnot(None),
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        model = result.scalar_one_or_none()
        if model and model.model_data.get("process", {}).get("elements"):
            return model
        return None

    async def get_draft_diagram(self, project_id: UUID) -> Optional[BpmnDiagram]:
        result = await self.db.execute(
            select(BpmnDiagram).where(
                BpmnDiagram.project_id == project_id,
                ~BpmnDiagram.name.like("%Bizagi%"),
            ).order_by(BpmnDiagram.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    async def get_current_bpmn_model(self, project_id: UUID) -> dict:
        bpmn_model = await self.get_bpmn_process_model(project_id)
        if bpmn_model:
            return bpmn_model.model_data

        consolidated = await self.get_consolidated_model(project_id)
        if consolidated:
            return self.local.build_bpmn_model(consolidated.model_data, "detailed")

        return self.local.build_bpmn_model({"process_name": "Proceso", "consolidated_activities": []}, "detailed")

    async def _get_chat_context(self, project_id: UUID, limit: int = 8) -> str:
        result = await self.db.execute(
            select(ChatMessage).where(ChatMessage.project_id == project_id)
            .order_by(ChatMessage.created_at.desc()).limit(limit)
        )
        msgs = list(reversed(result.scalars().all()))
        lines = []
        for m in msgs:
            role = "Usuario" if m.role == MessageRole.USER else "Asistente"
            lines.append(f"{role}: {m.content[:500]}")
        return "\n".join(lines) if lines else "Sin historial previo."

    async def _get_previous_answers(self, project_id: UUID) -> list[dict]:
        from app.models.project import AgentQuestion, QuestionStatus
        result = await self.db.execute(
            select(AgentQuestion).where(
                AgentQuestion.project_id == project_id,
                AgentQuestion.status == QuestionStatus.ANSWERED,
            )
        )
        return [{"question": q.question, "answer": q.answer} for q in result.scalars().all()]

    async def _get_document_context(self, project_id: UUID) -> str:
        from app.services.agent_orchestrator import AgentOrchestrator
        agent = AgentOrchestrator(self.db)
        return await agent._get_documents_context(project_id)

    def _apply_local_refinement(self, current_model: dict, user_message: str, consolidated: dict) -> dict:
        """Fallback local: aplica cambios simples al modelo BPMN."""
        model = json.loads(json.dumps(current_model))
        process = model.setdefault("process", model)
        elements = process.get("elements", [])
        flows = process.get("flows", [])
        msg = user_message.lower()

        added = False
        if re.search(r"\b(agregar|añadir|incluir|agrega)\b", msg):
            match = re.search(r"(?:agregar|añadir|incluir|agrega)\s+(?:la\s+)?(?:actividad\s+)?[:\-]?\s*[\"']?([^\"'\n.]+)", msg, re.I)
            name = (match.group(1).strip() if match else "Nueva actividad")[:80]
            task_id = f"task_{len(elements)}"
            default_lane = elements[0].get("lane", "lane_0") if elements else "lane_0"
            elements.append({
                "id": task_id, "type": "userTask", "name": name,
                "lane": default_lane, "is_manual": True,
            })
            prev = next((e["id"] for e in reversed(elements[:-1]) if e["type"] != "endEvent"), "start_1")
            flows.append({"id": f"flow_{len(flows)}", "source": prev, "target": task_id})
            added = True

        if re.search(r"\b(eliminar|quitar|borrar)\b", msg):
            tasks = [e for e in elements if e["type"] in ("userTask", "serviceTask", "manualTask")]
            if tasks:
                removed = tasks[-1]["id"]
                elements[:] = [e for e in elements if e["id"] != removed]
                flows[:] = [f for f in flows if f["source"] != removed and f["target"] != removed]
                added = True

        if not added and consolidated:
            merged = self.local.merge_answer_to_consolidated(consolidated, user_message)
            model = self.local.build_bpmn_model(merged, "detailed")

        process["elements"] = elements
        process["flows"] = flows
        return model

    async def refine_from_message(
        self, project_id: UUID, user_message: str, add_user_message: bool = True,
    ) -> dict:
        from app.services.agent_orchestrator import AgentOrchestrator
        agent = AgentOrchestrator(self.db)

        if add_user_message:
            await agent._add_message(project_id, MessageRole.USER, user_message)

        project = await self.db.get(Project, project_id)
        await agent._update_state(project, AgentState.MODELING, ProjectStatus.MODELING)

        current_model = await self.get_current_bpmn_model(project_id)
        consolidated_pm = await self.get_consolidated_model(project_id)
        consolidated = consolidated_pm.model_data if consolidated_pm else {}

        system_prompt = self._load_prompt("system")
        refinement_prompt = self._load_prompt("chat_bpmn_refinement")
        user_prompt = refinement_prompt.format(
            current_bpmn_model=json.dumps(current_model, ensure_ascii=False, indent=2),
            consolidated_model=json.dumps(consolidated, ensure_ascii=False, indent=2),
            chat_history=await self._get_chat_context(project_id),
            previous_answers=json.dumps(await self._get_previous_answers(project_id), ensure_ascii=False),
            document_context=(await self._get_document_context(project_id))[:4000],
            user_message=user_message,
        )

        model_updated = False
        reply = ""
        changes_summary: list[str] = []
        new_model = current_model

        await commit_checkpoint(self.db)
        try:
            response = await self.llm.generate(system_prompt, user_prompt, json_mode=True, temperature=0.2)
            result = json.loads(response)
            reply = result.get("reply", "He revisado tu mensaje.")
            model_updated = result.get("model_updated", False)
            changes_summary = result.get("changes_summary", [])
            if model_updated and result.get("bpmn_model"):
                new_model = result["bpmn_model"]
        except (LLMError, json.JSONDecodeError, Exception) as e:
            new_model = self._apply_local_refinement(current_model, user_message, consolidated)
            model_updated = new_model != current_model
            hint = e.message if isinstance(e, LLMError) else "modo local"
            reply = (
                f"He actualizado el diagrama en **modo local** ({hint}). "
                "Revisa el diagrama BPMN y continúa refinando por chat."
                if model_updated else
                f"**Aviso:** No pude usar la IA ({hint}). "
                "Describe cambios concretos: 'agregar actividad X', 'quitar paso Y', 'el responsable de Z es...'."
            )
            changes_summary = ["Refinamiento local aplicado"] if model_updated else []

        diagram_id = None
        if model_updated:
            diagram = await self._save_refined_model(project_id, new_model, consolidated_pm)
            diagram_id = str(diagram.id)
            validation = self.bpmn.validate_model(new_model)
            changes_text = "\n".join(f"- {c}" for c in changes_summary) if changes_summary else ""
            reply += f"\n\n**Diagrama actualizado.**" + (f"\n{changes_text}" if changes_text else "")
            if validation:
                reply += f"\n\nAdvertencias: {', '.join(validation)}"

        msg = await agent._add_message(
            project_id, MessageRole.ASSISTANT, reply,
            MessageType.BPMN if model_updated else MessageType.TEXT,
            {"diagram_id": diagram_id, "model_updated": model_updated, "changes": changes_summary},
        )

        return {
            "message": msg,
            "model_updated": model_updated,
            "diagram_id": diagram_id,
            "changes": changes_summary,
        }

    async def _save_refined_model(
        self, project_id: UUID, bpmn_model: dict, consolidated_pm: Optional[ProcessModel],
    ) -> BpmnDiagram:
        process_name = bpmn_model.get("process", {}).get("name", "Proceso")
        bpmn_xml = self.bpmn.model_to_bpmn_xml(bpmn_model)

        pm = ProcessModel(
            project_id=project_id,
            model_type=ModelType.DETAILED,
            name=f"{process_name} (refinado)",
            model_data=bpmn_model,
            parent_id=consolidated_pm.id if consolidated_pm else None,
        )
        self.db.add(pm)
        await commit_checkpoint(self.db)

        draft = await self.get_draft_diagram(project_id)
        diagram_name = f"{process_name} (refinado)"
        if draft:
            draft.bpmn_xml = bpmn_xml
            draft.name = diagram_name if "(inicial)" not in draft.name else f"{process_name} (inicial → refinado)"
            draft.process_model_id = pm.id
            diagram = draft
        else:
            diagram = BpmnDiagram(
                project_id=project_id,
                process_model_id=pm.id,
                diagram_type=DiagramType.DETAILED,
                name=f"{process_name} (borrador)",
                bpmn_xml=bpmn_xml,
            )
            self.db.add(diagram)

        await commit_checkpoint(self.db)
        return diagram

    async def finalize_bizagi(self, project_id: UUID, use_llm: bool = True) -> BpmnDiagram:
        from app.services.agent_orchestrator import AgentOrchestrator
        agent = AgentOrchestrator(self.db)

        current_model = await self.get_current_bpmn_model(project_id)
        consolidated_pm = await self.get_consolidated_model(project_id)
        consolidated = consolidated_pm.model_data if consolidated_pm else {}
        llm_used = False

        if use_llm and consolidated:
            await commit_checkpoint(self.db)
            try:
                payload = {**consolidated, "refined_bpmn": current_model}
                enhanced = await self.bpmn.generate_from_llm(payload, "detailed")
                if enhanced.get("process", {}).get("elements"):
                    current_model = enhanced
                    llm_used = True
            except (LLMError, Exception):
                pass

        validation = self.bpmn.validate_model(current_model)
        bizagi_xml = self.bpmn.model_to_bizagi_xml(current_model)

        process_name = current_model.get("process", {}).get("name", "Proceso")

        pm = ProcessModel(
            project_id=project_id,
            model_type=ModelType.DETAILED,
            name=f"{process_name} - Final Bizagi",
            model_data=current_model,
            parent_id=consolidated_pm.id if consolidated_pm else None,
            confidence_score=1.0,
        )
        self.db.add(pm)
        await commit_checkpoint(self.db)

        diagram = BpmnDiagram(
            project_id=project_id,
            process_model_id=pm.id,
            diagram_type=DiagramType.DETAILED,
            name=f"{process_name} - Bizagi",
            bpmn_xml=bizagi_xml,
            version=1,
        )
        self.db.add(diagram)
        await commit_checkpoint(self.db)

        project = await self.db.get(Project, project_id)
        if project:
            await agent._update_state(project, AgentState.COMPLETED, ProjectStatus.COMPLETED)

        source = "IA (Gemini)" if llm_used else "modelo refinado"
        warn = f" Advertencias: {', '.join(validation)}" if validation else ""
        await agent._add_message(
            project_id, MessageRole.ASSISTANT,
            f"**Diagrama final Bizagi generado** ({source}): {diagram.name}.\n"
            f"Puedes descargarlo desde la pestaña BPMN → Exportar Bizagi.{warn}",
            MessageType.BPMN,
            {"diagram_id": str(diagram.id), "format": "bizagi", "validation_errors": validation, "llm_used": llm_used},
        )

        return diagram
