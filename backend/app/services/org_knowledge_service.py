"""Estado interno de conocimiento organizacional y ciclo de actualización progresiva."""

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import flush_with_retry
from app.models.project import ModelType, ProcessModel, Project
from app.services.llm_service import LLMError
from app.services.prompt_utils import as_list, format_knowledge_compact
from app.services.sgq_document_catalog import DOC_PRIORITY, PROGRESSIVE_DOC_TYPES
from app.services.sgq_rules_engine import COMPONENT_RULES, DOCUMENT_SCHEMAS

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
MAX_PARALLEL_DRAFT_UPDATES = 3


def _shell_content(doc_type: str, org_name: str) -> dict[str, Any]:
    shells: dict[str, dict[str, Any]] = {
        "contexto_organizacion": {
            "organization_name": org_name,
            "internal_context": [],
            "external_context": [],
            "monitoring_review": "Revisión del contexto en elaboración según la entrevista.",
            "summary": "Contexto organizacional en construcción.",
        },
        "alcance_sgc": {
            "organization_name": org_name,
            "scope_statement": "Alcance del SGC en elaboración.",
            "products_services": [],
            "locations": [],
            "exclusions": [],
            "boundaries": "",
            "applicability_notes": "",
        },
        "partes_interesadas": {
            "stakeholders": [],
            "summary": "Partes interesadas en identificación según la entrevista.",
        },
        "mapa_procesos": {
            "processes": [],
            "summary": "Mapa de procesos en construcción con la información de la entrevista.",
        },
        "caracterizacion_procesos": {"characterizations": []},
        "matriz_interaccion": {"interactions": []},
        "cumplimiento_legal": {
            "requirements": [],
            "summary": "Matriz de cumplimiento legal en elaboración.",
        },
        "organigrama": {
            "organization_name": org_name,
            "nodes": [],
            "summary": "Organigrama funcional en construcción según estructura organizacional recopilada.",
        },
        "politica_calidad": {
            "policy_text": "Política de calidad en elaboración según misión, visión y objetivos.",
            "commitments": [],
            "alignment_with_context": "",
        },
        "objetivos_calidad": {
            "objectives": [],
            "alignment_with_policy": "",
        },
        "procedimientos": {"procedures": []},
        "diagrama_flujo": {"diagrams": []},
        "riesgos_oportunidades": {"entries": []},
        "indicadores": {"indicators": []},
        "registros_requeridos": {
            "records": [],
            "summary": "Registros requeridos del SGC en identificación.",
        },
    }
    return shells.get(doc_type, {})


def build_document_shell(doc_type: str, org_name: str) -> dict[str, Any]:
    title = COMPONENT_RULES.get(doc_type, {}).get("title", doc_type.replace("_", " ").title())
    return {
        "component_type": doc_type,
        "title": title,
        "content": _shell_content(doc_type, org_name),
        "status": "pendiente",
        "completeness_percent": 0,
        "mode": "to_be",
    }

DEFAULT_PENDING = [
    "Productos y servicios ofrecidos",
    "Principales clientes",
    "Principales proveedores",
    "Requisitos legales y normativos aplicables",
    "Alcance del Sistema de Gestión de Calidad",
    "Contexto interno y externo",
    "Estructura organizacional y cargos",
    "Procesos principales y su clasificación",
    "Relaciones entre procesos",
    "Recursos e infraestructura",
    "Competencias del personal",
    "Información documentada existente",
    "Riesgos y oportunidades",
    "Objetivos de calidad",
    "Indicadores y métodos de seguimiento",
    "Acciones de mejora",
]


def default_org_knowledge_state() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": None,
        "general": {
            "name": None,
            "economic_activity": None,
            "size": None,
            "mission": None,
            "vision": None,
            "values": [],
        },
        "products_services": [],
        "clients": [],
        "suppliers": [],
        "stakeholders": [],
        "context": {"internal": [], "external": []},
        "organizational_structure": {"areas": [], "roles": []},
        "processes": [],
        "process_relationships": [],
        "resources": [],
        "infrastructure": [],
        "competencies": [],
        "documented_information": [],
        "legal_requirements": [],
        "risks_opportunities": [],
        "quality_objectives": [],
        "indicators": [],
        "monitoring_methods": [],
        "improvement_actions": [],
        "iso_coverage": {},
        "pending_information": list(DEFAULT_PENDING),
        "as_is_observations": [],
    }


def _unique_append(target: list, items: list) -> None:
    seen = {json.dumps(x, sort_keys=True, ensure_ascii=False) if isinstance(x, dict) else str(x) for x in target}
    for item in items:
        key = json.dumps(item, sort_keys=True, ensure_ascii=False) if isinstance(item, dict) else str(item)
        if key not in seen and item:
            target.append(item)
            seen.add(key)


