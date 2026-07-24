import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import { measureActivityHeight, measureEventHeight } from "./measure";
import {
  FLOW_LAYOUT,
  modeLabelFrom,
  type FlowDiagramInput,
  type FlowLayoutResult,
  type FlowNodeKind,
  type LaidOutEdge,
  type LaidOutLane,
  type LaidOutNode,
  type Point,
} from "./types";

const elk = new ELK();

type SeqItem = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  lane: string;
  number?: number;
  statusNote?: string;
};

function normalizeKind(type?: string): FlowNodeKind {
  const t = (type || "task").toLowerCase();
  if (t === "decision" || t === "gateway") return "decision";
  if (t === "system") return "system";
  return "task";
}

function buildLanes(
  sequence: string[],
  actMap: Map<string, FlowDiagramInput["activities"][number]>,
): string[] {
  const lanes: string[] = [];
  for (const id of sequence) {
    const lane = (actMap.get(id)?.responsible || "General").trim() || "General";
    if (!lanes.includes(lane)) lanes.push(lane);
  }
  if (!lanes.length) lanes.push("General");
  return lanes;
}

function routeOrthogonal(sx: number, sy: number, tx: number, ty: number): Point[] {
  if (Math.abs(sy - ty) < 1.5) {
    return [
      { x: sx, y: sy },
      { x: tx, y: ty },
    ];
  }
  const midX = sx + Math.max(40, (tx - sx) * 0.5);
  return [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ];
}

function columnPitch(): number {
  return FLOW_LAYOUT.nodeWidth + FLOW_LAYOUT.horizontalGap;
}

/**
 * Motor de layout: ELK layered + particiones por swimlane,
 * luego snap compacto (sin columnas/filas vacías, alturas uniformes).
 */
