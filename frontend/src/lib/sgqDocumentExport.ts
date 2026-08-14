import { SgqDocument } from "@/lib/api";

export const SGQ_DOCUMENT_PDF_LABELS: Record<string, string> = {
  contexto_organizacion: "CONTEXTO DE LA ORGANIZACIÓN",
  alcance_sgc: "ALCANCE DEL SISTEMA DE GESTIÓN DE CALIDAD",
  partes_interesadas: "IDENTIFICACIÓN DE PARTES INTERESADAS",
  mapa_procesos: "MAPA DE PROCESOS",
  caracterizacion_procesos: "CARACTERIZACIÓN DE PROCESOS",
  matriz_interaccion: "INTERACCIÓN ENTRE PROCESOS",
  cumplimiento_legal: "MATRIZ DE CUMPLIMIENTO LEGAL",
  organigrama: "ORGANIGRAMA FUNCIONAL",
  politica_calidad: "POLÍTICA DE CALIDAD",
  objetivos_calidad: "OBJETIVOS DE CALIDAD",
  procedimientos: "PROCEDIMIENTOS",
  diagrama_flujo: "DIAGRAMA DE FLUJO",
  riesgos_oportunidades: "MATRIZ DE RIESGOS Y OPORTUNIDADES",
  indicadores: "INDICADORES DE DESEMPEÑO",
  registros_requeridos: "REGISTROS REQUERIDOS",
};

const DIAGRAM_TYPES = new Set([
  "mapa_procesos",
  "diagrama_flujo",
  "organigrama",
]);

/** Diagramas que NO deben aplastarse a 1 página (tipografía legible ~10–12 pt). */
const READABLE_DIAGRAM_TYPES = new Set(["mapa_procesos", "organigrama"]);

const WIDE_DOC_TYPES = new Set([
  "matriz_interaccion",
  "cumplimiento_legal",
  "indicadores",
  "riesgos_oportunidades",
  "partes_interesadas",
  "mapa_procesos",
  "organigrama",
  "caracterizacion_procesos",
  "procedimientos",
  "objetivos_calidad",
  "registros_requeridos",
]);

/** Ancho CSS ≈ área útil A4 (96dpi) — más amplio para no estrujar tablas. */
const DOC_PAGE_PX = {
  portrait: 780,
  landscape: 1180,
} as const;

/** Márgenes del PDF en mm (claros, tipo documento formal). */
const PDF_MARGIN_MM = 17;

type PageOrientation = "portrait" | "landscape";
type ExportMode = "document" | "diagram";

type ExportOptions = {
  organizationName: string;
  landscape?: boolean;
  diagramProcessName?: string;
};

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getOrganizationName(
  doc: SgqDocument,
  fallback = "ORGANIZACIÓN",
): string {
  const content = doc.content || {};
  const fromContent = content.organization_name;
  if (typeof fromContent === "string" && fromContent.trim()) {
    return fromContent.trim();
  }
  return fallback;
}

export function buildPdfFilename(
  doc: SgqDocument,
  organizationName: string,
  options?: { diagramProcessName?: string },
): string {
  const label =
    SGQ_DOCUMENT_PDF_LABELS[doc.component_type] ||
    (doc.title || "DOCUMENTO SGQ").toUpperCase();
  const org = organizationName.toUpperCase().trim();

  let subtitle = "";
  if (doc.component_type === "diagrama_flujo") {
    const diagrams = Array.isArray(doc.content?.diagrams)
      ? (doc.content.diagrams as Array<{ process_name?: string }>)
      : [];
    const processName =
      options?.diagramProcessName ||
      diagrams[0]?.process_name ||
      "PROCESO GENERAL";
    subtitle = ` – ${processName.toUpperCase()}`;
  }

  const separator = subtitle ? "" : " ";
  return sanitizeFilename(`${label}${subtitle}${separator}${org}.pdf`);
}

function applyBaseVisibility(root: HTMLElement) {
  const walk = (el: HTMLElement) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("overflow-x", "visible", "important");
    el.style.setProperty("overflow-y", "visible", "important");
    el.style.setProperty("max-height", "none", "important");
    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) walk(child);
    });
  };
  walk(root);
}

