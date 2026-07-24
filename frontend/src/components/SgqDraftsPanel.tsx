"use client";

import { useCallback, useEffect, useState } from "react";
import { api, OrgKnowledgeState, SgqDocument } from "@/lib/api";
import { SGQ_DOCUMENT_LABELS } from "@/lib/sgqDocuments";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import SgqDocumentsGrid from "@/components/SgqDocumentsGrid";

interface Props {
  projectId: string;
  refreshKey?: number;
  organizationName?: string;
}

export default function SgqDraftsPanel({
  projectId,
  refreshKey = 0,
  organizationName = "Organización",
}: Props) {
  const [data, setData] = useState<OrgKnowledgeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getOrgKnowledgeState(projectId);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const showMsg = (type: "ok" | "err" | "info", text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), type === "err" ? 20000 : 10000);
  };

  const handleCompleteDrafts = async (force: boolean) => {
    if (generating) return;
    const confirmMsg = force
      ? "¿Regenerar todos los borradores?\n\nPrioriza mapa de procesos y diagramas de flujo (estilo Bizagi). Puede tardar varios minutos."
      : "¿Completar los borradores pendientes?\n\nPrimero flujo de procesos (mapa + diagramas Bizagi), luego el resto. Puede tardar varios minutos.";
    if (!window.confirm(confirmMsg)) return;

    setGenerating(true);
    showMsg("info", "Generando borradores… primero procesos y flujos. No cierre esta pestaña.");
    try {
      const result = await api.completeSgqDrafts(projectId, { force });
      setData((prev) =>
        prev
          ? {
              ...prev,
              documents: (result.documents || prev.documents) as Record<string, SgqDocument>,
            }
          : prev,
      );
      const updatedLabels = (result.updated || [])
        .map((k) => SGQ_DOCUMENT_LABELS[k] || k)
        .slice(0, 5)
        .join(", ");
      const failedNote =
        result.failed?.length > 0
          ? ` Fallaron: ${result.failed.map((k) => SGQ_DOCUMENT_LABELS[k] || k).join(", ")}.`
          : "";
      showMsg(
        "ok",
        `${result.message}${updatedLabels ? ` Listos: ${updatedLabels}.` : ""}${failedNote} Abra «Ver y descargar» en cada tarjeta.`,
      );
      await load();
    } catch (err) {
      showMsg("err", err instanceof Error ? err.message : "No se pudieron generar los borradores.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando documentos…
      </div>
    );
  }

  const documents = (data?.documents || {}) as Record<string, SgqDocument>;
  const pending = data?.pending_information || [];
  const completeness = data?.knowledge_completeness || 0;
  const knowledgeGeneral = (data?.knowledge_state as { general?: { name?: string } } | undefined)?.general;
  const orgName = knowledgeGeneral?.name?.trim() || organizationName || "Organización";

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 enterprise-scroll bg-surface">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Documentos SGC</h2>
          <p className="text-sm text-ink-muted mt-1 max-w-xl">
            Complete los borradores con la información de la entrevista. Se prioriza el flujo de
            procesos (mapa y diagramas tipo Bizagi) y después el resto.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleCompleteDrafts(false)}
            disabled={generating}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Completar borradores
          </button>
          <button
            type="button"
            onClick={() => handleCompleteDrafts(true)}
            disabled={generating}
            className="btn-secondary text-xs disabled:opacity-50"
            title="Vuelve a generar los 15 documentos"
          >
            Regenerar todos
          </button>
          <button
            type="button"
            onClick={load}
            disabled={generating}
            className="p-2 text-ink-muted hover:bg-surface rounded-lg disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            statusMsg.type === "ok"
              ? "bg-success-muted text-success border-success/20"
              : statusMsg.type === "err"
                ? "bg-danger-muted text-danger border-danger/20"
                : "bg-secondary-muted text-secondary border-secondary/20"
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {generating && (
        <div className="card !p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-secondary shrink-0" />
          <div>
            <p className="text-sm font-medium text-ink">Generando documentación…</p>
            <p className="text-xs text-ink-muted">
              Orden: mapa de procesos → diagramas de flujo → caracterización → resto. Cada documento
              se guarda al terminar.
            </p>
          </div>
        </div>
      )}

      <div className="card !p-4">
        <div className="flex justify-between text-sm text-ink-muted mb-2">
          <span>Conocimiento organizacional</span>
          <span>{completeness}%</span>
        </div>
        <div className="h-2 bg-surface rounded-full overflow-hidden">
          <div className="h-full bg-secondary transition-all" style={{ width: `${completeness}%` }} />
        </div>
      </div>

      <SgqDocumentsGrid documents={documents} organizationName={orgName} compact />

      {pending.length > 0 && (
        <div className="bg-warning-muted border border-warning/20 rounded-xl p-4">
          <h3 className="text-sm font-medium text-warning mb-2">Información pendiente</h3>
          <ul className="text-sm text-ink space-y-1 list-disc list-inside">
            {pending.slice(0, 8).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
