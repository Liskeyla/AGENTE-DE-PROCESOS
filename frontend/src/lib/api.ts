const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "") ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8003/api/v1"
    : "");

function assertApiConfigured(): void {
  if (!API_BASE && typeof window !== "undefined") {
    console.error(
      "NEXT_PUBLIC_API_URL no está configurada. Defínela en Vercel → Settings → Environment Variables.",
    );
  }
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== "undefined") localStorage.setItem("token", token);
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== "undefined") return localStorage.getItem("token");
    return null;
  }

  clearToken() {
    this.token = null;
    if (typeof window !== "undefined") localStorage.removeItem("token");
  }

  private async request<T>(path: string, options: RequestInit = {}, timeoutMs = 180000): Promise<T> {
    assertApiConfigured();
    if (!API_BASE) {
      throw new Error(
        "API no configurada. El administrador debe definir NEXT_PUBLIC_API_URL en Vercel.",
      );
    }
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Error de conexión" }));
        const detail = typeof error.detail === "string"
          ? error.detail
          : Array.isArray(error.detail)
            ? error.detail.map((e: { msg?: string }) => e.msg || "").join(", ")
            : `Error ${res.status}`;
        throw new Error(detail);
      }
      return res.json();
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new Error("Tiempo de espera agotado. Intenta de nuevo.");
        }
        if (err.message === "Failed to fetch" || err instanceof TypeError) {
          throw new Error(
            `No se pudo conectar con el servidor. Verifica que el backend esté corriendo en ${API_BASE.replace("/api/v1", "")}`
          );
        }
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Auth
  login(email: string, password: string) {
    return this.request<{ access_token: string; refresh_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  register(email: string, password: string, full_name: string, organization_name: string) {
    return this.request<{ access_token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name, organization_name }),
    });
  }

  getMe() {
    return this.request<{ id: string; email: string; full_name: string; role: string }>("/auth/me");
  }

  // Projects
  listProjects() {
    return this.request<Project[]>("/projects");
  }

  createProject(name: string, description?: string) {
    return this.request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  getProject(id: string) {
    return this.request<Project>(`/projects/${id}`);
  }

  // Documents
  uploadDocument(projectId: string, file: File, meta: { source_type?: string; area?: string; participants?: string }) {
    const form = new FormData();
    form.append("file", file);
    if (meta.source_type) form.append("source_type", meta.source_type);
    if (meta.area) form.append("area", meta.area);
    if (meta.participants) form.append("participants", meta.participants);
    return this.request<Document>(`/projects/${projectId}/documents`, { method: "POST", body: form });
  }

  listDocuments(projectId: string) {
    return this.request<Document[]>(`/projects/${projectId}/documents`);
  }

  // Chat conversacional (texto y archivos)
  sendMessage(
    projectId: string,
    opts: { message?: string; file?: File } = {},
  ) {
    const form = new FormData();
    if (opts.message) form.append("message", opts.message);
    if (opts.file) form.append("file", opts.file);
    return this.request<ChatMessage[]>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: form,
    }, 300000);
  }

  getChatHistory(projectId: string) {
    return this.request<ChatMessage[]>(`/projects/${projectId}/chat`);
  }

  clearChatHistory(projectId: string) {
    return this.request<{ deleted: boolean }>(`/projects/${projectId}/chat`, {
      method: "DELETE",
    });
  }

  startInterview(projectId: string) {
    return this.request<ChatMessage>(`/projects/${projectId}/chat/start-interview`, {
      method: "POST",
    });
  }

  getInterviewStatus(projectId: string) {
    return this.request<InterviewStatus>(`/projects/${projectId}/chat/interview-status`);
  }

  // SGQ Diagnosis Engine
  getOrgKnowledgeState(projectId: string) {
    return this.request<OrgKnowledgeState>(`/projects/${projectId}/sgq/knowledge-state`);
  }

  getSgqStatus(projectId: string) {
    return this.request<SgqStatus>(`/projects/${projectId}/sgq/status`);
  }

  getSgqDiagnosis(projectId: string) {
    return this.request<SgqDiagnosis>(`/projects/${projectId}/sgq/diagnosis`);
  }

  runSgqDiagnosis(projectId: string) {
    return this.request<SgqDiagnosis>(`/projects/${projectId}/sgq/diagnose`, {
      method: "POST",
    }, 300000);
  }

  generateSgqComponent(projectId: string, componentType: string) {
    return this.request<SgqDocument>(
      `/projects/${projectId}/sgq/generate/${componentType}`,
      { method: "POST" },
      300000,
    );
  }

  listSgqDocuments(projectId: string) {
    return this.request<Record<string, SgqDocument>>(`/projects/${projectId}/sgq/documents`);
  }

  getSgqDocument(projectId: string, componentType: string) {
    return this.request<SgqDocument>(`/projects/${projectId}/sgq/documents/${componentType}`);
  }

  startAnalysis(projectId: string) {
    return this.request(`/projects/${projectId}/analyze`, { method: "POST" });
  }

  // Questions
  getQuestions(projectId: string) {
    return this.request<Question[]>(`/projects/${projectId}/questions`);
  }

  answerQuestion(projectId: string, questionId: string, answer: string) {
    return this.request(`/projects/${projectId}/questions/${questionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
  }

  // BPMN
  generateBpmn(projectId: string, diagramType: string = "detailed", options?: { regenerateInitial?: boolean; finalizeBizagi?: boolean }) {
    return this.request<BpmnDiagram>(`/projects/${projectId}/bpmn/generate`, {
      method: "POST",
      body: JSON.stringify({
        diagram_type: diagramType,
        regenerate_initial: options?.regenerateInitial ?? false,
        finalize_bizagi: options?.finalizeBizagi ?? false,
      }),
    });
  }

  listDiagrams(projectId: string) {
    return this.request<BpmnDiagram[]>(`/projects/${projectId}/bpmn`);
  }

  getDiagram(projectId: string, diagramId: string) {
    return this.request<BpmnDiagram>(`/projects/${projectId}/bpmn/${diagramId}`);
  }

  finalizeBizagi(projectId: string) {
    return this.generateBpmn(projectId, "detailed", { finalizeBizagi: true });
  }

  regenerateInitialDiagram(projectId: string) {
    return this.generateBpmn(projectId, "detailed", { regenerateInitial: true });
  }

  // Analysis
  runAnalysis(projectId: string, type: string) {
    return this.request(`/projects/${projectId}/analysis/${type}`, { method: "POST" });
  }

  listAnalyses(projectId: string) {
    return this.request<ProcessAnalysis[]>(`/projects/${projectId}/analysis`);
  }

  // Dashboard
  getDashboard(projectId: string) {
    return this.request<DashboardMetrics>(`/projects/${projectId}/dashboard`);
  }

  // Org Chart
  getOrgChart(projectId: string) {
    return this.request<OrgChart>(`/projects/${projectId}/org-chart`);
  }
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  agent_state: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  source_type: string;
  area?: string;
  participants: string[];
  processing_status: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  message_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Question {
  id: string;
  category: string;
  priority: string;
  question: string;
  context?: string;
  status: string;
  answer?: string;
  created_at: string;
}

export interface BpmnDiagram {
  id: string;
  diagram_type: string;
  name: string;
  bpmn_xml?: string;
  version: number;
  created_at: string;
}

export interface ProcessAnalysis {
  id: string;
  analysis_type: string;
  content: Record<string, unknown>;
  recommendations: unknown[];
  kpis: unknown[];
  risks: unknown[];
  automations: unknown[];
  created_at: string;
}

export interface DashboardMetrics {
  total_documents: number;
  total_activities: number;
  manual_activities: number;
  automated_activities: number;
  automatable_activities: number;
  areas_involved: string[];
  systems_involved: string[];
  risks_identified: number;
  pending_questions: number;
  completeness_score: number;
  iso_compliance_score: number;
  bpm_maturity_level: number;
  total_bpmn_diagrams?: number;
  agent_state: string;
  project_status: string;
}

export interface OrgChartNode {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
}

export interface ProcessFlowStep {
  id: string;
  name: string;
  responsible?: string;
  area?: string;
  is_automated: boolean;
  next?: string | null;
}

export interface AreaProcessFlow {
  area: string;
  steps: ProcessFlowStep[];
}

export interface OrgChart {
  organization_name: string;
  process_name: string;
  source_document?: string;
  nodes: OrgChartNode[];
  area_flows: AreaProcessFlow[];
}

export interface InterviewStatus {
  active: boolean;
  completed: boolean;
  current_clause?: string;
  answered_count: number;
  total_questions: number;
  progress_percent: number;
  knowledge_completeness?: number;
  draft_documents_count?: number;
  topics_covered?: string[];
  requirements_fulfilled?: string[];
  requirement_in_progress?: string | null;
  clauses_progress: Record<string, number>;
  org_profile?: { org_name?: string; main_activity?: string; employee_size?: string };
}

export interface SgqDocument {
  component_type: string;
  title: string;
  content: Record<string, unknown>;
  generated_at?: string;
  justified_by_requirements?: string[];
  justified_by_gaps?: unknown[];
  justification?: string;
  status?: string;
  completeness_percent?: number;
  mode?: string;
}

export interface OrgKnowledgeState {
  knowledge_state: Record<string, unknown>;
  knowledge_completeness: number;
  documents: Record<string, SgqDocument>;
  pending_information: string[];
}

export interface SgqStatus {
  interview_completed: boolean;
  ready_for_diagnosis: boolean;
  diagnosis_completed: boolean;
  diagnosed_at?: string;
  proposed_components_count: number;
  generated_documents_count: number;
  draft_documents_count?: number;
  knowledge_completeness?: number;
  overall_compliance_percent?: number;
}

export interface SgqComplianceSummary {
  overall_percent: number;
  by_clause: Record<string, number>;
  cumple: number;
  cumple_parcialmente: number;
  no_cumple: number;
  total_requirements: number;
}

export interface SgqGap {
  requirement_id: string;
  clause: string;
  requirement_title: string;
  evidence_found: string;
  evidence_missing: string;
  priority: string;
  recommendation: string;
}

export interface SgqProposedComponent {
  component_type: string;
  title: string;
  description: string;
  justification: string;
  related_requirements: string[];
  related_gaps: { requirement_id: string; priority: string; recommendation: string }[];
  status: string;
  generated_at?: string;
}

export interface SgqRequirementEvaluation {
  requirement_id: string;
  clause: string;
  title: string;
  status: string;
  evidence_found: string;
  evidence_missing: string;
}

export interface SgqDiagnosis {
  diagnosed_at?: string;
  compliance_summary: SgqComplianceSummary;
  requirements_evaluation: SgqRequirementEvaluation[];
  gaps: SgqGap[];
  organization_context: Record<string, unknown>;
  proposed_components: SgqProposedComponent[];
}

export const api = new ApiClient();
