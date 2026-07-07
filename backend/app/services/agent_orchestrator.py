import json
import re
from pathlib import Path
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.project import (
    AgentQuestion, AgentState, ChatMessage, Document, MessageRole,
    MessageType, ProcessAnalysis, ProcessModel, Project, ProjectStatus,
    QuestionStatus, AnalysisType, ModelType,
    QuestionCategory, QuestionPriority,
)
from app.core.database import commit_checkpoint, flush_with_retry
from app.services.rag_service import RAGService
from app.services.llm_service import LLMService

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class AgentOrchestrator:
    """Orquestador del agente IA para análisis de procesos."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMService()
        self.rag = RAGService()

    def _load_prompt(self, name: str) -> str:
        path = PROMPTS_DIR / f"{name}.txt"
        return path.read_text(encoding="utf-8")

    async def _call_llm(self, system: str, user: str, json_mode: bool = True) -> str:
        return await self.llm.generate(system, user, json_mode=json_mode)

    def _parse_json(self, text: str) -> dict:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
            if match:
                return json.loads(match.group(1))
            raise ValueError("No se pudo parsear la respuesta JSON del LLM")

    async def _update_state(self, project: Project, state: AgentState, status: Optional[ProjectStatus] = None):
        project.agent_state = state
        if status:
            project.status = status
        await flush_with_retry(self.db)

    async def _add_message(
        self, project_id: UUID, role: MessageRole, content: str,
        msg_type: MessageType = MessageType.TEXT, metadata: dict = None,
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

    async def run_extraction(self, project_id: UUID) -> dict:
        project = await self.db.get(Project, project_id)
        await self._update_state(project, AgentState.EXTRACTING, ProjectStatus.ANALYZING)

        result = await self.db.execute(
            select(Document).where(
                Document.project_id == project_id,
                Document.extracted_text.isnot(None),
            )
        )
        documents = result.scalars().all()

        system_prompt = self._load_prompt("system")
        extraction_prompt = self._load_prompt("extraction")
        all_extractions = []

        for doc in documents:
            text_limit = 30000 if doc.source_type.value == "interview" else 12000
            user_prompt = extraction_prompt.format(
                document_text=doc.extracted_text[:text_limit],
                source_type=doc.source_type.value,
                area=doc.area or "No especificada",
                participants=", ".join(doc.participants) if doc.participants else "No identificados",
            )
            await commit_checkpoint(self.db)
            response = await self._call_llm(system_prompt, user_prompt)
            extraction = self._parse_json(response)
            extraction["source_document"] = doc.filename
            all_extractions.append(extraction)
            await commit_checkpoint(self.db)

        await self._add_message(
            project_id, MessageRole.ASSISTANT,
            f"He analizado {len(documents)} documento(s) y extraído información del proceso.",
            MessageType.EXTRACTION,
            {"extractions_count": len(all_extractions), "extractions": all_extractions},
        )

        return {"extractions": all_extractions, "documents_analyzed": len(documents)}

    async def run_consolidation(self, project_id: UUID, extractions: list) -> dict:
        project = await self.db.get(Project, project_id)
        await self._update_state(project, AgentState.CONSOLIDATING)

        system_prompt = self._load_prompt("system")
        consolidation_prompt = self._load_prompt("consolidation")
        user_prompt = consolidation_prompt.format(
            extractions_json=json.dumps(extractions, ensure_ascii=False, indent=2),
        )

        await commit_checkpoint(self.db)
        response = await self._call_llm(system_prompt, user_prompt)
        consolidated = self._parse_json(response)

        model = ProcessModel(
            project_id=project_id,
            model_type=ModelType.MACRO,
            name=consolidated.get("process_name", "Proceso Consolidado"),
            model_data=consolidated,
            confidence_score=consolidated.get("completeness_score", 0.0),
        )
        self.db.add(model)
        await commit_checkpoint(self.db)

        contradictions = consolidated.get("contradictions", [])
        msg = f"Modelo consolidado creado con {len(consolidated.get('consolidated_activities', []))} actividades."
        if contradictions:
            msg += f" Se detectaron {len(contradictions)} contradicción(es) entre documentos."

        await self._add_message(project_id, MessageRole.ASSISTANT, msg, MessageType.EXTRACTION, consolidated)
        return consolidated

    async def generate_questions(self, project_id: UUID) -> list[dict]:
        project = await self.db.get(Project, project_id)
        await self._update_state(project, AgentState.QUESTIONING, ProjectStatus.QUESTIONING)

        model_result = await self.db.execute(
            select(ProcessModel).where(
                ProcessModel.project_id == project_id,
                ProcessModel.model_type == ModelType.MACRO,
            ).order_by(ProcessModel.created_at.desc()).limit(1)
        )
        process_model = model_result.scalar_one_or_none()
        if not process_model:
            return []

        answered = await self.db.execute(
            select(AgentQuestion).where(
                AgentQuestion.project_id == project_id,
                AgentQuestion.status == QuestionStatus.ANSWERED,
            )
        )
        previous_answers = [
            {"question": q.question, "answer": q.answer}
            for q in answered.scalars().all()
        ]

        system_prompt = self._load_prompt("system")
        questioning_prompt = self._load_prompt("questioning")
        user_prompt = questioning_prompt.format(
            consolidated_model=json.dumps(process_model.model_data, ensure_ascii=False, indent=2),
            previous_answers=json.dumps(previous_answers, ensure_ascii=False),
            contradictions=json.dumps(
                process_model.model_data.get("contradictions", []), ensure_ascii=False
            ),
        )

        await commit_checkpoint(self.db)
        response = await self._call_llm(system_prompt, user_prompt)
        result = self._parse_json(response)
        questions = result.get("questions", [])

        saved = []
        for q in questions[:5]:
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
            await self._add_message(
                project_id, MessageRole.ASSISTANT,
                f"**Pregunta ({first.get('priority', 'medium')}):** {first['question']}",
                MessageType.QUESTION,
                {"question_index": 0, "total": len(saved), "suggested_answers": first.get("suggested_answers", [])},
            )

        return saved

    async def answer_question(self, project_id: UUID, question_id: UUID, answer: str) -> dict:
        question = await self.db.get(AgentQuestion, question_id)
        if not question or question.project_id != project_id:
            raise ValueError("Pregunta no encontrada")

        from datetime import datetime, timezone
        question.answer = answer
        question.status = QuestionStatus.ANSWERED
        question.answered_at = datetime.now(timezone.utc)

        await self._add_message(project_id, MessageRole.USER, answer)

        pending = await self.db.execute(
            select(AgentQuestion).where(
                AgentQuestion.project_id == project_id,
                AgentQuestion.status == QuestionStatus.PENDING,
            )
        )
        remaining = pending.scalars().all()

        if remaining:
            next_q = remaining[0]
            await self._add_message(
                project_id, MessageRole.ASSISTANT,
                f"**Siguiente pregunta ({next_q.priority.value}):** {next_q.question}",
                MessageType.QUESTION,
                {"question_id": str(next_q.id)},
            )
        else:
            await self._add_message(
                project_id, MessageRole.ASSISTANT,
                "Todas las preguntas han sido respondidas. El diagrama BPMN se actualizará con tus respuestas. "
                "Continúa refinando por chat o genera el **diagrama final Bizagi**.",
            )

        from app.services.bpmn_refiner import BpmnRefiner
        refiner = BpmnRefiner(self.db)
        await refiner.refine_from_message(project_id, answer, add_user_message=False)

        await commit_checkpoint(self.db)
        return {"answered": True, "remaining_questions": len(remaining)}

    async def chat(self, project_id: UUID, user_message: str) -> ChatMessage:
        """Chat orientado a refinamiento del diagrama BPMN."""
        from app.services.bpmn_refiner import BpmnRefiner
        refiner = BpmnRefiner(self.db)
        result = await refiner.refine_from_message(project_id, user_message)
        return result["message"]

    async def _get_documents_context(self, project_id: UUID) -> str:
        result = await self.db.execute(
            select(Document).where(
                Document.project_id == project_id,
                Document.extracted_text.isnot(None),
            )
        )
        docs = result.scalars().all()
        parts = []
        for doc in docs:
            parts.append(f"[{doc.filename}]\n{doc.extracted_text[:3000]}")
        return "\n\n---\n\n".join(parts)

    async def run_full_analysis(self, project_id: UUID) -> dict:
        """Pipeline completo: extracción → consolidación → preguntas."""
        extraction = await self.run_extraction(project_id)
        consolidated = await self.run_consolidation(
            project_id, extraction["extractions"]
        )
        questions = await self.generate_questions(project_id)
        return {
            "extraction": extraction,
            "consolidated": consolidated,
            "questions_generated": len(questions),
        }

    async def run_process_analysis(self, project_id: UUID, analysis_type: str) -> dict:
        project = await self.db.get(Project, project_id)
        await self._update_state(project, AgentState.ANALYZING)

        model_result = await self.db.execute(
            select(ProcessModel).where(ProcessModel.project_id == project_id)
            .order_by(ProcessModel.created_at.desc()).limit(1)
        )
        process_model = model_result.scalar_one_or_none()

        answered = await self.db.execute(
            select(AgentQuestion).where(
                AgentQuestion.project_id == project_id,
                AgentQuestion.status == QuestionStatus.ANSWERED,
            )
        )
        user_answers = [
            {"question": q.question, "answer": q.answer}
            for q in answered.scalars().all()
        ]

        system_prompt = self._load_prompt("system")
        analysis_prompt = self._load_prompt("analysis")
        user_prompt = analysis_prompt.format(
            process_model=json.dumps(
                process_model.model_data if process_model else {}, ensure_ascii=False, indent=2
            ),
            consolidated_info=json.dumps(
                process_model.model_data if process_model else {}, ensure_ascii=False, indent=2
            ),
            user_answers=json.dumps(user_answers, ensure_ascii=False),
            analysis_type=analysis_type,
        )

        response = await self._call_llm(system_prompt, user_prompt)
        analysis_data = self._parse_json(response)

        analysis = ProcessAnalysis(
            project_id=project_id,
            analysis_type=AnalysisType(analysis_type),
            content=analysis_data,
            recommendations=analysis_data.get("recommendations", []),
            kpis=analysis_data.get("kpis", []),
            risks=analysis_data.get("risks", analysis_data.get("problems_pain_points", [])),
            automations=analysis_data.get("automations", []),
        )
        self.db.add(analysis)
        await self._update_state(project, AgentState.COMPLETED, ProjectStatus.COMPLETED)
        await commit_checkpoint(self.db)

        return analysis_data
