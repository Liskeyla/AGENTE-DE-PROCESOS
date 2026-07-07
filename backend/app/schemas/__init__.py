from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime
from enum import Enum


# --- Auth ---

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    organization_name: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    organization_id: UUID

    class Config:
        from_attributes = True


# --- Projects ---

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    status: str
    agent_state: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Documents ---

class DocumentUploadMeta(BaseModel):
    source_type: str = "other"
    area: Optional[str] = None
    participants: List[str] = []


class DocumentResponse(BaseModel):
    id: UUID
    filename: str
    file_type: str
    file_size: int
    source_type: str
    area: Optional[str]
    participants: List[str]
    processing_status: str
    created_at: datetime

    class Config:
        from_attributes = True


# --- Chat ---

class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    id: UUID
    role: str
    content: str
    message_type: str
    metadata: dict = {}
    created_at: datetime

    class Config:
        from_attributes = True


# --- Questions ---

class QuestionAnswer(BaseModel):
    answer: str


class QuestionResponse(BaseModel):
    id: UUID
    category: str
    priority: str
    question: str
    context: Optional[str]
    status: str
    answer: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# --- BPMN ---

class BpmnGenerateRequest(BaseModel):
    diagram_type: str = "detailed"
    subprocess_name: Optional[str] = None
    regenerate_initial: bool = False
    finalize_bizagi: bool = False


class BpmnDiagramResponse(BaseModel):
    id: UUID
    diagram_type: str
    name: str
    bpmn_xml: Optional[str]
    version: int
    created_at: datetime

    class Config:
        from_attributes = True


# --- Analysis ---

class AnalysisResponse(BaseModel):
    id: UUID
    analysis_type: str
    content: dict
    recommendations: list
    kpis: list
    risks: list
    automations: list
    created_at: datetime

    class Config:
        from_attributes = True


# --- Dashboard ---

class DashboardMetrics(BaseModel):
    total_documents: int = 0
    total_activities: int = 0
    manual_activities: int = 0
    automated_activities: int = 0
    automatable_activities: int = 0
    areas_involved: List[str] = []
    systems_involved: List[str] = []
    risks_identified: int = 0
    pending_questions: int = 0
    completeness_score: float = 0.0
    iso_compliance_score: float = 0.0
    bpm_maturity_level: int = 1
    total_bpmn_diagrams: int = 0
    agent_state: str = "idle"
    project_status: str = "draft"


# --- Org Chart ---

class OrgChartNode(BaseModel):
    id: str
    name: str
    type: str
    parent_id: Optional[str] = None


class ProcessFlowStep(BaseModel):
    id: str
    name: str
    responsible: Optional[str] = None
    area: Optional[str] = None
    is_automated: bool = False
    next: Optional[str] = None


class AreaProcessFlow(BaseModel):
    area: str
    steps: List[ProcessFlowStep] = []


class OrgChartResponse(BaseModel):
    organization_name: str
    process_name: str
    source_document: Optional[str] = None
    nodes: List[OrgChartNode] = []
    area_flows: List[AreaProcessFlow] = []


# --- Extraction ---

class ExtractionResult(BaseModel):
    activities: List[dict] = []
    participants: List[dict] = []
    areas: List[str] = []
    systems: List[str] = []
    decisions: List[dict] = []
    inputs: List[str] = []
    outputs: List[str] = []
    business_rules: List[dict] = []
    problems: List[str] = []
    opportunities: List[str] = []
    exceptions: List[dict] = []
    documents: List[str] = []
    sequence: List[dict] = []
    contradictions: List[dict] = []
    confidence_score: float = 0.0
