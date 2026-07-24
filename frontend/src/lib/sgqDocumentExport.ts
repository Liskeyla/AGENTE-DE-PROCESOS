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

/** Estilos de documento normal (tablas/texto) a 11–12 pt. */
function applyDocumentStyles(root: HTMLElement) {
  applyBaseVisibility(root);
  root.style.setProperty("font-family", "Segoe UI, Roboto, Helvetica, Arial, sans-serif", "important");
  root.style.setProperty("font-size", "11.5px", "important");
  root.style.setProperty("line-height", "1.45", "important");
  root.style.setProperty("width", "100%", "important");
  root.style.setProperty("max-width", "100%", "important");
  root.style.setProperty("box-sizing", "border-box", "important");

  root.querySelectorAll<HTMLElement>(".sgq-doc-header").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
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
  root.querySelectorAll<HTMLElement>("h1").forEach((el) => {
    el.style.setProperty("font-size", "16px", "important");
  });
  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.style.setProperty("table-layout", "auto", "important");
    table.style.setProperty("width", "100%", "important");
    table.style.setProperty("max-width", "100%", "important");
    table.style.setProperty("font-size", "11px", "important");
    table.classList.remove("table-fixed");
  });
  root.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
    cell.style.setProperty("white-space", "pre-wrap", "important");
    cell.style.setProperty("word-break", "break-word", "important");
    cell.style.setProperty("overflow-wrap", "anywhere", "important");
    cell.style.setProperty("overflow", "visible", "important");
    cell.style.setProperty("vertical-align", "top", "important");
    cell.style.setProperty("padding", "6px 8px", "important");
    cell.style.setProperty("font-size", "11px", "important");
  });
  root.querySelectorAll<HTMLElement>(".overflow-x-auto, .overflow-auto").forEach((el) => {
    el.style.setProperty("overflow", "visible", "important");
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
    "padding:16px 18px",
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
    const needed = Math.max(widthPx, clone.scrollWidth + 40);
    host.style.width = `${needed}px`;
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

async function captureElement(
  el: HTMLElement,
  html2canvas: typeof import("html2canvas").default,
  mode: ExportMode,
): Promise<HTMLCanvasElement> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const w = Math.ceil(Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth, 700));
  const h = Math.ceil(Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight, 400));

  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    width: w,
    height: h,
    windowWidth: w,
    windowHeight: h,
    scrollX: 0,
    scrollY: 0,
    onclone: (_doc, cloned) => {
      if (mode === "diagram") applyDiagramStyles(cloned as HTMLElement);
      else applyDocumentStyles(cloned as HTMLElement);
    },
  });
}

/** Encaja el canvas completo en UNA página (sin recortar). */
function addCanvasFitPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement,
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  let imgW = usableWidth;
  let imgH = (canvas.height * imgW) / canvas.width;
  if (imgH > usableHeight) {
    imgH = usableHeight;
    imgW = (canvas.width * imgH) / canvas.height;
  }
  const x = margin + (usableWidth - imgW) / 2;
  const y = margin + (usableHeight - imgH) / 2;
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgW, imgH);
}

/** Escala al ancho y pagina en vertical (documentos largos). */
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

  const imgWidthMm = usableWidth;
  const fullHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  if (fullHeightMm <= usableHeight + 0.5) {
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      margin,
      margin,
      imgWidthMm,
      fullHeightMm,
    );
    return;
  }

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
  const isDiagram = DIAGRAM_TYPES.has(doc.component_type);

  await exportElementToPdf(element, filename, {
    landscape: options.landscape,
    mode: isDiagram ? "diagram" : "document",
    componentType: doc.component_type,
  });
}
