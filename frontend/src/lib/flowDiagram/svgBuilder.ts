import { wrapText } from "./measure";
import {
  FLOW_LAYOUT,
  FLOW_THEME,
  type FlowLayoutResult,
  type LaidOutNode,
} from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nodeSvg(n: LaidOutNode): string {
  const { activityBorder, activityBg, textStrong, startFill, startBorder, endFill, endBorder, gatewayFill, gatewayBorder } =
    FLOW_THEME;

  if (n.kind === "start" || n.kind === "end") {
    const isStart = n.kind === "start";
    const cx = n.x + n.width / 2;
    const cy = n.y + FLOW_LAYOUT.startEndRadius + 4;
    const fill = isStart ? startFill : endFill;
    const stroke = isStart ? startBorder : endBorder;
    const lines = wrapText(n.label, n.width - 12, 12, 2);
    const labelY = cy + FLOW_LAYOUT.startEndRadius + 16;
    return `
      <g data-node="${esc(n.id)}">
        <circle cx="${cx}" cy="${cy}" r="${FLOW_LAYOUT.startEndRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${isStart ? 3 : 4}"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Inter,Roboto,Segoe UI,sans-serif" font-size="11" font-weight="700" fill="${stroke}">${isStart ? "Inicio" : "Fin"}</text>
        ${lines
          .map(
            (line, i) =>
              `<text x="${cx}" y="${labelY + i * 15}" text-anchor="middle" font-family="Inter,Roboto,Segoe UI,sans-serif" font-size="12" fill="${FLOW_THEME.text}">${esc(line)}</text>`,
          )
          .join("")}
      </g>`;
  }

  if (n.kind === "decision") {
    const size = 48;
    const cx = n.x + n.width / 2;
    const cy = n.y + size / 2 + 8;
    const lines = wrapText(n.label, n.width - 12, FLOW_LAYOUT.fontSize, FLOW_LAYOUT.maxLines);
    return `
      <g data-node="${esc(n.id)}">
        <rect x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" fill="${gatewayFill}" stroke="${gatewayBorder}" stroke-width="2" transform="rotate(45 ${cx} ${cy})" rx="4"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#92400e">?</text>
        ${n.number != null ? `<text x="${cx}" y="${cy - size / 2 - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="${FLOW_THEME.header}">${n.number}</text>` : ""}
        ${lines
          .map(
            (line, i) =>
              `<text x="${cx}" y="${cy + size / 2 + 18 + i * FLOW_LAYOUT.lineHeight}" text-anchor="middle" font-family="Inter,Roboto,Segoe UI,sans-serif" font-size="${FLOW_LAYOUT.fontSize}" font-weight="600" fill="${textStrong}">${esc(line)}</text>`,
          )
          .join("")}
      </g>`;
  }

  const lines = wrapText(
    n.label,
    n.width - FLOW_LAYOUT.nodePadding * 2,
    FLOW_LAYOUT.fontSize,
    FLOW_LAYOUT.maxLines,
  );
  const textTop = n.y + FLOW_LAYOUT.nodePadding + 14;
  return `
    <g data-node="${esc(n.id)}">
      <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${FLOW_LAYOUT.borderRadius}" ry="${FLOW_LAYOUT.borderRadius}" fill="${activityBg}" stroke="${activityBorder}" stroke-width="${FLOW_LAYOUT.borderWidth}" filter="url(#fd-shadow)"/>
      ${
        n.number != null
          ? `<circle cx="${n.x + 18}" cy="${n.y + 18}" r="11" fill="${FLOW_THEME.header}"/><text x="${n.x + 18}" y="${n.y + 22}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${n.number}</text>`
          : ""
      }
      ${lines
        .map(
          (line, i) =>
            `<text x="${n.x + FLOW_LAYOUT.nodePadding}" y="${textTop + i * FLOW_LAYOUT.lineHeight}" font-family="Inter,Roboto,Segoe UI,sans-serif" font-size="${FLOW_LAYOUT.fontSize}" font-weight="600" fill="${textStrong}">${esc(line)}</text>`,
        )
        .join("")}
    </g>`;
}

/** Construye un SVG vectorial completo (web y PDF idénticos). */
export function buildDiagramSvg(
  layout: FlowLayoutResult,
  options?: { includeHeader?: boolean; organizationName?: string },
): string {
  const includeHeader = options?.includeHeader !== false;
  const org = options?.organizationName ? ` — ${options.organizationName}` : "";
  const headerH = includeHeader ? FLOW_LAYOUT.headerBarHeight : 0;

  const lanes = layout.lanes
    .map((lane) => {
      const bar = FLOW_THEME.laneBars[lane.index % FLOW_THEME.laneBars.length];
      const bg = FLOW_THEME.laneBgs[lane.index % FLOW_THEME.laneBgs.length];
      const labelLines = wrapText(lane.label, layout.laneLabelWidth - 16, 12, 4);
      return `
        <g data-lane="${lane.index}">
          <rect x="0" y="${lane.y}" width="${layout.width}" height="${lane.height}" fill="${bg}" stroke="${FLOW_THEME.swimlaneBorder}" stroke-width="1"/>
          <rect x="0" y="${lane.y}" width="${layout.laneLabelWidth}" height="${lane.height}" fill="${bar}"/>
          ${labelLines
            .map(
              (line, i) =>
                `<text x="${layout.laneLabelWidth / 2}" y="${lane.y + lane.height / 2 - ((labelLines.length - 1) * 7) + i * 14}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Inter,Roboto,Segoe UI,sans-serif" font-size="12" font-weight="700">${esc(line)}</text>`,
            )
            .join("")}
        </g>`;
    })
    .join("");

  const edges = layout.edges
    .map((e) => {
      if (e.points.length < 2) return "";
      const d = e.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");
      const mid = e.points[Math.floor(e.points.length / 2)];
      return `
        <g data-edge="${esc(e.id)}">
          <path d="${d}" fill="none" stroke="${FLOW_THEME.arrow}" stroke-width="2" stroke-linejoin="miter" marker-end="url(#fd-arrow)"/>
          ${
            e.label
              ? `<text x="${mid.x}" y="${mid.y - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#92400e">${esc(e.label)}</text>`
              : ""
          }
        </g>`;
    })
    .join("");

  const nodes = layout.nodes.map(nodeSvg).join("");

  const header = includeHeader
    ? `<rect x="0" y="0" width="${layout.width}" height="${headerH}" fill="${FLOW_THEME.header}"/>
       <text x="${layout.margin}" y="${headerH / 2 + 5}" fill="#fff" font-family="Inter,Roboto,Segoe UI,sans-serif" font-size="14" font-weight="700">${esc(layout.headerTitle + org)}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="Inter,Roboto,Segoe UI,sans-serif">
  <defs>
    <marker id="fd-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0 0 L12 6 L0 12 Z" fill="${FLOW_THEME.arrow}"/>
    </marker>
    <filter id="fd-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${header}
  ${lanes}
  ${edges}
  ${nodes}
</svg>`;
}

/** Calcula cortes de página que no parten nodos (por límites de lane / gaps). */
export function computePageBreaks(
  layout: FlowLayoutResult,
  pageContentHeightPx: number,
): Array<{ y0: number; y1: number }> {
  const breaks: Array<{ y0: number; y1: number }> = [];
  let y0 = 0;
  const candidates = [
    0,
    ...layout.lanes.map((l) => l.y),
    ...layout.lanes.map((l) => l.y + l.height),
    layout.height,
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);

  while (y0 < layout.height - 1) {
    const limit = y0 + pageContentHeightPx;
    let y1 = layout.height;
    for (const c of candidates) {
      if (c > y0 + 40 && c <= limit) y1 = c;
    }
    if (y1 <= y0) y1 = Math.min(layout.height, limit);
    // Asegurar que ningún nodo quede partido
    for (const n of layout.nodes) {
      const top = n.y;
      const bottom = n.y + n.height;
      if (top < y1 && bottom > y1) {
        // Empujar corte antes del nodo
        if (top > y0 + 20) y1 = top;
      }
    }
    breaks.push({ y0, y1 });
    y0 = y1;
    if (breaks.length > 40) break;
  }
  return breaks.length ? breaks : [{ y0: 0, y1: layout.height }];
}
