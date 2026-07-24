import asyncio
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID
from email.utils import parseaddr

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
from app.services.org_profile_extractor import (
    EMPLOYEE_SIZE_OPTIONS,
    extract_org_profile,
    missing_fields as org_missing_fields,
    match_employee_size,
)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

DIAGNOSIS_EVERY_N_ANSWERS = 5


async def _run_onboarding_docs_background(project_id: UUID) -> None:
    """Actualiza borradores iniciales sin bloquear la primera pregunta ISO."""
    await asyncio.sleep(3)  # deja que el chat use Groq primero
    async with async_session() as db:
        try:
            project = await db.get(Project, project_id)
            if not project:
                return
            from app.services.llm_service import LLMService
            llm = LLMService()
            if not llm.is_configured:
                return
            chat = ConversationalChatService(db)
            model = await chat._get_or_create_process_model(project_id)
            ks = OrgKnowledgeService(db, llm)
            await ks.ensure_document_shells(model)
            await ks.update_progressive_drafts(
                project, model, ONBOARDING_BOOTSTRAP_DOCS,
                max_updates=PER_MESSAGE_MAX_DOC_UPDATES,
            )
            await commit_checkpoint(db)
        except Exception:
            await safe_rollback(db)


async def _run_knowledge_cycle_background(
    project_id: UUID,
    user_message: str,
    last_question: str,
    last_interaction_type: str,
    answers_count: int,
) -> None:
    """Extracción + borradores en segundo plano para no tumbar el chat en Render/Groq."""
    await asyncio.sleep(4)  # prioriza la respuesta conversacional ante límites de Groq
    async with async_session() as db:
        try:
            project = await db.get(Project, project_id)
            if not project:
                return
            chat = ConversationalChatService(db)
            state = chat._get_interview_state(project)
            state["answers_count"] = answers_count
            state["last_question"] = last_question
            state["last_interaction_type"] = last_interaction_type
            await chat._process_knowledge_cycle(project, user_message, state, None)
            await commit_checkpoint(db)
        except Exception:
            await safe_rollback(db)


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

# Frases genéricas que no deben repetirse ni quedar como «última pregunta» atrapada.
GENERIC_DEEPEN_PHRASES = (
    "podria ampliar esa informacion con mas detalle",
    "podria ampliar un poco mas",
    "necesito un poco mas de detalle",
    "puede ampliar su respuesta",
    "puede dar mas detalles",
)

MAX_CLARIFY_ROUNDS = 1

RETRY_OPTION = "Reintentar"
API_RETRY_MESSAGE = (
    "No pude obtener la siguiente pregunta del modelo de IA en este momento.\n\n"
    "Pulsa «Reintentar» para continuar con la entrevista."
)

AFFIRMATIVE_PATTERNS = frozenset({
    "si", "yes", "ok", "okay", "dale", "claro", "listo", "adelante",
    "de acuerdo", "vamos", "empecemos", "comencemos", "estoy listo", "estoy lista",
    "por supuesto", "perfecto", "continua", "arranquemos", "iniciemos",
    "empezar", "comenzar", "listos", "listas", "afirmativo", "correcto", "bueno",
})

NEGATIVE_PATTERNS = frozenset({
    "no", "no por el momento", "ahora no", "despues", "más tarde", "mas tarde",
    "omitir", "saltar", "no quiero", "no gracias", "nop",
})

