"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  api, Project, ChatMessage, Document, DashboardMetrics, BpmnDiagram, ProcessAnalysis, OrgChart,
} from "@/lib/api";
import {
  MessageSquare, FileText, GitBranch, BarChart3, Upload, Send,
  Play, Download, ArrowLeft, Loader2, CheckCircle, AlertCircle, Network,
} from "lucide-react";
import BpmnViewer from "@/components/BpmnViewer";
import OrgChartViewer from "@/components/OrgChartViewer";

type Tab = "chat" | "documents" | "bpmn" | "orgchart" | "analysis";

const PHASES = [
  { key: "ingesting", label: "Ingesta" },
  { key: "extracting", label: "Extracción" },
  { key: "consolidating", label: "Consolidación" },
  { key: "questioning", label: "Preguntas" },
  { key: "modeling", label: "Modelado" },
  { key: "analyzing", label: "Análisis" },
  { key: "completed", label: "Completado" },
];

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("chat");
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [diagrams, setDiagrams] = useState<BpmnDiagram[]>([]);
  const [analyses, setAnalyses] = useState<ProcessAnalysis[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);
  const [selectedDiagram, setSelectedDiagram] = useState<BpmnDiagram | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState<ProcessAnalysis | null>(null);
  const [orgChart, setOrgChart] = useState<OrgChart | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = (type: "ok" | "err" | "info", text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 6000);
  };

  const loadAll = useCallback(async () => {
    try {
      const [p, msgs, docs, diags, dash, anls] = await Promise.all([
        api.getProject(id),
        api.getChatHistory(id),
        api.listDocuments(id),
        api.listDiagrams(id),
        api.getDashboard(id),
        api.listAnalyses(id).catch(() => []),
      ]);
      setProject(p);
      setMessages(msgs);
      setDocuments(docs);
      setMetrics(dash);
      setAnalyses(anls);

      if (diags.length > 0) {
        const preferred = diags.find((d) => d.diagram_type === "detailed") || diags[0];
        try {
          const full = await api.getDiagram(id, preferred.id);
          setDiagrams(diags.map((d) => (d.id === full.id ? full : d)));
          setSelectedDiagram(full);
        } catch {
          setDiagrams(diags);
          setSelectedDiagram(diags[0]);
        }
      } else {
        setDiagrams([]);
        setSelectedDiagram(null);
      }

      if (anls.length > 0) setSelectedAnalysis(anls[0]);
      else setSelectedAnalysis(null);

      try {
        const chart = await api.getOrgChart(id);
        setOrgChart(chart);
      } catch {
        setOrgChart(null);
      }
    } catch {
      router.push("/projects");
    }
  }, [id, router]);

  useEffect(() => {
    if (!api.getToken()) { router.push("/"); return; }
    loadAll();
  }, [loadAll, router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    setLoading(true);
    setMessages((prev) => [...prev, {
      id: "temp", role: "user", content: text, message_type: "text",
      metadata: {}, created_at: new Date().toISOString(),
    }]);
    try {
      const reply = await api.sendMessage(id, text);
      setMessages((prev) => [...prev.filter((m) => m.id !== "temp"), reply]);
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setMessages((prev) => [...prev.filter((m) => m.id !== "temp"), {
        id: "err", role: "assistant", content: msg,
        message_type: "text", metadata: {}, created_at: new Date().toISOString(),
      }]);
    } finally { setLoading(false); }
  };

  const showDiagramAfterAnalysis = async () => {
    const diags = await api.listDiagrams(id);
    if (diags.length > 0) {
      setSelectedDiagram(diags[0]);
      setTab("bpmn");
      return true;
    }
    return false;
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || uploading) return;
    setUploading(true);
    showStatus("info", "Subiendo entrevista y analizando para generar BPMN...");
    try {
      for (const file of Array.from(files)) {
        const isInterview = /entrevista|transcripci[oó]n|interview/i.test(file.name);
        await api.uploadDocument(id, file, {
          source_type: isInterview ? "interview" : "other",
        });
      }
      await loadAll();
      const hasDiagram = await showDiagramAfterAnalysis();
      showStatus(
        "ok",
        hasDiagram
          ? "Análisis de entrevista completado. Revisa BPMN y Organigrama."
          : "Documento cargado. Revisa el chat para continuar.",
      );
    } catch (err) {
      showStatus("err", err instanceof Error ? err.message : "Error al subir archivo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAnalyze = async () => {
    if (analyzing || documents.length === 0) return;
    setAnalyzing(true);
    showStatus("info", "Analizando documento y generando primer diagrama...");
    try {
      await api.startAnalysis(id);
      await loadAll();
      const hasDiagram = await showDiagramAfterAnalysis();
      showStatus(
        "ok",
        hasDiagram
          ? "Análisis completado. Primer diagrama listo en la pestaña BPMN."
          : "Análisis completado. Revisa el chat.",
      );
    } catch (err) {
      showStatus("err", err instanceof Error ? err.message : "Error en análisis");
    } finally { setAnalyzing(false); }
  };

  const handleFinalizeBizagi = async () => {
    setLoading(true);
    showStatus("info", "Generando diagrama final compatible con Bizagi Modeler...");
    try {
      const diagram = await api.finalizeBizagi(id);
      await loadAll();
      setSelectedDiagram(diagram);
      setTab("bpmn");
      showStatus("ok", "Diagrama final Bizagi listo. Descárgalo e impórtalo en Bizagi Modeler.");
    } catch (err) {
      showStatus("err", err instanceof Error ? err.message : "Error generando diagrama Bizagi");
    } finally { setLoading(false); }
  };

  const handleRegenerateDiagram = async () => {
    setLoading(true);
    showStatus("info", "Regenerando diagrama detallado desde la entrevista...");
    try {
      const diagram = await api.regenerateInitialDiagram(id);
      await loadAll();
      setSelectedDiagram(diagram);
      setTab("bpmn");
      showStatus("ok", "Diagrama BPMN generado correctamente.");
    } catch (err) {
      showStatus("err", err instanceof Error ? err.message : "Error regenerando diagrama");
    } finally { setLoading(false); }
  };

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

  const currentPhaseIdx = PHASES.findIndex((p) => p.key === project?.agent_state);

  const messageStyle = (type: string) => {
    if (type === "question") return "bg-amber-50 border-amber-200";
    if (type === "extraction") return "bg-blue-50 border-blue-200";
    if (type === "bpmn") return "bg-teal-50 border-teal-200";
    if (type === "analysis") return "bg-purple-50 border-purple-200";
    return "";
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Status banner */}
      {statusMsg && (
        <div className={`px-4 py-2 text-sm flex items-center gap-2 shrink-0 ${
          statusMsg.type === "ok" ? "bg-emerald-100 text-emerald-800" :
          statusMsg.type === "err" ? "bg-red-100 text-red-800" :
          "bg-blue-100 text-blue-800"
        }`}>
          {statusMsg.type === "ok" ? <CheckCircle className="w-4 h-4" /> :
           statusMsg.type === "err" ? <AlertCircle className="w-4 h-4" /> :
           <Loader2 className="w-4 h-4 animate-spin" />}
          {statusMsg.text}
        </div>
      )}

      <header className="bg-primary text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/projects")} className="hover:opacity-80">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-bold">{project?.name || "Cargando..."}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={handleAnalyze} disabled={analyzing || uploading || documents.length === 0}
            className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50">
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Analizar
          </button>
          <button onClick={handleFinalizeBizagi} disabled={loading || analyzing || (diagrams.length === 0 && !(metrics?.total_bpmn_diagrams))}
            className="bg-secondary hover:bg-teal-600 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50">
            <Download className="w-4 h-4" /> Finalizar Bizagi
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
          {([
            { key: "chat" as Tab, icon: MessageSquare, label: "Chat", badge: messages.length },
            { key: "documents" as Tab, icon: FileText, label: "Documentos", badge: documents.length },
            { key: "bpmn" as Tab, icon: GitBranch, label: "BPMN", badge: diagrams.length },
            { key: "orgchart" as Tab, icon: Network, label: "Organigrama", badge: orgChart?.area_flows.length || 0 },
            { key: "analysis" as Tab, icon: BarChart3, label: "Análisis", badge: analyses.length },
          ]).map(({ key, icon: Icon, label, badge }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors ${
                tab === key ? "bg-blue-50 text-primary border-r-2 border-primary" : "text-slate-600 hover:bg-slate-50"
              }`}>
              <span className="flex items-center gap-3"><Icon className="w-4 h-4" /> {label}</span>
              {badge > 0 && <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded-full">{badge}</span>}
            </button>
          ))}

          <div className="mt-auto p-4 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-400 mb-2">FASES DEL AGENTE</p>
            {PHASES.map((phase, idx) => (
              <div key={phase.key} className="flex items-center gap-2 py-1">
                <div className={`w-2 h-2 rounded-full ${
                  idx < currentPhaseIdx ? "bg-emerald-500" :
                  idx === currentPhaseIdx ? "bg-amber-500 animate-pulse" : "bg-slate-200"
                }`} />
                <span className={`text-xs ${idx === currentPhaseIdx ? "font-semibold text-primary" : "text-slate-400"}`}>
                  {phase.label}
                </span>
              </div>
            ))}
          </div>
        </nav>

        <main className="flex-1 flex flex-col overflow-hidden">
          {tab === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-16 text-slate-400">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Sube un documento y se generará un <strong>primer diagrama BPMN</strong> automáticamente.</p>
                    <p className="text-sm mt-2">Luego usa el chat para <strong>refinarlo</strong> antes de exportar a Bizagi.</p>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-xl px-4 py-3 border ${
                      msg.role === "user" ? "bg-primary text-white border-primary" :
                      `bg-white border-slate-200 ${messageStyle(msg.message_type)}`
                    }`}>
                      {msg.message_type === "question" && <span className="text-xs font-semibold text-amber-600 block mb-1">PREGUNTA</span>}
                      {msg.message_type === "extraction" && <span className="text-xs font-semibold text-blue-600 block mb-1">EXTRACCIÓN</span>}
                      {msg.message_type === "bpmn" && <span className="text-xs font-semibold text-teal-600 block mb-1">BPMN</span>}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {(loading || uploading) && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-sm text-slate-500">{uploading ? "Procesando documento..." : "Pensando..."}</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="border-t border-slate-200 p-4 bg-white">
                <div className="flex gap-2">
                  <input className="input-field flex-1"
                    placeholder="Refina el diagrama: ej. 'Agregar actividad de aprobación por gerencia'..."
                    value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()} />
                  <button onClick={sendMessage} disabled={loading || !input.trim()} className="btn-primary px-4">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === "documents" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div onClick={() => !uploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-6 ${
                  uploading ? "border-primary bg-blue-50 opacity-70" :
                  "border-slate-300 hover:border-primary-light hover:bg-blue-50/50"
                }`}>
                {uploading ? (
                  <Loader2 className="w-8 h-8 mx-auto mb-2 text-primary animate-spin" />
                ) : (
                  <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                )}
                <p className="text-sm text-slate-500">
                  {uploading ? "Subiendo y analizando automáticamente..." : "Arrastra archivos o haz clic para subir"}
                </p>
                <p className="text-xs text-slate-400 mt-1">PDF, Word, Excel, TXT, CSV — entrevistas se analizan automáticamente</p>
                <input ref={fileInputRef} type="file" multiple className="hidden"
                  accept=".pdf,.docx,.xlsx,.xls,.txt,.csv" onChange={(e) => handleUpload(e.target.files)} />
              </div>
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div key={doc.id} className="card flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-primary-light" />
                      <div>
                        <p className="font-medium text-sm">{doc.filename}</p>
                        <p className="text-xs text-slate-400">
                          {doc.file_type.toUpperCase()} · {(doc.file_size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      doc.processing_status === "completed" ? "bg-emerald-100 text-emerald-700" :
                      doc.processing_status === "failed" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>{doc.processing_status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "bpmn" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {diagrams.length > 0 ? (
                <>
                  <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 bg-white">
                    <select className="text-sm border border-slate-200 rounded px-2 py-1"
                      value={selectedDiagram?.id || ""}
                      onChange={async (e) => {
                        const d = diagrams.find((x) => x.id === e.target.value);
                        if (!d) return;
                        if (!d.bpmn_xml) {
                          try {
                            const full = await api.getDiagram(id, d.id);
                            setSelectedDiagram(full);
                          } catch { setSelectedDiagram(d); }
                        } else setSelectedDiagram(d);
                      }}>
                      {diagrams.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.diagram_type})</option>)}
                    </select>
                    {selectedDiagram && (
                      <>
                        <a href={`${apiBase}/projects/${id}/bpmn/${selectedDiagram.id}/export?format=bpmn`}
                          className="btn-secondary text-xs py-1 flex items-center gap-1" target="_blank">
                          <Download className="w-3 h-3" /> BPMN
                        </a>
                        <a href={`${apiBase}/projects/${id}/bpmn/${selectedDiagram.id}/export?format=bizagi`}
                          className="btn-primary text-xs py-1 flex items-center gap-1" target="_blank">
                          <Download className="w-3 h-3" /> Exportar Bizagi
                        </a>
                      </>
                    )}
                  </div>
                  <div className="flex-1">
                    {selectedDiagram?.bpmn_xml && <BpmnViewer xml={selectedDiagram.bpmn_xml} />}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                  <div className="text-center">
                    <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No hay diagramas aún.</p>
                    <p className="text-sm mb-4">
                      {documents.length > 0
                        ? "El análisis del documento no completó el diagrama."
                        : "Sube un documento: se generará el primer diagrama automáticamente."}
                    </p>
                    {documents.length > 0 && (
                      <button onClick={handleRegenerateDiagram} disabled={loading}
                        className="btn-primary text-sm flex items-center gap-2 mx-auto">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
                        Regenerar diagrama
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "orgchart" && (
            <div className="flex-1 overflow-hidden bg-slate-50">
              {orgChart && orgChart.nodes.length > 0 ? (
                <OrgChartViewer chart={orgChart} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 h-full">
                  <div className="text-center">
                    <Network className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No hay organigrama aún.</p>
                    <p className="text-sm mb-4">
                      {documents.length > 0
                        ? "Presiona Analizar para extraer la estructura desde la entrevista."
                        : "Sube la entrevista del proceso para generar el organigrama."}
                    </p>
                    {documents.length > 0 && (
                      <button onClick={handleAnalyze} disabled={analyzing}
                        className="btn-primary text-sm flex items-center gap-2 mx-auto">
                        {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Analizar entrevista
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "analysis" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Actividades", value: metrics?.total_activities || 0 },
                  { label: "Manuales", value: metrics?.manual_activities || 0 },
                  { label: "Automatizables", value: metrics?.automatable_activities || 0 },
                  { label: "Riesgos", value: metrics?.risks_identified || 0 },
                ].map((m) => (
                  <div key={m.label} className="card text-center py-4">
                    <p className="text-2xl font-bold text-primary">{m.value}</p>
                    <p className="text-xs text-slate-500">{m.label}</p>
                  </div>
                ))}
              </div>

              {analyses.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card">
                    <h3 className="font-semibold mb-3">Análisis realizados</h3>
                    <div className="space-y-2">
                      {analyses.map((a) => (
                        <button key={a.id} type="button"
                          onClick={() => setSelectedAnalysis(a)}
                          className={`w-full text-left text-sm border rounded-lg p-3 transition-colors ${
                            selectedAnalysis?.id === a.id
                              ? "border-primary bg-blue-50"
                              : "border-slate-100 hover:bg-slate-50"
                          }`}>
                          <span className="font-medium text-primary">{a.analysis_type.toUpperCase().replace("_", "-")}</span>
                          <span className="text-slate-400 ml-2 text-xs">{new Date(a.created_at).toLocaleString("es")}</span>
                          {a.recommendations?.length > 0 && (
                            <p className="text-slate-500 text-xs mt-1">{a.recommendations.length} recomendaciones</p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedAnalysis && (
                    <div className="card">
                      <h3 className="font-semibold mb-3">
                        Detalle: {selectedAnalysis.analysis_type.toUpperCase().replace("_", "-")}
                      </h3>
                      <AnalysisDetail analysis={selectedAnalysis} />
                    </div>
                  )}
                </div>
              )}

              {(diagrams.length > 0 || (metrics?.total_bpmn_diagrams ?? 0) > 0) && (
                <div className="card flex items-center justify-between">
                  <p className="text-sm text-slate-600">
                    Hay {metrics?.total_bpmn_diagrams ?? diagrams.length} diagrama(s) BPMN disponible(s).
                  </p>
                  <button onClick={() => setTab("bpmn")} className="btn-primary text-xs py-1.5">
                    Ver diagrama BPMN
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card">
                  <h3 className="font-semibold mb-3">Áreas Involucradas</h3>
                  {(metrics?.areas_involved || []).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {metrics!.areas_involved.map((a) => (
                        <span key={a} className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded">{a}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-slate-400">Sube documentos y analiza para ver áreas</p>}
                </div>
                <div className="card">
                  <h3 className="font-semibold mb-3">Sistemas</h3>
                  {(metrics?.systems_involved || []).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {metrics!.systems_involved.map((s) => (
                        <span key={s} className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded">{s}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-slate-400">Sin sistemas detectados aún</p>}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {["as_is", "to_be", "lean", "dmaic", "iso", "maturity"].map((type) => (
                  <button key={type} onClick={async () => {
                    setLoading(true);
                    showStatus("info", `Ejecutando análisis ${type.toUpperCase()}...`);
                    try {
                      await api.runAnalysis(id, type);
                      await loadAll();
                      showStatus("ok", `Análisis ${type.toUpperCase()} completado.`);
                    } catch (err) {
                      showStatus("err", err instanceof Error ? err.message : "Error");
                    } finally { setLoading(false); }
                  }} className="btn-secondary text-xs" disabled={loading || documents.length === 0}>
                    Análisis {type.toUpperCase().replace("_", "-")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        <aside className="w-64 bg-white border-l border-slate-200 p-4 overflow-y-auto shrink-0 hidden lg:block">
          <h3 className="font-semibold text-sm mb-4">Dashboard</h3>
          {metrics && (
            <div className="space-y-4">
              <MetricBar label="Completitud" value={metrics.completeness_score * 100} />
              <MetricBar label="ISO 9001" value={metrics.iso_compliance_score} />
              <div className="text-center">
                <p className="text-xs text-slate-400">Madurez BPM</p>
                <p className="text-2xl font-bold text-secondary">Nivel {metrics.bpm_maturity_level}</p>
              </div>
              <div className="border-t pt-3 space-y-2 text-sm">
                <Row label="Documentos" value={metrics.total_documents} />
                <Row label="Preguntas pendientes" value={metrics.pending_questions} />
                <Row label="Actividades" value={metrics.total_activities} />
                <Row label="Diagramas BPMN" value={metrics?.total_bpmn_diagrams ?? diagrams.length} />
                <Row label="Manuales" value={metrics.manual_activities} />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="font-semibold">{value.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function formatRec(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    return String(o.text || o.recommendation || o.title || o.description || JSON.stringify(r));
  }
  return String(r);
}

function AnalysisDetail({ analysis }: { analysis: ProcessAnalysis }) {
  const c = analysis.content || {};
  const summary = String(c.summary || c.description || c.process_description || "");
  const activities = (c.activities || c.consolidated_activities || []) as unknown[];
  const areas = (c.areas || c.areas_involved || []) as unknown[];
  const problems = (c.problems_pain_points || c.bottlenecks || analysis.risks || []) as unknown[];

  return (
    <div className="space-y-4 text-sm max-h-[420px] overflow-y-auto">
      {summary && (
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-1">RESUMEN</p>
          <p className="text-slate-700 whitespace-pre-wrap">{summary}</p>
        </div>
      )}
      {activities.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-1">ACTIVIDADES ({activities.length})</p>
          <ul className="list-disc pl-4 space-y-1 text-slate-600">
            {activities.slice(0, 12).map((a, i) => (
              <li key={i}>{typeof a === "string" ? a : String((a as Record<string, unknown>).name || (a as Record<string, unknown>).activity || JSON.stringify(a))}</li>
            ))}
          </ul>
        </div>
      )}
      {analysis.recommendations?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-1">RECOMENDACIONES</p>
          <ul className="list-disc pl-4 space-y-1 text-slate-600">
            {analysis.recommendations.map((r, i) => <li key={i}>{formatRec(r)}</li>)}
          </ul>
        </div>
      )}
      {areas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {areas.map((a, i) => (
            <span key={i} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">{String(a)}</span>
          ))}
        </div>
      )}
      {problems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-1">RIESGOS / PROBLEMAS</p>
          <ul className="list-disc pl-4 space-y-1 text-slate-600">
            {problems.slice(0, 8).map((p, i) => (
              <li key={i}>{typeof p === "string" ? p : formatRec(p)}</li>
            ))}
          </ul>
        </div>
      )}
      {!summary && activities.length === 0 && !analysis.recommendations?.length && (
        <p className="text-slate-400">Sin detalle adicional. Ejecuta el análisis de nuevo con el botón Analizar.</p>
      )}
    </div>
  );
}
