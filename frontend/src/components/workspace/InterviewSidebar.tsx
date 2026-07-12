"use client";

import { InterviewStatus, SgqDocument } from "@/lib/api";
import {
  getClauseLabel,
  getRequirementStatus,
} from "@/lib/interviewUtils";
import { SGQ_DOCUMENT_LABELS } from "@/lib/sgqDocuments";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Loader2,
} from "lucide-react";

interface Props {
  interviewStatus: InterviewStatus | null;
  documents?: Record<string, SgqDocument>;
  loadingDocs?: boolean;
}

function StatusBadge({ status }: { status: "completed" | "in_progress" | "pending" }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success bg-success-muted px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> Completado
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-secondary bg-secondary-muted px-2 py-0.5 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" /> En progreso
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint bg-surface px-2 py-0.5 rounded-full">
      <Circle className="w-3 h-3" /> Pendiente
    </span>
  );
}

export default function InterviewSidebar({ interviewStatus, documents = {}, loadingDocs }: Props) {
  const reqId = interviewStatus?.requirement_in_progress;
  const fulfilled = interviewStatus?.requirements_fulfilled || [];
  const reqStatus = getRequirementStatus(reqId, fulfilled, reqId);
  const clause = interviewStatus?.current_clause;

  const docEntries = Object.keys(SGQ_DOCUMENT_LABELS).map((key) => ({
    key,
    label: SGQ_DOCUMENT_LABELS[key],
    doc: documents[key],
  }));

  return (
    <aside className="hidden xl:flex w-80 flex-col bg-surface-card border-l border-primary/10 shrink-0 enterprise-scroll overflow-y-auto">
      <div className="p-5 border-b border-primary/10">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-ink">Asistente contextual</h2>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          Seguimiento de la norma ISO 9001:2015 y documentos en construcción.
        </p>
      </div>

      <div className="p-5 space-y-5">
        <section className="card !p-4 !shadow-none">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-2">
            Requisito actual
          </p>
          <p className="text-sm font-semibold text-ink">
            {reqId ? `ISO ${reqId}` : "—"}
          </p>
          <p className="text-xs text-ink-muted mt-1">{getClauseLabel(clause)}</p>
          <div className="mt-3">
            <StatusBadge status={reqStatus} />
          </div>
        </section>

        {interviewStatus?.active && (
          <section className="card !p-4 !shadow-none">
            <div className="flex items-center gap-2 text-xs text-ink-muted mb-2">
              <Clock className="w-3.5 h-3.5" />
              Avance de entrevista
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-surface p-2">
                <p className="text-lg font-bold text-primary">{interviewStatus.progress_percent}%</p>
                <p className="text-[10px] text-ink-faint">Progreso</p>
              </div>
              <div className="rounded-lg bg-surface p-2">
                <p className="text-lg font-bold text-primary">{interviewStatus.answered_count}</p>
                <p className="text-[10px] text-ink-faint">Respuestas</p>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-ink">Documentos SGQ</h3>
            </div>
            {loadingDocs && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-faint" />}
          </div>
          <ul className="space-y-2">
            {docEntries.map(({ key, label, doc }) => {
              const pct = doc?.completeness_percent ?? 0;
              const status = doc?.status || "pendiente";
              return (
                <li
                  key={key}
                  className="rounded-lg border border-primary/10 bg-white px-3 py-2.5 transition-colors"
                >
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-xs font-medium text-ink leading-tight">{label}</p>
                    <span className="text-[10px] text-ink-faint shrink-0">{pct}%</span>
                  </div>
                  <div className="mt-2 h-1 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-secondary rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-ink-faint mt-1 capitalize">{status}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {(interviewStatus?.topics_covered?.length ?? 0) > 0 && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-2">
              Temas cubiertos
            </p>
            <div className="flex flex-wrap gap-1.5">
              {interviewStatus!.topics_covered!.slice(0, 8).map((t) => (
                <span key={t} className="text-[10px] px-2 py-1 rounded-md bg-primary-muted text-primary">
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
