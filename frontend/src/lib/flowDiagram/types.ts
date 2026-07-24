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

export type LaidOutNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  laneIndex: number;
  laneLabel: string;
  bandIndex: number;
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
  /** Orthogonal polyline points in canvas coordinates */
  points: Array<{ x: number; y: number }>;
};

export type LaidOutLane = {
  index: number;
  label: string;
  y: number;
  height: number;
  colorIndex: number;
};

export type LaidOutBand = {
  index: number;
  y: number;
  height: number;
  lanes: LaidOutLane[];
};

export type FlowLayoutResult = {
  width: number;
  height: number;
  laneLabelWidth: number;
  nodeWidth: number;
  bands: LaidOutBand[];
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  processName: string;
  modeLabel: string;
};

export const FLOW_LAYOUT = {
  nodeWidth: 200,
  nodePaddingX: 16,
  nodePaddingY: 16,
  fontSize: 13 as number,
  lineHeight: 18 as number,
  maxLines: 3 as number,
  minHorizontalSpacing: 220 as number,
  minVerticalSpacing: 140 as number,
  laneLabelWidth: 160,
  poolPadding: 24,
  bandGap: 48,
  startEndSize: 56,
  borderColor: "#2952CC",
  borderWidth: 2,
  borderRadius: 10,
};