/** Estilos de documento normal (tablas/texto) legibles para PDF. */
function applyDocumentStyles(root: HTMLElement) {
  applyBaseVisibility(root);
  root.style.setProperty("font-family", "Segoe UI, Roboto, Helvetica, Arial, sans-serif", "important");
  root.style.setProperty("font-size", "12px", "important");
  root.style.setProperty("line-height", "1.45", "important");
  root.style.setProperty("width", "100%", "important");
  root.style.setProperty("max-width", "100%", "important");
  root.style.setProperty("box-sizing", "border-box", "important");

  root.querySelectorAll<HTMLElement>(".sgq-doc-header").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("margin-bottom", "14px", "important");
    el.style.setProperty("padding-bottom", "10px", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header-meta").forEach((el) => {
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("font-size", "11px", "important");
    el.style.setProperty("padding", "10px 12px", "important");
    el.style.setProperty("margin-top", "10px", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header img").forEach((el) => {
    el.style.setProperty("height", "32px", "important");
    el.style.setProperty("width", "auto", "important");
  });
  root.querySelectorAll<HTMLElement>("h1").forEach((el) => {
    el.style.setProperty("font-size", "16px", "important");
    el.style.setProperty("margin", "6px 0", "important");
  });
  root.querySelectorAll<HTMLElement>("h4").forEach((el) => {
    el.style.setProperty("font-size", "13px", "important");
    el.style.setProperty("margin", "0 0 8px", "important");
    el.style.setProperty("padding-bottom", "5px", "important");
  });
  root.querySelectorAll<HTMLElement>(".mb-6, .mb-8").forEach((el) => {
    el.style.setProperty("margin-bottom", "14px", "important");
  });
  root.querySelectorAll<HTMLElement>(".space-y-5, .space-y-4, .space-y-3").forEach((el) => {
    el.style.setProperty("gap", "10px", "important");
  });
  root.querySelectorAll<HTMLElement>(".p-6, .p-5, .p-4").forEach((el) => {
    el.style.setProperty("padding", "12px 14px", "important");
  });
  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.style.setProperty("table-layout", "auto", "important");
    table.style.setProperty("width", "100%", "important");
    table.style.setProperty("max-width", "100%", "important");
    table.style.setProperty("border-collapse", "collapse", "important");
    table.style.setProperty("font-size", "11.5px", "important");
    table.classList.remove("table-fixed");
  });
  root.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
    cell.style.setProperty("white-space", "pre-wrap", "important");
    cell.style.setProperty("word-break", "break-word", "important");
    cell.style.setProperty("overflow-wrap", "break-word", "important");
    cell.style.setProperty("overflow", "visible", "important");
    cell.style.setProperty("vertical-align", "top", "important");
    cell.style.setProperty("padding", "7px 8px", "important");
    cell.style.setProperty("font-size", "11.5px", "important");
    cell.style.setProperty("line-height", "1.4", "important");
  });
  root.querySelectorAll<HTMLElement>(".overflow-x-auto, .overflow-auto").forEach((el) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("max-width", "100%", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-document-body").forEach((el) => {
    el.style.setProperty("font-size", "12px", "important");
  });
}

/**
 * Mapa de procesos: tipografía fija ~12 px cuerpo / 15 px títulos
 * para que al escalar al ancho A4 quede ~10–12 pt en el PDF.
 */
