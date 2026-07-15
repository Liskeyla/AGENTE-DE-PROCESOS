"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, Project, ChatMessage, InterviewStatus, OrgKnowledgeState, SgqDocument } from "@/lib/api";
import { CheckCircle, AlertCircle, Loader2, Play } from "lucide-react";
import Image from "next/image";
import ChatMessageBubble from "@/components/ChatMessageBubble";
import WorkspaceTopBar from "@/components/workspace/WorkspaceTopBar";
import WorkspaceNav, { WorkspaceTab } from "@/components/workspace/WorkspaceNav";
import InterviewSidebar from "@/components/workspace/InterviewSidebar";
import ChatComposer from "@/components/workspace/ChatComposer";
import { useVoiceInput } from "@/hooks/useVoiceInput";

const SgqDraftsPanel = dynamic(() => import("@/components/SgqDraftsPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20 text-ink-muted">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando documentos…
    </div>
  ),
});

const SgqDiagnosisPanel = dynamic(() => import("@/components/SgqDiagnosisPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20 text-ink-muted">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando diagnóstico…
    </div>
  ),
});

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<WorkspaceTab>("chat");
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);
  const [interviewStatus, setInterviewStatus] = useState<InterviewStatus | null>(null);
  const [knowledgePreview, setKnowledgePreview] = useState<OrgKnowledgeState | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const docsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const organizationName =
    interviewStatus?.org_profile?.org_name ||
    project?.name ||
    "Organización";

  const showStatus = useCallback((type: "ok" | "err" | "info", text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), type === "err" ? 20000 : 6000);
  }, []);

  const refreshInterviewStatus = useCallback(async () => {
    try {
      const ist = await api.getInterviewStatus(id);
      setInterviewStatus(ist);
    } catch {
      /* mantener estado previo */
    }
  }, [id]);

  const refreshKnowledgePreview = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const data = await api.getOrgKnowledgeState(id);
      setKnowledgePreview(data);
    } catch {
      setKnowledgePreview(null);
    } finally {
      setLoadingDocs(false);
    }
  }, [id]);

  const loadAll = useCallback(async () => {
    try {
      const [p, msgs, ist] = await Promise.all([
        api.getProject(id),
        api.getChatHistory(id),
        api.getInterviewStatus(id).catch(() => null),
      ]);
      setProject(p);
      setMessages(msgs);
      setInterviewStatus(ist);
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
  }, [messages, loading]);

  useEffect(() => {
    if (tab === "chat" && (interviewStatus?.active || interviewStatus?.draft_documents_count)) {
      refreshKnowledgePreview();
    }
  }, [tab, interviewStatus?.active, interviewStatus?.draft_documents_count, draftsRefreshKey, refreshKnowledgePreview]);

  useEffect(() => {
    if (docsDebounceRef.current) clearTimeout(docsDebounceRef.current);
    docsDebounceRef.current = setTimeout(() => {
      if (interviewStatus?.active) refreshKnowledgePreview();
    }, 800);
    return () => { if (docsDebounceRef.current) clearTimeout(docsDebounceRef.current); };
  }, [draftsRefreshKey, interviewStatus?.active, refreshKnowledgePreview]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await refreshInterviewStatus();
      showStatus("ok", "Progreso guardado. La entrevista se sincroniza automáticamente.");
    } finally {
      setSaving(false);
    }
  };

  const startInterview = async () => {
    setLoading(true);
    try {
      const welcome = await api.startInterview(id);
      setMessages((prev) => [...prev, welcome]);
      await Promise.all([refreshInterviewStatus(), refreshKnowledgePreview()]);
    } catch (err) {
      showStatus("err", err instanceof Error ? err.message : "Error al iniciar entrevista");
    } finally { setLoading(false); }
  };

  const sendMessage = async (textOverride?: string, opts?: { file?: File }) => {
    const text = (textOverride ?? input).trim();
    if ((!text && !opts?.file) || loading) return;
    if (!textOverride) setInput("");
    setLoading(true);
    const display = text || (opts?.file ? `Adjunto: ${opts.file.name}` : "");
    setMessages((prev) => [...prev, {
      id: "temp", role: "user", content: display, message_type: "text",
      metadata: {}, created_at: new Date().toISOString(),
    }]);
    try {
      const replies = await api.sendMessage(id, { message: text || undefined, file: opts?.file });
      setMessages((prev) => {
        const temp = prev.find((m) => m.id === "temp");
        const base = prev.filter((m) => m.id !== "temp");
        return [...base, ...(temp ? [temp] : []), ...replies];
      });
      await refreshInterviewStatus();
      setDraftsRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setMessages((prev) => [...prev.filter((m) => m.id !== "temp"), {
        id: "err", role: "assistant", content: msg,
        message_type: "text", metadata: {}, created_at: new Date().toISOString(),
      }]);
    } finally { setLoading(false); }
  };

  const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
  const activeQuestion =
    lastAssistant &&
    (lastAssistant.message_type === "question" ||
      (lastAssistant.metadata?.options as string[] | undefined)?.length ||
      lastAssistant.metadata?.interaction_type === "dropdown" ||
      lastAssistant.metadata?.interaction_type === "date")
      ? lastAssistant
      : undefined;

  const questionOptions = (activeQuestion?.metadata?.options as string[]) || [];
  const interactionType = (activeQuestion?.metadata?.interaction_type as string) || "text";
  const isMultiSelect = interactionType === "multi_choice" || Boolean(activeQuestion?.metadata?.multi_select);
  const isDropdown = interactionType === "dropdown";
  const isDate = interactionType === "date";
  const isSingleChoice = interactionType === "single_choice";
  const fileRequested = Boolean(activeQuestion?.metadata?.file_request);
  const hasChoiceOptions = questionOptions.length > 0 && (isSingleChoice || isMultiSelect || isDropdown);
  const showTextInput =
    (!hasChoiceOptions && !isDate) || fileRequested || interactionType === "text";

  useEffect(() => { setSelectedOptions([]); }, [activeQuestion?.id]);

  const handleOptionAnswer = (option: string) => {
    if (loading) return;
    if (isMultiSelect) {
      setSelectedOptions((prev) =>
        prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
      );
      return;
    }
    sendMessage(option);
  };

  const submitMultiSelect = () => {
    if (selectedOptions.length === 0 || loading) return;
    sendMessage(selectedOptions.join(", "));
    setSelectedOptions([]);
  };

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  const voice = useVoiceInput({
    onFinalTranscript: useCallback((text: string) => {
      if (text.trim()) setInput((prev) => (prev ? `${prev} ${text.trim()}` : text.trim()));
    }, []),
    onError: (msg) => showStatus("err", msg),
  });

  const handleChatFile = async (files: FileList | null) => {
    if (!files?.[0] || loading) return;
    await sendMessage("", { file: files[0] });
    if (chatFileRef.current) chatFileRef.current.value = "";
  };

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      <WorkspaceTopBar
        projectName={project?.name || "Cargando…"}
        organizationName={organizationName}
        interviewStatus={interviewStatus}
        onSave={handleSave}
        onExit={() => router.push("/projects")}
        saving={saving}
      />

      {statusMsg && (
        <div className={`px-4 py-2.5 text-sm flex items-center gap-2 shrink-0 border-b animate-fade-in ${
          statusMsg.type === "ok" ? "bg-success-muted text-success border-success/20" :
          statusMsg.type === "err" ? "bg-danger-muted text-danger border-danger/20" :
          "bg-secondary-muted text-secondary border-secondary/20"
        }`}>
          {statusMsg.type === "ok" ? <CheckCircle className="w-4 h-4 shrink-0" /> :
           statusMsg.type === "err" ? <AlertCircle className="w-4 h-4 shrink-0" /> :
           <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          {statusMsg.text}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <WorkspaceNav
          tab={tab}
          onTabChange={setTab}
          messageCount={messages.length}
          documentsCount={interviewStatus?.draft_documents_count || 0}
        />

        <div className="flex flex-1 min-h-0">
          <main className="flex-1 flex flex-col min-h-0 min-w-0">
            <div className={`flex flex-1 flex-col min-h-0 ${tab !== "chat" ? "hidden" : ""}`}>
              <div className="flex-1 overflow-y-auto enterprise-scroll bg-surface">
                <div className="max-w-4xl mx-auto px-4 lg:px-8 py-8 space-y-6">
                  {messages.length === 0 && (
                    <div className="card text-center py-16 animate-fade-in">
                      <div className="flex justify-center mb-5">
                        <Image
                          src="/processum.png"
                          alt="Processum"
                          width={180}
                          height={48}
                          className="h-12 w-auto object-contain"
                          priority
                        />
                      </div>
                      <h2 className="text-xl font-semibold text-primary">Processum S.A.</h2>
                      <p className="text-sm text-secondary font-medium mt-1">
                        Consultorías y capacitación en SGC
                      </p>
                      <p className="text-sm text-ink-muted mt-4 max-w-md mx-auto leading-relaxed">
                        Inicia la entrevista para construir la documentación de tu Sistema de Gestión de Calidad
                        de forma progresiva.
                      </p>
                      <button onClick={startInterview} disabled={loading} className="btn-primary mt-8 inline-flex items-center gap-2">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Iniciar entrevista
                      </button>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <ChatMessageBubble
                      key={msg.id}
                      message={msg}
                      onOptionClick={msg.id === activeQuestion?.id ? handleOptionAnswer : undefined}
                      selectedOptions={msg.id === activeQuestion?.id ? selectedOptions : []}
                      isMultiSelect={msg.id === activeQuestion?.id && isMultiSelect}
                    />
                  ))}

                  {loading && (
                    <div className="card !p-4 flex items-center gap-3 animate-fade-in max-w-md">
                      <Loader2 className="w-5 h-5 animate-spin text-secondary" />
                      <div>
                        <p className="text-sm font-medium text-ink">Procesando respuesta</p>
                        <p className="text-xs text-ink-muted">
                          Analizando información y actualizando documentos SGC…
                        </p>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              {messages.length > 0 && (
                <ChatComposer
                  input={input}
                  onInputChange={setInput}
                  onSend={() => sendMessage()}
                  loading={loading}
                  voiceSupported={voice.supported}
                  voiceListening={voice.listening}
                  voiceInterim={voice.interim}
                  onVoiceToggle={voice.toggle}
                  onFileSelect={handleChatFile}
                  fileInputRef={chatFileRef}
                  fileRequested={fileRequested}
                  showTextInput={showTextInput}
                  questionOptions={activeQuestion?.id === lastAssistant?.id ? questionOptions : []}
                  isMultiSelect={isMultiSelect}
                  isDropdown={isDropdown}
                  isDate={isDate}
                  selectedOptions={selectedOptions}
                  onOptionClick={handleOptionAnswer}
                  onSubmitMulti={submitMultiSelect}
                  onDropdownChange={(v) => sendMessage(v)}
                  onDateSelect={(v) => sendMessage(v)}
                />
              )}
            </div>

            <div className={`flex flex-1 flex-col min-h-0 ${tab !== "documents" ? "hidden" : ""}`}>
              <SgqDraftsPanel
                projectId={id}
                refreshKey={draftsRefreshKey}
                organizationName={organizationName}
              />
            </div>

            <div className={`flex flex-1 flex-col min-h-0 ${tab !== "diagnosis" ? "hidden" : ""}`}>
              <SgqDiagnosisPanel
                projectId={id}
                interviewActive={!!interviewStatus?.active}
                refreshKey={draftsRefreshKey}
                organizationName={organizationName}
                onStatus={showStatus}
              />
            </div>
          </main>

          {tab === "chat" && (
            <InterviewSidebar
              interviewStatus={interviewStatus}
              documents={knowledgePreview?.documents as Record<string, SgqDocument> | undefined}
              loadingDocs={loadingDocs}
            />
          )}
        </div>
      </div>
    </div>
  );
}
