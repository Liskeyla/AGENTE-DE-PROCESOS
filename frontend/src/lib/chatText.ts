/** Elimina marcado markdown para mostrar texto plano legible. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

export function splitParagraphs(text: string): string[] {
  return sanitizeUserFacingText(text)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
}

/** Oculta referencias internas a cláusulas ISO en mensajes ya guardados. */
export function sanitizeUserFacingText(text: string): string {
  return stripMarkdown(text)
    .replace(/Comenzamos con la Cláusula \d+\s*[–-]\s*[^\n(]+(\(pregunta \d+ de \d+\))?\.?\s*/gi, "")
    .replace(/Comenzamos con la pregunta \d+ de \d+\.?\s*/gi, "")
    .replace(/ISO 9001\s*·\s*Cláusula \d+[^.\n]*/gi, "")
    .replace(/Cl[aá]usula\s*(es\s*)?\d+\.?/gi, "")
    .replace(/\bCl\.\s*\d+\b/gi, "")
    .replace(/¡Excelente! Puedes responder con (texto|texto, voz)[^]*?\.\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isHiddenIntroMessage(content: string): boolean {
  const t = sanitizeUserFacingText(content);
  return !t;
}