function applyProcessMapExportStyles(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".bizagi-process-map").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("min-width", "0", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-pm-title").forEach((el) => {
    el.style.setProperty("font-size", "16px", "important");
    el.style.setProperty("line-height", "1.35", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-pm-body").forEach((el) => {
    el.style.setProperty("font-size", "13px", "important");
    el.style.setProperty("line-height", "1.45", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-pm-band").forEach((el) => {
    el.style.setProperty("font-size", "13px", "important");
    el.style.setProperty("letter-spacing", "0.04em", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-pm-card").forEach((el) => {
    el.style.setProperty("min-width", "0", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("padding", "14px 16px", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-process-map .grid").forEach((el) => {
    const onlyOneCol =
      el.className.includes("grid-cols-1") &&
      !el.className.includes("sm:grid-cols") &&
      !el.className.includes("xl:grid-cols");
    if (!onlyOneCol) {
      el.style.setProperty("grid-template-columns", "repeat(2, minmax(0, 1fr))", "important");
      el.style.setProperty("gap", "14px", "important");
    }
  });
}

/**
 * Diagramas: conservar tamaño natural (SVG/flex).
 * No forzar width:100% ni quitar attrs del SVG (rompe el layout).
 */
function applyDiagramStyles(root: HTMLElement) {
  applyBaseVisibility(root);

  root.querySelectorAll<HTMLElement>(".sgq-doc-header").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("margin-bottom", "12px", "important");
    el.style.setProperty("padding-bottom", "10px", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header-meta").forEach((el) => {
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("font-size", "11px", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header img").forEach((el) => {
    el.style.setProperty("height", "36px", "important");
    el.style.setProperty("width", "auto", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header h1").forEach((el) => {
    el.style.setProperty("font-size", "16px", "important");
  });

  root.querySelectorAll<HTMLElement>(".bizagi-export-block").forEach((el) => {
    if (el.classList.contains("bizagi-process-map")) {
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("min-width", "0", "important");
      el.style.setProperty("max-width", "100%", "important");
    } else {
      el.style.setProperty("width", "max-content", "important");
      el.style.setProperty("min-width", "100%", "important");
      el.style.setProperty("max-width", "none", "important");
    }
    el.style.setProperty("overflow", "visible", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-flow-sequence").forEach((el) => {
    el.style.setProperty("display", "inline-block", "important");
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("overflow", "visible", "important");
  });
  root.querySelectorAll<SVGElement>(".bizagi-flow-canvas").forEach((svg) => {
    svg.style.setProperty("display", "block", "important");
    svg.style.setProperty("max-width", "none", "important");
  });
  root.querySelectorAll<HTMLElement>(".bizagi-lane-row").forEach((el) => {
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("overflow", "visible", "important");
  });

  applyProcessMapExportStyles(root);
}

function prepareExportClone(
  source: HTMLElement,
  widthPx: number,
  mode: ExportMode,
): { host: HTMLDivElement; clone: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("data-sgq-pdf-export-host", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-16000px",
    "top:0",
    `width:${widthPx}px`,
    "padding:22px 26px",
    "background:#ffffff",
    "z-index:-1",
    "overflow:visible",
    "pointer-events:none",
    "font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "box-sizing:border-box",
  ].join(";");

  const clone = source.cloneNode(true) as HTMLElement;
  if (mode === "diagram") {
    clone.style.cssText = [
      "width:max-content",
      "min-width:100%",
      "max-width:none",
      "height:auto",
      "overflow:visible",
      "background:#ffffff",
      "box-sizing:border-box",
    ].join(";");
    applyDiagramStyles(clone);
  } else {
    clone.style.cssText = [
      "width:100%",
      "max-width:100%",
      "height:auto",
      "overflow:visible",
      "background:#ffffff",
      "box-sizing:border-box",
    ].join(";");
    applyDocumentStyles(clone);
  }

  host.appendChild(clone);
  document.body.appendChild(host);

  if (mode === "diagram") {
    // Nunca capturar React Flow (genera PDF con rayas de colores)
    clone.querySelectorAll(".react-flow, .react-flow__renderer, canvas").forEach((el) => {
      el.remove();
    });
    const isProcessMap = !!clone.querySelector(".bizagi-process-map");
    if (isProcessMap) {
      // Ancho de página: las cajas hacen wrap y la tipografía no se aplasta
      host.style.width = `${widthPx}px`;
      clone.style.width = "100%";
      clone.style.maxWidth = "100%";
      applyProcessMapExportStyles(clone);
    } else {
      const needed = Math.max(widthPx, clone.scrollWidth + 40);
      host.style.width = `${Math.min(needed, 2400)}px`;
    }
  }

  return { host, clone };
}

function cleanupExportHost(host: HTMLDivElement) {
  try {
    host.remove();
  } catch {
    /* ignore */
  }
}

const MAX_CAPTURE_EDGE = 4096;
const MAX_CAPTURE_PIXELS = 16_000_000;

function stripUnsafeExportNodes(root: HTMLElement) {
  // React Flow / canvas WebGL → html2canvas los corrompe (rayas de colores)
  root.querySelectorAll(".react-flow, .react-flow__renderer, canvas").forEach((el) => {
    const parent = el.parentElement;
    if (!parent) return;
    // Sustituir por un aviso estático si era el canvas del flujo
    if (el.classList.contains("react-flow") || el.classList.contains("react-flow__renderer")) {
      const placeholder = document.createElement("div");
      placeholder.style.cssText =
        "padding:24px;border:1px dashed #94a3b8;color:#64748b;font-size:12px;text-align:center;";
      placeholder.textContent =
        "Diagrama interactivo: use Descargar PDF / export vectorial del diagrama.";
      el.replaceWith(placeholder);
    } else if (el.tagName === "CANVAS") {
      el.remove();
    }
  });
}

function html2canvasOptions(
  el: HTMLElement,
  mode: ExportMode,
  scale: number,
  extras?: Record<string, unknown>,
) {
  return {
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(el.scrollWidth, el.offsetWidth, 700),
    windowHeight: Math.max(el.scrollHeight, el.offsetHeight, 400),
    ignoreElements: (node: Element) => {
      if (!(node instanceof HTMLElement)) return false;
      return (
        node.classList.contains("react-flow") ||
        node.classList.contains("react-flow__panel") ||
        node.tagName === "CANVAS"
      );
    },
    onclone: (_doc: Document, cloned: HTMLElement) => {
      stripUnsafeExportNodes(cloned);
      if (mode === "diagram") applyDiagramStyles(cloned);
      else applyDocumentStyles(cloned);
      cloned.style.setProperty("overflow", "visible", "important");
    },
    ...extras,
  };
}

async function captureStrip(
  el: HTMLElement,
  html2canvas: typeof import("html2canvas").default,
  mode: ExportMode,
  scale: number,
  y: number,
  height: number,
): Promise<HTMLCanvasElement> {
  return html2canvas(
    el,
    html2canvasOptions(el, mode, scale, {
      y,
      height,
      windowHeight: Math.max(height + y, el.scrollHeight),
    }),
  );
}

/**
 * Captura completa del elemento. Si es muy alto, une tramos verticales
 * para no truncar el contenido inferior.
 */
async function captureElement(
  el: HTMLElement,
  html2canvas: typeof import("html2canvas").default,
  mode: ExportMode,
): Promise<HTMLCanvasElement> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  stripUnsafeExportNodes(el);

  const rawW = Math.ceil(Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth, 700));
  const rawH = Math.ceil(Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight, 400));

  let scale = 1.45;
  while (rawW * scale * rawH * scale > MAX_CAPTURE_PIXELS && scale > 0.7) {
    scale -= 0.15;
  }

  const scaledH = rawH * scale;
  const scaledW = rawW * scale;

  // Cabe en un solo canvas
  if (scaledW <= MAX_CAPTURE_EDGE && scaledH <= MAX_CAPTURE_EDGE) {
    const canvas = await html2canvas(el, html2canvasOptions(el, mode, scale));
    if (!canvas.width || !canvas.height) {
      throw new Error("La captura del documento falló (canvas vacío).");
    }
    return canvas;
  }

  // Documento largo: capturar por franjas y unir
  const maxCssStrip = Math.floor(MAX_CAPTURE_EDGE / scale);
  const stripCssH = Math.max(800, Math.min(maxCssStrip, 2800));
  const strips: HTMLCanvasElement[] = [];
  let offsetY = 0;
  while (offsetY < rawH) {
    const h = Math.min(stripCssH, rawH - offsetY);
    const part = await captureStrip(el, html2canvas, mode, scale, offsetY, h);
    strips.push(part);
    offsetY += h;
    if (strips.length > 40) break;
  }

  if (!strips.length) {
    throw new Error("La captura del documento falló (sin franjas).");
  }

  const width = Math.max(...strips.map((s) => s.width));
  const totalH = strips.reduce((acc, s) => acc + s.height, 0);
  const joined = document.createElement("canvas");
  joined.width = width;
  joined.height = totalH;
  const ctx = joined.getContext("2d");
  if (!ctx) throw new Error("No se pudo unir la captura del documento.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, totalH);
  let dy = 0;
  for (const s of strips) {
    ctx.drawImage(s, 0, dy);
    dy += s.height;
  }
  return joined;
}

/**
 * Busca una fila casi blanca cerca del corte ideal para no partir tablas/cajas.
 */
function findBestCutY(
  source: HTMLCanvasElement,
  idealY: number,
  searchRadius: number,
): number {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return idealY;

  const start = Math.max(1, Math.floor(idealY - searchRadius));
  const end = Math.min(source.height - 2, Math.ceil(idealY + searchRadius));
  if (end <= start) return idealY;

  let bestY = idealY;
  let bestScore = -1;
  const width = source.width;
  const sampleStep = Math.max(1, Math.floor(width / 120));

  for (let y = start; y <= end; y++) {
    const row = ctx.getImageData(0, y, width, 1).data;
    let whiteish = 0;
    let samples = 0;
    for (let x = 0; x < width; x += sampleStep) {
      const i = x * 4;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      samples += 1;
      if (r > 245 && g > 245 && b > 245) whiteish += 1;
    }
    const score = whiteish / Math.max(samples, 1);
    // Preferir huecos muy blancos; empatar con cercanía al ideal
    const proximity = 1 - Math.abs(y - idealY) / Math.max(searchRadius, 1);
    const combined = score * 0.85 + proximity * 0.15;
    if (combined > bestScore) {
      bestScore = combined;
      bestY = y;
    }
  }

  // Solo usar el corte inteligente si hay un hueco claramente vacío
  if (bestScore < 0.55) return idealY;
  return bestY;
}

/**
 * Encaja el contenido en UNA página (solo diagramas cortos no-legibles).
 */
function addCanvasFitPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement,
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = PDF_MARGIN_MM;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const scaleW = usableWidth / canvas.width;
  const scaleH = usableHeight / canvas.height;
  const scale = Math.min(scaleW, scaleH);

  const imgW = canvas.width * scale;
  const imgH = canvas.height * scale;
  const x = margin + (usableWidth - imgW) / 2;
  const y = margin;
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgW, imgH);
}

/**
 * Multipágina a ancho completo. Por defecto NO comprime (legibilidad > 1 hoja).
 * Intenta cortar en zonas vacías para no partir filas/cuadros.
 */
function addCanvasWidthSlice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement,
  options?: { allowCompress?: boolean },
) {
  const allowCompress = options?.allowCompress === true;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = PDF_MARGIN_MM;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const fullHeightAtFullWidth = (canvas.height * usableWidth) / canvas.width;

  // Cabe en una página a ancho completo
  if (fullHeightAtFullWidth <= usableHeight + 0.8) {
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      margin,
      margin,
      usableWidth,
      fullHeightAtFullWidth,
    );
    return;
  }

  // Compresión opcional (desactivada por defecto)
  if (allowCompress && fullHeightAtFullWidth <= usableHeight * 1.12) {
    const scale = Math.min(usableWidth / canvas.width, usableHeight / canvas.height);
    const imgW = canvas.width * scale;
    const imgH = canvas.height * scale;
    const x = margin + (usableWidth - imgW) / 2;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, margin, imgW, imgH);
    return;
  }

  const imgWidthMm = usableWidth;
  const idealSlicePx = Math.max(
    1,
    Math.floor((usableHeight * canvas.width) / imgWidthMm),
  );
  const searchRadius = Math.min(90, Math.floor(idealSlicePx * 0.12));

  let yPx = 0;
  let pageIndex = 0;
  while (yPx < canvas.height) {
    const remaining = canvas.height - yPx;
    let sliceH = Math.min(idealSlicePx, remaining);

    if (remaining > idealSlicePx + 20) {
      const idealCut = yPx + idealSlicePx;
      const cutY = findBestCutY(canvas, idealCut, searchRadius);
      sliceH = Math.max(120, cutY - yPx);
      // Evitar rebanadas absurdamente cortas o que dejen un resto minúsculo
      if (canvas.height - (yPx + sliceH) < 80) {
        sliceH = remaining;
      }
    }

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, yPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    const sliceMm = (sliceH * imgWidthMm) / canvas.width;
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(
      pageCanvas.toDataURL("image/png"),
      "PNG",
      margin,
      margin,
      imgWidthMm,
      Math.min(sliceMm, usableHeight),
    );
    yPx += sliceH;
    pageIndex += 1;
    if (pageIndex > 100) break;
  }
}

