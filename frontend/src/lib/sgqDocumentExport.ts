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

/** Tipos que suelen ser anchos (matrices/tablas) → preferir horizontal si el contenido lo justifica. */
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

/**
 * Elige orientación según el contenido real (no por lista fija).
 * Horizontal solo si el lienzo es claramente más ancho que alto,
 * o si es diagrama/matriz ancha con ratio ≥ ~1.05.
 */
export function chooseOrientation(
  contentWidthPx: number,
  contentHeightPx: number,
  componentType?: string,
): PageOrientation {
  const w = Math.max(1, contentWidthPx);
  const h = Math.max(1, contentHeightPx);
  const ratio = w / h;

  if (ratio >= 1.25) return "landscape";
  if (componentType && DIAGRAM_TYPES.has(componentType) && ratio >= 1.05) {
    return "landscape";
  }
  if (
    componentType &&
    WIDE_CANDIDATE_TYPES.has(componentType) &&
    ratio >= 1.12 &&
    w >= 1100
  ) {
    return "landscape";
  }
  return "portrait";
}

function applyExportStyles(root: HTMLElement, mode: ExportMode) {
  const walk = (el: HTMLElement) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("overflow-x", "visible", "important");
    el.style.setProperty("overflow-y", "visible", "important");
    el.style.setProperty("max-height", "none", "important");
    el.style.setProperty("max-width", "none", "important");
    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) walk(child);
    });
  };
  walk(root);

  // Tablas: sin table-fixed, texto completo, sin contenedores que recorten
  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.style.setProperty("table-layout", "auto", "important");
    table.style.setProperty("width", "100%", "important");
    table.style.setProperty("min-width", "100%", "important");
    table.style.setProperty("border-collapse", "collapse", "important");
    table.classList.remove("table-fixed");
  });

  root.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
    cell.style.setProperty("white-space", "pre-wrap", "important");
    cell.style.setProperty("word-break", "break-word", "important");
    cell.style.setProperty("overflow-wrap", "anywhere", "important");
    cell.style.setProperty("overflow", "visible", "important");
    cell.style.setProperty("vertical-align", "top", "important");
    cell.style.setProperty("height", "auto", "important");
    cell.style.setProperty("max-height", "none", "important");
  });

  root.querySelectorAll<HTMLElement>("p, li, span, div, h1, h2, h3, h4").forEach((el) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("text-overflow", "clip", "important");
    if (getComputedStyle(el).webkitLineClamp && getComputedStyle(el).webkitLineClamp !== "none") {
      el.style.setProperty("-webkit-line-clamp", "unset", "important");
    }
  });

  // Encabezado institucional: ancho completo de la hoja (proporcional)
  root.querySelectorAll<HTMLElement>(".sgq-doc-header").forEach((el) => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
  });
  root.querySelectorAll<HTMLElement>(".sgq-doc-header-meta").forEach((el) => {
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
  });

  if (mode === "diagram") {
    root.querySelectorAll<HTMLElement>(".bizagi-flow-sequence").forEach((el) => {
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("width", "max-content", "important");
      el.style.setProperty("max-width", "none", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
    root.querySelectorAll<SVGElement>(".bizagi-flow-canvas").forEach((el) => {
      el.style.setProperty("display", "block", "important");
      el.style.setProperty("max-width", "none", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
    root.querySelectorAll<HTMLElement>(".bizagi-lane-row").forEach((el) => {
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("width", "max-content", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
    root.querySelectorAll<HTMLElement>(".bizagi-export-block").forEach((el) => {
      el.style.setProperty("width", "max-content", "important");
      el.style.setProperty("min-width", "100%", "important");
      el.style.setProperty("overflow", "visible", "important");
    });
  } else {
    // Documentos: el cuerpo usa todo el ancho del host; tablas pueden crecer
    root.style.setProperty("width", "100%", "important");
    root.querySelectorAll<HTMLElement>(".sgq-document-export, .sgq-document-body").forEach((el) => {
      el.style.setProperty("max-width", "none", "important");
      el.style.setProperty("width", "100%", "important");
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
    "padding:24px",
    "background:#ffffff",
    "z-index:-1",
    "overflow:visible",
    "pointer-events:none",
    "font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "box-sizing:border-box",
  ].join(";");

  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.cssText = [
    mode === "diagram" ? "width:max-content" : "width:100%",
    "min-width:100%",
    "max-width:none",
    "max-height:none",
    "height:auto",
    "overflow:visible",
    "background:#ffffff",
    "color:#0f172a",
    "box-sizing:border-box",
  ].join(";");

  applyExportStyles(clone, mode);

  host.appendChild(clone);
  document.body.appendChild(host);

  // Ampliar host si tablas/diagramas necesitan más ancho (evita cortes horizontales)
  const needed = Math.max(widthPx, clone.scrollWidth + 48);
  if (needed > widthPx) {
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
): Promise<HTMLCanvasElement> {
  // Esperar layout + fuentes
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const w = Math.ceil(Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth, 800));
  const h = Math.ceil(Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight, 400));

  const canvas = await html2canvas(el, {
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
      applyExportStyles(cloned as HTMLElement, "document");
      (cloned as HTMLElement).style.setProperty("overflow", "visible", "important");
    },
  });

  // Si html2canvas truncó, reintentar con altura del canvas reportada vs scroll
  if (canvas.height < h * 1.5) {
    // scale=2 → esperamos ~2*h; tolerar
  }
  return canvas;
}

function addCanvasPaginated(
  // jsPDF instance — tipado laxo para compatibilidad entre versiones
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement,
  options?: { centerIfSinglePage?: boolean },
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const imgWidthMm = usableWidth;
  const fullHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  if (fullHeightMm <= usableHeight) {
    const y =
      margin +
      (options?.centerIfSinglePage ? (usableHeight - fullHeightMm) / 2 : 0);
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      margin,
      y,
      imgWidthMm,
      fullHeightMm,
    );
    return;
  }

  const pageSlicePx = Math.max(1, Math.floor((usableHeight * canvas.width) / imgWidthMm));
  let yPx = 0;
  let pageIndex = 0;
  while (yPx < canvas.height) {
    const slicePx = Math.min(pageSlicePx, canvas.height - yPx);
    // Evitar cortes de 1px residuales
    const safeSlice = slicePx < 2 && yPx > 0 ? canvas.height - yPx : slicePx;
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
      sliceMm,
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

/**
 * Exporta un elemento a PDF sin recortes.
 * Orientación automática según proporción del contenido (salvo override).
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

  // Ancho de captura: más amplio para matrices/diagramas
  const preferWide =
    mode === "diagram" ||
    (componentType ? WIDE_CANDIDATE_TYPES.has(componentType) : false);
  const widthPx = mode === "diagram" ? 1600 : preferWide ? 1280 : 980;

  const { host, clone } = prepareExportClone(element, widthPx, mode);

  try {
    const blocks = Array.from(
      clone.querySelectorAll<HTMLElement>(".bizagi-export-block"),
    );

    if (mode === "diagram" && blocks.length > 0) {
      const header = clone.querySelector<HTMLElement>(".sgq-doc-header");
      const captured: Array<{ canvas: HTMLCanvasElement; orientation: PageOrientation }> =
        [];

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const wrap = document.createElement("div");
        wrap.style.cssText =
          "background:#ffffff;padding:16px 20px;width:max-content;min-width:100%;box-sizing:border-box;overflow:visible;";

        // Encabezado encima del diagrama, al mismo ancho (como encabezado normal)
        if (header && i === 0) {
          const headerClone = header.cloneNode(true) as HTMLElement;
          headerClone.style.cssText = [
            "width:100%",
            "max-width:none",
            "box-sizing:border-box",
            "margin-bottom:20px",
            "padding-bottom:16px",
            "border-bottom:2px solid #e2e8f0",
            "text-align:center",
          ].join(";");
          wrap.appendChild(headerClone);
        }

        wrap.appendChild(block.cloneNode(true));
        host.appendChild(wrap);
        applyExportStyles(wrap, "diagram");

        // Forzar encabezado al ancho real del diagrama
        const contentW = Math.max(
          block.scrollWidth,
          wrap.scrollWidth,
          widthPx,
        );
        wrap.style.width = `${contentW}px`;
        wrap.querySelectorAll<HTMLElement>(".sgq-doc-header, .sgq-doc-header-meta").forEach((el) => {
          el.style.setProperty("width", "100%", "important");
          el.style.setProperty("max-width", "none", "important");
        });

        const needed = Math.max(
          Number.parseInt(host.style.width, 10) || widthPx,
          contentW + 40,
        );
        host.style.width = `${needed}px`;

        const canvas = await captureElement(wrap, html2canvas);
        const logicalW = canvas.width / 2;
        const logicalH = canvas.height / 2;
        const blockOrientation: PageOrientation =
          forcedLandscape === true
            ? "landscape"
            : forcedLandscape === false
              ? "portrait"
              : chooseOrientation(logicalW, logicalH, componentType);
        captured.push({ canvas, orientation: blockOrientation });
        wrap.remove();
      }

      if (!captured.length) {
        return;
      }

      const pdf = createPdf(jsPDF, captured[0].orientation);
      // Sin centrar: el encabezado y el diagrama ocupan el ancho útil de la hoja
      addCanvasPaginated(pdf, captured[0].canvas);

      for (let i = 1; i < captured.length; i++) {
        const page = captured[i];
        pdf.addPage("a4", page.orientation);
        addCanvasPaginated(pdf, page.canvas);
      }

      pdf.save(filename);
      return;
    }

    // Documentos normales (tablas, textos, matrices)
    const canvas = await captureElement(clone, html2canvas);
    const logicalW = canvas.width / 2;
    const logicalH = canvas.height / 2;
    const finalOrientation: PageOrientation =
      forcedLandscape === true
        ? "landscape"
        : forcedLandscape === false
          ? "portrait"
          : chooseOrientation(logicalW, logicalH, componentType);

    const pdf = createPdf(jsPDF, finalOrientation);
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
    // Solo forzar si el caller lo pide; si no, auto según contenido
    landscape: options.landscape,
    mode: isDiagram ? "diagram" : "document",
    componentType: doc.component_type,
  });
}