def _merge_dict(base: dict, patch: dict) -> dict:
    for key, value in patch.items():
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _merge_dict(dict(base[key]), value)
        elif isinstance(value, list) and isinstance(base.get(key), list):
            _unique_append(base[key], value)
        else:
            base[key] = value
    return base


def merge_knowledge_state(state: dict, patch: dict) -> dict:
    merged = deepcopy(state)
    return _merge_dict(merged, patch)


def seed_from_org_profile(state: dict, org_profile: dict) -> dict:
    merged = deepcopy(state)
    general = merged.setdefault("general", {})
    if org_profile.get("org_name"):
        general["name"] = org_profile["org_name"]
    if org_profile.get("main_activity"):
        general["economic_activity"] = org_profile["main_activity"]
    if org_profile.get("employee_size"):
        general["size"] = org_profile["employee_size"]
    pending = merged.get("pending_information", [])
    merged["pending_information"] = [
        p for p in pending
        if p not in {
            "Nombre de la organización",
            "Actividad económica principal",
            "Tamaño de la empresa",
        }
    ]
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    return merged


def compute_completeness(state: dict) -> int:
    checks = [
        bool(state.get("general", {}).get("name")) if isinstance(state.get("general"), dict) else False,
        bool(state.get("general", {}).get("economic_activity")) if isinstance(state.get("general"), dict) else False,
        bool(state.get("general", {}).get("size")) if isinstance(state.get("general"), dict) else False,
        bool(state.get("products_services")),
        bool(state.get("clients")),
        bool(state.get("stakeholders")),
        bool(
            (isinstance(state.get("context"), dict) and (state["context"].get("internal") or state["context"].get("external")))
        ),
        bool(
            isinstance(state.get("organizational_structure"), dict)
            and (state["organizational_structure"].get("roles") or state["organizational_structure"].get("areas"))
        ),
        bool(state.get("processes")),
        bool(state.get("risks_opportunities")),
        bool(state.get("quality_objectives")),
        bool(state.get("indicators")),
        len(state.get("pending_information", []) if isinstance(state.get("pending_information"), list) else []) <= 5,
    ]
    return int(sum(checks) / len(checks) * 100)


def format_knowledge_for_prompt(state: dict) -> str:
    if not state:
        return "Estado vacío — inicio de entrevista."
    return json.dumps(state, ensure_ascii=False, indent=2)


def format_pending_for_prompt(state: dict) -> str:
    pending = as_list(state.get("pending_information")) or list(DEFAULT_PENDING)
    if not pending:
        return "No hay información pendiente crítica identificada."
    return "\n".join(f"- {p}" for p in pending[:20])


def format_drafts_summary(documents: dict) -> str:
    if not documents:
        return "Aún no hay borradores. Se crearán con cada respuesta."
    lines = []
    for doc_type in PROGRESSIVE_DOC_TYPES:
        doc = documents.get(doc_type)
        if not doc:
            lines.append(f"- {doc_type}: no iniciado")
            continue
        status = doc.get("status", "draft")
        completeness = doc.get("completeness_percent", 0)
        lines.append(f"- {doc.get('title', doc_type)}: {status} ({completeness}% completo)")
    return "\n".join(lines)


