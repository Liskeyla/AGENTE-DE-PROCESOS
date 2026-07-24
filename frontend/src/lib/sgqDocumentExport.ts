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

const WIDE_DOC_TYPES = new Set([
  "matriz_interaccion",
  "cumplimiento_legal",
  "indicadores",
  "riesgos_oportunidades",
  "partes_interesadas",
]);

/** Ancho CSS ≈ área útil A4 (96dpi) para documentos de texto/tablas. */
const DOC_PAGE_PX = {
  portrait: 720,
  landscape: 1040,
} as const;

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

/** Estilos de documento normal (tablas/texto) a 11–12 pt, compacto para PDF. */
function applyDocumentStyles(root: HTMLElement) {
  applyBaseVisibility(root);
  root.style.setProperty("font-family", "Segoe UI, Roboto, Helvetica, Arial, sans-serif", "important");
  root.style.setProperty("font-size", "11px", "important");
  root.style.setProperty("line-height", "1.35", "important");
  root.style.setProperty("width", "100%", "important");
  root.style.setProperty("max-width", "100%", "important");
  root.style.setProperty("box-sizing", "border-box", "important");

  root.querySelectorAll<HTMLElement>(".sgq-doc-header").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("margin-bottom", "10px", "important");
    el.style.setProperty("padding-bottom", "8px", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header-meta").forEach((el) => {
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("font-size", "10px", "important");
    el.style.setProperty("padding", "8px 10px", "important");
    el.style.setProperty("margin-top", "8px", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header img").forEach((el) => {
    el.style.setProperty("height", "28px", "important");
    el.style.setProperty("width", "auto", "important");
  });
  root.querySelectorAll<HTMLElement>("h1").forEach((el) => {
    el.style.setProperty("font-size", "15px", "important");
    el.style.setProperty("margin", "4px 0", "important");
  });
  root.querySelectorAll<HTMLElement>("h4").forEach((el) => {
    el.style.setProperty("font-size", "12px", "important");
    el.style.setProperty("margin", "0 0 6px", "important");
    el.style.setProperty("padding-bottom", "4px", "important");
  });
  root.querySelectorAll<HTMLElement>(".mb-6, .mb-8").forEach((el) => {
    el.style.setProperty("margin-bottom", "10px", "important");
  });
  root.querySelectorAll<HTMLElement>(".space-y-5, .space-y-4, .space-y-3").forEach((el) => {
    el.style.setProperty("gap", "8px", "important");
  });
  root.querySelectorAll<HTMLElement>(".p-6, .p-5, .p-4").forEach((el) => {
    el.style.setProperty("padding", "10px 12px", "important");
  });
  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.style.setProperty("table-layout", "auto", "important");
    table.style.setProperty("width", "100%", "important");
    table.style.setProperty("max-width", "100%", "important");
    table.style.setProperty("font-size", "10.5px", "important");
    table.classList.remove("table-fixed");
  });
  root.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
    cell.style.setProperty("white-space", "pre-wrap", "important");
    cell.style.setProperty("word-break", "break-word", "important");
    cell.style.setProperty("overflow-wrap", "anywhere", "important");
    cell.style.setProperty("overflow", "visible", "important");
    cell.style.setProperty("vertical-align", "top", "important");
    cell.style.setProperty("padding", "4px 6px", "important");
    cell.style.setProperty("font-size", "10.5px", "important");
  });
  root.querySelectorAll<HTMLElement>(".overflow-x-auto, .overflow-auto").forEach((el) => {
    el.style.setProperty("overflow", "visible", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-document-body").forEach((el) => {
    el.style.setProperty("font-size", "11px", "important");
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
    el.style.setProperty("height", "32px", "important");
    el.style.setProperty("width", "auto", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header h1").forEach((el) => {
    el.style.setProperty("font-size", "15px", "important");
  });

  root.querySelectorAll<HTMLElement>(".bizagi-export-block").forEach((el) => {
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("min-width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
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
    // Conservar width/height del layout
  });
  root.querySelectorAll<HTMLElement>(".bizagi-lane-row").forEach((el) => {
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("overflow", "visible", "important");
  });
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
    "padding:10px 14px",
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
    const needed = Math.max(widthPx, clone.scrollWidth + 40);
    host.style.width = `${Math.min(needed, 2400)}px`;
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

async function captureElement(
  el: HTMLElement,
  html2canvas: typeof import("html2canvas").default,
  mode: ExportMode,
): Promise<HTMLCanvasElement> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  stripUnsafeExportNodes(el);

  const rawW = Math.ceil(Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth, 700));
  const rawH = Math.ceil(Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight, 400));

  // Evitar canvas gigantes (límite del navegador → rayas/corrupción)
  let scale = 1.5;
  while (rawW * scale * rawH * scale > MAX_CAPTURE_PIXELS && scale > 0.75) {
    scale -= 0.25;
  }
  const w = Math.min(rawW, MAX_CAPTURE_EDGE);
  const h = Math.min(rawH, MAX_CAPTURE_EDGE);

  // CRÍTICO: no forzar width/height distintos al contenido real (causa el glitch de rayas)
  const canvas = await html2canvas(el, {
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(w, el.scrollWidth),
    windowHeight: Math.max(h, el.scrollHeight),
    ignoreElements: (node) => {
      if (!(node instanceof HTMLElement)) return false;
      return (
        node.classList.contains("react-flow") ||
        node.classList.contains("react-flow__panel") ||
        node.tagName === "CANVAS"
      );
    },
    onclone: (_doc, cloned) => {
      stripUnsafeExportNodes(cloned as HTMLElement);
      if (mode === "diagram") applyDiagramStyles(cloned as HTMLElement);
      else applyDocumentStyles(cloned as HTMLElement);
      (cloned as HTMLElement).style.setProperty("overflow", "visible", "important");
    },
  });

  // Sanidad: canvas vacío o inválido
  if (!canvas.width || !canvas.height) {
    throw new Error("La captura del documento falló (canvas vacío).");
  }
  return canvas;
}

