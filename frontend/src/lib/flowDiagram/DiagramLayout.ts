import { runLayoutEngine } from "./LayoutEngine";
import type { FlowDiagramInput, FlowLayoutResult } from "./types";

/**
 * Fachada de layout: convierte el JSON SGQ en un layout BPM listo para
 * React Flow / SVG / PDF.
 */
export async function buildDiagramLayout(
  input: FlowDiagramInput,
): Promise<FlowLayoutResult> {
  return runLayoutEngine(input);
}

export { runLayoutEngine as LayoutEngine };