MEETING_DURATION_OPTIONS = ["30 minutos", "45 minutos", "60 minutos"]
MEETING_MODALITY_OPTIONS = ["Virtual", "Presencial"]
MEETING_TIME_OPTIONS = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00",
]


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
            "meeting_step": None,
            "meeting_request": {},
            "clarify_count": 0,
            "recent_questions": [],
            "recovery_asked": [],
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
        if not isinstance(answers, list):
            answers = list(answers.values()) if isinstance(answers, dict) else []
        if not answers:
            return "Ninguna información almacenada aún."
        lines = []
        for a in answers[-20:]:
            if not isinstance(a, dict):
                lines.append(f"- {a}")
                continue
            clauses = ", ".join(a.get("iso_clauses", []) or [])
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

    def _is_substantive_answer(self, text: str) -> bool:
        """Respuesta con contenido útil (no monosílabo ni vacía)."""
        cleaned = (text or "").strip()
        if not cleaned or self._is_short_answer(cleaned):
            return False
        # Opciones de onboarding / elección cerrada ya son suficientes
        if any(opt.lower() in cleaned.lower() for opt in EMPLOYEE_SIZE_OPTIONS):
            return True
        words = self._normalize_text(cleaned).split()
        if len(words) >= 4:
            return True
        if len(cleaned) >= 20:
            return True
        if re.search(r"\d", cleaned) and len(words) >= 2:
            return True
        return False

    def _is_generic_deepen(self, text: str) -> bool:
        if not text:
            return False
        normalized = self._normalize_text(text)
        return any(p in normalized for p in GENERIC_DEEPEN_PHRASES)

    def _question_tokens(self, text: str) -> set[str]:
        stop = {
            "de", "la", "el", "los", "las", "y", "o", "en", "por", "para", "un", "una",
            "su", "sus", "como", "que", "cual", "cuales", "son", "del", "al", "se",
            "con", "a", "es", "me", "nos", "le", "lo", "esto", "esta", "ese", "esa",
            "mas", "muy", "tambien", "sobre", "entre", "segun", "desde", "hacia",
            "terminos", "respecto",
        }
        return {
            w for w in self._normalize_text(text or "").split()
            if len(w) > 2 and w not in stop
        }

    def _is_similar_question(self, a: str, b: str, threshold: float = 0.5) -> bool:
        if not a or not b:
            return False
        na, nb = self._normalize_text(a), self._normalize_text(b)
        if na == nb or na in nb or nb in na:
            return True
        ta, tb = self._question_tokens(a), self._question_tokens(b)
        if not ta or not tb:
            return False
        overlap = len(ta & tb) / max(1, min(len(ta), len(tb)))
        return overlap >= threshold

    def _register_asked_question(self, state: dict, question: str) -> None:
        q = (question or "").strip()
        if not q:
            return
        recent = list(state.get("recent_questions") or [])
        recent.append(q)
        state["recent_questions"] = recent[-10:]

    def _was_question_already_asked(self, state: dict, question: str) -> bool:
        last = state.get("last_question") or ""
        recent = list(state.get("recent_questions") or [])
        candidates = [last, *recent]
        return any(self._is_similar_question(question, prev) for prev in candidates if prev)

    def _is_retry_request(self, text: str) -> bool:
        normalized = self._normalize_text(text or "")
        return normalized in {
            self._normalize_text(RETRY_OPTION),
            "reintentar",
            "reintentar pregunta",
            "continuar",
            "validar",
            "reintentar ahora",
        }

    async def _emit_api_retry(
        self,
        project: Project,
        state: dict,
        *,
        context: str,
        missing: list[str] | None = None,
        user_message: str | None = None,
        is_start: bool = False,
    ) -> ChatMessage:
        """Sin pregunta incrustada: solo aviso + botón Reintentar para volver a llamar al API."""
        state["awaiting_llm_retry"] = True
        state["retry_context"] = context
        if missing is not None:
            state["retry_missing"] = list(missing)
        if user_message is not None:
            state["retry_user_message"] = user_message
        state["last_question"] = API_RETRY_MESSAGE
        state["last_interaction_type"] = "single_choice"
        await self._save_interview_state(project, state)
        return await self._add_message(
            project.id,
            MessageRole.ASSISTANT,
            API_RETRY_MESSAGE,
            MessageType.QUESTION,
            {
                "interaction_type": "single_choice",
                "options": [RETRY_OPTION],
                "multi_select": False,
                "hint": "",
                "progress_percent": state.get("progress_percent", 0),
                "is_welcome": False,
                "file_request": False,
                "hide_clause": True,
                "llm_retry": True,
                "retry_context": context,
                "is_start": is_start,
            },
        )

    async def _llm_recovery_question(
        self,
        project: Project,
        state: dict,
        knowledge_state: dict | None,
    ) -> str | None:
        """Siguiente pregunta generada por API. None si el modelo no responde."""
        org_name = (
            (state.get("org_profile") or {}).get("org_name")
            or project.name
            or "la organización"
        )
        recent = "\n".join(f"- {q}" for q in (state.get("recent_questions") or [])[-6:]) or "- (ninguna)"
        covered = ", ".join(state.get("topics_covered") or []) or "Ninguno"
        template = self._load_prompt("chat_recovery")
        user = template.format(
            org_name=org_name,
            pending_information=format_pending_for_prompt(knowledge_state or {}),
            topics_covered=covered,
            recent_questions=recent,
        )
        parsed = await self._ask_llm_for_reply(
            system="Eres Processum S.A. Consultor ISO 9001. SOLO JSON válido.",
            user=user,
            temperature=0.35,
        )
        reply = str((parsed or {}).get("reply", "")).strip()
        if reply and not self._was_question_already_asked(state, reply) and not self._is_generic_deepen(reply):
            return reply
        parsed2 = await self._ask_llm_for_reply(
            system="SOLO JSON {\"reply\":\"pregunta corta nueva\"}",
            user=(
                f"Organización: {org_name}. Cubiertos: {covered}. "
                f"Pendiente: {format_pending_for_prompt(knowledge_state or {})}. "
                "Una pregunta distinta a las recientes. No pidas el nombre de la organización."
            ),
            temperature=0.4,
        )
        reply2 = str((parsed2 or {}).get("reply", "")).strip()
        if reply2 and not self._is_generic_deepen(reply2) and not self._asks_for_org_name(reply2):
            return reply2
        return None

    async def _llm_onboarding_question(
        self,
        project: Project,
        state: dict,
        missing: list[str],
    ) -> ChatMessage:
        """Pregunta de perfil vía API; nombre = proyecto (nunca se pide)."""
        org_profile = self._ensure_org_name_in_profile(project, state)
        org_name = (org_profile.get("org_name") or (project.name or "").strip() or "").strip()
        missing = [m for m in missing if m != "org_name"]
        if not missing:
            missing = [m for m in org_missing_fields(org_profile) if m != "org_name"] or [
                "main_activity",
                "employee_size",
            ]

        profile_txt = self._format_org_profile(org_profile)
        missing_txt = ", ".join(missing)
        template = self._load_prompt("chat_onboarding")
        parsed = await self._ask_llm_for_reply(
            system=(
                "Eres Processum S.A. Consultor cercano. SOLO JSON. "
                "PROHIBIDO pedir el nombre de la organización si ya está en el perfil. "
                "Usa viñetas en líneas separadas cuando pidas varios datos."
            ),
            user=template.format(org_profile=profile_txt, missing_fields=missing_txt),
            temperature=0.35,
        )
        reply = str((parsed or {}).get("reply", "")).strip()
        if not reply or self._asks_for_org_name(reply):
            return await self._emit_api_retry(
                project, state, context="onboarding", missing=missing,
            )

        interaction = str((parsed or {}).get("interaction_type") or "text")
        options = list((parsed or {}).get("options") or [])
        if missing == ["employee_size"] and not options:
            interaction = "single_choice"
            options = list(EMPLOYEE_SIZE_OPTIONS)
        if interaction == "single_choice" and not options:
            interaction = "text"

        state["awaiting_llm_retry"] = False
        return await self._ask_org_profile_prompt(
            project,
            state,
            reply,
            with_size_options=(interaction == "single_choice" and bool(options)),
            options_override=options if options else None,
        )

    async def _mark_answered_topic(
        self,
        project: Project,
        state: dict,
        last_question: str,
        user_message: str,
    ) -> None:
        """Tras una respuesta útil, saca el tema de pendientes para que el LLM no lo repita."""
        if not last_question or not self._is_substantive_answer(user_message):
            return
        tokens = self._question_tokens(last_question)
        if not tokens:
            return

        topic_labels = [
            ({"producto", "productos", "servicio", "servicios", "complejidad", "riesgo"}, "Productos y servicios ofrecidos"),
            ({"cliente", "clientes"}, "Principales clientes"),
            ({"proveedor", "proveedores"}, "Principales proveedores"),
            ({"proceso", "procesos"}, "Procesos principales y su clasificación"),
            ({"riesgo", "riesgos", "oportunidad", "oportunidades"}, "Riesgos y oportunidades"),
            ({"objetivo", "objetivos", "calidad"}, "Objetivos de calidad"),
            ({"indicador", "indicadores"}, "Indicadores y métodos de seguimiento"),
            ({"organigrama", "cargo", "cargos", "estructura"}, "Estructura organizacional y cargos"),
            ({"contexto", "interno", "externo"}, "Contexto interno y externo"),
            ({"alcance", "sgc"}, "Alcance del Sistema de Gestión de Calidad"),
        ]

        model = await self._get_or_create_process_model(project.id)
        data = dict(model.model_data or {})
        ks = dict(data.get("org_knowledge_state") or {})
        pending = [str(p) for p in (ks.get("pending_information") or [])]
        removed: list[str] = []

        for keys, label in topic_labels:
            if keys & tokens:
                before = len(pending)
                pending = [p for p in pending if label.lower() not in p.lower()]
                if len(pending) < before:
                    removed.append(label)

        kept = []
        for p in pending:
            if len(self._question_tokens(p) & tokens) >= 2:
                removed.append(p)
            else:
                kept.append(p)
        ks["pending_information"] = kept
        data["org_knowledge_state"] = ks
        model.model_data = data
        await flush_with_retry(self.db)

        covered = list(state.get("topics_covered") or [])
        for item in removed:
            if item not in covered:
                covered.append(item)
        asked_sigs = list(state.get("answered_question_sigs") or [])
        sig = " ".join(sorted(tokens)[:12])
        if sig and sig not in asked_sigs:
            asked_sigs.append(sig)
        state["answered_question_sigs"] = asked_sigs[-30:]
        state["topics_covered"] = covered[-40:]

    async def _ask_llm_for_reply(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.3,
    ) -> dict:
        """Llama al LLM y parsea JSON; reintenta una vez con prompt corto si falla."""
        raw = ""
        try:
            raw = await self.llm.generate(
                system=system, user=user, json_mode=True, temperature=temperature,
            )
        except LLMError:
            short_user = user[-2500:] if len(user) > 2500 else user
            try:
                await asyncio.sleep(1.2)
                raw = await self.llm.generate(
                    system=system,
                    user=short_user + "\n\nResponde SOLO JSON con campo reply (pregunta corta).",
                    json_mode=True,
                    temperature=0.2,
                )
            except LLMError:
                return {}

        try:
            parsed = self._parse_json(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        # Segundo intento: pedir solo la pregunta
        try:
            await asyncio.sleep(0.8)
            raw2 = await self.llm.generate(
                system="Eres un consultor ISO 9001. Responde SOLO JSON: {\"reply\":\"pregunta corta\",\"response_category\":\"case_1\"}",
                user="Con el contexto anterior, formula la siguiente pregunta más útil para el SGQ. No repitas datos ya conocidos.",
                json_mode=True,
                temperature=0.2,
            )
            parsed2 = self._parse_json(raw2)
            if isinstance(parsed2, dict):
                return parsed2
        except Exception:
            return {}
        return {}

    def _should_force_advance(
        self,
        state: dict,
        category: str,
        user_message: str,
        *,
        is_start: bool,
    ) -> bool:
        if is_start or category == "case_4":
            return False
        clarify_count = int(state.get("clarify_count") or 0)
        last_q = str(state.get("last_question") or "")
        substantive = self._is_substantive_answer(user_message)

        # Ya se pidió ampliación una vez y el usuario aportó detalle → avanzar
        if clarify_count >= MAX_CLARIFY_ROUNDS and substantive:
            return True
        if clarify_count >= MAX_CLARIFY_ROUNDS + 1:
            return True
        # Si la última pregunta fue el fallback genérico y hay contenido, no repetir
        if self._is_generic_deepen(last_q) and substantive:
            return True
        # Segunda profundización sobre el mismo requisito
        if state.get("requirement_in_progress") and clarify_count >= MAX_CLARIFY_ROUNDS and substantive:
            return True
        return False

    def _resolve_category_for_fluidity(
        self,
        state: dict,
        category: str,
        user_message: str,
        validation: dict | None,
        *,
        is_start: bool,
    ) -> str:
        if self._should_force_advance(state, category, user_message, is_start=is_start):
            if validation is not None:
                validation["response_category"] = "case_1"
                validation["sufficiency"] = "sufficient"
                validation["recommended_action"] = "advance"
                validation["forced_advance"] = True
            return "case_1"
        # Tras una respuesta sustancial a pregunta concreta, no insistir en case_2
        if (
            category in ("case_2", "case_3")
            and self._is_substantive_answer(user_message)
            and int(state.get("clarify_count") or 0) >= MAX_CLARIFY_ROUNDS
        ):
            return "case_1"
        return category

    def _normalize_text(self, text: str) -> str:
        t = unicodedata.normalize("NFKC", text.strip().lower())
        t = "".join(
            c for c in unicodedata.normalize("NFD", t)
            if unicodedata.category(c) != "Mn"
        )
        t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
        return re.sub(r"\s+", " ", t).strip()

    def _is_affirmative(self, text: str) -> bool:
        normalized = self._normalize_text(text)
        if not normalized:
            return False
        # Solo afirmaciones claras (botón «Sí» / frases cortas de confirmación).
        # Evita marcar nombres de empresa u oraciones largas como «sí».
        if normalized in AFFIRMATIVE_PATTERNS or normalized.rstrip(".") in AFFIRMATIVE_PATTERNS:
            return True
        words = normalized.split()
        if len(words) == 1 and words[0] in AFFIRMATIVE_PATTERNS:
            return True
        if len(words) <= 3 and words[0] in AFFIRMATIVE_PATTERNS:
            return True
        short_phrases = {
            "de acuerdo", "por supuesto", "estoy listo", "estoy lista",
            "creo que si", "si claro", "si listo", "si adelante",
        }
        return normalized in short_phrases

    def _is_negative(self, text: str) -> bool:
        normalized = self._normalize_text(text)
        if not normalized:
            return False
        if normalized in NEGATIVE_PATTERNS:
            return True
        return any(normalized.startswith(f"{p} ") or normalized == p for p in NEGATIVE_PATTERNS)

    def _is_valid_email(self, text: str) -> bool:
        value = text.strip()
        if "@" not in value or "." not in value.split("@")[-1]:
            return False
        _, addr = parseaddr(value)
        return bool(addr and "@" in addr)

    def _meeting_active(self, state: dict) -> bool:
        step = state.get("meeting_step")
        return bool(step) and step not in ("done", "skipped")

    async def _ask_meeting_step(self, project: Project, state: dict, step: str) -> ChatMessage:
        state["meeting_step"] = step
        await self._save_interview_state(project, state)

        specs = {
            "ask_interest": {
                "text": "¿Deseas agendar una reunión?",
                "interaction_type": "single_choice",
                "options": ["Sí", "No por el momento"],
            },
            "modality": {
                "text": "¿Qué modalidad prefieres para la reunión?",
                "interaction_type": "single_choice",
                "options": MEETING_MODALITY_OPTIONS,
            },
            "duration": {
                "text": "¿Cuál es la duración deseada de la reunión?",
                "interaction_type": "single_choice",
                "options": MEETING_DURATION_OPTIONS,
            },
            "date": {
                "text": "Selecciona la fecha disponible para la reunión.",
                "interaction_type": "date",
                "options": [],
            },
            "time": {
                "text": "Selecciona la hora disponible.",
                "interaction_type": "single_choice",
                "options": MEETING_TIME_OPTIONS,
            },
            "email": {
                "text": "Indica el correo electrónico de contacto para confirmar la reunión.",
                "interaction_type": "text",
                "options": [],
            },
            "phone": {
                "text": "Número de contacto (opcional). Puedes escribirlo o responder «Omitir».",
                "interaction_type": "text",
                "options": ["Omitir"],
            },
            "topic": {
                "text": "¿Hay algún tema específico que deseas tratar durante la reunión?",
                "interaction_type": "text",
                "options": ["Sin tema específico"],
            },
        }
        spec = specs[step]
        metadata = {
            "interaction_type": spec["interaction_type"],
            "options": spec["options"],
            "multi_select": False,
            "hint": "",
            "progress_percent": state.get("progress_percent", 100),
            "is_welcome": False,
            "file_request": False,
            "meeting_step": step,
            "hide_clause": True,
        }
        msg_type = MessageType.QUESTION if spec["interaction_type"] != "text" or "?" in spec["text"] else MessageType.TEXT
        if spec["interaction_type"] in ("single_choice", "date") or spec["options"]:
            msg_type = MessageType.QUESTION
        return await self._add_message(
            project.id, MessageRole.ASSISTANT, spec["text"], msg_type, metadata,
        )

    async def _complete_meeting(
        self,
        project: Project,
        state: dict,
        *,
        skipped: bool = False,
    ) -> ChatMessage:
        meeting = dict(state.get("meeting_request") or {})
        if skipped:
            state["meeting_step"] = "skipped"
            reply = (
                "Entendido. No agendaremos una reunión por ahora.\n\n"
                "Cuando lo desees, Processum S.A. estará disponible para acompañarte "
                "en consultorías y capacitación en SGC."
            )
        else:
            state["meeting_step"] = "done"
            phone = meeting.get("phone") or "No indicado"
            topic = meeting.get("topic") or "Sin tema específico"
            reply = (
                "¡Listo! Registramos tu solicitud de reunión con Processum S.A.\n\n"
                f"• Modalidad: {meeting.get('modality', '—')}\n"
                f"• Duración: {meeting.get('duration', '—')}\n"
                f"• Fecha: {meeting.get('date', '—')}\n"
                f"• Hora: {meeting.get('time', '—')}\n"
                f"• Correo: {meeting.get('email', '—')}\n"
                f"• Contacto: {phone}\n"
                f"• Tema: {topic}\n\n"
                "El equipo de Processum se pondrá en contacto para confirmar la reunión."
            )

        model = await self._get_or_create_process_model(project.id)
        data = dict(model.model_data or {})
        data["meeting_request"] = {
            **meeting,
            "status": "skipped" if skipped else "requested",
            "requested_at": datetime.now(timezone.utc).isoformat(),
        }
        model.model_data = data
        await flush_with_retry(self.db)
        await self._save_interview_state(project, state)
        return await self._add_message(
            project.id,
            MessageRole.ASSISTANT,
            reply,
            MessageType.TEXT,
            {
                "interaction_type": "text",
                "options": [],
                "multi_select": False,
                "progress_percent": 100,
                "meeting_step": state["meeting_step"],
                "hide_clause": True,
            },
        )

    async def _handle_meeting_schedule(
        self,
        project: Project,
        state: dict,
        user_message: str,
    ) -> ChatMessage:
        step = state.get("meeting_step") or "ask_interest"
        answer = user_message.strip()
        meeting = dict(state.get("meeting_request") or {})

        if step == "ask_interest":
            if self._is_negative(answer) or answer.lower() == "no por el momento":
                return await self._complete_meeting(project, state, skipped=True)
            if not self._is_affirmative(answer) and answer.lower() not in ("sí", "si"):
                return await self._ask_meeting_step(project, state, "ask_interest")
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "modality")

        if step == "modality":
            matched = next((o for o in MEETING_MODALITY_OPTIONS if o.lower() == answer.lower()), None)
            if not matched:
                return await self._ask_meeting_step(project, state, "modality")
            meeting["modality"] = matched
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "duration")

        if step == "duration":
            matched = next((o for o in MEETING_DURATION_OPTIONS if o.lower() == answer.lower()), None)
            if not matched:
                return await self._ask_meeting_step(project, state, "duration")
            meeting["duration"] = matched
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "date")

        if step == "date":
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", answer):
                reply = "Por favor selecciona una fecha válida en el calendario."
                await self._add_message(project.id, MessageRole.ASSISTANT, reply, MessageType.TEXT, {
                    "interaction_type": "text", "options": [], "hide_clause": True,
                })
                return await self._ask_meeting_step(project, state, "date")
            meeting["date"] = answer
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "time")

        if step == "time":
            matched = next((o for o in MEETING_TIME_OPTIONS if o == answer or o in answer), None)
            if not matched and re.match(r"^\d{1,2}:\d{2}$", answer):
                matched = answer
            if not matched:
                return await self._ask_meeting_step(project, state, "time")
            meeting["time"] = matched
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "email")

        if step == "email":
            if not self._is_valid_email(answer):
                reply = "Necesito un correo electrónico válido para confirmar la reunión."
                await self._add_message(project.id, MessageRole.ASSISTANT, reply, MessageType.TEXT, {
                    "interaction_type": "text", "options": [], "hide_clause": True,
                })
                return await self._ask_meeting_step(project, state, "email")
            meeting["email"] = answer.strip()
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "phone")

        if step == "phone":
            if self._normalize_text(answer) in ("omitir", "skip", "ninguno", "no"):
                meeting["phone"] = None
            else:
                meeting["phone"] = answer.strip()
            state["meeting_request"] = meeting
            return await self._ask_meeting_step(project, state, "topic")

        if step == "topic":
            if self._normalize_text(answer) in ("sin tema especifico", "ninguno", "omitir", "no"):
                meeting["topic"] = "Sin tema específico"
            else:
                meeting["topic"] = answer.strip()
            state["meeting_request"] = meeting
            return await self._complete_meeting(project, state, skipped=False)

        return await self._ask_meeting_step(project, state, "ask_interest")

    def _match_employee_size(self, text: str) -> str | None:
        return match_employee_size(text)

    def _format_org_profile(self, org_profile: dict) -> str:
        if not org_profile:
            return "Los datos iniciales se recopilarán al inicio de la conversación."
        lines = []
        if org_profile.get("org_name"):
            lines.append(f"- Nombre de la organización: {org_profile['org_name']}")
        if org_profile.get("main_activity"):
            lines.append(f"- Actividad principal: {org_profile['main_activity']}")
        if org_profile.get("employee_size"):
            lines.append(f"- Tamaño: {org_profile['employee_size']}")
        return "\n".join(lines) if lines else "Los datos iniciales se recopilarán al inicio de la conversación."

    def _ensure_org_name_in_profile(self, project: Project, state: dict) -> dict:
        """Usa siempre el nombre del proyecto como organización si existe."""
        org_profile = dict(state.get("org_profile") or {})
        project_name = (project.name or "").strip()
        if project_name:
            # El nombre del proyecto manda: no se vuelve a preguntar
            org_profile["org_name"] = project_name
            state["org_profile"] = org_profile
        return org_profile

    def _asks_for_org_name(self, text: str) -> bool:
        return bool(
            re.search(
                r"(nombre\s+(completo\s+)?(de\s+)?(la\s+)?(organizaci[oó]n|empresa)|"
                r"c[oó]mo\s+se\s+llama\s+(su|la)\s+(organizaci[oó]n|empresa)|"
                r"•\s*nombre\s+de\s+la\s+empresa)",
                text or "",
                re.IGNORECASE,
            )
        )

    async def _ask_org_profile_prompt(
        self,
        project: Project,
        state: dict,
        prompt: str,
        *,
        with_size_options: bool = False,
        options_override: list[str] | None = None,
    ) -> ChatMessage:
        org_profile = self._ensure_org_name_in_profile(project, state)
        org_name = (org_profile.get("org_name") or (project.name or "").strip() or "").strip()
        if self._asks_for_org_name(prompt):
            missing = [
                m for m in org_missing_fields(org_profile) if m != "org_name"
            ] or ["main_activity", "employee_size"]
            return await self._emit_api_retry(
                project, state, context="onboarding", missing=missing,
            )

        state["onboarding_step"] = "collect_org_profile"
        state["active"] = True
        state["awaiting_llm_retry"] = False
        state["last_question"] = prompt
        state["last_interaction_type"] = "single_choice" if with_size_options else "text"
        state["original_question"] = prompt
        await self._save_interview_state(project, state)

        if options_override is not None:
            options = list(options_override)
        else:
            options = list(EMPLOYEE_SIZE_OPTIONS) if with_size_options else []
        interaction = "single_choice" if options else "text"
        state["last_interaction_type"] = interaction
        metadata = {
            "interaction_type": interaction,
            "options": options,
            "multi_select": False,
            "hint": "",
            "progress_percent": state.get("progress_percent", 0),
            "is_welcome": False,
            "file_request": False,
            "onboarding_step": "collect_org_profile",
            "hide_clause": True,
            "locked_org_name": org_name or None,
        }
        msg_type = MessageType.QUESTION if options or "?" in prompt else MessageType.TEXT
        return await self._add_message(
            project.id, MessageRole.ASSISTANT, prompt, msg_type, metadata,
        )

    async def _handle_onboarding(
        self,
        project: Project,
        state: dict,
        user_message: str,
    ) -> tuple[ChatMessage | None, str | None]:
        """Bienvenida + captura de perfil (preguntas LLM; extracción local de respuestas)."""
        step = state.get("onboarding_step", "awaiting_ready")
        if step == "iso":
            return None, None

        answer = user_message.strip()
        org_profile = self._ensure_org_name_in_profile(project, state)

        if step == "awaiting_ready":
            if self._is_negative(answer):
                reply = (
                    "Sin problema. Cuando quieras iniciar la entrevista con Processum S.A., "
                    "responde «Sí» o pulsa el botón correspondiente."
                )
                metadata = {
                    "interaction_type": "single_choice",
                    "options": ["Sí", "No por el momento"],
                    "multi_select": False,
                    "hint": "",
                    "progress_percent": 0,
                    "is_welcome": True,
                    "file_request": False,
                    "onboarding_step": "awaiting_ready",
                    "hide_clause": True,
                }
                await self._save_interview_state(project, state)
                return await self._add_message(
                    project.id, MessageRole.ASSISTANT, reply, MessageType.QUESTION, metadata,
                ), None
            if not self._is_affirmative(answer):
                reply = (
                    "Para continuar, confirma si deseas iniciar la entrevista con Processum S.A.\n\n"
                    "¿Estás listo para comenzar?"
                )
                metadata = {
                    "interaction_type": "single_choice",
                    "options": ["Sí", "No por el momento"],
                    "multi_select": False,
                    "hint": "",
                    "progress_percent": 0,
                    "is_welcome": True,
                    "file_request": False,
                    "onboarding_step": "awaiting_ready",
                    "hide_clause": True,
                }
                await self._save_interview_state(project, state)
                return await self._add_message(
                    project.id, MessageRole.ASSISTANT, reply, MessageType.QUESTION, metadata,
                ), None
            if not state.get("started_at"):
                state["started_at"] = datetime.now(timezone.utc).isoformat()
            await self._save_interview_state(project, state)
            missing = [m for m in org_missing_fields(org_profile) if m != "org_name"]
            if not missing:
                missing = ["main_activity", "employee_size"]
            msg = await self._llm_onboarding_question(project, state, missing)
            return msg, None

        # Pasos legacy: migrar a captura abierta
        if step in ("q_org_name", "q_main_activity", "q_employees"):
            state["onboarding_step"] = "collect_org_profile"
            step = "collect_org_profile"

        if step == "collect_org_profile":
            if len(answer) < 2:
                missing = [m for m in org_missing_fields(org_profile) if m != "org_name"]
                if not missing:
                    missing = ["main_activity", "employee_size"]
                msg = await self._llm_onboarding_question(project, state, missing)
                return msg, None

            before = dict(org_profile)
            # Conservar SIEMPRE el nombre del proyecto; el chat no lo cambia
            org_profile = extract_org_profile(answer, org_profile)
            project_name = (project.name or "").strip()
            if project_name:
                org_profile["org_name"] = project_name
            state["org_profile"] = org_profile
            await self._sync_onboarding_knowledge(project, org_profile)

            # No registrar cambios de nombre desde el chat (el recuadro Organización es fijo)
            if org_profile.get("main_activity") and org_profile.get("main_activity") != before.get("main_activity"):
                await self._record_answer(
                    project.id,
                    f"Actividad principal: {org_profile['main_activity']}",
                    ["4.1"],
                    "onboarding.main_activity",
                    "case_1",
                )
            if org_profile.get("employee_size") and org_profile.get("employee_size") != before.get("employee_size"):
                await self._record_answer(
                    project.id,
                    f"Tamaño: {org_profile['employee_size']}",
                    ["4.1"],
                    "onboarding.employee_size",
                    "case_1",
                )

            missing = [m for m in org_missing_fields(org_profile) if m != "org_name"]
            if missing:
                msg = await self._llm_onboarding_question(project, state, missing)
                return msg, None

            state["onboarding_step"] = "iso"
            await self._save_interview_state(project, state)
            iso_trigger = (
                "[ONBOARDING COMPLETADO] Datos iniciales registrados. "
                f"Organización: {org_profile.get('org_name', '')}. "
                f"Actividad: {org_profile.get('main_activity', '')}. "
                f"Tamaño: {org_profile.get('employee_size', '')}. "
                "Iniciar entrevista ISO 9001:2015. NO vuelvas a preguntar nombre, "
                "actividad principal ni tamaño de la organización; ya están capturados. "
                "Formula la siguiente pregunta de mayor valor para el SGQ."
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
        elif self._is_substantive_answer(user_answer) and self._is_generic_deepen(last_question):
            # El usuario ya amplió tras un pedido de detalle → aceptar y avanzar
            validation["response_category"] = "case_1"
            validation["sufficiency"] = "sufficient"
            validation["recommended_action"] = "advance"
            validation["requirement_can_be_marked_done"] = True

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
            state["clarify_count"] = 0
            state["answers_count"] = state.get("answers_count", 0) + 1
        elif category in ("case_2", "case_3"):
            state["requirement_in_progress"] = requirement_id
            state["clarify_count"] = int(state.get("clarify_count") or 0) + 1
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

        if not is_start and user_message and not user_message.startswith("["):
            await self._mark_answered_topic(
                project, state, state.get("last_question") or "", user_message,
            )
            # refrescar estado de conocimiento tras marcar pendientes
            knowledge_state = ks.get_state(model.model_data)
            documents = (model.model_data or {}).get("sgq_documents", {})

        recent_block = "\n".join(
            f"- {q}" for q in (state.get("recent_questions") or [])[-5:]
        ) or "- (ninguna aún)"
        covered_block = ", ".join(state.get("topics_covered") or []) or "Ninguno"

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
            chat_history=await self._get_chat_history(project.id, limit=6),
            user_message=user_message,
        )
        prompt += (
            f"\n\n# PREGUNTAS RECIENTES (NO REPETIR NI PARAFASEAR)\n{recent_block}\n"
            f"# TEMAS YA CUBIERTOS\n{covered_block}\n"
            "Si el usuario ya respondió sobre productos/servicios, clientes, procesos u otro tema, "
            "avanza a un pendiente DISTINTO.\n"
        )

        system_msg = (
            "Eres Processum S.A. Mantienes estado interno de la organización y construyes "
            "documentación SGQ TO BE progresivamente. Formula la siguiente pregunta "
            "más valiosa según información pendiente. No audites. SOLO JSON."
        )
        parsed = await self._ask_llm_for_reply(system=system_msg, user=prompt, temperature=0.3)
        if not parsed:
            recovery = await self._llm_recovery_question(project, state, knowledge_state)
            if recovery:
                state["awaiting_llm_retry"] = False
                state["active"] = True
                state["last_question"] = recovery
                state["last_interaction_type"] = "text"
                self._register_asked_question(state, recovery)
                await self._save_interview_state(project, state)
                return await self._add_message(
                    project.id,
                    MessageRole.ASSISTANT,
                    recovery,
                    MessageType.QUESTION,
                    {
                        "interaction_type": "text",
                        "options": [],
                        "multi_select": False,
                        "progress_percent": state.get("progress_percent", 0),
                    },
                )
            return await self._emit_api_retry(
                project,
                state,
                context="iso",
                user_message=user_message,
                is_start=is_start,
            )

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
        category = self._resolve_category_for_fluidity(
            state, category, user_message, validation, is_start=is_start,
        )
        requirement_marked_done = bool(parsed.get("requirement_marked_done", False))
        if category == "case_1":
            requirement_marked_done = True

        if not answer_summary and validation.get("interpreted_answer"):
            answer_summary = str(validation["interpreted_answer"]).strip()
        if not answer_summary and not is_start and category != "case_4":
            answer_summary = user_message.strip()[:400]

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

        # Si el modelo insiste en case_2/3 tras el tope, forzar avance antes de guardar estado
        if (
            category in ("case_2", "case_3")
            and int(state.get("clarify_count") or 0) >= MAX_CLARIFY_ROUNDS
            and self._is_substantive_answer(user_message)
        ):
            category = "case_1"
            requirement_marked_done = True

        self._apply_category_to_state(
            state, category, requirement_id, requirement_marked_done, validation,
        )

        # Si el modelo devolvió vacío, genérico o repetido: recovery API o botón Reintentar
        if not reply or self._is_generic_deepen(reply):
            recovery = await self._llm_recovery_question(project, state, knowledge_state)
            if recovery:
                reply = recovery
            else:
                return await self._emit_api_retry(
                    project,
                    state,
                    context="iso",
                    user_message=user_message,
                    is_start=is_start,
                )

        original_llm_reply = str(parsed.get("reply", "")).strip()
        if original_llm_reply and self._was_question_already_asked(state, original_llm_reply):
            category = "case_1"
            state["requirement_in_progress"] = None
            state["clarify_count"] = 0
            recovery = await self._llm_recovery_question(project, state, knowledge_state)
            if recovery:
                reply = recovery
            else:
                return await self._emit_api_retry(
                    project,
                    state,
                    context="iso",
                    user_message=user_message,
                    is_start=is_start,
                )
        elif self._was_question_already_asked(state, reply):
            recovery = await self._llm_recovery_question(project, state, knowledge_state)
            if recovery:
                reply = recovery
            else:
                return await self._emit_api_retry(
                    project,
                    state,
                    context="iso",
                    user_message=user_message,
                    is_start=is_start,
                )
        if not reply:
            return await self._emit_api_retry(
                project,
                state,
                context="iso",
                user_message=user_message,
                is_start=is_start,
            )
        state["awaiting_llm_retry"] = False
        self._register_asked_question(state, reply)

        state["active"] = True
        state["current_clause"] = current_clause
        state["current_requirement_id"] = requirement_id
        state["progress_percent"] = min(100, max(0, progress))
        merged_topics = list(dict.fromkeys(list(state.get("topics_covered") or []) + list(topics or [])))
        state["topics_covered"] = merged_topics[-40:]
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

            # Al finalizar la entrevista ISO, iniciar agendamiento condicional
            if not state.get("meeting_step"):
                state["meeting_step"] = "ask_interest"
                await self._save_interview_state(project, state)
                if reply.strip():
                    await self._add_message(
                        project.id,
                        MessageRole.ASSISTANT,
                        reply,
                        MessageType.TEXT,
                        {
                            "interaction_type": "text",
                            "options": [],
                            "progress_percent": 100,
                            "hide_clause": True,
                        },
                    )
                return await self._ask_meeting_step(project, state, "ask_interest")

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

        # Limpiar historial previo para no mostrar preguntas viejas (ej. pedir nombre)
        old_msgs = await self.db.execute(
            select(ChatMessage).where(ChatMessage.project_id == project_id)
        )
        for msg in old_msgs.scalars().all():
            await self.db.delete(msg)
        await flush_with_retry(self.db)

        # Conservar perfil previo; el nombre del proyecto siempre prevalece
        previous = self._get_interview_state(project)
        prev_profile = dict(previous.get("org_profile") or {})
        # Al reiniciar, conservar solo el nombre del proyecto (no actividad/tamaño viejos a medias)
        project_name = (project.name or "").strip()
        prev_profile = {"org_name": project_name} if project_name else {}

        state = self._default_state()
        state["active"] = True
        state["onboarding_step"] = "awaiting_ready"
        state["started_at"] = datetime.now(timezone.utc).isoformat()
        state["org_profile"] = prev_profile
        await self._save_interview_state(project, state)

        model = await self._get_or_create_process_model(project_id)
        ks = OrgKnowledgeService(self.db, self.llm)
        await ks.ensure_document_shells(model)
        if prev_profile.get("org_name"):
            await ks.apply_onboarding(model, prev_profile)

        metadata = {
            "interaction_type": "single_choice",
            "options": ["Sí", "No por el momento"],
            "multi_select": False,
            "hint": "",
            "progress_percent": 0,
            "current_clause": "4",
            "is_welcome": True,
            "file_request": False,
            "onboarding_step": "awaiting_ready",
            "hide_clause": True,
        }

        org_name = (prev_profile.get("org_name") or project.name or "").strip() or "la organización"
        try:
            template = self._load_prompt("chat_welcome")
            parsed = await self._ask_llm_for_reply(
                system="Eres Processum S.A. Consultor ISO 9001. SOLO JSON.",
                user=template.format(org_name=org_name),
                temperature=0.35,
            )
            welcome = str((parsed or {}).get("reply", "")).strip()
            if welcome:
                opts = list((parsed or {}).get("options") or [])
                if opts:
                    metadata["options"] = opts
                state["awaiting_llm_retry"] = False
                await self._save_interview_state(project, state)
                return await self._add_message(
                    project_id,
                    MessageRole.ASSISTANT,
                    welcome,
                    MessageType.QUESTION,
                    metadata,
                )
        except Exception:
            pass

        return await self._emit_api_retry(
            project, state, context="welcome", is_start=True,
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
        # El nombre del proyecto siempre alimenta el perfil (evita repreguntar organización)
        self._ensure_org_name_in_profile(project, state)
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
        # En Groq/OpenAI omitimos validación previa para no gastar cuota antes de la pregunta
        # (era una causa frecuente de caídas a preguntas de respaldo).
        question_for_validation = state.get("original_question") or state.get("last_question")
        meeting_pending = self._meeting_active(state) or (
            bool(state.get("completed")) and not state.get("meeting_step")
        )
        use_prevalidation = (
            self.llm.provider == "gemini"
            and not in_onboarding
            and not meeting_pending
            and bool(llm_input)
            and bool(question_for_validation)
        )
        if use_prevalidation:
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

        # Botón Reintentar: vuelve a pedir la pregunta al API (sin preguntas incrustadas)
        if self._is_retry_request(llm_input or display):
            ctx = state.get("retry_context") or ("onboarding" if in_onboarding else "iso")
            if ctx == "welcome":
                    # Regenerar bienvenida vía API
                    org_name = (
                        (state.get("org_profile") or {}).get("org_name")
                        or project.name
                        or "la organización"
                    )
                    try:
                        template = self._load_prompt("chat_welcome")
                        parsed = await self._ask_llm_for_reply(
                            system="Eres Processum S.A. Consultor ISO 9001. SOLO JSON.",
                            user=template.format(org_name=org_name),
                            temperature=0.35,
                        )
                        welcome = str((parsed or {}).get("reply", "")).strip()
                        if welcome:
                            state["awaiting_llm_retry"] = False
                            state["onboarding_step"] = "awaiting_ready"
                            await self._save_interview_state(project, state)
                            return await self._add_message(
                                project_id,
                                MessageRole.ASSISTANT,
                                welcome,
                                MessageType.QUESTION,
                                {
                                    "interaction_type": "single_choice",
                                    "options": list((parsed or {}).get("options") or ["Sí", "No por el momento"]),
                                    "multi_select": False,
                                    "progress_percent": 0,
                                    "is_welcome": True,
                                    "onboarding_step": "awaiting_ready",
                                    "hide_clause": True,
                                },
                            )
                    except Exception:
                        pass
                    return await self._emit_api_retry(project, state, context="welcome", is_start=True)

            if ctx == "onboarding":
                    missing = list(state.get("retry_missing") or [])
                    if not missing:
                        org_profile = self._ensure_org_name_in_profile(project, state)
                        missing = [m for m in org_missing_fields(org_profile) if m != "org_name"] or [
                            "main_activity",
                            "employee_size",
                        ]
                    return await self._llm_onboarding_question(project, state, missing)

            # iso / default
            retry_msg = (
                state.get("retry_user_message")
                or state.get("last_real_user_message")
                or ""
            )
            return await self._generate_response(
                project,
                retry_msg or "[REINTENTAR SIGUIENTE PREGUNTA]",
                is_start=False,
                pre_validation=None,
                knowledge_cycle={},
            )

        if not self.llm.is_configured:
            return await self._add_message(
                project_id,
                MessageRole.ASSISTANT,
                "Configure GEMINI_API_KEY o OPENAI_API_KEY en backend/.env.",
            )

        # Flujo post-entrevista: agendar reunión (condicional)
        if self._meeting_active(state):
            return await self._handle_meeting_schedule(project, state, llm_input or display)

        if state.get("completed") and not state.get("meeting_step"):
            state["meeting_step"] = "ask_interest"
            await self._save_interview_state(project, state)
            return await self._ask_meeting_step(project, state, "ask_interest")

        if in_onboarding:
            onboarding_msg, iso_trigger = await self._handle_onboarding(project, state, llm_input or display)
            if onboarding_msg is not None:
                return onboarding_msg
            if iso_trigger:
                model = await self._get_or_create_process_model(project.id)
                ks = OrgKnowledgeService(self.db, self.llm)
                await ks.ensure_document_shells(model)
                # Documentos en background: evita timeout Render/Groq en el primer turno ISO
                asyncio.create_task(_run_onboarding_docs_background(project.id))
                return await self._generate_response(
                    project, iso_trigger, is_start=True, pre_validation=None,
                )

        # Priorizar respuesta del chat; extracción/documentos en segundo plano
        if (
            llm_input
            and not llm_input.startswith("[ONBOARDING")
            and not llm_input.startswith("[INICIO")
        ):
            asyncio.create_task(
                _run_knowledge_cycle_background(
                    project.id,
                    llm_input,
                    state.get("last_question", "") or "",
                    state.get("last_interaction_type", "text") or "text",
                    int(state.get("answers_count") or 0),
                )
            )

        if not state.get("active") and not llm_input:
            return await self._generate_response(project, "", is_start=True)

        if llm_input and not self._is_retry_request(llm_input):
            state["last_real_user_message"] = llm_input
            state["retry_user_message"] = llm_input
            await self._save_interview_state(project, state)

        return await self._generate_response(
            project,
            llm_input or "(mensaje vacío)",
            pre_validation=pre_validation,
            knowledge_cycle={},
        )

    def get_status(self, project: Project) -> dict:
        state = self._get_interview_state(project)
        org_profile = dict(state.get("org_profile") or {})
        # El recuadro Organización refleja SOLO el nombre del proyecto
        project_name = (project.name or "").strip()
        if project_name:
            org_profile["org_name"] = project_name
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
            "org_profile": org_profile,
            "project_organization_name": project_name,
            "knowledge_completeness": state.get("knowledge_completeness", 0),
            "draft_documents_count": state.get("draft_documents_count", 0),
        }