/**
 * Encaja el contenido en UNA página de forma proporcional.
 * Prioriza llenar el ancho; si sobra poco alto, no deja márgenes enormes centrados.
 */
function addCanvasFitPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement,
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const scaleW = usableWidth / canvas.width;
  const scaleH = usableHeight / canvas.height;
  const scale = Math.min(scaleW, scaleH);

  const imgW = canvas.width * scale;
  const imgH = canvas.height * scale;
  // Alineado arriba; centrado horizontal solo si no llena el ancho
  const x = margin + (usableWidth - imgW) / 2;
  const y = margin;
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgW, imgH);
}

/**
 * Documentos: una página si cabe (o casi cabe); multipágina solo si es necesario.
 * Escala proporcionalmente para evitar espacios vacíos excesivos.
 */
function addCanvasWidthSlice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement,
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
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

  // Casi cabe (hasta ~18% más): comprimir a una sola página de forma proporcional
  if (fullHeightAtFullWidth <= usableHeight * 1.18) {
    const scale = Math.min(usableWidth / canvas.width, usableHeight / canvas.height);
    const imgW = canvas.width * scale;
    const imgH = canvas.height * scale;
    const x = margin + (usableWidth - imgW) / 2;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, margin, imgW, imgH);
    return;
  }

  // Documento largo: multipágina a ancho completo
  const imgWidthMm = usableWidth;
  const pageSlicePx = Math.max(
    1,
    Math.floor((usableHeight * canvas.width) / imgWidthMm),
  );
  let yPx = 0;
  let pageIndex = 0;
  while (yPx < canvas.height) {
    const safeSlice = Math.min(pageSlicePx, canvas.height - yPx);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = safeSlice;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, yPx, canvas.width, safeSlice, 0, 0, canvas.width, safeSlice);
    const sliceMm = (safeSlice * imgWidthMm) / canvas.width;
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(
      pageCanvas.toDataURL("image/png"),
      "PNG",
      margin,
      margin,
      imgWidthMm,
      Math.min(sliceMm, usableHeight),
    );
    yPx += safeSlice;
    pageIndex += 1;
    if (pageIndex > 80) break;
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
    // Captura a tamaño natural del diagrama (no aplastar)
    const { host, clone } = prepareExportClone(element, 1400, "diagram");
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
        wrap.style.cssText =
          "background:#ffffff;padding:12px 14px;width:max-content;box-sizing:border-box;overflow:visible;";

        if (header && i === 0) {
          wrap.appendChild(header.cloneNode(true));
        }
        wrap.appendChild(blocks[i].cloneNode(true));
        host.appendChild(wrap);
        applyDiagramStyles(wrap);

        const needed = Math.max(
          Number.parseInt(host.style.width, 10) || 1400,
          wrap.scrollWidth + 36,
        );
        host.style.width = `${needed}px`;
        // Encabezado al ancho del diagrama
        wrap.style.width = `${Math.max(wrap.scrollWidth, blocks[i].scrollWidth)}px`;
        wrap.querySelectorAll<HTMLElement>(".sgq-doc-header, .sgq-doc-header-meta").forEach((el) => {
          el.style.setProperty("width", "100%", "important");
          el.style.setProperty("max-width", "none", "important");
        });

        const canvas = await captureElement(wrap, html2canvas, "diagram");
        if (pageStarted) pdf.addPage("a4", orientation);
        // Un diagrama completo por página, escalado para que quepa entero
        addCanvasFitPage(pdf, canvas);
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
    addCanvasWidthSlice(pdf, canvas);
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
