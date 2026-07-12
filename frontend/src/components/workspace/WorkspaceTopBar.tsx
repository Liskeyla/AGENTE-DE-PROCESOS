"use client";

import { InterviewStatus } from "@/lib/api";
import { estimateMinutesRemaining, getClauseLabel } from "@/lib/interviewUtils";
import { LogOut, Save, Shield } from "lucide-react";

interface Props {
  projectName: string;
  organizationName: string;
  interviewStatus: InterviewStatus | null;
  onSave: () => void;
  onExit: () => void;
  saving?: boolean;
}

export default function WorkspaceTopBar({
  projectName,
  organizationName,
  interviewStatus,
  onSave,
  onExit,
  saving,
}: Props) {
  const progress = interviewStatus?.progress_percent ?? 0;
  const answered = interviewStatus?.answered_count ?? 0;
  const mins = estimateMinutesRemaining(interviewStatus);
  const clause = interviewStatus?.current_clause;
  const knowledge = interviewStatus?.knowledge_completeness;

  return (
    <header className="bg-primary text-white shrink-0 shadow-elevated z-20">
      <div className="flex items-center gap-4 px-4 lg:px-6 h-14 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">GeoCar SGQ</p>
            <p className="text-sm font-semibold truncate">{projectName}</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-white/10 text-sm min-w-0">
          <span className="text-white/60 shrink-0">Organización:</span>
          <span className="font-medium truncate">{organizationName}</span>
        </div>

        <div className="flex-1 min-w-0 max-w-2xl mx-auto hidden lg:block">
          {interviewStatus?.active && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-white/75">
                <span>
                  {clause ? `Cláusula ${clause} · ${getClauseLabel(clause)}` : "Entrevista ISO 9001:2015"}
                </span>
                <span>
                  {progress}% · {answered} respuestas
                  {mins != null && ` · ~${mins} min restantes`}
                </span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {knowledge != null && (
            <span className="hidden xl:inline text-xs text-white/70 px-2 py-1 rounded-md bg-white/10">
              Conocimiento {knowledge}%
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors disabled:opacity-60"
            title="El progreso se guarda automáticamente"
          >
            <Save className="w-4 h-4" />
            <span className="hidden sm:inline">{saving ? "Guardando…" : "Guardar"}</span>
          </button>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>

      {interviewStatus?.active && (
        <div className="lg:hidden px-4 py-2 bg-primary/95 border-t border-white/10">
          <div className="flex justify-between text-[11px] text-white/75 mb-1">
            <span>{clause ? `Cláusula ${clause}` : "Entrevista en curso"}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-secondary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </header>
  );
}
