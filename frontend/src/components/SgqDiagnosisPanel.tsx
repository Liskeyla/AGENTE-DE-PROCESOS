"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  SgqDiagnosis,
  SgqDocument,
  SgqStatus,
} from "@/lib/api";
import {
  AlertCircle,
  ClipboardList,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import SgqDocumentsGrid from "@/components/SgqDocumentsGrid";
import { DocumentJustification } from "@/lib/sgqDocuments";

interface Props {
  projectId: string;
  interviewActive?: boolean;
  refreshKey?: number;
  organizationName?: string;
  onStatus?: (type: "ok" | "err" | "info", text: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  cumple: { label: "Cumple", color: "bg-success-muted text-success" },
  cumple_parcialmente: { label: "Parcial", color: "bg-warning-muted text-warning" },
  no_cumple: { label: "No cumple", color: "bg-danger-muted text-danger" },
};

const PRIORITY_COLORS: Record<string, string> = {
  alta: "text-danger bg-danger-muted",
  media: "text-warning bg-warning-muted",
  baja: "text-ink-muted bg-surface",
};

export default function SgqDiagnosisPanel({
  projectId,
  interviewActive = false,
  refreshKey = 0,
  organizationName = "Organización",
  onStatus,
}: Props) {
  const [status, setStatus] = useState<SgqStatus | null>(null);
  const [diagnosis, setDiagnosis] = useState<SgqDiagnosis | null>(null);
  const [documents, setDocuments] = useState<Record<string, SgqDocument>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, docs] = await Promise.all([
        api.getSgqStatus(projectId),
        api.listSgqDocuments(projectId).catch(() => ({})),
      ]);
      setStatus(st);
      setDocuments(docs as Record<string, SgqDocument>);
      try {
        const d = await api.getSgqDiagnosis(projectId);
        setDiagnosis(d);
      } catch {
        if (!st.diagnosis_completed) {
          setDiagnosis(null);
        }
      }
    } catch {
      /* mantener datos visibles */
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const runDiagnosis = async () => {
    setLoading(true);
    try {
      const d = await api.runSgqDiagnosis(projectId);
      setDiagnosis(d);
      await load();
      onStatus?.("ok", "Análisis de cumplimiento actualizado.");
    } catch (err) {
      onStatus?.("err", err instanceof Error ? err.message : "Error en diagnóstico");
    } finally {
      setLoading(false);
    }
  };

  const summary = diagnosis?.compliance_summary;
  const hasDiagnosis = !!(
    diagnosis?.diagnosed_at ||
    (diagnosis?.requirements_evaluation?.length ?? 0) > 0
  );

  const orgName =
    (diagnosis?.organization_context as { organization_name?: string } | undefined)?.organization_name?.trim() ||
    organizationName;

  const justifications = useMemo(() => {
    const map: Record<string, DocumentJustification> = {};
    diagnosis?.proposed_components?.forEach((c) => {
      map[c.component_type] = {
        justification: c.justification,
        related_requirements: c.related_requirements,
        related_gaps: c.related_gaps,
      };
    });
    return map;
  }, [diagnosis?.proposed_components]);

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8 enterprise-scroll bg-surface">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Resultados del Diagnóstico</h2>
          <p className="text-sm text-ink-muted mt-1">
            Cumplimiento ISO, brechas y los mismos documentos SGQ de la pestaña Documentos
            {interviewActive && " · se actualiza durante la entrevista"}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-ink-muted hover:bg-surface-card rounded-lg" title="Actualizar">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={runDiagnosis} disabled={loading} className="btn-primary flex items-center gap-2 text-sm">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : hasDiagnosis ? <ClipboardList className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {hasDiagnosis ? "Actualizar análisis" : "Ejecutar análisis"}
          </button>
        </div>
      </div>

      {!hasDiagnosis && !loading && (
        <div className="card text-center py-10">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-primary/30" />
          <p className="font-medium text-ink">Diagnóstico de cumplimiento en preparación</p>
          <p className="text-sm text-ink-muted mt-2 max-w-md mx-auto">
            Los documentos SGQ ya se construyen con la entrevista. Ejecute el análisis para ver brechas y cumplimiento ISO.
          </p>
        </div>
      )}

      {loading && !hasDiagnosis && (
        <div className="card flex items-center justify-center py-12 gap-3 text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin text-secondary" />
          <span>Analizando cumplimiento ISO…</span>
        </div>
      )}

      {diagnosis && summary && (
        <>
          <section className="card">
            <h3 className="font-semibold text-ink mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Resumen de cumplimiento
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-primary-muted rounded-lg">
                <p className="text-3xl font-bold text-primary">{summary.overall_percent}%</p>
                <p className="text-xs text-ink-muted mt-1">Cumplimiento general</p>
              </div>
              <div className="text-center p-4 bg-success-muted rounded-lg">
                <p className="text-3xl font-bold text-success">{summary.cumple}</p>
                <p className="text-xs text-ink-muted mt-1">Cumple</p>
              </div>
              <div className="text-center p-4 bg-warning-muted rounded-lg">
                <p className="text-3xl font-bold text-warning">{summary.cumple_parcialmente}</p>
                <p className="text-xs text-ink-muted mt-1">Parcial</p>
              </div>
              <div className="text-center p-4 bg-danger-muted rounded-lg">
                <p className="text-3xl font-bold text-danger">{summary.no_cumple}</p>
                <p className="text-xs text-ink-muted mt-1">No cumple</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-faint uppercase">Por cláusula</p>
              {Object.entries(summary.by_clause).sort(([a], [b]) => a.localeCompare(b)).map(([clause, pct]) => (
                <div key={clause} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-24 text-ink">Cláusula {clause}</span>
                  <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                    <div className="h-full bg-secondary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm text-ink-muted w-12 text-right">{pct}%</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3 className="font-semibold text-ink mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-warning" />
              Brechas detectadas ({(diagnosis.gaps || []).length})
            </h3>
            <div className="overflow-x-auto enterprise-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/10 text-left text-ink-muted">
                    <th className="py-2 pr-4">Requisito ISO</th>
                    <th className="py-2 pr-4">Evidencia encontrada</th>
                    <th className="py-2 pr-4">Brecha</th>
                    <th className="py-2 pr-4">Prioridad</th>
                    <th className="py-2">Recomendación</th>
                  </tr>
                </thead>
                <tbody>
                  {(diagnosis.gaps || []).map((gap, i) => (
                    <tr key={i} className="border-b border-primary/5 hover:bg-surface align-top">
                      <td className="py-3 pr-4 font-mono text-xs whitespace-nowrap text-ink">
                        {gap.requirement_id}
                        <span className="block text-ink-faint font-sans">Cl. {gap.clause}</span>
                      </td>
                      <td className="py-3 pr-4 max-w-[10rem] text-ink-muted">{gap.evidence_found}</td>
                      <td className="py-3 pr-4 max-w-xs text-ink">{gap.evidence_missing}</td>
                      <td className="py-3 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[gap.priority] || PRIORITY_COLORS.media}`}>
                          {gap.priority}
                        </span>
                      </td>
                      <td className="py-3 text-ink-muted">{gap.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="card">
            <summary className="font-semibold text-ink cursor-pointer">
              Detalle por requisito ({(diagnosis.requirements_evaluation || []).length})
            </summary>
            <div className="mt-4 space-y-2 max-h-96 overflow-y-auto enterprise-scroll">
              {(diagnosis.requirements_evaluation || []).map((ev) => {
                const st = STATUS_LABELS[ev.status] || STATUS_LABELS.no_cumple;
                return (
                  <div key={ev.requirement_id} className="flex items-start gap-3 py-2 border-b border-primary/5">
                    <span className="font-mono text-xs w-12 shrink-0 text-ink-muted">{ev.requirement_id}</span>
                    <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${st.color}`}>{st.label}</span>
                    <div className="text-xs text-ink-muted">
                      <p className="font-medium text-ink">{ev.title}</p>
                      <p className="mt-0.5">Evidencia: {ev.evidence_found}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        </>
      )}

      <section>
        <h3 className="font-semibold text-ink mb-1">Documentos SGQ</h3>
        <p className="text-sm text-ink-muted mb-4">
          Vista unificada — mismos diagramas de flujo, mapa de procesos y organigrama que en Documentos SGQ.
          {status?.overall_compliance_percent != null && (
            <span className="ml-1">Cumplimiento estimado: {status.overall_compliance_percent}%</span>
          )}
        </p>
        <SgqDocumentsGrid
          documents={documents}
          organizationName={orgName}
          justifications={justifications}
        />
      </section>
    </div>
  );
}