class OrgKnowledgeService:
    """Gestiona estado interno y borradores progresivos del SGQ."""

    def __init__(self, db: AsyncSession, llm):
        self.db = db
        self.llm = llm

    def _load_prompt(self, name: str) -> str:
        path = PROMPTS_DIR / f"{name}.txt"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def _parse_json(self, text: str) -> dict:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            import re
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                return json.loads(match.group(0))
            raise ValueError("JSON inválido del LLM")

    async def _get_process_model(self, project_id: UUID) -> ProcessModel | None:
        from sqlalchemy import select
        result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.model_type == ModelType.MACRO,
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    def get_state(self, model_data: dict | None) -> dict:
        stored = (model_data or {}).get("org_knowledge_state")
        if isinstance(stored, dict) and stored:
            base = default_org_knowledge_state()
            return merge_knowledge_state(base, stored)
        return default_org_knowledge_state()

    async def save_state(self, model: ProcessModel, state: dict) -> None:
        data = dict(model.model_data or {})
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        data["org_knowledge_state"] = state
        model.model_data = data
        await flush_with_retry(self.db)

    async def apply_onboarding(self, model: ProcessModel, org_profile: dict) -> dict:
        state = seed_from_org_profile(self.get_state(model.model_data), org_profile)
        await self.save_state(model, state)
        await self.ensure_document_shells(model, state)
        return state

    async def ensure_document_shells(self, model: ProcessModel, state: dict | None = None) -> list[str]:
        """Crea borradores vacíos para todos los documentos SGQ si aún no existen."""
        state = state or self.get_state(model.model_data)
        org_name = state.get("general", {}).get("name") or "Organización"
        data = dict(model.model_data or {})
        documents = dict(data.get("sgq_documents") or {})
        created: list[str] = []
        changed = False

        # Tipos deprecados: ya no se generan ni se muestran
        for deprecated in ("informacion_documentada",):
            if deprecated in documents:
                documents.pop(deprecated, None)
                changed = True

        for doc_type in PROGRESSIVE_DOC_TYPES:
            if doc_type not in documents:
                documents[doc_type] = build_document_shell(doc_type, org_name)
                created.append(doc_type)
                changed = True

        if changed:
            data["sgq_documents"] = documents
            model.model_data = data
            await flush_with_retry(self.db)
        return created

    def resolve_affected_documents(self, llm_affected: list[str], state: dict) -> list[str]:
        """Combina documentos señalados por la IA con inferencia por estado de conocimiento."""
        inferred = self._infer_affected_documents(state)
        merged: list[str] = []
        for doc_type in list(llm_affected or []) + inferred:
            if doc_type in PROGRESSIVE_DOC_TYPES and doc_type not in merged:
                merged.append(doc_type)
        return sorted(merged, key=lambda x: DOC_PRIORITY.get(x, 99))

    async def extract_and_update(
        self,
        project: Project,
        model: ProcessModel,
        user_message: str,
        last_question: str,
        interaction_type: str,
        pre_validation: dict | None = None,
    ) -> dict:
        """Interpreta respuesta, actualiza estado interno. Retorna resumen del ciclo."""
        if not self.llm.is_configured or not user_message.strip():
            return {"affected_documents": [], "interpretation_summary": ""}

        current_state = self.get_state(model.model_data)
        category = (pre_validation or {}).get("response_category", "case_1")
        if category == "case_4":
            return {"affected_documents": [], "interpretation_summary": ""}

        template = self._load_prompt("knowledge_extraction")
        prompt = template.format(
            user_message=user_message,
            last_question=last_question or "N/A",
            interaction_type=interaction_type or "text",
            current_knowledge=format_knowledge_compact(current_state),
            semantic_analysis=json.dumps(pre_validation or {}, ensure_ascii=False, indent=2),
            project_name=project.name or current_state.get("general", {}).get("name") or "Organización",
        )

        try:
            raw = await self.llm.generate(
                system=(
                    "Analista de información organizacional ISO 9001. "
                    "Extrae hechos de la respuesta del usuario (AS IS). "
                    "Actualiza el estado interno. SOLO JSON."
                ),
                user=prompt,
                json_mode=True,
                temperature=0.15,
            )
            parsed = self._parse_json(raw)
        except LLMError:
            raise

        patch = parsed.get("state_patch") or {}
        updated = merge_knowledge_state(current_state, patch)

        pending_remove = parsed.get("pending_to_remove") or []
        pending_add = parsed.get("pending_to_add") or []
        pending = [p for p in updated.get("pending_information", []) if p not in pending_remove]
        _unique_append(pending, pending_add)
        updated["pending_information"] = pending

        await self.save_state(model, updated)

        return {
            "interpretation_summary": parsed.get("interpretation_summary", ""),
            "extracted_facts": parsed.get("extracted_facts", []),
            "affected_documents": parsed.get("affected_documents", []),
            "pending_information": updated.get("pending_information", []),
            "knowledge_completeness": compute_completeness(updated),
        }

    async def update_progressive_drafts(
        self,
        project: Project,
        model: ProcessModel,
        affected_documents: list[str],
        *,
        max_updates: int = 0,
    ) -> list[str]:
        """Actualiza en paralelo los borradores TO BE afectados por la nueva información."""
        if not self.llm.is_configured:
            return []

        state = self.get_state(model.model_data)
        org_name = state.get("general", {}).get("name") or project.name or "Organización"
        await self.ensure_document_shells(model, state)

        data = dict(model.model_data or {})
        documents = dict(data.get("sgq_documents") or {})

        candidates = self.resolve_affected_documents(affected_documents, state)
        if max_updates > 0:
            candidates = candidates[:max_updates]

        if not candidates:
            return []

        semaphore = asyncio.Semaphore(MAX_PARALLEL_DRAFT_UPDATES)

        async def _update_one(doc_type: str) -> tuple[str, dict | None]:
            async with semaphore:
                existing = documents.get(doc_type, {})
                content = await self._generate_draft_content(
                    project=project,
                    doc_type=doc_type,
                    state=state,
                    existing=existing,
                    org_name=org_name,
                )
                if content is None:
                    return doc_type, None
                return doc_type, content

        results = await asyncio.gather(*[_update_one(dt) for dt in candidates])

        updated_types: list[str] = []
        for doc_type, doc_payload in results:
            if not doc_payload:
                continue
            documents[doc_type] = doc_payload
            updated_types.append(doc_type)

        if updated_types:
            data["sgq_documents"] = documents
            from app.services.sgq_document_sync import apply_document_sync_to_model_data
            model.model_data = apply_document_sync_to_model_data(data)
            await flush_with_retry(self.db)

        return updated_types

    async def _generate_draft_content(
        self,
        *,
        project: Project,
        doc_type: str,
        state: dict,
        existing: dict,
        org_name: str,
    ) -> dict | None:
        title = COMPONENT_RULES.get(doc_type, {}).get("title", doc_type)
        schema = DOCUMENT_SCHEMAS.get(doc_type, "{}")
        template = self._load_prompt("progressive_document_update")

        prompt = template.format(
            document_type=doc_type,
            document_title=title,
            current_knowledge=format_knowledge_compact(state),
            existing_draft=json.dumps(existing.get("content", {}), ensure_ascii=False, indent=2),
            document_schema=schema,
            organization_name=org_name,
        )

        try:
            raw = await self.llm.generate(
                system=(
                    "Consultor ISO 9001:2015. Genera documentación TO BE (modelo objetivo) "
                    "basada en TODA la información AS IS recopilada hasta ahora. "
                    "Integra datos previos del borrador con los nuevos hechos. "
                    "Para diagrama_flujo, mapa_procesos y organigrama usa estructura visual "
                    "tipo Bizagi (actividades, carriles, eventos, nodos jerárquicos). "
                    "Diseña estructura optimizada según buenas prácticas. SOLO JSON."
                ),
                user=prompt,
                json_mode=True,
                temperature=0.2,
            )
            content = self._parse_json(raw)
        except LLMError:
            return None

        if not isinstance(content, dict):
            return None

        completeness = int(content.pop("completeness_percent", existing.get("completeness_percent", 20)))
        content = self._inject_organization_metadata(content, doc_type, org_name)

        return {
            "component_type": doc_type,
            "title": title,
            "content": content,
            "status": "draft" if completeness < 85 else "ready",
            "completeness_percent": min(100, max(0, completeness)),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "to_be",
        }

    def _inject_organization_metadata(self, content: dict, doc_type: str, org_name: str) -> dict:
        if doc_type in ("organigrama", "contexto_organizacion", "alcance_sgc"):
            content.setdefault("organization_name", org_name)
        if doc_type == "mapa_procesos" and org_name:
            summary = content.get("summary") or ""
            if org_name not in str(summary):
                content["summary"] = f"{summary} Organización: {org_name}.".strip()
        return content

    def _infer_affected_documents(self, state: dict) -> list[str]:
        affected: list[str] = []
        general = state.get("general") or {}
        context = state.get("context") or {}

        if general.get("name") or general.get("economic_activity") or context:
            affected.extend(["contexto_organizacion", "alcance_sgc"])

        if state.get("stakeholders"):
            affected.append("partes_interesadas")

        if general.get("name") or general.get("economic_activity"):
            affected.append("mapa_procesos")

        if state.get("processes"):
            affected.extend([
                "mapa_procesos",
                "caracterizacion_procesos",
                "diagrama_flujo",
                "procedimientos",
            ])

        if state.get("process_relationships"):
            affected.append("matriz_interaccion")

        if state.get("legal_requirements") or general.get("economic_activity"):
            affected.append("cumplimiento_legal")

        org = state.get("organizational_structure") or {}
        if org.get("roles") or org.get("areas"):
            affected.append("organigrama")

        if general.get("mission") or general.get("vision"):
            affected.append("politica_calidad")

        if state.get("quality_objectives"):
            affected.extend(["objetivos_calidad", "politica_calidad", "indicadores"])

        if state.get("risks_opportunities"):
            affected.append("riesgos_oportunidades")

        if state.get("indicators") or state.get("monitoring_methods"):
            affected.append("indicadores")

        if state.get("documented_information"):
            affected.extend(["registros_requeridos"])

        if not affected and (general.get("name") or state.get("products_services")):
            affected.extend(["contexto_organizacion", "mapa_procesos"])

        return list(dict.fromkeys(affected))
