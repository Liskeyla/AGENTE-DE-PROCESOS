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

const WIDE_CANDIDATE_TYPES = new Set([
  "mapa_procesos",
  "diagrama_flujo",
  "organigrama",
  "matriz_interaccion",
  "cumplimiento_legal",
  "indicadores",
  "riesgos_oportunidades",
  "partes_interesadas",
  "caracterizacion_procesos",
]);

/**
 * Anchos CSS ≈ área útil A4 a 96dpi.
 * Así, al escalar al ancho de la hoja, 11–12px se ven como 11–12 pt.
 */
const PAGE_CONTENT_PX = {
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

export function chooseOrientation(
  contentWidthPx: number,
  contentHeightPx: number,
  componentType?: string,
): PageOrientation {
  const w = Math.max(1, contentWidthPx);
  const h = Math.max(1, contentHeightPx);
  const ratio = w / h;

  if (componentType && DIAGRAM_TYPES.has(componentType)) {
    return ratio >= 0.95 ? "landscape" : "portrait";
  }
  if (ratio >= 1.2) return "landscape";
  if (
    componentType &&
    WIDE_CANDIDATE_TYPES.has(componentType) &&
    (ratio >= 1.08 || w > PAGE_CONTENT_PX.portrait * 1.15)
  ) {
    return "landscape";
  }
  return "portrait";
}

/** Tipografía y layout de documento normal (11–12 pt), sin recortes. */
function applyReadableDocumentStyles(root: HTMLElement, mode: ExportMode) {
  root.style.setProperty("font-family", "Segoe UI, Roboto, Helvetica, Arial, sans-serif", "important");
  root.style.setProperty("font-size", "11.5px", "important");
  root.style.setProperty("line-height", "1.45", "important");
  root.style.setProperty("color", "#0f172a", "important");
  root.style.setProperty("background", "#ffffff", "important");
  root.style.setProperty("box-sizing", "border-box", "important");

  const walk = (el: HTMLElement) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("overflow-x", "visible", "important");
    el.style.setProperty("overflow-y", "visible", "important");
    el.style.setProperty("max-height", "none", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) walk(child);
    });
  };
  walk(root);

  root.querySelectorAll<HTMLElement>("h1").forEach((el) => {
    el.style.setProperty("font-size", "16px", "important");
    el.style.setProperty("line-height", "1.3", "important");
    el.style.setProperty("font-weight", "700", "important");
    el.style.setProperty("margin", "0 0 6px", "important");
  });
  root.querySelectorAll<HTMLElement>("h2, h3, h4").forEach((el) => {
    el.style.setProperty("font-size", "13px", "important");
    el.style.setProperty("line-height", "1.35", "important");
    el.style.setProperty("font-weight", "700", "important");
  });

  root.querySelectorAll<HTMLElement>("p, li, span, label, td, th, div").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") return;
    // No pisar tipografía de SVG/foreignObject extremos
    if (el.closest("svg")) return;
    const current = parseFloat(getComputedStyle(el).fontSize || "11.5");
    // Unificar tamaños diminutos o enormes a rango legible
    if (current < 10 || current > 18 || tag === "td" || tag === "th" || tag === "p" || tag === "li") {
      if (tag === "th") {
        el.style.setProperty("font-size", "11px", "important");
        el.style.setProperty("font-weight", "700", "important");
      } else if (tag === "td" || tag === "p" || tag === "li") {
        el.style.setProperty("font-size", "11px", "important");
      }
    }
    el.style.setProperty("text-overflow", "clip", "important");
    el.style.setProperty("-webkit-line-clamp", "unset", "important");
  });

  // Encabezado a ancho de hoja
  root.querySelectorAll<HTMLElement>(".sgq-doc-header").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
    el.style.setProperty("text-align", "center", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header-meta").forEach((el) => {
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("font-size", "11px", "important");
    el.style.setProperty("text-align", "left", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header img").forEach((el) => {
    el.style.setProperty("height", "40px", "important");
    el.style.setProperty("width", "auto", "important");
    el.style.setProperty("max-width", "200px", "important");
    el.style.setProperty("object-fit", "contain", "important");
  });

  // Tablas legibles, sin cortes
  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.style.setProperty("table-layout", "auto", "important");
    table.style.setProperty("width", "100%", "important");
    table.style.setProperty("max-width", "100%", "important");
    table.style.setProperty("min-width", "0", "important");
    table.style.setProperty("border-collapse", "collapse", "important");
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
    cell.style.setProperty("height", "auto", "important");
    cell.style.setProperty("max-height", "none", "important");
    cell.style.setProperty("font-size", "11px", "important");
    cell.style.setProperty("line-height", "1.4", "important");
  });

  // Contenedores scrollables → visibles y a 100%
  root.querySelectorAll<HTMLElement>(".overflow-x-auto, .overflow-auto, .overflow-hidden").forEach((el) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("max-width", "100%", "important");
  });

  root.querySelectorAll<HTMLElement>(".sgq-document-export, .sgq-document-body").forEach((el) => {
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("font-size", "11.5px", "important");
  });

  if (mode === "diagram") {
    // Diagramas: que quepan en el ancho de la hoja (sin desbordar)
    root.querySelectorAll<HTMLElement>(".bizagi-export-block").forEach((el) => {
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("max-width", "100%", "important");
      el.style.setProperty("min-width", "0", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
    root.querySelectorAll<HTMLElement>(".bizagi-flow-sequence").forEach((el) => {
      el.style.setProperty("display", "block", "important");
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("max-width", "100%", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
    root.querySelectorAll<SVGElement>(".bizagi-flow-canvas").forEach((svg) => {
      const vb = svg.getAttribute("viewBox");
      svg.style.setProperty("display", "block", "important");
      svg.style.setProperty("width", "100%", "important");
      svg.style.setProperty("height", "auto", "important");
      svg.style.setProperty("max-width", "100%", "important");
      if (vb) {
        // Mantener proporción vía viewBox; quitar width/height fijos en attrs
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      }
    });
    root.querySelectorAll<HTMLElement>(".bizagi-lane-row").forEach((el) => {
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("max-width", "100%", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
  }
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
    "padding:18px 22px",
    "background:#ffffff",
    "z-index:-1",
    "overflow:visible",
    "pointer-events:none",
    "font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "font-size:11.5px",
    "line-height:1.45",
    "box-sizing:border-box",
  ].join(";");

  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.cssText = [
    "width:100%",
    "max-width:100%",
    "min-width:0",
    "max-height:none",
    "height:auto",
    "overflow:visible",
    "background:#ffffff",
    "color:#0f172a",
    "box-sizing:border-box",
  ].join(";");

  applyReadableDocumentStyles(clone, mode);

  host.appendChild(clone);
  document.body.appendChild(host);

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

  const w = Math.ceil(
    Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth, 600),
  );
  const h = Math.ceil(
    Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight, 400),
  );

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
      applyReadableDocumentStyles(cloned as HTMLElement, mode);
      (cloned as HTMLElement).style.setProperty("overflow", "visible", "important");
      (cloned as HTMLElement).style.setProperty("width", "100%", "important");
    },
  });
}

/**
 * Escala al ancho útil de la hoja y pagina en vertical.
 * Nunca recorta horizontalmente ni deja texto fuera de la página.
 */
function addCanvasPaginated(
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
    const remaining = canvas.height - yPx;
    const safeSlice = Math.min(pageSlicePx, remaining);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = safeSlice;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      yPx,
      canvas.width,
      safeSlice,
      0,
      0,
      canvas.width,
      safeSlice,
    );
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

function resolveOrientation(
  forced: boolean | undefined,
  componentType: string | undefined,
  contentW: number,
  contentH: number,
  preferWideDefault: boolean,
): PageOrientation {
  if (forced === true) return "landscape";
  if (forced === false) return "portrait";
  if (componentType) {
    return chooseOrientation(contentW, contentH, componentType);
  }
  return preferWideDefault ? "landscape" : "portrait";
}

/**
 * Exporta como documento A4 legible (11–12 pt), sin recortes.
 */
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

  const preferWide =
    mode === "diagram" ||
    (componentType ? WIDE_CANDIDATE_TYPES.has(componentType) : false);

  // Primera pasada: ancho portrait para medir; luego re-clonar al ancho de orientación final
  const probeOrientation: PageOrientation =
    forcedLandscape === true
      ? "landscape"
      : forcedLandscape === false
        ? "portrait"
        : preferWide || (componentType && DIAGRAM_TYPES.has(componentType))
          ? "landscape"
          : "portrait";

  let orientation = probeOrientation;
  let widthPx = PAGE_CONTENT_PX[orientation];
  let { host, clone } = prepareExportClone(element, widthPx, mode);

  try {
    const blocks = Array.from(
      clone.querySelectorAll<HTMLElement>(".bizagi-export-block"),
    );

    if (mode === "diagram" && blocks.length > 0) {
      // Diagramas → landscape por defecto (más legible)
      orientation = resolveOrientation(
        forcedLandscape,
        componentType,
        PAGE_CONTENT_PX.landscape,
        700,
        true,
      );
      if (orientation !== probeOrientation) {
        cleanupExportHost(host);
        widthPx = PAGE_CONTENT_PX[orientation];
        ({ host, clone } = prepareExportClone(element, widthPx, mode));
      }

      const header = clone.querySelector<HTMLElement>(".sgq-doc-header");
      const liveBlocks = Array.from(
        clone.querySelectorAll<HTMLElement>(".bizagi-export-block"),
      );
      const captured: HTMLCanvasElement[] = [];

      for (let i = 0; i < liveBlocks.length; i++) {
        const block = liveBlocks[i];
        const wrap = document.createElement("div");
        wrap.style.cssText = [
          "background:#ffffff",
          "padding:12px 8px",
          `width:${widthPx - 44}px`,
          "max-width:100%",
          "box-sizing:border-box",
          "overflow:visible",
        ].join(";");

        if (header && i === 0) {
          const headerClone = header.cloneNode(true) as HTMLElement;
          wrap.appendChild(headerClone);
        }
        wrap.appendChild(block.cloneNode(true));
        host.appendChild(wrap);
        applyReadableDocumentStyles(wrap, "diagram");

        const canvas = await captureElement(wrap, html2canvas, "diagram");
        captured.push(canvas);
        wrap.remove();
      }

      if (!captured.length) return;

      const pdf = createPdf(jsPDF, orientation);
      addCanvasPaginated(pdf, captured[0]);
      for (let i = 1; i < captured.length; i++) {
        pdf.addPage("a4", orientation);
        addCanvasPaginated(pdf, captured[i]);
      }
      pdf.save(filename);
      return;
    }

    // Documentos: si el contenido es muy ancho (tablas), usar landscape
    const naturalW = Math.max(clone.scrollWidth, widthPx);
    const naturalH = Math.max(clone.scrollHeight, 400);
    orientation = resolveOrientation(
      forcedLandscape,
      componentType,
      naturalW,
      naturalH,
      preferWide,
    );

    if (orientation !== probeOrientation) {
      cleanupExportHost(host);
      widthPx = PAGE_CONTENT_PX[orientation];
      ({ host, clone } = prepareExportClone(element, widthPx, mode));
    } else {
      // Mantener ancho fijo de hoja (no expandir → evita letra diminuta)
      host.style.width = `${widthPx}px`;
    }

    applyReadableDocumentStyles(clone, "document");
    const canvas = await captureElement(clone, html2canvas, "document");
    const pdf = createPdf(jsPDF, orientation);
    addCanvasPaginated(pdf, canvas);
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
