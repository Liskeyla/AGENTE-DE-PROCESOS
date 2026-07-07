const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

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
            "No se pudo conectar con el servidor. Verifica que el backend esté corriendo en http://localhost:8000"
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

  // Chat
  sendMessage(projectId: string, message: string) {
    return this.request<ChatMessage>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  getChatHistory(projectId: string) {
    return this.request<ChatMessage[]>(`/projects/${projectId}/chat`);
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

export const api = new ApiClient();
