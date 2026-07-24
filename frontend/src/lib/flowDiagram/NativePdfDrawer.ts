import { wrapText } from "./measure";
import {
  FLOW_LAYOUT,
  FLOW_THEME,
  type FlowLayoutResult,
  type LaidOutEdge,
  type LaidOutNode,
  type Point,
} from "./types";

export type PdfMeta = {
  organizationName?: string;
  processType?: string;
  version?: string;
  generatedAt?: Date;
};

export type PageFormat = "a4" | "a3";

type JsPdfDoc = {
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  setFillColor: (...args: number[]) => void;
  setDrawColor: (...args: number[]) => void;
  setTextColor: (...args: number[]) => void;
  setFont: (font: string, style?: string) => void;
  setFontSize: (size: number) => void;
  setLineWidth: (w: number) => void;
  rect: (x: number, y: number, w: number, h: number, style?: string) => void;
  roundedRect: (
    x: number,
    y: number,
    w: number,
    h: number,
    rx: number,
    ry: number,
    style?: string,
  ) => void;
  circle: (x: number, y: number, r: number, style?: string) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  text: (
    text: string | string[],
    x: number,
    y: number,
    options?: { align?: string; baseline?: string; maxWidth?: number },
  ) => void;
  addPage: (format?: string, orientation?: string) => void;
  getNumberOfPages: () => number;
  setPage: (n: number) => void;
  save: (name: string) => void;
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Elige A3 si el diagrama es grande; A4 si es compacto. */
export function choosePageFormat(layout: FlowLayoutResult): PageFormat {
  const cols = Math.max(...layout.nodes.map((n) => n.columnIndex), 0) + 1;
  const lanes = layout.lanes.length;
  if (layout.width > 1600 || cols >= 8 || lanes >= 5 || layout.nodes.length >= 12) {
    return "a3";
  }
  return "a4";
}

/**
 * Escala el layout para ocupar el 100% del ancho útil (coordenadas en px lógicos).
 * Mantiene proporciones; no usa CSS ni capturas.
 */
export function scaleLayoutToPageWidth(
  layout: FlowLayoutResult,
  targetWidthPx: number,
): FlowLayoutResult {
  const factor = targetWidthPx / Math.max(layout.width, 1);
  if (Math.abs(factor - 1) < 0.01) return layout;

  const mapPt = (p: Point): Point => ({ x: p.x * factor, y: p.y * factor });

  return {
    ...layout,
    width: layout.width * factor,
    height: layout.height * factor,
    laneLabelWidth: layout.laneLabelWidth * factor,
    nodeWidth: layout.nodeWidth * factor,
    margin: layout.margin * factor,
    lanes: layout.lanes.map((l) => ({
      ...l,
      y: l.y * factor,
      height: l.height * factor,
    })),
    nodes: layout.nodes.map((n) => ({
      ...n,
      x: n.x * factor,
      y: n.y * factor,
      width: n.width * factor,
      height: n.height * factor,
    })),
    edges: layout.edges.map((e) => ({
      ...e,
      points: e.points.map(mapPt),
    })),
  };
}

function routeSimple(sx: number, sy: number, tx: number, ty: number): Point[] {
  if (Math.abs(sy - ty) < 1.5) {
    return [
      { x: sx, y: sy },
      { x: tx, y: ty },
    ];
  }
  const midX = sx + Math.max(28, (tx - sx) * 0.5);
  return [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ];
}

function eventAnchor(n: LaidOutNode, side: "out" | "in"): Point {
  const isEvent = n.kind === "start" || n.kind === "end";
  if (!isEvent) {
    return {
      x: side === "out" ? n.x + n.width : n.x,
      y: n.y + n.height / 2,
    };
  }
  const cy = n.y + Math.min(n.height * 0.35, FLOW_LAYOUT.startEndRadius + 8);
  return {
    x:
      side === "out"
        ? n.x + n.width / 2 + FLOW_LAYOUT.startEndRadius * 0.85
        : n.x + n.width / 2 - FLOW_LAYOUT.startEndRadius * 0.85,
    y: cy,
  };
}

/**
 * Expande las swimlanes para llenar el alto útil de la página
 * (evita la franja vacía inferior en diagramas anchos).
 */
export function expandLayoutToFillHeight(
  layout: FlowLayoutResult,
  targetHeightPx: number,
): FlowLayoutResult {
  if (targetHeightPx <= layout.height + 2 || layout.lanes.length === 0) {
    return layout;
  }

  const extra = targetHeightPx - layout.height;
  const perLane = extra / layout.lanes.length;

  const lanes = layout.lanes.map((l, i) => ({
    ...l,
    y: l.y + i * perLane,
    height: l.height + perLane,
  }));

  const nodes = layout.nodes.map((n) => {
    const lane = lanes[n.laneIndex] ?? lanes[0];
    return {
      ...n,
      y: lane.y + (lane.height - n.height) / 2,
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = layout.edges.map((e) => {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) return e;
    const a = eventAnchor(s, "out");
    const b = eventAnchor(t, "in");
    return { ...e, points: routeSimple(a.x, a.y, b.x, b.y) };
  });

  return {
    ...layout,
    height: targetHeightPx,
    lanes,
    nodes,
    edges,
  };
}

/** Cortes verticales que no parten nodos ni lanes a mitad. */
export function computeSafePageBreaks(
  layout: FlowLayoutResult,
  maxContentHeightPx: number,
): Array<{ y0: number; y1: number }> {
  if (layout.height <= maxContentHeightPx + 1) {
    return [{ y0: 0, y1: layout.height }];
  }

  const boundaries = new Set<number>([0, layout.height]);
  for (const lane of layout.lanes) {
    boundaries.add(lane.y);
    boundaries.add(lane.y + lane.height);
  }
  for (const n of layout.nodes) {
    boundaries.add(n.y);
    boundaries.add(n.y + n.height);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const pages: Array<{ y0: number; y1: number }> = [];
  let y0 = 0;
  while (y0 < layout.height - 0.5) {
    const limit = y0 + maxContentHeightPx;
    let y1 = layout.height;
    for (const b of sorted) {
      if (b > y0 + 8 && b <= limit) y1 = b;
    }
    // Si no hay frontera válida, forzar al límite pero empujar antes de nodos cruzados
    if (y1 <= y0) y1 = Math.min(layout.height, limit);
    for (const n of layout.nodes) {
      if (n.y < y1 && n.y + n.height > y1 && n.y > y0 + 8) {
        y1 = n.y;
      }
    }
    for (const lane of layout.lanes) {
      const mid = lane.y + 4;
      const bottom = lane.y + lane.height;
      if (lane.y < y1 && bottom > y1 && mid > y0 + 8) {
        // Preferir corte en borde de lane
        if (lane.y > y0 + 8) y1 = Math.min(y1, lane.y);
        else y1 = Math.min(y1, bottom);
      }
    }
    if (y1 <= y0) y1 = Math.min(layout.height, y0 + maxContentHeightPx);
    pages.push({ y0, y1 });
    y0 = y1;
    if (pages.length > 60) break;
  }
  return pages;
}

function drawArrowHead(
  pdf: JsPdfDoc,
  from: Point,
  to: Point,
  sizeMm: number,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  const p1 = { x: to.x + Math.cos(a1) * sizeMm, y: to.y + Math.sin(a1) * sizeMm };
  const p2 = { x: to.x + Math.cos(a2) * sizeMm, y: to.y + Math.sin(a2) * sizeMm };
  pdf.setFillColor(...hexToRgb(FLOW_THEME.arrow));
  // Triángulo con líneas (jsPDF no tiene fill polygon simple en todas versiones)
  pdf.setDrawColor(...hexToRgb(FLOW_THEME.arrow));
  pdf.setLineWidth(0.35);
  pdf.line(to.x, to.y, p1.x, p1.y);
  pdf.line(to.x, to.y, p2.x, p2.y);
  pdf.line(p1.x, p1.y, p2.x, p2.y);
}

function drawOrthogonalEdge(
  pdf: JsPdfDoc,
  edge: LaidOutEdge,
  toMm: (p: Point) => Point,
  yOffsetPx: number,
  pxToMm: number,
) {
  if (edge.points.length < 2) return;
  const pts = edge.points.map((p) =>
    toMm({ x: p.x, y: p.y - yOffsetPx }),
  );
  pdf.setDrawColor(...hexToRgb(FLOW_THEME.arrow));
  pdf.setLineWidth(0.45);
  for (let i = 0; i < pts.length - 1; i++) {
    pdf.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  drawArrowHead(pdf, prev, last, 2.2);

  if (edge.label) {
    const mid = pts[Math.floor(pts.length / 2)];
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...hexToRgb("#92400E"));
    pdf.text(edge.label, mid.x, mid.y - 1.5, { align: "center" });
  }
}

function drawNode(
  pdf: JsPdfDoc,
  node: LaidOutNode,
  toMm: (p: Point) => Point,
  yOffsetPx: number,
  pxToMm: number,
) {
  const origin = toMm({ x: node.x, y: node.y - yOffsetPx });
  const x = origin.x;
  const y = origin.y;
  const w = node.width * pxToMm;
  const h = node.height * pxToMm;
  // Escala tipográfica según tamaño real del nodo en mm
  const fs = Math.min(1.4, Math.max(0.7, w / 48));

  if (node.kind === "start" || node.kind === "end") {
    const isStart = node.kind === "start";
    const cx = x + w / 2;
    const r = Math.min(w * 0.18, h * 0.2, 7.5 * fs);
    // Círculo arriba; etiqueta del evento debajo (sin invadir la flecha horizontal)
    const cy = y + r + 2 * fs;
    pdf.setFillColor(...hexToRgb(isStart ? FLOW_THEME.startFill : FLOW_THEME.endFill));
    pdf.setDrawColor(...hexToRgb(isStart ? FLOW_THEME.startBorder : FLOW_THEME.endBorder));
    pdf.setLineWidth(isStart ? 0.7 : 0.95);
    pdf.circle(cx, cy, r, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8 * fs);
    pdf.setTextColor(...hexToRgb(isStart ? FLOW_THEME.startBorder : FLOW_THEME.endBorder));
    pdf.text(isStart ? "Inicio" : "Fin", cx, cy + 0.9 * fs, { align: "center" });
    const lines = wrapText(node.label, Math.max(100, node.width - 12), 11, 3);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5 * fs);
    pdf.setTextColor(...hexToRgb(FLOW_THEME.text));
    lines.forEach((line, i) => {
      pdf.text(line, cx, cy + r + 3.2 * fs + i * 3.1 * fs, { align: "center" });
    });
    return;
  }

  if (node.kind === "decision") {
    const cx = x + w / 2;
    const size = Math.min(14 * fs, w * 0.3);
    const cy = y + size / 2 + 2 * fs;
    const s = size / 2;
    pdf.setFillColor(...hexToRgb(FLOW_THEME.gatewayFill));
    pdf.setDrawColor(...hexToRgb(FLOW_THEME.gatewayBorder));
    pdf.setLineWidth(0.5);
    pdf.line(cx, cy - s, cx + s, cy);
    pdf.line(cx + s, cy, cx, cy + s);
    pdf.line(cx, cy + s, cx - s, cy);
    pdf.line(cx - s, cy, cx, cy - s);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11 * fs);
    pdf.setTextColor(...hexToRgb("#92400E"));
    pdf.text("?", cx, cy + 1, { align: "center" });
    const lines = wrapText(node.label, Math.max(120, node.width - 8), 12, FLOW_LAYOUT.maxLines);
    pdf.setFontSize(9 * fs);
    pdf.setTextColor(...hexToRgb(FLOW_THEME.textStrong));
    lines.forEach((line, i) => {
      pdf.text(line, cx, cy + s + 4 * fs + i * 3.4 * fs, { align: "center" });
    });
    return;
  }

  // Actividad — caja profesional
  pdf.setFillColor(...hexToRgb(FLOW_THEME.activityBg));
  pdf.setDrawColor(...hexToRgb(FLOW_THEME.activityBorder));
  pdf.setLineWidth(0.55);
  const radius = Math.min(2.8, w * 0.04);
  pdf.roundedRect(x, y, w, h, radius, radius, "FD");

  const badgeR = Math.min(3.2 * fs, 3.4);
  let textX = x + 3.2 * fs;
  if (node.number != null) {
    const bx = x + 3.2 * fs + badgeR;
    const by = y + 3.2 * fs + badgeR;
    pdf.setFillColor(...hexToRgb(FLOW_THEME.header));
    pdf.circle(bx, by, badgeR, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5 * fs);
    pdf.setTextColor(255, 255, 255);
    pdf.text(String(node.number), bx, by + 0.85 * fs, { align: "center" });
    textX = bx + badgeR + 2.2 * fs;
  }

  const textWpx = Math.max(80, node.width - FLOW_LAYOUT.nodePadding * 2 - 28);
  const lines = wrapText(node.label, textWpx, 13, FLOW_LAYOUT.maxLines);
  const lineH = 3.8 * fs;
  const blockH = lines.length * lineH;
  const textY0 = y + Math.max(4.5 * fs, (h - blockH) / 2 + 2.2 * fs);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10 * fs);
  pdf.setTextColor(...hexToRgb(FLOW_THEME.textStrong));
  lines.forEach((line, i) => {
    pdf.text(line, textX, textY0 + i * lineH);
  });
}

function drawSwimlanes(
  pdf: JsPdfDoc,
  layout: FlowLayoutResult,
  toMm: (p: Point) => Point,
  yOffsetPx: number,
  contentBottomMm: number,
  pxToMm: number,
) {
  for (const lane of layout.lanes) {
    const top = toMm({ x: 0, y: lane.y - yOffsetPx }).y;
    const bottom = toMm({ x: 0, y: lane.y + lane.height - yOffsetPx }).y;
    if (bottom < 5 || top > contentBottomMm) continue;
    const y = Math.max(top, 0);
    const h = Math.min(bottom, contentBottomMm) - y;
    if (h < 0.5) continue;

    const x0 = toMm({ x: 0, y: 0 }).x;
    const fullW = layout.width * pxToMm;
    const labelW = layout.laneLabelWidth * pxToMm;
    const bg = FLOW_THEME.laneBgs[lane.index % FLOW_THEME.laneBgs.length];
    const bar = FLOW_THEME.laneBars[lane.index % FLOW_THEME.laneBars.length];

    pdf.setFillColor(...hexToRgb(bg));
    pdf.setDrawColor(...hexToRgb(FLOW_THEME.swimlaneBorder));
    pdf.setLineWidth(0.25);
    pdf.rect(x0, y, fullW, h, "FD");

    pdf.setFillColor(...hexToRgb(bar));
    pdf.rect(x0, y, labelW, h, "F");

    pdf.setFont("helvetica", "bold");
    const laneFs = Math.min(11, Math.max(7.5, labelW * 0.11));
    pdf.setFontSize(laneFs);
    pdf.setTextColor(255, 255, 255);
    const labelLines = wrapText(lane.label, Math.max(90, layout.laneLabelWidth - 16), 11, 4);
    const midY = y + h / 2 - ((labelLines.length - 1) * (laneFs * 0.42)) / 2;
    labelLines.forEach((line, i) => {
      pdf.text(line, x0 + labelW / 2, midY + i * (laneFs * 0.45), { align: "center" });
    });
  }
}

function drawDocHeader(
  pdf: JsPdfDoc,
  layout: FlowLayoutResult,
  meta: PdfMeta,
  pageIndex: number,
  pageCount: number,
  marginMm: number,
  pageW: number,
  headerH: number,
) {
  const org = meta.organizationName || "Organización";
  const processType = meta.processType || layout.modeLabel;
  const version = meta.version || "V01";
  const date = (meta.generatedAt || new Date()).toLocaleDateString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  pdf.setFillColor(...hexToRgb(FLOW_THEME.header));
  pdf.rect(marginMm, marginMm, pageW - marginMm * 2, headerH, "F");

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  const titleMax = pageW - marginMm * 2 - 8;
  pdf.text(layout.headerTitle, marginMm + 4, marginMm + 6.2, {
    maxWidth: titleMax,
  });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text(org, marginMm + 4, marginMm + 12.2);

  pdf.setFontSize(8);
  const metaLine = `Tipo: ${processType}   |   Versión: ${version}   |   Fecha: ${date}   |   Página ${pageIndex} de ${pageCount}`;
  pdf.text(metaLine, marginMm + 4, marginMm + headerH - 3.2);
}

/**
 * Dibuja el diagrama de forma nativa en jsPDF (vectorial, texto seleccionable).
 * Sin html2canvas, sin screenshots, sin imágenes del DOM.
 * Escala al 100% del ancho y expande swimlanes para llenar el alto útil.
 */
export async function renderDiagramToNativePdf(
  layoutIn: FlowLayoutResult,
  filename: string,
  meta: PdfMeta = {},
): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const format = choosePageFormat(layoutIn);
  const marginMm = 14;
  const headerH = 20;

  const probe = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format,
    compress: true,
  });
  const pageW = probe.internal.pageSize.getWidth();
  const pageH = probe.internal.pageSize.getHeight();
  const usableW = pageW - marginMm * 2;
  const usableH = pageH - marginMm * 2 - headerH - 3;

  const pxPerMm = 96 / 25.4;
  // 1) Ancho completo de la hoja
  let layout = scaleLayoutToPageWidth(layoutIn, usableW * pxPerMm);
  let pxToMm = usableW / layout.width;
  let contentHmm = layout.height * pxToMm;

  // 2) Si cabe en una página, expandir lanes para llenar el alto (sin estirar nodos)
  const fitsOnePage = contentHmm <= usableH * 1.02;
  if (fitsOnePage) {
    const targetHpx = usableH / pxToMm;
    layout = expandLayoutToFillHeight(layout, targetHpx);
    pxToMm = usableW / layout.width;
    contentHmm = layout.height * pxToMm;
  } else {
    // Multipágina a ancho completo (sin comprimir tipografía)
    pxToMm = usableW / layout.width;
  }

  const drawWidthMm = layout.width * pxToMm;
  const xOffset = marginMm + Math.max(0, (usableW - drawWidthMm) / 2);

  const maxContentHpx = usableH / pxToMm;
  const breaks = fitsOnePage
    ? [{ y0: 0, y1: layout.height }]
    : computeSafePageBreaks(layout, maxContentHpx);
  const pageCount = breaks.length;

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format,
    compress: true,
  }) as unknown as JsPdfDoc;

  for (let i = 0; i < breaks.length; i++) {
    const { y0, y1 } = breaks[i];
    if (i > 0) pdf.addPage(format, "landscape");

    drawDocHeader(
      pdf,
      layout,
      meta,
      i + 1,
      pageCount,
      marginMm,
      pageW,
      headerH,
    );

    const contentTop = marginMm + headerH + 2;
    const contentBottom = pageH - marginMm;

    const toMm = (p: Point): Point => ({
      x: xOffset + p.x * pxToMm,
      y: contentTop + (p.y - y0) * pxToMm,
    });

    drawSwimlanes(pdf, layout, toMm, y0, contentBottom, pxToMm);

    for (const edge of layout.edges) {
      const ys = edge.points.map((p) => p.y);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      if (maxY < y0 || minY > y1) continue;
      drawOrthogonalEdge(pdf, edge, toMm, y0, pxToMm);
    }

    for (const node of layout.nodes) {
      if (node.y + node.height < y0 || node.y > y1) continue;
      if (node.y < y0 || node.y + node.height > y1 + 0.5) continue;
      drawNode(pdf, node, toMm, y0, pxToMm);
    }
  }

  pdf.save(filename);
}

export { downloadBlob };
