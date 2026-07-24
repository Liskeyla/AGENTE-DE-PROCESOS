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

type ExportMode = "document" | "diagram";

type ExportOptions = {
  organizationName: string;
  landscape?: boolean;
  diagramProcessName?: string;
};

function applyDiagramLayout(clone: HTMLElement) {
  clone.querySelectorAll<HTMLElement>(".bizagi-flow-sequence").forEach((el) => {
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("flex-wrap", "nowrap", "important");
    el.style.setProperty("align-items", "center", "important");
    el.style.setProperty("gap", "8px", "important");
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("overflow", "visible", "important");
  });

  clone.querySelectorAll<HTMLElement>(".bizagi-lane-row").forEach((el) => {
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("flex-direction", "row", "important");
    el.style.setProperty("align-items", "stretch", "important");
    el.style.setProperty("width", "100%", "important");
  });

  clone.querySelectorAll<HTMLElement>(".bizagi-lane-label").forEach((el) => {
    el.style.setProperty("width", "160px", "important");
    el.style.setProperty("min-width", "160px", "important");
    el.style.setProperty("flex-shrink", "0", "important");
  });

  clone.querySelectorAll<HTMLElement>(".bizagi-lane-steps").forEach((el) => {
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("flex-wrap", "nowrap", "important");
    el.style.setProperty("align-items", "center", "important");
    el.style.setProperty("gap", "12px", "important");
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("min-width", "100%", "important");
  });

  clone.querySelectorAll<HTMLElement>(".bizagi-export-block").forEach((el) => {
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("min-width", "100%", "important");
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
    "padding:28px",
    "background:#ffffff",
    "z-index:-1",
    "overflow:visible",
    "pointer-events:none",
    "font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
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

  const walk = (el: HTMLElement) => {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("overflow-x", "visible", "important");
    el.style.setProperty("overflow-y", "visible", "important");
    el.style.setProperty("max-height", "none", "important");
    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) walk(child);
    });
  };
  walk(clone);

  if (mode === "diagram") {
    applyDiagramLayout(clone);
  }

  host.appendChild(clone);
  document.body.appendChild(host);

  // Ajustar ancho del host al contenido real del diagrama
  if (mode === "diagram") {
    const needed = Math.max(widthPx, clone.scrollWidth + 56);
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
  clone: HTMLElement,
  html2canvas: typeof import("html2canvas").default,
): Promise<HTMLCanvasElement> {
  const w = Math.ceil(Math.max(clone.scrollWidth, clone.offsetWidth, 800));
  const h = Math.ceil(Math.max(clone.scrollHeight, clone.offsetHeight, 400));
  return html2canvas(clone, {
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
  });
}

/** Encaja la imagen en la página sin recortar (diagramas) o pagina en vertical (documentos). */
function addCanvasToPdf(
  pdf: { internal: { pageSize: { getWidth: () => number; getHeight: () => number } }; addImage: Function; addPage: Function },
  canvas: HTMLCanvasElement,
  mode: "fit" | "slice",
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  if (mode === "fit") {
    let imgWidth = usableWidth;
    let imgHeight = (canvas.height * imgWidth) / canvas.width;
    if (imgHeight > usableHeight) {
      imgHeight = usableHeight;
      imgWidth = (canvas.width * imgHeight) / canvas.height;
    }
    const x = margin + (usableWidth - imgWidth) / 2;
    const y = margin + (usableHeight - imgHeight) / 2;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgWidth, imgHeight);
    return;
  }

  const imgWidthMm = usableWidth;
  const fullHeightMm = (canvas.height * imgWidthMm) / canvas.width;
  if (fullHeightMm <= usableHeight) {
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, imgWidthMm, fullHeightMm);
    return;
  }

  const pageSlicePx = Math.floor((usableHeight * canvas.width) / imgWidthMm);
  let yPx = 0;
  let pageIndex = 0;
  while (yPx < canvas.height) {
    const slicePx = Math.min(pageSlicePx, canvas.height - yPx);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = slicePx;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, yPx, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
    const sliceMm = (slicePx * imgWidthMm) / canvas.width;
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, margin, imgWidthMm, sliceMm);
    yPx += slicePx;
    pageIndex += 1;
    if (pageIndex > 50) break;
  }
}

/**
 * Exporta un elemento a PDF. En modo diagrama usa lienzo ancho + layout horizontal
 * (igual que la vista previa Bizagi) y lo encaja en hoja apaisada.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  options?: { landscape?: boolean; mode?: ExportMode },
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const mode: ExportMode = options?.mode ?? "document";
  const landscape = options?.landscape ?? mode === "diagram";
  const widthPx = mode === "diagram" ? 2200 : 920;

  const { host, clone } = prepareExportClone(element, widthPx, mode);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });

    // Diagramas: una página por bloque Bizagi (se ve como la preview)
    const blocks = Array.from(
      clone.querySelectorAll<HTMLElement>(".bizagi-export-block"),
    );
    if (mode === "diagram" && blocks.length > 0) {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        // Envolver bloque + título de documento si es el primero
        const wrap = document.createElement("div");
        wrap.style.cssText = "background:#fff;padding:8px;width:max-content;";
        if (i === 0) {
          const header = clone.querySelector("header");
          if (header) wrap.appendChild(header.cloneNode(true));
        }
        wrap.appendChild(block.cloneNode(true));
        host.appendChild(wrap);
        applyDiagramLayout(wrap);
        await new Promise((r) => requestAnimationFrame(r));

        const canvas = await captureElement(wrap, html2canvas);
        if (i > 0) pdf.addPage();
        addCanvasToPdf(pdf, canvas, "fit");
        wrap.remove();
      }
    } else {
      const canvas = await captureElement(clone, html2canvas);
      addCanvasToPdf(pdf, canvas, "slice");
    }

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
  const landscape =
    options.landscape ??
    (isDiagram ||
      ["indicadores", "matriz_interaccion", "cumplimiento_legal"].includes(
        doc.component_type,
      ));
  await exportElementToPdf(element, filename, {
    landscape,
    mode: isDiagram ? "diagram" : "document",
  });
}
