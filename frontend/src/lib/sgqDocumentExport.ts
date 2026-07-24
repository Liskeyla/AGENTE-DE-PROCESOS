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

type ExportOptions = {
  organizationName: string;
  landscape?: boolean;
  diagramProcessName?: string;
};

/** Prepara un clon off-screen sin recortes (overflow / max-height) para capturar todo el contenido. */
function prepareExportClone(
  source: HTMLElement,
  widthPx: number,
): { host: HTMLDivElement; clone: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("data-sgq-pdf-export-host", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-12000px",
    "top:0",
    `width:${widthPx}px`,
    "padding:24px",
    "background:#ffffff",
    "z-index:-1",
    "overflow:visible",
    "pointer-events:none",
  ].join(";");

  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.cssText = [
    "width:100%",
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
    el.style.setProperty("height", "auto", "important");
    if (el.classList.contains("overflow-x-auto") || el.classList.contains("overflow-auto")) {
      el.style.setProperty("display", "block", "important");
    }
    // Flujos Bizagi: evitar scroll horizontal que recorta en captura
    if (el.classList.contains("flex") && el.classList.contains("overflow-x-auto")) {
      el.style.setProperty("flex-wrap", "wrap", "important");
      el.style.setProperty("row-gap", "12px", "important");
    }
    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) walk(child);
    });
  };
  walk(clone);

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

/**
 * Exporta un elemento a PDF multipágina, capturando la altura completa
 * (igual que la vista previa) sin cortar tablas ni diagramas.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  options?: { landscape?: boolean },
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const landscape = options?.landscape ?? false;
  const widthPx = landscape ? 1400 : 900;
  const { host, clone } = prepareExportClone(element, widthPx);

  // Esperar layout (fuentes / flex wrap)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const canvas = await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      width: clone.scrollWidth,
      height: clone.scrollHeight,
      windowWidth: clone.scrollWidth,
      windowHeight: clone.scrollHeight,
      scrollX: 0,
      scrollY: 0,
    });

    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const imgWidthMm = usableWidth;
    const fullHeightMm = (canvas.height * imgWidthMm) / canvas.width;
    // Altura en px del canvas que cabe en una página
    const pageSlicePx = Math.floor((usableHeight * canvas.width) / imgWidthMm);

    if (fullHeightMm <= usableHeight) {
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, imgWidthMm, fullHeightMm);
    } else {
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
        ctx.drawImage(
          canvas,
          0,
          yPx,
          canvas.width,
          slicePx,
          0,
          0,
          canvas.width,
          slicePx,
        );
        const sliceMm = (slicePx * imgWidthMm) / canvas.width;
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(
          pageCanvas.toDataURL("image/png"),
          "PNG",
          margin,
          margin,
          imgWidthMm,
          sliceMm,
        );
        yPx += slicePx;
        pageIndex += 1;
        // Seguridad ante bucles infinitos
        if (pageIndex > 40) break;
      }
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
  const landscape =
    options.landscape ??
    ["mapa_procesos", "diagrama_flujo", "organigrama", "indicadores", "matriz_interaccion"].includes(
      doc.component_type,
    );
  await exportElementToPdf(element, filename, { landscape });
}
