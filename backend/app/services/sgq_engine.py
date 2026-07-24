"""Motor Inteligente de Generación del Sistema de Gestión de Calidad."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import flush_with_retry
from app.models.project import (
    ChatMessage,
    MessageRole,
    ModelType,
    ProcessModel,
    Project,
)
from app.services.llm_service import LLMError, LLMService
from app.services.org_knowledge_service import OrgKnowledgeService, compute_completeness, format_knowledge_for_prompt
from app.services.prompt_utils import format_knowledge_compact, truncate_text
from app.services.sgq_rules_engine import (
    COMPONENT_RULES,
    DOCUMENT_SCHEMAS,
    build_compliance_summary,
    infer_proposed_components,
)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def compute_completeness_from_data(model_data: dict) -> int:
    ks = OrgKnowledgeService.__new__(OrgKnowledgeService)
    state = {}
    if model_data.get("org_knowledge_state"):
        from app.services.org_knowledge_service import default_org_knowledge_state, merge_knowledge_state
        state = merge_knowledge_state(default_org_knowledge_state(), model_data["org_knowledge_state"])
    return compute_completeness(state)
DATA_DIR = Path(__file__).parent.parent / "data"


class SgqEngineError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class SgqEngine:
    """Analiza cumplimiento ISO, identifica brechas e infiere documentos SGQ necesarios."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMService()

    def _parse_json(self, text: str) -> dict:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
            if match:
                return json.loads(match.group(1))
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                return json.loads(match.group(0))
            raise ValueError("No se pudo interpretar la respuesta del motor SGQ")

    def _load_iso_requirements(self) -> list[dict]:
        data = json.loads((DATA_DIR / "iso9001_requirements.json").read_text(encoding="utf-8"))
        items = []
        for clause in data.get("clauses", []):
            for req in clause.get("requirements", []):
                items.append({
                    "id": req["id"],
                    "clause": clause["id"],
                    "title": req["title"],
                    "topics": req.get("topics", []),
                })
        return items

    async def _get_process_model(self, project_id: UUID) -> ProcessModel | None:
        result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.model_type == ModelType.MACRO,
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    def _is_interview_complete(self, project: Project, model: ProcessModel | None) -> bool:
        state = (project.methodology or {}).get("iso_interview", {})
        if state.get("completed"):
            return True
        data = (model.model_data or {}) if model else {}
        return bool(data.get("ready_for_sgq_generation"))

    async def _get_evidence_bundle(self, project: Project) -> dict:
        model = await self._get_process_model(project.id)
        answers = (model.model_data or {}).get("iso_answers", []) if model else []
        if not isinstance(answers, list):
            answers = list(answers.values()) if isinstance(answers, dict) else []

        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.project_id == project.id)
            .order_by(ChatMessage.created_at)
        )
        msgs = result.scalars().all()
        chat_lines = []
        for m in msgs:
            role = "Usuario" if m.role == MessageRole.USER else "Consultor"
            chat_lines.append(f"{role}: {m.content[:400]}")

        answers_text = "\n".join(
            f"- [Req {a.get('requirement_id', '?')}] Cláusulas {', '.join(a.get('iso_clauses', []) or [])}: "
            f"{a.get('summary', '')}"
            for a in answers
            if isinstance(a, dict)
        ) or "Sin respuestas estructuradas registradas."

        knowledge_state = {}
        if model:
            ks = OrgKnowledgeService(self.db, self.llm)
            knowledge_state = ks.get_state(model.model_data)

        org_name = (
            knowledge_state.get("general", {}).get("name")
            or project.name
            or "Organización"
        )

        return {
            "model": model,
            "iso_answers": answers,
            "iso_answers_text": answers_text,
            "chat_history": "\n".join(chat_lines) or "Sin historial de chat.",
            "knowledge_state": knowledge_state,
            "org_knowledge_text": format_knowledge_compact(knowledge_state),
            "organization_name": org_name,
        }

    async def _execute_diagnosis(self, project: Project, *, incremental: bool = False) -> dict:
        """Núcleo del análisis de cumplimiento, brechas e inferencia documental."""
        evidence = await self._get_evidence_bundle(project)
        model = evidence["model"]

        if not evidence["iso_answers"] and len(evidence["chat_history"]) < 80:
            if incremental:
                return (model.model_data or {}).get("sgq_diagnosis") or self._empty_diagnosis()
            raise SgqEngineError(
                "No hay información suficiente de la entrevista para realizar el diagnóstico.",
                400,
            )

        requirements = self._load_iso_requirements()
        req_lines = "\n".join(
            f"- {r['id']} ({r['clause']}): {r['title']} — Temas: {', '.join(r['topics'])}"
            for r in requirements
        )

        prompt_template = (PROMPTS_DIR / "sgq_compliance_analysis.txt").read_text(encoding="utf-8")
        user_prompt = prompt_template.format(
            organization_name=evidence["organization_name"],
            requirements_list=req_lines,
            org_knowledge_state=evidence["org_knowledge_text"],
            iso_answers=evidence["iso_answers_text"],
            chat_history=truncate_text(evidence["chat_history"], 4500),
        )

        try:
            raw = await self.llm.generate(
                system=(
                    "Auditor ISO 9001:2015. Evalúa cumplimiento SOLO con evidencia proporcionada. "
                    "Nunca asumas información no mencionada. Responde exclusivamente en JSON válido."
                ),
                user=user_prompt,
                json_mode=True,
                temperature=0.1,
            )
        except LLMError as e:
            if incremental:
                existing = (model.model_data or {}).get("sgq_diagnosis") if model else None
                if existing:
                    return existing
            raise SgqEngineError(e.message, e.status_code) from e

        parsed = self._parse_json(raw)
        evaluations = parsed.get("evaluations", [])
        gaps = parsed.get("gaps", [])
        org_context = parsed.get("organization_context", {})

        eval_ids = {e.get("requirement_id") for e in evaluations}
        gap_ids = {g.get("requirement_id") for g in gaps}
        for req in requirements:
            if req["id"] not in eval_ids:
                evaluations.append({
                    "requirement_id": req["id"],
                    "clause": req["clause"],
                    "title": req["title"],
                    "status": "no_cumple",
                    "evidence_found": "Ninguna",
                    "evidence_missing": "No se proporcionó información durante la entrevista",
                })
                eval_ids.add(req["id"])
            ev = next((e for e in evaluations if e.get("requirement_id") == req["id"]), None)
            if req["id"] not in gap_ids and ev and ev.get("status") in ("no_cumple", "cumple_parcialmente"):
                gaps.append({
                    "requirement_id": req["id"],
                    "clause": req["clause"],
                    "requirement_title": req["title"],
                    "evidence_found": ev.get("evidence_found", "Ninguna"),
                    "evidence_missing": ev.get("evidence_missing", "Información insuficiente"),
                    "priority": "alta" if req["id"] in ("4.4", "5.2", "6.1", "7.5", "9.1", "9.2", "10.2") else "media",
                    "recommendation": f"Implementar controles para cumplir el requisito {req['id']}: {req['title']}",
                })
                gap_ids.add(req["id"])

        compliance_summary = build_compliance_summary(evaluations)
        proposed = infer_proposed_components(
            evaluations, gaps, org_context, evidence["knowledge_state"],
        )

        documents = (model.model_data or {}).get("sgq_documents", {}) if model else {}
        from app.services.sgq_document_sync import sync_proposed_components_with_documents
        proposed = sync_proposed_components_with_documents(
            {"proposed_components": proposed},
            documents,
        )

        return {
            "diagnosed_at": datetime.now(timezone.utc).isoformat(),
            "incremental": incremental,
            "compliance_summary": compliance_summary,
            "requirements_evaluation": evaluations,
            "gaps": gaps,
            "organization_context": org_context,
            "proposed_components": proposed,
        }

    def _empty_diagnosis(self) -> dict:
        return {
            "diagnosed_at": None,
            "incremental": True,
            "compliance_summary": build_compliance_summary([]),
            "requirements_evaluation": [],
            "gaps": [],
            "organization_context": {},
            "proposed_components": [],
        }

    async def run_incremental_diagnosis(self, project: Project) -> dict | None:
        """Actualiza diagnóstico progresivamente durante la entrevista."""
        if not self.llm.is_configured:
            return None
        model = await self._get_process_model(project.id)
        if not model:
            return None
        try:
            diagnosis = await self._execute_diagnosis(project, incremental=True)
        except SgqEngineError:
            return (model.model_data or {}).get("sgq_diagnosis")

        data = dict(model.model_data or {})
        data["sgq_diagnosis"] = diagnosis
        from app.services.sgq_document_sync import apply_document_sync_to_model_data
        model.model_data = apply_document_sync_to_model_data(data)
        await flush_with_retry(self.db)
        return model.model_data.get("sgq_diagnosis")

    async def run_diagnosis(self, project: Project) -> dict:
        """Ejecuta análisis final de cumplimiento, brechas e inferencia documental."""
        if not self.llm.is_configured:
            raise SgqEngineError(
                "Configure GEMINI_API_KEY en Render o backend/.env", 503
            )

        model = await self._get_process_model(project.id)
        if not model:
            raise SgqEngineError("No hay datos de entrevista para este proyecto.", 400)

        diagnosis = await self._execute_diagnosis(project, incremental=False)

        data = dict(model.model_data or {})
        data["sgq_diagnosis"] = diagnosis
        data["ready_for_sgq_generation"] = True
        from app.services.sgq_document_sync import apply_document_sync_to_model_data
        model.model_data = apply_document_sync_to_model_data(data)
        await flush_with_retry(self.db)

        return model.model_data.get("sgq_diagnosis")

    async def get_status(self, project: Project) -> dict:
        model = await self._get_process_model(project.id)
        data = (model.model_data or {}) if model else {}
        interview = (project.methodology or {}).get("iso_interview", {})
        diagnosis = data.get("sgq_diagnosis")
        documents = data.get("sgq_documents", {})

        return {
            "interview_completed": self._is_interview_complete(project, model),
            "ready_for_diagnosis": bool(
                diagnosis or (model and ((model.model_data or {}).get("iso_answers") or (model.model_data or {}).get("org_knowledge_state")))
            ),
            "diagnosis_completed": diagnosis is not None,
            "diagnosed_at": diagnosis.get("diagnosed_at") if diagnosis else None,
            "proposed_components_count": len(diagnosis.get("proposed_components", [])) if diagnosis else 0,
            "generated_documents_count": len(documents),
            "draft_documents_count": len(documents),
            "knowledge_completeness": (
                (project.methodology or {}).get("iso_interview", {}).get("knowledge_completeness")
                or compute_completeness_from_data(data)
            ),
            "overall_compliance_percent": (
                diagnosis.get("compliance_summary", {}).get("overall_percent") if diagnosis else None
            ),
        }

    async def get_knowledge_state(self, project: Project) -> dict:
        model = await self._get_process_model(project.id)
        if not model:
            return {"knowledge_state": {}, "knowledge_completeness": 0, "documents": {}, "pending_information": []}
        ks = OrgKnowledgeService(self.db, self.llm)
        await ks.ensure_document_shells(model)
        state = ks.get_state(model.model_data)
        data = dict(model.model_data or {})
        from app.services.sgq_document_sync import apply_document_sync_to_model_data
        synced = apply_document_sync_to_model_data(data)
        if synced != data:
            model.model_data = synced
            await flush_with_retry(self.db)
        docs = synced.get("sgq_documents", {})
        return {
            "knowledge_state": state,
            "knowledge_completeness": compute_completeness(state),
            "documents": docs,
            "pending_information": state.get("pending_information", []),
        }

    async def complete_drafts(
        self,
        project: Project,
        *,
        force: bool = False,
        max_documents: int = 0,
    ) -> dict:
        if not self.llm.is_configured:
            raise SgqEngineError(
                "Configure GEMINI_API_KEY en Render o backend/.env", 503
            )
        model = await self._get_process_model(project.id)
        if not model:
            raise SgqEngineError("No hay datos de entrevista para este proyecto.", 400)
        ks = OrgKnowledgeService(self.db, self.llm)
        try:
            return await ks.complete_all_drafts(
                project, model, force=force, max_documents=max_documents,
            )
        except LLMError as e:
            raise SgqEngineError(e.message, e.status_code) from e

    async def get_diagnosis(self, project: Project) -> dict | None:
        model = await self._get_process_model(project.id)
        if not model:
            return None
        data = dict(model.model_data or {})
        diagnosis = data.get("sgq_diagnosis")
        if not diagnosis:
            return None
        from app.services.sgq_document_sync import apply_document_sync_to_model_data
        synced = apply_document_sync_to_model_data(data)
        if synced.get("sgq_diagnosis") != diagnosis:
            model.model_data = synced
            await flush_with_retry(self.db)
        return synced.get("sgq_diagnosis")

    async def generate_component(self, project: Project, component_type: str) -> dict:
        """Genera un documento SGQ específico justificado por el diagnóstico."""
        if component_type not in COMPONENT_RULES:
            raise SgqEngineError(f"Tipo de componente desconocido: {component_type}", 400)

        if not self.llm.is_configured:
            raise SgqEngineError(
                "Configure GEMINI_API_KEY en Render o backend/.env", 503
            )

        model = await self._get_process_model(project.id)
        if not model:
            raise SgqEngineError("No hay datos de entrevista para este proyecto.", 400)

        data = dict(model.model_data or {})
        diagnosis = data.get("sgq_diagnosis")
        if not diagnosis:
            raise SgqEngineError(
                "Debe ejecutar el diagnóstico antes de generar documentos.", 400
            )

        proposed = diagnosis.get("proposed_components", [])
        component = next(
            (c for c in proposed if c.get("component_type") == component_type), None
        )
        existing_doc = data.get("sgq_documents", {}).get(component_type)
        from app.services.sgq_document_sync import document_has_content
        if document_has_content(existing_doc):
            return existing_doc
        if not component:
            raise SgqEngineError(
                f"El componente '{COMPONENT_RULES[component_type]['title']}' no fue "
                "identificado como necesario en el diagnóstico. No se generará.",
                400,
            )

        evidence = await self._get_evidence_bundle(project)
        existing_docs = data.get("sgq_documents", {})
        existing_summary = json.dumps(
            {k: {"generated_at": v.get("generated_at"), "title": v.get("title")}
             for k, v in existing_docs.items()},
            ensure_ascii=False,
        ) if existing_docs else "Ninguno"

        related_gaps = [
            g for g in diagnosis.get("gaps", [])
            if g.get("requirement_id") in component.get("related_requirements", [])
        ]
        gaps_text = json.dumps(related_gaps, ensure_ascii=False, indent=2)

        prompt_template = (PROMPTS_DIR / "sgq_document_generation.txt").read_text(encoding="utf-8")
        user_prompt = prompt_template.format(
            document_type=component_type,
            document_title=component.get("title", COMPONENT_RULES[component_type]["title"]),
            justifying_requirements=", ".join(component.get("related_requirements", [])),
            related_gaps=gaps_text,
            organization_context=json.dumps(
                diagnosis.get("organization_context", {}), ensure_ascii=False, indent=2
            ),
            evidence=evidence["org_knowledge_text"] + "\n\n" + evidence["iso_answers_text"] + "\n\n" + evidence["chat_history"][:15000],
            existing_documents=existing_summary,
            document_schema=DOCUMENT_SCHEMAS.get(component_type, "{}"),
        )

        try:
            raw = await self.llm.generate(
                system=(
                    "Consultor ISO 9001:2015. Genera documentación SGQ basada EXCLUSIVAMENTE "
                    "en evidencia de entrevista. JSON válido únicamente."
                ),
                user=user_prompt,
                json_mode=True,
                temperature=0.2,
            )
        except LLMError as e:
            raise SgqEngineError(e.message, e.status_code) from e

        content = self._parse_json(raw)
        generated_at = datetime.now(timezone.utc).isoformat()

        doc_record = {
            "component_type": component_type,
            "title": component.get("title"),
            "content": content,
            "generated_at": generated_at,
            "justified_by_requirements": component.get("related_requirements", []),
            "justified_by_gaps": component.get("related_gaps", []),
            "justification": component.get("justification", ""),
        }

        if "sgq_documents" not in data:
            data["sgq_documents"] = {}
        data["sgq_documents"][component_type] = doc_record

        for comp in diagnosis.get("proposed_components", []):
            if comp.get("component_type") == component_type:
                comp["status"] = "generated"
                comp["generated_at"] = generated_at

        data["sgq_diagnosis"] = diagnosis
        model.model_data = data
        await flush_with_retry(self.db)

        return doc_record

    async def list_documents(self, project: Project) -> dict:
        model = await self._get_process_model(project.id)
        if not model:
            return {}
        ks = OrgKnowledgeService(self.db, self.llm)
        await ks.ensure_document_shells(model)
        data = dict(model.model_data or {})
        from app.services.sgq_document_sync import apply_document_sync_to_model_data
        synced = apply_document_sync_to_model_data(data)
        if synced != data:
            model.model_data = synced
            await flush_with_retry(self.db)
        return synced.get("sgq_documents", {})

    async def get_document(self, project: Project, component_type: str) -> dict | None:
        docs = await self.list_documents(project)
        return docs.get(component_type)
