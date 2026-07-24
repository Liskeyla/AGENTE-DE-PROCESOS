import { FLOW_LAYOUT } from "./types";

/** Estimate wrapped text height without DOM (PDF-safe, deterministic). */
export function estimateTextHeight(
  text: string,
  maxWidth: number,
  fontSize = FLOW_LAYOUT.fontSize,
  lineHeight = FLOW_LAYOUT.lineHeight,
  maxLines = FLOW_LAYOUT.maxLines,
): { height: number; lines: string[] } {
  const avgChar = fontSize * 0.55;
  const charsPerLine = Math.max(8, Math.floor(maxWidth / avgChar));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= charsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
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
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  while (lines.length > maxLines) lines.pop();
  if (lines.length === maxLines && (words.length > 0 || text.length > 0)) {
    const used = lines.join(" ").length;
    if (used < text.trim().length && lines[maxLines - 1].length > 3) {
      lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
    }
  }

  const height = Math.max(lineHeight, lines.length * lineHeight);
  return { height, lines: lines.length ? lines : [""] };
}

export function estimateActivityNodeHeight(label: string, hasStatus = false): number {
  const textMaxW =
    FLOW_LAYOUT.nodeWidth - FLOW_LAYOUT.nodePaddingX * 2;
  const { height: textH } = estimateTextHeight(label, textMaxW);
  const statusH = hasStatus ? 22 : 0;
  return (
    FLOW_LAYOUT.nodePaddingY * 2 +
    textH +
    statusH +
    4
  );
}

export function estimateEventNodeHeight(label: string): number {
  const textMaxW = FLOW_LAYOUT.nodeWidth - 16;
  const { height: textH } = estimateTextHeight(label, textMaxW, 11, 14, 2);
  return FLOW_LAYOUT.startEndSize + 8 + textH;
}