function createPdf(
  jsPDF: typeof import("jspdf").jsPDF,
  orientation: PageOrientation,
) {
  return new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  });
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  options?: {
    landscape?: boolean;
    mode?: ExportMode;
    componentType?: string;
  },
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const mode: ExportMode = options?.mode ?? "document";
  const componentType = options?.componentType;
  const forcedLandscape = options?.landscape;

  if (mode === "diagram") {
    const readable =
      !!componentType && READABLE_DIAGRAM_TYPES.has(componentType);
    // Mapa: capturar al ancho de página (tipografía legible). Otros: tamaño natural.
    const captureWidth = readable ? DOC_PAGE_PX.landscape : 1400;
    const { host, clone } = prepareExportClone(element, captureWidth, "diagram");
    try {
      const header = clone.querySelector<HTMLElement>(".sgq-doc-header");
      const blocks = Array.from(
        clone.querySelectorAll<HTMLElement>(".bizagi-export-block"),
      );
      if (!blocks.length) return;

      const orientation: PageOrientation =
        forcedLandscape === false ? "portrait" : "landscape";
      const pdf = createPdf(jsPDF, orientation);
      let pageStarted = false;

      for (let i = 0; i < blocks.length; i++) {
        const wrap = document.createElement("div");
        wrap.style.cssText = readable
          ? "background:#ffffff;padding:18px 22px;width:100%;box-sizing:border-box;overflow:visible;"
          : "background:#ffffff;padding:18px 22px;width:max-content;box-sizing:border-box;overflow:visible;";

        if (header && i === 0) {
          wrap.appendChild(header.cloneNode(true));
        }
        wrap.appendChild(blocks[i].cloneNode(true));
        host.appendChild(wrap);
        applyDiagramStyles(wrap);
        if (readable) applyProcessMapExportStyles(wrap);

        if (readable) {
          host.style.width = `${captureWidth}px`;
          wrap.style.width = "100%";
        } else {
          const needed = Math.max(
            Number.parseInt(host.style.width, 10) || 1400,
            wrap.scrollWidth + 36,
          );
          host.style.width = `${needed}px`;
          wrap.style.width = `${Math.max(wrap.scrollWidth, blocks[i].scrollWidth)}px`;
        }
        wrap.querySelectorAll<HTMLElement>(".sgq-doc-header, .sgq-doc-header-meta").forEach((el) => {
          el.style.setProperty("width", "100%", "important");
          el.style.setProperty("max-width", "none", "important");
        });

        const canvas = await captureElement(wrap, html2canvas, "diagram");
        if (pageStarted) pdf.addPage("a4", orientation);
        if (readable) {
          // Ancho completo + multipágina si hace falta (sin comprimir tipografía)
          addCanvasWidthSlice(pdf, canvas, { allowCompress: false });
        } else {
          addCanvasFitPage(pdf, canvas);
        }
        pageStarted = true;
        wrap.remove();
      }

      pdf.save(filename);
    } finally {
      cleanupExportHost(host);
    }
    return;
  }

  // Documentos (tablas / texto)
  const preferLandscape =
    forcedLandscape === true ||
    (forcedLandscape !== false &&
      !!componentType &&
      WIDE_DOC_TYPES.has(componentType));
  const orientation: PageOrientation = preferLandscape ? "landscape" : "portrait";
  const widthPx = DOC_PAGE_PX[orientation];
  const { host, clone } = prepareExportClone(element, widthPx, "document");

  try {
    applyDocumentStyles(clone);
    const canvas = await captureElement(clone, html2canvas, "document");
    const pdf = createPdf(jsPDF, orientation);
    addCanvasWidthSlice(pdf, canvas, { allowCompress: false });
    pdf.save(filename);
  } finally {
    cleanupExportHost(host);
  }
}

