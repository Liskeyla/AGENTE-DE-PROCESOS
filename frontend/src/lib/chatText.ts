/** Elimina marcado markdown para mostrar texto plano legible. */
export function stripMarkdown(text: string | null | undefined): string {
  if (text == null) return "";
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/**
 * Gemini a veces devuelve opciones como {label, value} en vez de strings.
 * Renderizar objetos en React provoca el "Application error" de Next.js.
 */
export function normalizeChoiceOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push(t);
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const label = o.label ?? o.text ?? o.name ?? o.value;
      if (typeof label === "string" && label.trim()) {
        out.push(label.trim());
      } else if (label != null && String(label).trim()) {
        out.push(String(label).trim());
      }
    }
  }
  return out;
}

/** Divide en bloques: párrafos y listas con viñetas (conserva saltos útiles). */
export function splitParagraphs(text: string): string[] {
  const cleaned = sanitizeUserFacingText(text);
  if (!cleaned) return [];

  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const isBullet = /^([•\-\*]|\d+[.)])\s+/.test(trimmed);
    if (
      isBullet &&
      current.length > 0 &&
      !/^([•\-\*]|\d+[.)])\s+/.test(current[current.length - 1].trim())
    ) {
      flush();
    }
    current.push(trimmed);
  }
  flush();
  return blocks;
}

/** Oculta referencias internas a cláusulas ISO en mensajes ya guardados. */
export function sanitizeUserFacingText(text: string | null | undefined): string {
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

export function isHiddenIntroMessage(content: string | null | undefined): boolean {
  const t = sanitizeUserFacingText(content);
  return !t;
}
