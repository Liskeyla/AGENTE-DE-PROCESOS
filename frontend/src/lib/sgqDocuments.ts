import { SgqDocument } from "@/lib/api";

export const SGQ_DOCUMENT_TYPES = [
  "contexto_organizacion",
  "alcance_sgc",
  "partes_interesadas",
  "mapa_procesos",
  "caracterizacion_procesos",
  "matriz_interaccion",
  "cumplimiento_legal",
  "organigrama",
  "politica_calidad",
  "objetivos_calidad",
  "procedimientos",
  "diagrama_flujo",
  "riesgos_oportunidades",
  "indicadores",
  "registros_requeridos",
] as const;

export const SGQ_DOCUMENT_LABELS: Record<string, string> = {
  contexto_organizacion: "Contexto de la organización",
  alcance_sgc: "Alcance del Sistema de Gestión de Calidad",
  partes_interesadas: "Identificación de partes interesadas",
  mapa_procesos: "Mapa de procesos",
  caracterizacion_procesos: "Caracterización de procesos",
  matriz_interaccion: "Interacción entre procesos",
  cumplimiento_legal: "Matriz de cumplimiento legal",
  organigrama: "Organigrama funcional",
  politica_calidad: "Política de calidad",
  objetivos_calidad: "Objetivos de calidad",
  procedimientos: "Procedimientos",
  diagrama_flujo: "Diagramas de flujo",
  riesgos_oportunidades: "Matriz de riesgos y oportunidades",
  indicadores: "Indicadores de desempeño",
  registros_requeridos: "Registros requeridos",
};

export interface DocumentJustification {
  justification?: string;
  related_requirements?: string[];
  related_gaps?: { requirement_id: string; priority?: string }[];
}

export function documentIsViewable(doc: SgqDocument | undefined): boolean {
  if (!doc) return false;
  const pct = doc.completeness_percent ?? 0;
  if (pct > 0) return true;
  if (doc.status && doc.status !== "pendiente" && doc.status !== "pending") return true;
  const c = doc.content || {};
  return Object.values(c).some((v) =>
    (Array.isArray(v) && v.length > 0) ||
    (typeof v === "string" && v.trim().length > 10),
  );
}

export function documentStatusLabel(doc: SgqDocument | undefined): string {
  if (!doc) return "Sin iniciar";
  const pct = doc.completeness_percent ?? 0;
  const status = doc.status || "pendiente";
  if (status === "pendiente" || status === "pending") {
    return pct > 0 ? `En construcción · ${pct}%` : "Sin iniciar";
  }
  return `${status} · ${pct}%`;
}
