import { buildDiagramSvg } from "./svgBuilder";
import {
  choosePageFormat,
  downloadBlob,
  renderDiagramToNativePdf,
  scaleLayoutToPageWidth,
  type PdfMeta,
} from "./NativePdfDrawer";
import type { FlowLayoutResult } from "./types";

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Exporta SVG vectorial (mismo modelo de datos que el PDF). */
export function exportDiagramSvg(
  layout: FlowLayoutResult,
  filename: string,
  organizationName?: string,
) {
  const svg = buildDiagramSvg(layout, { organizationName });
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

/**
 * PNG 4K desde SVG vectorial (solo para raster; el PDF NO usa este camino).
 * 3840px de ancho ≈ 4K.
 */
export async function exportDiagramPng(
  layout: FlowLayoutResult,
  filename: string,
  organizationName?: string,
  targetWidth = 3840,
): Promise<void> {
  const scale = targetWidth / Math.max(layout.width, 1);
  const svg = buildDiagramSvg(layout, { organizationName });
  const img = new Image();
  const url = svgToDataUrl(svg);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo rasterizar el SVG a PNG"));
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

export type ExportDiagramPdfOptions = PdfMeta & {
  organizationName?: string;
};

/**
 * PDF nativo vectorial construido desde el modelo de layout.
 * - Sin html2canvas / screenshots / imágenes del DOM
 * - A3 o A4 landscape según tamaño
 * - Márgenes 20 mm, ancho útil 100%
 * - Encabezado en cada página
 * - Texto seleccionable
 */
export async function exportDiagramPdf(
  layout: FlowLayoutResult,
  filename: string,
  organizationNameOrOptions?: string | ExportDiagramPdfOptions,
): Promise<void> {
  const meta: PdfMeta =
    typeof organizationNameOrOptions === "string"
      ? {
          organizationName: organizationNameOrOptions,
          processType: layout.modeLabel,
          version: "V01",
          generatedAt: new Date(),
        }
      : {
          organizationName: organizationNameOrOptions?.organizationName,
          processType:
            organizationNameOrOptions?.processType || layout.modeLabel,
          version: organizationNameOrOptions?.version || "V01",
          generatedAt: organizationNameOrOptions?.generatedAt || new Date(),
        };

  await renderDiagramToNativePdf(layout, filename, meta);
}

export const PdfExporter = {
  exportPdf: exportDiagramPdf,
  exportSvg: exportDiagramSvg,
  exportPng: exportDiagramPng,
  choosePageFormat,
  scaleLayoutToPageWidth,
};
