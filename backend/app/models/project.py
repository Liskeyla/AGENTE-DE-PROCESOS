import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Text, Enum as SAEnum, Integer, Float, Uuid, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class ProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    ANALYZING = "analyzing"
    QUESTIONING = "questioning"
    MODELING = "modeling"
    COMPLETED = "completed"


class AgentState(str, enum.Enum):
    IDLE = "idle"
    INGESTING = "ingesting"
    EXTRACTING = "extracting"
    CONSOLIDATING = "consolidating"
    QUESTIONING = "questioning"
    MODELING = "modeling"
    ANALYZING = "analyzing"
    COMPLETED = "completed"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ProjectStatus] = mapped_column(SAEnum(ProjectStatus), default=ProjectStatus.DRAFT)
    agent_state: Mapped[AgentState] = mapped_column(SAEnum(AgentState), default=AgentState.IDLE)
    methodology: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    organization = relationship("Organization", back_populates="projects")
    documents = relationship("Document", back_populates="project", cascade="all, delete-orphan")
    process_models = relationship("ProcessModel", back_populates="project", cascade="all, delete-orphan")
    bpmn_diagrams = relationship("BpmnDiagram", back_populates="project", cascade="all, delete-orphan")
    chat_messages = relationship("ChatMessage", back_populates="project", cascade="all, delete-orphan")
    agent_questions = relationship("AgentQuestion", back_populates="project", cascade="all, delete-orphan")
    analyses = relationship("ProcessAnalysis", back_populates="project", cascade="all, delete-orphan")


class FileType(str, enum.Enum):
    PDF = "pdf"
    DOCX = "docx"
    XLSX = "xlsx"
    TXT = "txt"
    CSV = "csv"
    AUDIO = "audio"
    TRANSCRIPT = "transcript"


class SourceType(str, enum.Enum):
    INTERVIEW = "interview"
    MEETING = "meeting"
    ACTA = "acta"
    VALIDATION = "validation"
    OTHER = "other"


class ProcessingStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"))
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[FileType] = mapped_column(SAEnum(FileType), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    source_type: Mapped[SourceType] = mapped_column(SAEnum(SourceType), default=SourceType.OTHER)
    area: Mapped[str | None] = mapped_column(String(255))
    participants: Mapped[list] = mapped_column(JSON, default=list)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    processing_status: Mapped[ProcessingStatus] = mapped_column(
        SAEnum(ProcessingStatus), default=ProcessingStatus.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project = relationship("Project", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("documents.id"))
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_id: Mapped[str | None] = mapped_column(String(255))
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

    document = relationship("Document", back_populates="chunks")


class ModelType(str, enum.Enum):
    MACRO = "macro"
    DETAILED = "detailed"
    AS_IS = "as_is"
    TO_BE = "to_be"


class ProcessModel(Base):
    __tablename__ = "process_models"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"))
    model_type: Mapped[ModelType] = mapped_column(SAEnum(ModelType), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("process_models.id"))
    model_data: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project = relationship("Project", back_populates="process_models")


class DiagramType(str, enum.Enum):
    MACRO = "macro"
    DETAILED = "detailed"
    AS_IS = "as_is"
    TO_BE = "to_be"


class BpmnDiagram(Base):
    __tablename__ = "bpmn_diagrams"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"))
    process_model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("process_models.id"))
    diagram_type: Mapped[DiagramType] = mapped_column(SAEnum(DiagramType), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    bpmn_xml: Mapped[str | None] = mapped_column(Text)
    svg_content: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project = relationship("Project", back_populates="bpmn_diagrams")


class QuestionCategory(str, enum.Enum):
    MISSING_INFO = "missing_info"
    BUSINESS_RULE = "business_rule"
    RESPONSIBILITY = "responsibility"
    SYSTEM = "system"
    EXCEPTION = "exception"
    KPI = "kpi"
    AUTOMATION = "automation"


class QuestionPriority(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class QuestionStatus(str, enum.Enum):
    PENDING = "pending"
    ANSWERED = "answered"
    SKIPPED = "skipped"


class AgentQuestion(Base):
    __tablename__ = "agent_questions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"))
    category: Mapped[QuestionCategory] = mapped_column(SAEnum(QuestionCategory), nullable=False)
    priority: Mapped[QuestionPriority] = mapped_column(SAEnum(QuestionPriority), default=QuestionPriority.MEDIUM)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text)
    related_activity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    status: Mapped[QuestionStatus] = mapped_column(SAEnum(QuestionStatus), default=QuestionStatus.PENDING)
    answer: Mapped[str | None] = mapped_column(Text)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project = relationship("Project", back_populates="agent_questions")


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class MessageType(str, enum.Enum):
    TEXT = "text"
    QUESTION = "question"
    EXTRACTION = "extraction"
    BPMN = "bpmn"
    ANALYSIS = "analysis"


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"))
    role: Mapped[MessageRole] = mapped_column(SAEnum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[MessageType] = mapped_column(SAEnum(MessageType), default=MessageType.TEXT)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project = relationship("Project", back_populates="chat_messages")


class AnalysisType(str, enum.Enum):
    AS_IS = "as_is"
    TO_BE = "to_be"
    DMAIC = "dmaic"
    LEAN = "lean"
    ISO = "iso"
    MATURITY = "maturity"


class ProcessAnalysis(Base):
    __tablename__ = "process_analyses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"))
    analysis_type: Mapped[AnalysisType] = mapped_column(SAEnum(AnalysisType), nullable=False)
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    recommendations: Mapped[list] = mapped_column(JSON, default=list)
    kpis: Mapped[list] = mapped_column(JSON, default=list)
    risks: Mapped[list] = mapped_column(JSON, default=list)
    automations: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project = relationship("Project", back_populates="analyses")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("organizations.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("projects.id"))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
