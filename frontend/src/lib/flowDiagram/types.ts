/** Constantes y tipos del diagrama de flujo BPM (Bizagi / Signavio style). */

export type FlowNodeKind = "start" | "end" | "task" | "decision" | "system";

export type FlowActivityInput = {
  id: string;
  name: string;
  responsible: string;
  type?: string;
  status_note?: string;
};

export type FlowDecisionInput = {
  after: string;
  question?: string;
  yes_to?: string;
  no_to?: string;
  yes_label?: string;
  no_label?: string;
};

export type FlowDiagramInput = {
  process_name: string;
  start_event?: string;
  end_event?: string;
  mode?: string;
  activities: FlowActivityInput[];
  sequence: string[];
  decisions?: FlowDecisionInput[];
};

export type Point = { x: number; y: number };

export type LaidOutNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  laneIndex: number;
  laneLabel: string;
  columnIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  number?: number;
  statusNote?: string;
};

export type LaidOutEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  points: Point[];
};

export type LaidOutLane = {
  index: number;
  label: string;
  y: number;
  height: number;
};

export type FlowLayoutResult = {
  width: number;
  height: number;
  laneLabelWidth: number;
  nodeWidth: number;
  margin: number;
  lanes: LaidOutLane[];
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  processName: string;
  modeLabel: string;
  headerTitle: string;
};

export const FLOW_THEME = {
  header: "#173B73",
  swimlaneBg: "#F8FAFC",
  swimlaneBorder: "#CBD5E1",
  text: "#334155",
  textStrong: "#1E293B",
  activityBg: "#FFFFFF",
  activityBorder: "#2952CC",
  arrow: "#64748B",
  startFill: "#ECFDF5",
  startBorder: "#059669",
  endFill: "#FEF2F2",
  endBorder: "#DC2626",
  gatewayFill: "#FFFBEB",
  gatewayBorder: "#D97706",
  laneBars: ["#173B73", "#0F766E", "#C2410C", "#7C3AED", "#0369A1", "#B45309"],
  laneBgs: ["#F1F5F9", "#F0FDFA", "#FFF7ED", "#FAF5FF", "#F0F9FF", "#FFFBEB"],
} as const;

export const FLOW_LAYOUT = {
  nodeWidth: 280,
  nodePadding: 16,
  fontSize: 14 as number,
  fontWeight: 600 as number,
  lineHeight: 18 as number,
  /** Más líneas = texto completo legible en PDF/UI (sin “…”). */
  maxLines: 8 as number,
  /** Separación horizontal entre actividades (borde a borde). */
  horizontalGap: 96 as number,
  /** Separación vertical mínima entre centros de lanes. */
  verticalGap: 100 as number,
  margin: 36 as number,
  laneLabelWidth: 156,
  borderWidth: 2,
  borderRadius: 10,
  shadow: "0 4px 10px rgba(0,0,0,.08)",
  startEndRadius: 28,
  numberBadge: 22,
  headerBarHeight: 36,
};

export function modeLabelFrom(mode?: string): string {
  const m = (mode || "to_be").toLowerCase();
  if (m.includes("as") && m.includes("is")) return "AS IS";
  return "TO BE";
}
