import { SgqDocument } from "@/lib/api";

export const SGQ_DOCUMENT_TYPES = [
  "mapa_procesos",
  "diagrama_flujo",
  "caracterizacion_procesos",
  "matriz_interaccion",
  "organigrama",
  "contexto_organizacion",
  "alcance_sgc",
  "partes_interesadas",
  "cumplimiento_legal",
  "politica_calidad",
  "objetivos_calidad",
  "procedimientos",
  "riesgos_oportunidades",
  "indicadores",
  "registros_requeridos",
] as const;

export const SGQ_DOCUMENT_LABELS: Record<string, string> = {
  mapa_procesos: "Mapa de procesos",
  diagrama_flujo: "Diagramas de flujo",
  caracterizacion_procesos: "Caracterización de procesos",
  matriz_interaccion: "Interacción entre procesos",
  organigrama: "Organigrama funcional",
  contexto_organizacion: "Contexto de la organización",
  alcance_sgc: "Alcance del Sistema de Gestión de Calidad",
  partes_interesadas: "Identificación de partes interesadas",
  cumplimiento_legal: "Matriz de cumplimiento legal",
  politica_calidad: "Política de calidad",
  objetivos_calidad: "Objetivos de calidad",
  procedimientos: "Procedimientos",
  riesgos_oportunidades: "Matriz de riesgos y oportunidades",
  indicadores: "Indicadores de desempeño",
  registros_requeridos: "Registros requeridos",
};

/** Propósito breve y referencia ISO para el encabezado de cada documento. */
export const SGQ_DOCUMENT_META: Record<
  string,
  { purpose: string; iso_ref: string }
> = {
  mapa_procesos: {
    purpose:
      "Identifica y clasifica los procesos de la organización (estratégicos, misionales y de apoyo) y su interrelación.",
    iso_ref: "ISO 9001:2015 — Cláusula 4.4 (Sistema de gestión de la calidad y sus procesos)",
  },
  diagrama_flujo: {
    purpose:
      "Describe la secuencia operativa TO BE de cada proceso, con roles, actividades y puntos de decisión.",
    iso_ref: "ISO 9001:2015 — Cláusulas 4.4 y 8.1 (Planificación y control operacional)",
  },
  caracterizacion_procesos: {
    purpose:
      "Documenta objetivo, alcance, responsable, entradas, salidas y actividades principales de cada proceso.",
    iso_ref: "ISO 9001:2015 — Cláusulas 4.4 y 7.5 (Información documentada)",
  },
  matriz_interaccion: {
    purpose:
      "Muestra cómo interactúan los procesos entre sí y qué información o dependencias se transfieren.",
    iso_ref: "ISO 9001:2015 — Cláusula 4.4 (Interacción de procesos)",
  },
  organigrama: {
    purpose:
      "Representa la estructura organizacional, cargos y líneas de responsabilidad del SGC.",
    iso_ref: "ISO 9001:2015 — Cláusulas 5.3 y 4.4 (Roles, responsabilidades y autoridades)",
  },
  contexto_organizacion: {
    purpose:
      "Analiza factores internos y externos que afectan la capacidad de la organización para lograr los resultados del SGC.",
    iso_ref: "ISO 9001:2015 — Cláusula 4.1 (Comprensión de la organización y de su contexto)",
  },
  alcance_sgc: {
    purpose:
      "Delimita el alcance del SGC: productos/servicios, ubicaciones, límites y exclusiones justificadas.",
    iso_ref: "ISO 9001:2015 — Cláusula 4.3 (Determinación del alcance del SGC)",
  },
  partes_interesadas: {
    purpose:
      "Identifica partes interesadas relevantes y sus necesidades y expectativas aplicables al SGC.",
    iso_ref: "ISO 9001:2015 — Cláusula 4.2 (Comprensión de las necesidades de las partes interesadas)",
  },
  cumplimiento_legal: {
    purpose:
      "Registra requisitos legales y reglamentarios aplicables y el estado de cumplimiento.",
    iso_ref: "ISO 9001:2015 — Cláusulas 4.2 y 6.1 (Requisitos legales y riesgos)",
  },
  politica_calidad: {
    purpose:
      "Establece el compromiso de la dirección con la calidad, alineado a la estrategia y al contexto.",
    iso_ref: "ISO 9001:2015 — Cláusula 5.2 (Política)",
  },
  objetivos_calidad: {
    purpose:
      "Define objetivos medibles de calidad, metas, plazos y responsables alineados a la política.",
    iso_ref: "ISO 9001:2015 — Cláusula 6.2 (Objetivos de la calidad)",
  },
  procedimientos: {
    purpose:
      "Estandariza la forma de ejecutar procesos críticos mediante pasos, roles y registros asociados.",
    iso_ref: "ISO 9001:2015 — Cláusulas 7.5, 8.1 y 8.5 (Información documentada y operación)",
  },
  riesgos_oportunidades: {
    purpose:
      "Identifica riesgos y oportunidades relacionados con los procesos y propone acciones de tratamiento.",
    iso_ref: "ISO 9001:2015 — Cláusula 6.1 (Acciones para abordar riesgos y oportunidades)",
  },
  indicadores: {
    purpose:
      "Define indicadores para medir el desempeño de los procesos y el logro de objetivos de calidad.",
    iso_ref: "ISO 9001:2015 — Cláusulas 9.1 y 6.2 (Seguimiento, medición y objetivos)",
  },
  registros_requeridos: {
    purpose:
      "Lista los registros del SGC necesarios para evidenciar la conformidad y el control de la información documentada.",
    iso_ref: "ISO 9001:2015 — Cláusula 7.5 (Información documentada / registros)",
  },
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
