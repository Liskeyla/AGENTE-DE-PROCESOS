import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session, commit_checkpoint, flush_with_retry, safe_rollback
from app.models.project import (
    ChatMessage, Document, MessageRole, MessageType, ModelType, ProcessModel, Project,
)
from app.services.llm_service import LLMError
from app.services.sgq_document_catalog import (
    ONBOARDING_BOOTSTRAP_DOCS,
    PER_MESSAGE_MAX_DOC_UPDATES,
    PROGRESSIVE_DOC_TYPES,
)
from app.services.org_knowledge_service import (
    OrgKnowledgeService,
    compute_completeness,
    format_drafts_summary,
    format_knowledge_for_prompt,
    format_pending_for_prompt,
)
from app.services.prompt_utils import (
    MAX_CHAT_HISTORY_MSGS,
    MAX_CHAT_MSG_CHARS,
    format_iso_requirements_compact,
    format_knowledge_compact,
)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

DIAGNOSIS_EVERY_N_ANSWERS = 5


async def _run_incremental_diagnosis_background(project_id: UUID) -> None:
    """Diagnóstico incremental sin bloquear la respuesta del chat."""
    async with async_session() as db:
        try:
            project = await db.get(Project, project_id)
            if not project:
                return
            from app.services.sgq_engine import SgqEngine
            await SgqEngine(db).run_incremental_diagnosis(project)
            await commit_checkpoint(db)
        except Exception:
            await safe_rollback(db)
DATA_DIR = Path(__file__).parent.parent / "data"

INTERACTIVE_TYPES = frozenset({
    "single_choice", "multi_choice", "dropdown", "confirm", "file_request",
})

SHORT_ANSWERS = frozenset({
    "sí", "si", "no", "tal vez", "quizás", "quizas", "no lo sé", "no lo se",
    "a veces", "creo que sí", "creo que si", "n/a", "na",
})

WELCOME_MESSAGE = """¡Hola!
Soy Processum S.A., tu consultor en Sistemas de Gestión de Calidad basados en ISO 9001.

Mi objetivo es conocer cómo funciona tu organización para ayudarte a construir automáticamente la estructura documental de tu Sistema de Gestión de Calidad.
Durante esta entrevista recopilaré información sobre tu empresa, sus procesos y la forma en que trabaja.

Con tus respuestas podré generar documentos como: mapa de procesos, diagramas de flujo, caracterizaciones de procesos, procedimientos, políticas y otros documentos requeridos por ISO 9001.
La entrevista tomará aproximadamente entre 20 y 30 minutos.

¿Estás listo para comenzar?"""

ONBOARDING_QUESTIONS = {
    "q_org_name": {
        "text": "¿Cuál es el nombre de la organización?",
        "interaction_type": "text",
        "options": [],
        "field": "org_name",
    },
    "q_main_activity": {
        "text": "¿Cuál es la actividad principal de la organización?",
        "interaction_type": "text",
        "options": [],
        "field": "main_activity",
    },
    "q_employees": {
        "text": "¿Cuántos colaboradores tiene actualmente?",
        "interaction_type": "single_choice",
        "options": [
            "Microempresa (1–10 colaboradores)",
            "Pequeña empresa (11–50 colaboradores)",
            "Mediana empresa (51–250 colaboradores)",
            "Gran empresa (más de 250 colaboradores)",
        ],
        "field": "employee_size",
    },
}

EMPLOYEE_SIZE_OPTIONS = ONBOARDING_QUESTIONS["q_employees"]["options"]

AFFIRMATIVE_PATTERNS = frozenset({
    "si", "sí", "yes", "ok", "okay", "dale", "claro", "listo", "adelante",
    "de acuerdo", "vamos", "empecemos", "comencemos", "estoy listo", "estoy lista",
    "por supuesto", "perfecto", "continua", "continúa", "arranquemos", "iniciemos",
    "empezar", "comenzar", "listos", "listas", "afirmativo", "correcto", "bueno",
})


