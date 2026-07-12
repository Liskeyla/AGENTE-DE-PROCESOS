import { InterviewStatus } from "@/lib/api";

const CLAUSE_LABELS: Record<string, string> = {
  "4": "Contexto de la organización",
  "5": "Liderazgo",
  "6": "Planificación",
  "7": "Apoyo",
  "8": "Operación",
  "9": "Evaluación del desempeño",
  "10": "Mejora",
};

export function getClauseLabel(clause?: string): string {
  if (!clause) return "Levantamiento inicial";
  const base = clause.split(".")[0];
  return CLAUSE_LABELS[base] || `Cláusula ${clause}`;
}

export function estimateMinutesRemaining(status: InterviewStatus | null): number | null {
  if (!status?.active || status.completed) return null;
  const pct = status.progress_percent || 0;
  if (pct <= 0) return 25;
  if (pct >= 95) return 2;
  return Math.max(3, Math.round(((100 - pct) / 100) * 28));
}

export function getRequirementStatus(
  requirementId: string | null | undefined,
  fulfilled: string[] = [],
  inProgress?: string | null,
): "completed" | "in_progress" | "pending" {
  if (!requirementId) return "pending";
  if (fulfilled.includes(requirementId)) return "completed";
  if (inProgress === requirementId) return "in_progress";
  return "pending";
}

import { SGQ_DOCUMENT_LABELS } from "@/lib/sgqDocuments";

export const SGQ_DOC_LABELS = SGQ_DOCUMENT_LABELS;