export async function runLayoutEngine(
  input: FlowDiagramInput,
): Promise<FlowLayoutResult> {
  const actMap = new Map(input.activities.map((a) => [a.id, a] as const));
  const sequence = (
    input.sequence.length ? input.sequence : input.activities.map((a) => a.id)
  ).filter((id) => actMap.has(id));

  const lanes = buildLanes(sequence, actMap);
  const laneIndex = new Map(lanes.map((l, i) => [l, i]));
  const modeLabel = modeLabelFrom(input.mode);

  const firstLane =
    sequence.length > 0
      ? (actMap.get(sequence[0])?.responsible || lanes[0]).trim() || lanes[0]
      : lanes[0];
  const lastLane =
    sequence.length > 0
      ? (actMap.get(sequence[sequence.length - 1])?.responsible || lanes[0]).trim() ||
        lanes[0]
      : lanes[0];

  const items: SeqItem[] = [
    {
      id: "__start__",
      kind: "start",
      label: input.start_event || "Inicio del proceso",
      lane: firstLane,
    },
    ...sequence.map((id, i) => {
      const a = actMap.get(id)!;
      return {
        id,
        kind: normalizeKind(a.type),
        label: a.name || id,
        lane: (a.responsible || "General").trim() || "General",
        number: i + 1,
        statusNote: a.status_note?.trim() || undefined,
      };
    }),
    {
      id: "__end__",
      kind: "end",
      label: input.end_event || "Fin del proceso",
      lane: lastLane,
    },
  ];

  // Una columna por actividad (sin columnas vacías)
  const internal = items.map((item, col) => {
    const isEvent = item.kind === "start" || item.kind === "end";
    const height = isEvent
      ? measureEventHeight(item.label)
      : measureActivityHeight(item.label, !!item.statusNote);
    return {
      ...item,
      columnIndex: col,
      laneIndex: laneIndex.get(item.lane) ?? 0,
      width: FLOW_LAYOUT.nodeWidth,
      height,
    };
  });

  const edges: Array<{ id: string; source: string; target: string; label?: string }> = [];
  for (let i = 0; i < items.length - 1; i++) {
    edges.push({
      id: `seq-${items[i].id}-${items[i + 1].id}`,
      source: items[i].id,
      target: items[i + 1].id,
    });
  }
  for (const dec of input.decisions || []) {
    if (dec.yes_to && actMap.has(dec.yes_to)) {
      edges.push({
        id: `yes-${dec.after}-${dec.yes_to}`,
        source: dec.after,
        target: dec.yes_to,
        label: dec.yes_label || "Sí",
      });
    }
    if (dec.no_to && actMap.has(dec.no_to)) {
      edges.push({
        id: `no-${dec.after}-${dec.no_to}`,
        source: dec.after,
        target: dec.no_to,
        label: dec.no_label || "No",
      });
    }
  }

  // ELK: layered L→R + partition por lane (calcula capas; luego snap)
  const pitch = columnPitch();
  const elkChildren: ElkNode[] = internal.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
    layoutOptions: {
      "elk.partitioning.partition": String(n.laneIndex),
      "elk.layered.layering.layerConstraint": "NONE",
      "elk.position": `(${n.columnIndex * pitch},0)`,
    },
  }));
  const elkEdges: ElkExtendedEdge[] = edges
    .filter((e) => internal.some((n) => n.id === e.source) && internal.some((n) => n.id === e.target))
    .map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    }));

  try {
    await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.partitioning.activate": "true",
        "elk.layered.spacing.nodeNodeBetweenLayers": String(FLOW_LAYOUT.horizontalGap),
        "elk.spacing.nodeNode": String(FLOW_LAYOUT.verticalGap),
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.padding": `[top=${FLOW_LAYOUT.margin},left=${FLOW_LAYOUT.margin},bottom=${FLOW_LAYOUT.margin},right=${FLOW_LAYOUT.margin}]`,
      },
      children: elkChildren,
      edges: elkEdges,
    });
  } catch {
    // Continuar con snap determinístico
  }

  // Alturas de lane uniformes (compactas, sin filas vacías)
  const perLaneMax = lanes.map((_, li) => {
    const inLane = internal.filter((n) => n.laneIndex === li);
    const maxH = inLane.length
      ? Math.max(...inLane.map((n) => n.height))
      : 80;
    return Math.max(maxH + 36, FLOW_LAYOUT.verticalGap);
  });
  const uniformLaneH = Math.max(...perLaneMax, FLOW_LAYOUT.verticalGap);

  const laidLanes: LaidOutLane[] = lanes.map((label, index) => ({
    index,
    label,
    y: FLOW_LAYOUT.margin + FLOW_LAYOUT.headerBarHeight + index * uniformLaneH,
    height: uniformLaneH,
  }));

  const contentLeft =
    FLOW_LAYOUT.margin + FLOW_LAYOUT.laneLabelWidth + 16;
  const nodes: LaidOutNode[] = internal.map((n) => {
    const lane = laidLanes[n.laneIndex];
    const x = contentLeft + n.columnIndex * pitch;
    const y = lane.y + (lane.height - n.height) / 2;
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      laneIndex: n.laneIndex,
      laneLabel: n.lane,
      columnIndex: n.columnIndex,
      x,
      y,
      width: n.width,
      height: n.height,
      number: n.number,
      statusNote: n.statusNote,
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const laidEdges: LaidOutEdge[] = [];
  const seen = new Set<string>();

  for (const e of edges) {
    if (seen.has(e.id)) continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    seen.add(e.id);
    // Anclar al centro del círculo en start/end (evita cruzar la etiqueta del evento)
    const sIsEvent = s.kind === "start" || s.kind === "end";
    const tIsEvent = t.kind === "start" || t.kind === "end";
    const sx = sIsEvent ? s.x + s.width / 2 + FLOW_LAYOUT.startEndRadius * 0.85 : s.x + s.width;
    const sy = sIsEvent
      ? s.y + FLOW_LAYOUT.startEndRadius + 8
      : s.y + s.height / 2;
    const tx = tIsEvent ? t.x + t.width / 2 - FLOW_LAYOUT.startEndRadius * 0.85 : t.x;
    const ty = tIsEvent
      ? t.y + FLOW_LAYOUT.startEndRadius + 8
      : t.y + t.height / 2;
    if (tx < sx - 8 && !e.label) {
      // wrap raro: enrutar abajo
      const midY = Math.max(sy, ty) + 24;
      laidEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        points: [
          { x: sx, y: sy },
          { x: sx + 24, y: sy },
          { x: sx + 24, y: midY },
          { x: tx - 24, y: midY },
          { x: tx - 24, y: ty },
          { x: tx, y: ty },
        ],
      });
    } else {
      laidEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        points: routeOrthogonal(sx, sy, tx, ty),
      });
    }
  }

  const cols = internal.length;
  const width =
    contentLeft +
    cols * pitch -
    FLOW_LAYOUT.horizontalGap +
    FLOW_LAYOUT.margin;
  const height =
    FLOW_LAYOUT.margin +
    FLOW_LAYOUT.headerBarHeight +
    lanes.length * uniformLaneH +
    FLOW_LAYOUT.margin;

  return {
    width: Math.max(width, 640),
    height: Math.max(height, 320),
    laneLabelWidth: FLOW_LAYOUT.laneLabelWidth,
    nodeWidth: FLOW_LAYOUT.nodeWidth,
    margin: FLOW_LAYOUT.margin,
    lanes: laidLanes,
    nodes,
    edges: laidEdges,
    processName: input.process_name,
    modeLabel,
    headerTitle: `Diagrama de flujo ${modeLabel}: ${input.process_name}`,
  };
}

/** Alias público solicitado. */
export const computeDiagramLayout = runLayoutEngine;