class ConversationalChatService:
    """Entrevista ISO 9001:2015 adaptativa con clasificación en 4 casos y memoria de requisitos."""

    def __init__(self, db: AsyncSession):
        self.db = db
        from app.services.llm_service import LLMService
        self.llm = LLMService()

    def _load_prompt(self, name: str) -> str:
        path = PROMPTS_DIR / f"{name}.txt"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def _load_iso_requirements(self, compact: bool = True) -> str:
        path = DATA_DIR / "iso9001_requirements.json"
        if not path.exists():
            return "(Referencia ISO no disponible)"
        data = json.loads(path.read_text(encoding="utf-8"))
        if compact:
            return format_iso_requirements_compact(data)
        lines = []
        for clause in data.get("clauses", []):
            lines.append(f"## Cláusula {clause['id']} — {clause['title']}")
            for req in clause.get("requirements", []):
                topics = ", ".join(req.get("topics", []))
                lines.append(f"- {req['id']} {req['title']}: {topics}")
        return "\n".join(lines)

    def _default_state(self) -> dict:
        return {
            "active": False,
            "completed": False,
            "current_clause": "4",
            "current_requirement_id": "4.1",
            "progress_percent": 0,
            "topics_covered": [],
            "answers_count": 0,
            "requirements_fulfilled": [],
            "requirement_in_progress": None,
            "original_question": "",
            "started_at": None,
            "completed_at": None,
            "last_question": "",
            "last_interaction_type": "",
            "last_semantic_validation": None,
            "onboarding_step": "awaiting_ready",
            "org_profile": {},
        }

    def _get_interview_state(self, project: Project) -> dict:
        state = self._default_state()
        stored = (project.methodology or {}).get("iso_interview", {})
        if isinstance(stored, dict):
            state.update(stored)
        return state

    async def _save_interview_state(self, project: Project, state: dict) -> None:
        methodology = dict(project.methodology or {})
        methodology["mode"] = "iso_adaptive_interview"
        methodology["iso_interview"] = state
        project.methodology = methodology
        await flush_with_retry(self.db)

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
            raise ValueError("No se pudo interpretar la respuesta del asistente")

    async def _get_chat_history(self, project_id: UUID, limit: int | None = None) -> str:
        limit = limit or MAX_CHAT_HISTORY_MSGS
        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.project_id == project_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
        msgs = list(reversed(result.scalars().all()))
        if not msgs:
            return "Sin mensajes previos."
        lines = []
        for m in msgs:
            role = "Usuario" if m.role == MessageRole.USER else "Consultor"
            lines.append(f"{role}: {m.content[:MAX_CHAT_MSG_CHARS]}")
        return "\n".join(lines)

    async def _get_last_assistant_question(self, project_id: UUID) -> tuple[str, str]:
        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.project_id == project_id, ChatMessage.role == MessageRole.ASSISTANT)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        msg = result.scalar_one_or_none()
        if not msg:
            return "", ""
        meta = msg.metadata_ or {}
        return msg.content, str(meta.get("interaction_type", "text"))

    async def _get_collected_information(self, project_id: UUID) -> str:
        model = await self._get_or_create_process_model(project_id)
        ks = OrgKnowledgeService(self.db, self.llm)
        state = ks.get_state(model.model_data)
        if state.get("general", {}).get("name") or state.get("processes"):
            return format_knowledge_compact(state)
        result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.model_type == ModelType.MACRO,
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        model = result.scalar_one_or_none()
        if not model:
            return "Ninguna información almacenada aún."
        answers = (model.model_data or {}).get("iso_answers", [])
        if not answers:
            return "Ninguna información almacenada aún."
        lines = []
        for a in answers[-20:]:
            clauses = ", ".join(a.get("iso_clauses", []))
            lines.append(f"- [{clauses}] {a.get('summary', '')}")
        return "\n".join(lines)

    async def _process_knowledge_cycle(
        self,
        project: Project,
        user_message: str,
        state: dict,
        pre_validation: dict | None,
    ) -> dict:
        """Interpreta respuesta, actualiza estado interno y borradores progresivos."""
        if not user_message.strip() or user_message.startswith("[ONBOARDING"):
            return {}

        model = await self._get_or_create_process_model(project.id)
        ks = OrgKnowledgeService(self.db, self.llm)
        await ks.ensure_document_shells(model)

        try:
            cycle = await ks.extract_and_update(
                project,
                model,
                user_message,
                state.get("last_question", ""),
                state.get("last_interaction_type", "text"),
                pre_validation,
            )
            state_after = ks.get_state(model.model_data)
            affected = ks.resolve_affected_documents(
                cycle.get("affected_documents", []),
                state_after,
            )
            updated_docs = await ks.update_progressive_drafts(
                project, model, affected, max_updates=PER_MESSAGE_MAX_DOC_UPDATES,
            )
            cycle["updated_documents"] = updated_docs
            cycle["affected_documents"] = affected

            answers_count = state.get("answers_count", 0)
            should_diagnose = (
                (cycle.get("extracted_facts") or updated_docs)
                and answers_count > 0
                and answers_count % DIAGNOSIS_EVERY_N_ANSWERS == 0
            )
            if should_diagnose:
                asyncio.create_task(_run_incremental_diagnosis_background(project.id))
                cycle["diagnosis_scheduled"] = True

            return cycle
        except LLMError:
            raise

    async def _sync_onboarding_knowledge(self, project: Project, org_profile: dict) -> None:
        model = await self._get_or_create_process_model(project.id)
        ks = OrgKnowledgeService(self.db, self.llm)
        await ks.apply_onboarding(model, org_profile)

    async def _get_document_context(self, project_id: UUID) -> str:
        result = await self.db.execute(
            select(Document).where(
                Document.project_id == project_id,
                Document.extracted_text.isnot(None),
            )
        )
        docs = result.scalars().all()
        if not docs:
            return "No hay documentos adjuntos."
        parts = [f"[{d.filename}]\n{d.extracted_text[:2500]}" for d in docs[:5]]
        return "\n\n---\n\n".join(parts)

    def _is_short_answer(self, text: str) -> bool:
        normalized = text.strip().lower().rstrip(".")
        return normalized in SHORT_ANSWERS or len(normalized) <= 3

    def _normalize_text(self, text: str) -> str:
        t = text.strip().lower()
        for src, dst in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ü", "u"), ("ñ", "n")):
            t = t.replace(src, dst)
        t = re.sub(r"[^\w\s]", " ", t)
        return re.sub(r"\s+", " ", t).strip()

    def _is_affirmative(self, text: str) -> bool:
        normalized = self._normalize_text(text)
        if not normalized:
            return False
        if normalized in AFFIRMATIVE_PATTERNS:
            return True
        for pattern in AFFIRMATIVE_PATTERNS:
            if normalized == pattern or normalized.startswith(f"{pattern} "):
                return True
        words = normalized.split()
        if words and words[0] in AFFIRMATIVE_PATTERNS:
            return True
        if len(words) <= 4 and any(w in AFFIRMATIVE_PATTERNS for w in words):
            return True
        return False

    def _match_employee_size(self, text: str) -> str | None:
        raw = text.strip()
        if not raw:
            return None
        lowered = raw.lower()
        for option in EMPLOYEE_SIZE_OPTIONS:
            if lowered == option.lower():
                return option
        normalized = self._normalize_text(raw)
        size_map = [
            (("micro", "1 10", "1-10"), 0),
            (("pequena", "11 50", "11-50"), 1),
            (("mediana", "51 250", "51-250"), 2),
            (("gran", "grande", "250", "mas de 250"), 3),
        ]
        for keywords, index in size_map:
            if any(k in normalized for k in keywords):
                return EMPLOYEE_SIZE_OPTIONS[index]
        return None

    def _format_org_profile(self, org_profile: dict) -> str:
        if not org_profile:
            return "Los datos iniciales se recopilarán en las primeras preguntas."
        lines = []
        if org_profile.get("org_name"):
            lines.append(f"- Nombre de la organización: {org_profile['org_name']}")
        if org_profile.get("main_activity"):
            lines.append(f"- Actividad principal: {org_profile['main_activity']}")
        if org_profile.get("employee_size"):
            lines.append(f"- Tamaño: {org_profile['employee_size']}")
        return "\n".join(lines) if lines else "Los datos iniciales se recopilarán en las primeras preguntas."

    async def _ask_onboarding_question(self, project: Project, state: dict, step_key: str) -> ChatMessage:
        question = ONBOARDING_QUESTIONS[step_key]
        state["onboarding_step"] = step_key
        state["active"] = True
        state["last_question"] = question["text"]
        state["last_interaction_type"] = question["interaction_type"]
        state["original_question"] = question["text"]
        await self._save_interview_state(project, state)

        interaction = question["interaction_type"]
        options = list(question.get("options") or [])
        metadata = {
            "interaction_type": interaction,
            "options": options if interaction != "text" else [],
            "multi_select": False,
            "hint": "",
            "progress_percent": state.get("progress_percent", 0),
            "current_clause": state.get("current_clause", "4"),
            "is_welcome": False,
            "file_request": False,
            "onboarding_step": step_key,
        }
        msg_type = MessageType.QUESTION if interaction != "text" else MessageType.TEXT
        return await self._add_message(
            project.id, MessageRole.ASSISTANT, question["text"], msg_type, metadata,
        )

    async def _handle_onboarding(
        self,
        project: Project,
        state: dict,
        user_message: str,
    ) -> tuple[ChatMessage | None, str | None]:
        """Maneja bienvenida y 3 preguntas fijas. Retorna (mensaje, trigger_iso) si aplica."""
        step = state.get("onboarding_step", "awaiting_ready")
        if step == "iso":
            return None, None

        answer = user_message.strip()
        org_profile = dict(state.get("org_profile") or {})

        if step == "awaiting_ready":
            if not self._is_affirmative(answer):
                reply = (
                    "Gracias por tu mensaje. Para continuar necesito confirmar si deseas "
                    "iniciar la entrevista.\n\n¿Estás listo para comenzar?"
                )
                metadata = {
                    "interaction_type": "text",
                    "options": [],
                    "multi_select": False,
                    "hint": "",
                    "progress_percent": 0,
                    "current_clause": "4",
                    "is_welcome": True,
                    "file_request": False,
                    "onboarding_step": "awaiting_ready",
                }
                await self._save_interview_state(project, state)
                return await self._add_message(
                    project.id, MessageRole.ASSISTANT, reply, MessageType.TEXT, metadata,
                ), None
            if not state.get("started_at"):
                state["started_at"] = datetime.now(timezone.utc).isoformat()
            msg = await self._ask_onboarding_question(project, state, "q_org_name")
            return msg, None

        if step == "q_org_name":
            if len(answer) < 2:
                reply = (
                    "Por favor, indícame el nombre de la organización.\n\n"
                    "¿Cuál es el nombre de la organización?"
                )
                metadata = {
                    "interaction_type": "text",
                    "options": [],
                    "multi_select": False,
                    "hint": "",
                    "progress_percent": 0,
                    "current_clause": "4",
                    "is_welcome": False,
                    "file_request": False,
                    "onboarding_step": "q_org_name",
                }
                return await self._add_message(
                    project.id, MessageRole.ASSISTANT, reply, MessageType.TEXT, metadata,
                ), None
            org_profile["org_name"] = answer
            state["org_profile"] = org_profile
            await self._record_answer(
                project.id, f"Organización: {answer}", ["4.1"], "onboarding.org_name", "case_1",
            )
            await self._sync_onboarding_knowledge(project, org_profile)
            msg = await self._ask_onboarding_question(project, state, "q_main_activity")
            return msg, None

        if step == "q_main_activity":
            if len(answer) < 3:
                reply = (
                    "Por favor, describe brevemente la actividad principal.\n\n"
                    "¿Cuál es la actividad principal de la organización?"
                )
                metadata = {
                    "interaction_type": "text",
                    "options": [],
                    "multi_select": False,
                    "hint": "",
                    "progress_percent": 0,
                    "current_clause": "4",
                    "is_welcome": False,
                    "file_request": False,
                    "onboarding_step": "q_main_activity",
                }
                return await self._add_message(
                    project.id, MessageRole.ASSISTANT, reply, MessageType.TEXT, metadata,
                ), None
            org_profile["main_activity"] = answer
            state["org_profile"] = org_profile
            await self._record_answer(
                project.id, f"Actividad principal: {answer}", ["4.1"], "onboarding.main_activity", "case_1",
            )
            await self._sync_onboarding_knowledge(project, org_profile)
            msg = await self._ask_onboarding_question(project, state, "q_employees")
            return msg, None

        if step == "q_employees":
            matched = self._match_employee_size(answer)
            if not matched:
                reply = ONBOARDING_QUESTIONS["q_employees"]["text"]
                metadata = {
                    "interaction_type": "single_choice",
                    "options": EMPLOYEE_SIZE_OPTIONS,
                    "multi_select": False,
                    "hint": "Selecciona una de las opciones disponibles.",
                    "progress_percent": 0,
                    "current_clause": "4",
                    "is_welcome": False,
                    "file_request": False,
                    "onboarding_step": "q_employees",
                }
                return await self._add_message(
                    project.id, MessageRole.ASSISTANT, reply, MessageType.QUESTION, metadata,
                ), None
            org_profile["employee_size"] = matched
            state["org_profile"] = org_profile
            state["onboarding_step"] = "iso"
            await self._record_answer(
                project.id, f"Tamaño: {matched}", ["4.1"], "onboarding.employee_size", "case_1",
            )
            await self._sync_onboarding_knowledge(project, org_profile)
            await self._save_interview_state(project, state)
            iso_trigger = (
                "[ONBOARDING COMPLETADO] Datos iniciales registrados. "
                f"Organización: {org_profile.get('org_name', '')}. "
                f"Actividad: {org_profile.get('main_activity', '')}. "
                f"Tamaño: {matched}. "
                "Iniciar entrevista ISO 9001:2015 desde la Cláusula 4 con la primera pregunta."
            )
            return None, iso_trigger

        return None, None

    async def _validate_answer_semantically(
        self,
        last_question: str,
        last_interaction_type: str,
        user_answer: str,
        recent_context: str,
        current_requirement_id: str,
        collected_information: str,
        requirements_fulfilled: list,
    ) -> dict:
        if not last_question or not user_answer.strip():
            return {
                "response_category": "case_1",
                "answers_question": True,
                "sufficiency": "sufficient",
                "recommended_action": "advance",
                "requirement_can_be_marked_done": False,
                "interpreted_answer": user_answer,
                "gaps": [],
                "consistency_issue": False,
            }

        template = self._load_prompt("interview_semantic_validation")
        prompt = template.format(
            last_question=last_question,
            last_interaction_type=last_interaction_type or "text",
            user_answer=user_answer,
            recent_context=recent_context,
            current_requirement_id=current_requirement_id or "N/A",
            collected_information=collected_information,
            requirements_fulfilled=", ".join(requirements_fulfilled) or "Ninguno",
        )
        raw = await self.llm.generate(
            system="Clasificador de respuestas ISO 9001. SOLO JSON. Nunca inventes información del usuario.",
            user=prompt,
            json_mode=True,
            temperature=0.15,
        )
        validation = self._parse_json(raw)

        if self._is_short_answer(user_answer):
            validation["is_short_answer"] = True
            if validation.get("response_category") == "case_1":
                validation["response_category"] = "case_2"
            validation["sufficiency"] = "insufficient"
            validation["requirement_can_be_marked_done"] = False
            validation["recommended_action"] = "deepen"

        return validation

    def _format_semantic_analysis(self, validation: dict | None) -> str:
        if not validation:
            return "No aplica."
        slim = {
            k: validation.get(k)
            for k in (
                "response_category", "sufficiency", "recommended_action",
                "interpreted_answer", "gaps",
            )
            if validation.get(k) is not None
        }
        return json.dumps(slim, ensure_ascii=False)[:800]

    async def _get_or_create_process_model(self, project_id: UUID) -> ProcessModel:
        result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.model_type == ModelType.MACRO,
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        model = result.scalar_one_or_none()
        if model:
            return model
        model = ProcessModel(
            project_id=project_id,
            model_type=ModelType.MACRO,
            name="Levantamiento ISO 9001",
            model_data={
                "iso_answers": [],
                "process_name": "Proceso",
                "sgq_deliverables_pending": PROGRESSIVE_DOC_TYPES.copy(),
            },
        )
        self.db.add(model)
        await flush_with_retry(self.db)
        return model

    async def _record_answer(
        self,
        project_id: UUID,
        summary: str,
        clauses: list,
        requirement_id: str,
        category: str,
        validation: dict | None = None,
    ) -> None:
        if not summary or not summary.strip():
            return
        model = await self._get_or_create_process_model(project_id)
        data = dict(model.model_data or {})
        answers = list(data.get("iso_answers", []))
        answers.append({
            "summary": summary.strip(),
            "iso_clauses": clauses,
            "requirement_id": requirement_id,
            "response_category": category,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "validation": {
                "sufficiency": (validation or {}).get("sufficiency"),
                "pertinence": (validation or {}).get("pertinence"),
            } if validation else {},
        })
        data["iso_answers"] = answers
        model.model_data = data
        await flush_with_retry(self.db)

    async def _add_message(
        self,
        project_id: UUID,
        role: MessageRole,
        content: str,
        msg_type: MessageType = MessageType.TEXT,
        metadata: dict | None = None,
    ) -> ChatMessage:
        msg = ChatMessage(
            project_id=project_id,
            role=role,
            content=content,
            message_type=msg_type,
            metadata_=metadata or {},
        )
        self.db.add(msg)
        await flush_with_retry(self.db)
        return msg

    def _resolve_interaction_type(self, parsed: dict, options: list) -> str:
        interaction = str(parsed.get("interaction_type", "text"))
        if interaction == "single_choice" and len(options) > 6:
            return "dropdown"
        return interaction

    def _apply_category_to_state(
        self,
        state: dict,
        category: str,
        requirement_id: str,
        requirement_marked_done: bool,
        validation: dict | None,
    ) -> None:
        if category == "case_1" or requirement_marked_done:
            fulfilled = list(state.get("requirements_fulfilled", []))
            if requirement_id and requirement_id not in fulfilled:
                fulfilled.append(requirement_id)
            state["requirements_fulfilled"] = fulfilled
            state["requirement_in_progress"] = None
            state["answers_count"] = state.get("answers_count", 0) + 1
        elif category in ("case_2", "case_3"):
            state["requirement_in_progress"] = requirement_id
        elif category == "case_4":
            pass

        if validation and validation.get("consistency_issue"):
            state["requirement_in_progress"] = requirement_id

    async def _generate_response(
        self,
        project: Project,
        user_message: str,
        *,
        is_start: bool = False,
        pre_validation: dict | None = None,
        knowledge_cycle: dict | None = None,
    ) -> ChatMessage:
        state = self._get_interview_state(project)
        model = await self._get_or_create_process_model(project.id)
        ks = OrgKnowledgeService(self.db, self.llm)
        knowledge_state = ks.get_state(model.model_data)
        documents = (model.model_data or {}).get("sgq_documents", {})

        if is_start and user_message.startswith("[ONBOARDING COMPLETADO]"):
            user_message = (
                "[INICIO ENTREVISTA] Onboarding completado. "
                "Estado interno inicial cargado. Formular la primera pregunta de mayor valor "
                "para completar el SGQ según información pendiente."
            )
        elif is_start:
            user_message = "[INICIO DE ENTREVISTA] Comenzar levantamiento ISO 9001:2015."

        semantic_analysis = pre_validation
        if (
            not is_start
            and user_message
            and not user_message.startswith("[INICIO")
            and not user_message.startswith("[ONBOARDING")
            and pre_validation is None
        ):
            try:
                collected = await self._get_collected_information(project.id)
                recent = await self._get_chat_history(project.id, limit=8)
                semantic_analysis = await self._validate_answer_semantically(
                    state.get("last_question") or state.get("original_question", ""),
                    state.get("last_interaction_type", "text"),
                    user_message,
                    recent,
                    state.get("current_requirement_id", "4.1"),
                    collected,
                    state.get("requirements_fulfilled", []),
                )
            except LLMError:
                raise

        cycle = knowledge_cycle or {}
        cycle_summary = cycle.get("interpretation_summary") or "Sin actualización en este turno."
        if cycle.get("updated_documents"):
            cycle_summary += f" Documentos actualizados: {', '.join(cycle['updated_documents'])}."

        knowledge_progress = cycle.get("knowledge_completeness") or compute_completeness(knowledge_state)
        progress = max(state.get("progress_percent", 0), knowledge_progress)

        instructions = self._load_prompt("chat_conversational")
        prompt = instructions.format(
            iso_requirements=self._load_iso_requirements(),
            progress_percent=progress,
            requirements_fulfilled=", ".join(state.get("requirements_fulfilled", [])) or "Ninguno",
            requirement_in_progress=state.get("requirement_in_progress") or "Ninguno",
            semantic_analysis=self._format_semantic_analysis(semantic_analysis),
            org_knowledge_state=format_knowledge_compact(knowledge_state),
            pending_information=format_pending_for_prompt(knowledge_state),
            document_drafts_summary=format_drafts_summary(documents),
            knowledge_cycle_summary=cycle_summary,
            project_name=project.name or knowledge_state.get("general", {}).get("name") or "Sin nombre",
            chat_history=await self._get_chat_history(project.id, limit=8),
            user_message=user_message,
        )

        try:
            raw = await self.llm.generate(
                system=(
                    "Eres Processum S.A. Mantienes estado interno de la organización y construyes "
                    "documentación SGQ TO BE progresivamente. Formula la siguiente pregunta "
                    "más valiosa según información pendiente. No audites. SOLO JSON."
                ),
                user=prompt,
                json_mode=True,
                temperature=0.3,
            )
        except LLMError:
            raise
        parsed = self._parse_json(raw)

        reply = str(parsed.get("reply", "")).strip()
        clarification = str(parsed.get("clarification") or parsed.get("hint") or "").strip()
        options = list(parsed.get("options") or [])
        interaction = self._resolve_interaction_type(parsed, options)
        iso_clauses = parsed.get("iso_clauses") or []
        requirement_id = str(
            parsed.get("current_requirement_id")
            or state.get("current_requirement_id")
            or (iso_clauses[0] if iso_clauses else "4.1")
        )
        progress = max(
            int(parsed.get("progress_percent", state.get("progress_percent", 0))),
            knowledge_progress,
        )
        current_clause = str(parsed.get("current_clause", requirement_id.split(".")[0]))
        topics = parsed.get("topics_covered") or state.get("topics_covered", [])
        answer_summary = str(parsed.get("answer_summary", "")).strip()
        completed = bool(parsed.get("interview_completed", False))

        validation = semantic_analysis or {}
        category = str(
            parsed.get("response_category")
            or validation.get("response_category")
            or ("start" if is_start else "case_1")
        )
        requirement_marked_done = bool(parsed.get("requirement_marked_done", False))
        if category == "case_1":
            requirement_marked_done = True

        if not answer_summary and validation.get("interpreted_answer"):
            answer_summary = str(validation["interpreted_answer"]).strip()

        if category == "case_4":
            original = str(
                parsed.get("original_question_to_repeat")
                or state.get("original_question")
                or state.get("last_question")
                or ""
            ).strip()
            if original and original not in reply:
                if not reply:
                    reply = (
                        "Gracias por su respuesta. Sin embargo, esa información no corresponde "
                        "a lo que necesito en este momento. Permítame repetir la pregunta:\n\n"
                        f"{original}"
                    )
            answer_summary = ""

        if not is_start and answer_summary and category != "case_4":
            await self._record_answer(
                project.id, answer_summary, iso_clauses, requirement_id, category, validation,
            )

        self._apply_category_to_state(
            state, category, requirement_id, requirement_marked_done, validation,
        )

        if not reply:
            reply = "¿Podría ampliar esa información con más detalle?"

        state["active"] = True
        state["current_clause"] = current_clause
        state["current_requirement_id"] = requirement_id
        state["progress_percent"] = min(100, max(0, progress))
        state["topics_covered"] = topics
        state["knowledge_completeness"] = knowledge_progress
        state["draft_documents_count"] = len(documents)
        state["last_question"] = reply
        state["last_interaction_type"] = interaction
        state["last_semantic_validation"] = validation

        if category != "case_4" and not state.get("requirement_in_progress"):
            state["original_question"] = reply
        elif is_start:
            state["original_question"] = reply

        if is_start and not state.get("started_at"):
            state["started_at"] = datetime.now(timezone.utc).isoformat()
        if completed:
            state["completed"] = True
            state["completed_at"] = datetime.now(timezone.utc).isoformat()
            state["progress_percent"] = 100
            model = await self._get_or_create_process_model(project.id)
            data = dict(model.model_data or {})
            data["interview_completed_at"] = state["completed_at"]
            data["ready_for_sgq_generation"] = True
            model.model_data = data
            await flush_with_retry(self.db)

        await self._save_interview_state(project, state)

        has_options = interaction in INTERACTIVE_TYPES and interaction != "file_request"
        metadata = {
            "interaction_type": interaction,
            "options": options if has_options and interaction != "text" else [],
            "multi_select": interaction == "multi_choice",
            "hint": clarification,
            "progress_percent": state["progress_percent"],
            "knowledge_completeness": knowledge_progress,
            "updated_documents": cycle.get("updated_documents", []),
            "current_clause": current_clause,
            "is_welcome": is_start,
            "file_request": interaction == "file_request",
        }

        msg_type = MessageType.QUESTION if interaction != "text" or "?" in reply else MessageType.TEXT
        return await self._add_message(
            project.id, MessageRole.ASSISTANT, reply, msg_type, metadata,
        )

    async def start_interview(self, project_id: UUID) -> ChatMessage:
        project = await self.db.get(Project, project_id)
        if not project:
            raise ValueError("Proyecto no encontrado")
        if not self.llm.is_configured:
            return await self._add_message(
                project_id,
                MessageRole.ASSISTANT,
                "Configure GEMINI_API_KEY o OPENAI_API_KEY en backend/.env.",
            )

        state = self._default_state()
        state["active"] = True
        state["onboarding_step"] = "awaiting_ready"
        state["started_at"] = datetime.now(timezone.utc).isoformat()
        await self._save_interview_state(project, state)

        model = await self._get_or_create_process_model(project_id)
        ks = OrgKnowledgeService(self.db, self.llm)
        await ks.ensure_document_shells(model)

        metadata = {
            "interaction_type": "text",
            "options": [],
            "multi_select": False,
            "hint": "",
            "progress_percent": 0,
            "current_clause": "4",
            "is_welcome": True,
            "file_request": False,
            "onboarding_step": "awaiting_ready",
        }
        return await self._add_message(
            project_id,
            MessageRole.ASSISTANT,
            WELCOME_MESSAGE,
            MessageType.TEXT,
            metadata,
        )

    async def send_message(
        self,
        project_id: UUID,
        user_message: str,
        attachment_note: str = "",
    ) -> ChatMessage:
        project = await self.db.get(Project, project_id)
        if not project:
            raise ValueError("Proyecto no encontrado")

        state = self._get_interview_state(project)
        onboarding_step = state.get("onboarding_step", "awaiting_ready")
        in_onboarding = onboarding_step != "iso"

        llm_input = user_message.strip()
        if attachment_note:
            llm_input = (
                f"{llm_input}\n\n[Contenido del archivo adjunto]\n{attachment_note}"
                if llm_input
                else f"[Archivo adjunto]\n{attachment_note}"
            )

        display = user_message.strip()
        if attachment_note:
            short = attachment_note[:200] + "..." if len(attachment_note) > 200 else attachment_note
            display = f"{display}\n\n📎 {short}" if display else f"📎 {short}"

        pre_validation = None
        question_for_validation = state.get("original_question") or state.get("last_question")
        if not in_onboarding and llm_input and question_for_validation:
            collected = await self._get_collected_information(project_id)
            try:
                recent = await self._get_chat_history(project_id, limit=8)
                pre_validation = await self._validate_answer_semantically(
                    question_for_validation,
                    state.get("last_interaction_type", "text"),
                    llm_input,
                    recent,
                    state.get("current_requirement_id", "4.1"),
                    collected,
                    state.get("requirements_fulfilled", []),
                )
            except LLMError:
                await self._add_message(project_id, MessageRole.USER, display)
                await self.db.flush()
                raise

        await self._add_message(project_id, MessageRole.USER, display)

        if not self.llm.is_configured:
            return await self._add_message(
                project_id,
                MessageRole.ASSISTANT,
                "Configure GEMINI_API_KEY o OPENAI_API_KEY en backend/.env.",
            )

        if in_onboarding:
            onboarding_msg, iso_trigger = await self._handle_onboarding(project, state, llm_input or display)
            if onboarding_msg is not None:
                return onboarding_msg
            if iso_trigger:
                model = await self._get_or_create_process_model(project.id)
                ks = OrgKnowledgeService(self.db, self.llm)
                await ks.ensure_document_shells(model)
                await ks.update_progressive_drafts(
                    project, model, ONBOARDING_BOOTSTRAP_DOCS,
                    max_updates=PER_MESSAGE_MAX_DOC_UPDATES,
                )
                return await self._generate_response(
                    project, iso_trigger, is_start=True, pre_validation=None,
                )

        knowledge_cycle: dict = {}
        if llm_input and not llm_input.startswith("[ONBOARDING"):
            knowledge_cycle = await self._process_knowledge_cycle(
                project, llm_input, state, pre_validation,
            )

        if not state.get("active") and not llm_input:
            return await self._generate_response(project, "", is_start=True)

        return await self._generate_response(
            project,
            llm_input or "(mensaje vacío)",
            pre_validation=pre_validation,
            knowledge_cycle=knowledge_cycle,
        )

    def get_status(self, project: Project) -> dict:
        state = self._get_interview_state(project)
        return {
            "active": state.get("active", False),
            "completed": state.get("completed", False),
            "current_clause": state.get("current_clause"),
            "answered_count": state.get("answers_count", 0),
            "total_questions": len(state.get("requirements_fulfilled", [])),
            "progress_percent": state.get("progress_percent", 0),
            "topics_covered": state.get("topics_covered", []),
            "requirements_fulfilled": state.get("requirements_fulfilled", []),
            "requirement_in_progress": state.get("requirement_in_progress"),
            "clauses_progress": {},
            "last_interaction_type": state.get("last_interaction_type"),
            "onboarding_step": state.get("onboarding_step", "awaiting_ready"),
            "org_profile": state.get("org_profile", {}),
            "knowledge_completeness": state.get("knowledge_completeness", 0),
            "draft_documents_count": state.get("draft_documents_count", 0),
        }
