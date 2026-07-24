import { FLOW_LAYOUT } from "./types";

/** Estima líneas de texto sin cortar palabras (máx. maxLines). */
export function wrapText(
  text: string,
  maxWidthPx: number,
  fontSize = FLOW_LAYOUT.fontSize,
  maxLines = FLOW_LAYOUT.maxLines,
): string[] {
  const avg = fontSize * 0.52;
  const charsPerLine = Math.max(10, Math.floor(maxWidthPx / avg));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= charsPerLine) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (lines.length >= maxLines) {
      current = "";
      break;
    }
    // Palabra larga: partir sin cortar a mitad si cabe en una línea
    if (word.length > charsPerLine) {
      let rest = word;
      while (rest.length > charsPerLine && lines.length < maxLines) {
        lines.push(rest.slice(0, charsPerLine));
        rest = rest.slice(charsPerLine);
      }
      current = rest;
    } else {
      current = word;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    const joined = lines.join(" ");
    if (joined.length < text.trim().length && lines[maxLines - 1].length > 1) {
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, "")}…`;
    }
  }
  return lines.length ? lines : [""];
}

export function measureActivityHeight(label: string, hasStatus = false): number {
  const textW = FLOW_LAYOUT.nodeWidth - FLOW_LAYOUT.nodePadding * 2;
  const lines = wrapText(label, textW);
  const textH = lines.length * FLOW_LAYOUT.lineHeight;
  const statusH = hasStatus ? 18 : 0;
  const badgeSpace = 8;
  return Math.max(
    72,
    FLOW_LAYOUT.nodePadding * 2 + badgeSpace + textH + statusH,
  );
}

export function measureEventHeight(label: string): number {
  const lines = wrapText(label, FLOW_LAYOUT.nodeWidth - 16, 12, 2);
  return FLOW_LAYOUT.startEndRadius * 2 + 12 + lines.length * 16;
}