export async function downloadSgqDocumentPdf(
  element: HTMLElement,
  doc: SgqDocument,
  options: ExportOptions,
): Promise<void> {
  const orgName = getOrganizationName(doc, options.organizationName);
  const filename = buildPdfFilename(doc, orgName, {
    diagramProcessName: options.diagramProcessName,
  });

  // Diagramas de flujo: PDF vectorial (SVG → jsPDF), no captura de pantalla
  if (doc.component_type === "diagrama_flujo") {
    const { buildDiagramLayout } = await import("@/lib/flowDiagram/DiagramLayout");
    const { exportDiagramPdf } = await import("@/lib/flowDiagram/PdfExporter");
    const diagrams = Array.isArray(doc.content?.diagrams)
      ? (doc.content.diagrams as Array<Record<string, unknown>>)
      : [];
    if (!diagrams.length) {
      throw new Error(
        "No hay diagramas de flujo para exportar. Complete el borrador e intente de nuevo.",
      );
    }

    // Exportar el primero (o el solicitado) como vector; si hay varios, cada uno en secuencia
    for (let i = 0; i < diagrams.length; i++) {
      const d = diagrams[i];
      const activities = Array.isArray(d.activities) ? d.activities : [];
      const input = {
        process_name: String(d.process_name || `Proceso ${i + 1}`),
        start_event: d.start_event != null ? String(d.start_event) : undefined,
        end_event: d.end_event != null ? String(d.end_event) : undefined,
        mode: d.mode != null ? String(d.mode) : String(doc.content?.mode || "to_be"),
        activities: activities.map((a: Record<string, unknown>) => ({
          id: String(a.id || ""),
          name: String(a.name || ""),
          responsible: String(a.responsible || "General"),
          type: a.type != null ? String(a.type) : "task",
          status_note:
            a.status_note != null && String(a.status_note).trim()
              ? String(a.status_note)
              : undefined,
        })),
        sequence: Array.isArray(d.sequence) ? d.sequence.map(String) : [],
        decisions: Array.isArray(d.decisions)
          ? (d.decisions as Array<Record<string, unknown>>).map((dec) => ({
              after: String(dec.after || ""),
              question: dec.question != null ? String(dec.question) : undefined,
              yes_to: dec.yes_to ? String(dec.yes_to) : undefined,
              no_to: dec.no_to ? String(dec.no_to) : undefined,
              yes_label: String(dec.yes_label || "Sí"),
              no_label: String(dec.no_label || "No"),
            }))
          : [],
      };
      const layout = await buildDiagramLayout(input);
      const name =
        diagrams.length > 1
          ? filename.replace(/\.pdf$/i, ` – ${i + 1}.pdf`)
          : filename;
      await exportDiagramPdf(layout, name, {
        organizationName: orgName,
        processType: String(input.mode || "TO BE").toUpperCase().includes("AS")
          ? "AS IS"
          : "TO BE",
        version: "V01",
        generatedAt: new Date(),
      });
    }
    return;
  }

  const isDiagram = DIAGRAM_TYPES.has(doc.component_type);
  await exportElementToPdf(element, filename, {
    landscape: options.landscape,
    mode: isDiagram ? "diagram" : "document",
    componentType: doc.component_type,
  });
}
