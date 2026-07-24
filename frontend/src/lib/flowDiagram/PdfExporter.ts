import { buildDiagramSvg, computePageBreaks } from "./svgBuilder";
import type { FlowLayoutResult } from "./types";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Exporta SVG vectorial puro. */
export function exportDiagramSvg(
  layout: FlowLayoutResult,
  filename: string,
  organizationName?: string,
) {
  const svg = buildDiagramSvg(layout, { organizationName });
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

/** PNG alta resolución (~300 dpi equivalente a scale 3–4). */
export async function exportDiagramPng(
  layout: FlowLayoutResult,
  filename: string,
  organizationName?: string,
  scale = 3,
): Promise<void> {
  const svg = buildDiagramSvg(layout, { organizationName });
  const img = new Image();
  const url = svgToDataUrl(svg);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo rasterizar el SVG"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  await new Promise<void>((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob) downloadBlob(blob, filename);
        resolve();
      },
      "image/png",
      1,
    );
  });
}

/**
 * PDF vectorial vía svg2pdf (no captura de pantalla).
 * Landscape A4, márgenes 20 mm, header repetido, sin cortar actividades.
 */
export async function exportDiagramPdf(
  layout: FlowLayoutResult,
  filename: string,
  organizationName?: string,
): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js"),
  ]);

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const marginMm = 20;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const usableW = pageW - marginMm * 2;
  const usableH = pageH - marginMm * 2;

  // px → mm al escalar al ancho útil
  const scale = usableW / layout.width;
  const pageContentHeightPx = usableH / scale;

  const breaks = computePageBreaks(layout, pageContentHeightPx);
  const fullSvg = buildDiagramSvg(layout, { organizationName, includeHeader: true });

  for (let i = 0; i < breaks.length; i++) {
    const { y0, y1 } = breaks[i];
    const sliceH = Math.max(1, y1 - y0);
    if (i > 0) pdf.addPage("a4", "landscape");

    // Contenedor SVG con viewBox recortado (vectorial)
    const sliceSvg = fullSvg
      .replace(
        /width="[^"]+" height="[^"]+" viewBox="[^"]+"/,
        `width="${layout.width}" height="${sliceH}" viewBox="0 ${y0} ${layout.width} ${sliceH}"`,
      );

    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-20000px;top:0;width:0;height:0;overflow:hidden;";
    container.innerHTML = sliceSvg;
    const svgEl = container.querySelector("svg");
    document.body.appendChild(container);
    if (!svgEl) {
      container.remove();
      continue;
    }

    const drawH = sliceH * scale;
    try {
      await svg2pdf(svgEl, pdf, {
        x: marginMm,
        y: marginMm,
        width: usableW,
        height: drawH,
      });
    } finally {
      container.remove();
    }
  }

  pdf.save(filename);
}

export const PdfExporter = {
  exportPdf: exportDiagramPdf,
  exportSvg: exportDiagramSvg,
  exportPng: exportDiagramPng,
};
