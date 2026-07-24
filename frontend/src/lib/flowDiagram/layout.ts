import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import { estimateActivityNodeHeight, estimateEventNodeHeight } from "./measure";
import {
  FLOW_LAYOUT,
  type FlowDiagramInput,
  type FlowLayoutResult,
  type FlowNodeKind,
  type LaidOutBand,
  type LaidOutEdge,
  type LaidOutLane,
  type LaidOutNode,
} from "./types";

const elk = new ELK();

type InternalNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  laneIndex: number;
  laneLabel: string;
  columnIndex: number;
  bandIndex: number;
  width: number;
  height: number;
  number?: number;
  statusNote?: string;
};

type InternalEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

function normalizeKind(type?: string): FlowNodeKind {
  const t = (type || "task").toLowerCase();
  if (t === "decision" || t === "gateway") return "decision";
  if (t === "system") return "system";
  return "task";
}

function buildLaneOrder(
  sequence: string[],
  actMap: Map<string, FlowDiagramInput["activities"][number]>,
): string[] {
  const lanes: string[] = [];
  for (const id of sequence) {
    const act = actMap.get(id);
    const lane = (act?.responsible || "General").trim() || "General";
    if (!lanes.includes(lane)) lanes.push(lane);
  }
  if (!lanes.length) lanes.push("General");
  return lanes;
}

/**
 * Column pitch (left-edge to left-edge) must be ≥ minHorizontalSpacing
 * and also leave room for node width.
 */
function columnPitch(nodeWidth: number): number {
  return Math.max(FLOW_LAYOUT.minHorizontalSpacing, nodeWidth + 48);
}

function maxColumnsForWidth(availableWidth: number, nodeWidth: number): number {
  const pitch = columnPitch(nodeWidth);
  const usable = Math.max(
    pitch,
    availableWidth - FLOW_LAYOUT.laneLabelWidth - FLOW_LAYOUT.poolPadding * 2,
  );
  return Math.max(2, Math.floor(usable / pitch));
}

/** Orthogonal L→R path: horizontal, then vertical (lane change), then horizontal. */
function routeOrthogonal(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Array<{ x: number; y: number }> {
  if (Math.abs(sy - ty) < 1) {
    return [
      { x: sx, y: sy },
      { x: tx, y: ty },
    ];
  }
  // Prefer mid X between source right and target left for vertical segment
  const midX = sx + Math.max(24, (tx - sx) / 2);
  return [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ];
}

function staggerEdgeMidX(
  baseMid: number,
  edgeIndex: number,
  total: number,
): number {
  if (total <= 1) return baseMid;
  const offset = (edgeIndex - (total - 1) / 2) * 12;
  return baseMid + offset;
}

async function layoutBandWithElk(
  nodes: InternalNode[],
  edges: InternalEdge[],
  laneCount: number,
  bandOffsetY: number,
): Promise<{ nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number }> {
  const pitch = columnPitch(FLOW_LAYOUT.nodeWidth);
  const children: ElkNode[] = nodes.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
    layoutOptions: {
      "elk.partitioning.partition": String(n.laneIndex),
      // Keep sequence order left→right
      "elk.layered.layering.layerConstraint": "NONE",
      "elk.position": `(${n.columnIndex * pitch}, ${n.laneIndex * FLOW_LAYOUT.minVerticalSpacing})`,
    },
  }));

  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
    labels: e.label
      ? [{ id: `${e.id}-label`, text: e.label, width: 40, height: 16 }]
      : undefined,
  }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        Math.max(48, columnPitch(FLOW_LAYOUT.nodeWidth) - FLOW_LAYOUT.nodeWidth),
      ),
      "elk.spacing.nodeNode": String(FLOW_LAYOUT.minVerticalSpacing),
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "16",
      "elk.partitioning.activate": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.padding": "[top=16,left=16,bottom=16,right=16]",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges: elkEdges,
  };

  let laid: ElkNode;
  try {
    laid = await elk.layout(graph);
  } catch {
    // Fallback: deterministic grid if ELK fails
    return layoutBandDeterministic(nodes, edges, laneCount, bandOffsetY);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const laidNodes: LaidOutNode[] = (laid.children || []).map((c) => {
    const src = byId.get(c.id)!;
    return {
      id: src.id,
      kind: src.kind,
      label: src.label,
      laneIndex: src.laneIndex,
      laneLabel: src.laneLabel,
      bandIndex: src.bandIndex,
      columnIndex: src.columnIndex,
      x: FLOW_LAYOUT.laneLabelWidth + (c.x || 0),
      y: bandOffsetY + (c.y || 0),
      width: c.width || src.width,
      height: c.height || src.height,
      number: src.number,
      statusNote: src.statusNote,
    };
  });

  // Enforce column alignment + uniform lane Y (Bizagi/Visio discipline)
  return snapToSwimlaneGrid(laidNodes, edges, nodes, laneCount, bandOffsetY);
}

function layoutBandDeterministic(
  nodes: InternalNode[],
  edges: InternalEdge[],
  laneCount: number,
  bandOffsetY: number,
): { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number } {
  return snapToSwimlaneGrid(
    nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      laneIndex: n.laneIndex,
      laneLabel: n.laneLabel,
      bandIndex: n.bandIndex,
      columnIndex: n.columnIndex,
      x: 0,
      y: 0,
      width: n.width,
      height: n.height,
      number: n.number,
      statusNote: n.statusNote,
    })),
    edges,
    nodes,
    laneCount,
    bandOffsetY,
  );
}

function snapToSwimlaneGrid(
  _positioned: LaidOutNode[],
  edges: InternalEdge[],
  sourceNodes: InternalNode[],
  laneCount: number,
  bandOffsetY: number,
): { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number } {
  const pitch = columnPitch(FLOW_LAYOUT.nodeWidth);
  const maxCol = Math.max(0, ...sourceNodes.map((n) => n.columnIndex));

  // Uniform lane height from tallest node in each lane (then equalize)
  const laneMaxH = Array.from({ length: laneCount }, () => FLOW_LAYOUT.minVerticalSpacing);
  for (const n of sourceNodes) {
    laneMaxH[n.laneIndex] = Math.max(
      laneMaxH[n.laneIndex],
      n.height + 32,
      FLOW_LAYOUT.minVerticalSpacing,
    );
  }
  const uniformLaneH = Math.max(...laneMaxH, FLOW_LAYOUT.minVerticalSpacing);

  const laneY: number[] = [];
  let cy = bandOffsetY;
  for (let i = 0; i < laneCount; i++) {
    laneY[i] = cy;
    cy += uniformLaneH;
  }

  const nodeMap = new Map<string, LaidOutNode>();
  for (const src of sourceNodes) {
    const x =
      FLOW_LAYOUT.laneLabelWidth +
      FLOW_LAYOUT.poolPadding +
      src.columnIndex * pitch;
    const y = laneY[src.laneIndex] + (uniformLaneH - src.height) / 2;
    nodeMap.set(src.id, {
      id: src.id,
      kind: src.kind,
      label: src.label,
      laneIndex: src.laneIndex,
      laneLabel: src.laneLabel,
      bandIndex: src.bandIndex,
      columnIndex: src.columnIndex,
      x,
      y,
      width: src.width,
      height: src.height,
      number: src.number,
      statusNote: src.statusNote,
    });
  }

  // Group edges by source column for mid-X stagger (avoid crossings)
  const edgesByPair = new Map<string, InternalEdge[]>();
  for (const e of edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    const key = `${s.columnIndex}->${t.columnIndex}`;
    const list = edgesByPair.get(key) || [];
    list.push(e);
    edgesByPair.set(key, list);
  }

  const laidEdges: LaidOutEdge[] = [];
  for (const group of Array.from(edgesByPair.values())) {
    group.forEach((e: InternalEdge, ei: number) => {
      const s = nodeMap.get(e.source)!;
      const t = nodeMap.get(e.target)!;
      const sx = s.x + s.width;
      const sy = s.y + s.height / 2;
      const tx = t.x;
      const ty = t.y + t.height / 2;
      let points = routeOrthogonal(sx, sy, tx, ty);
      if (points.length === 4) {
        const mid = staggerEdgeMidX(points[1].x, ei, group.length);
        points = [
          points[0],
          { x: mid, y: points[1].y },
          { x: mid, y: points[2].y },
          points[3],
        ];
      }
      // Ensure overall left→right (no back-edges visually)
      if (tx < sx - 1) {
        // wrap to next band: route down then right
        const downY = Math.max(sy, ty) + 28;
        points = [
          { x: sx, y: sy },
          { x: sx + 20, y: sy },
          { x: sx + 20, y: downY },
          { x: tx - 20, y: downY },
          { x: tx - 20, y: ty },
          { x: tx, y: ty },
        ];
      }
      laidEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        points,
      });
    });
  }

  const width =
    FLOW_LAYOUT.laneLabelWidth +
    FLOW_LAYOUT.poolPadding * 2 +
    (maxCol + 1) * pitch;
  const height = laneCount * uniformLaneH;

  return {
    nodes: Array.from(nodeMap.values()),
    edges: laidEdges,
    width,
    height,
  };
}

/**
 * Professional swimlane flow layout (ELK layered + swimlane snap).
 * Positions are never hand-authored; they come from the layout algorithm.
 */
export async function layoutFlowDiagram(
  input: FlowDiagramInput,
  availableWidth = 1100,
): Promise<FlowLayoutResult> {
  const actMap = new Map(
    input.activities.map((a) => [a.id, a] as const),
  );
  const sequence = (
    input.sequence.length
      ? input.sequence
      : input.activities.map((a) => a.id)
  ).filter((id) => actMap.has(id));

  const lanes = buildLaneOrder(sequence, actMap);
  const laneIndex = new Map(lanes.map((l, i) => [l, i]));

  const modeRaw = (input.mode || "to_be").toLowerCase();
  const modeLabel =
    modeRaw.includes("as") && modeRaw.includes("is")
      ? "AS IS"
      : "TO BE";

  // Build ordered flow nodes: start + activities + end
  type SeqItem = {
    id: string;
    kind: FlowNodeKind;
    label: string;
    lane: string;
    number?: number;
    statusNote?: string;
  };

  const firstLane = sequence.length
    ? (actMap.get(sequence[0])?.responsible || lanes[0]).trim() || lanes[0]
    : lanes[0];
  const lastLane = sequence.length
    ? (actMap.get(sequence[sequence.length - 1])?.responsible || lanes[0]).trim() ||
      lanes[0]
    : lanes[0];

  const seqItems: SeqItem[] = [
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

  const maxCols = maxColumnsForWidth(availableWidth, FLOW_LAYOUT.nodeWidth);
  const bandsCount = Math.ceil(seqItems.length / maxCols) || 1;

  const allNodes: LaidOutNode[] = [];
  const allEdges: LaidOutEdge[] = [];
  const bands: LaidOutBand[] = [];
  let cursorY = FLOW_LAYOUT.poolPadding;
  let canvasWidth = availableWidth;

  // Sequence edges + decision edges
  const decisionEdges: InternalEdge[] = [];
  for (const dec of input.decisions || []) {
    const after = dec.after;
    if (dec.yes_to && actMap.has(dec.yes_to)) {
      decisionEdges.push({
        id: `dec-yes-${after}-${dec.yes_to}`,
        source: after,
        target: dec.yes_to,
        label: dec.yes_label || "Sí",
      });
    }
    if (dec.no_to && actMap.has(dec.no_to)) {
      decisionEdges.push({
        id: `dec-no-${after}-${dec.no_to}`,
        source: after,
        target: dec.no_to,
        label: dec.no_label || "No",
      });
    }
  }

  for (let b = 0; b < bandsCount; b++) {
    const slice = seqItems.slice(b * maxCols, (b + 1) * maxCols);
    const internal: InternalNode[] = slice.map((item, col) => {
      const isEvent = item.kind === "start" || item.kind === "end";
      const height = isEvent
        ? estimateEventNodeHeight(item.label)
        : item.kind === "decision"
          ? Math.max(72, estimateActivityNodeHeight(item.label, !!item.statusNote))
          : estimateActivityNodeHeight(item.label, !!item.statusNote);
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        laneIndex: laneIndex.get(item.lane) ?? 0,
        laneLabel: item.lane,
        columnIndex: col,
        bandIndex: b,
        width: FLOW_LAYOUT.nodeWidth,
        height,
        number: item.number,
        statusNote: item.statusNote,
      };
    });

    const bandEdges: InternalEdge[] = [];
    for (let i = 0; i < slice.length - 1; i++) {
      const a = slice[i];
      const c = slice[i + 1];
      // Skip sequence edge if a decision already covers this hop
      const covered = decisionEdges.some(
        (e) => e.source === a.id && e.target === c.id,
      );
      if (!covered) {
        bandEdges.push({
          id: `seq-${a.id}-${c.id}`,
          source: a.id,
          target: c.id,
        });
      }
    }

    // Decision edges fully inside this band
    const ids = new Set(slice.map((s) => s.id));
    for (const de of decisionEdges) {
      if (ids.has(de.source) && ids.has(de.target)) {
        bandEdges.push(de);
      }
    }

    // Cross-band continuation: last of previous → first of this
    if (b > 0) {
      const prevLast = seqItems[b * maxCols - 1];
      const currFirst = slice[0];
      if (prevLast && currFirst) {
        bandEdges.push({
          id: `wrap-${prevLast.id}-${currFirst.id}`,
          source: prevLast.id,
          target: currFirst.id,
        });
        // prevLast must exist in node map — add ghost ref from previous band nodes
        // We'll connect using already laid nodes after; for now include both in this band's edge
        // by also injecting prevLast into layout as already positioned... handled below.
      }
    }

    const result = await layoutBandWithElk(
      internal,
      bandEdges.filter((e) => {
        const idsIn = new Set(internal.map((n) => n.id));
        return idsIn.has(e.source) && idsIn.has(e.target);
      }),
      lanes.length,
      cursorY,
    );

    // Uniform lanes for this band
    const uniformH = Math.max(
      FLOW_LAYOUT.minVerticalSpacing,
      ...Array.from({ length: lanes.length }, (_, li) => {
        const inLane = result.nodes.filter((n) => n.laneIndex === li);
        if (!inLane.length) return FLOW_LAYOUT.minVerticalSpacing;
        return Math.max(...inLane.map((n) => n.height + 40));
      }),
    );

    const bandLanes: LaidOutLane[] = lanes.map((label, index) => ({
      index,
      label,
      y: cursorY + index * uniformH,
      height: uniformH,
      colorIndex: index,
    }));

    // Re-snap Y to uniform lanes
    for (const n of result.nodes) {
      const lane = bandLanes[n.laneIndex];
      n.y = lane.y + (lane.height - n.height) / 2;
      n.bandIndex = b;
    }

    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    const bandHeight = lanes.length * uniformH;
    bands.push({
      index: b,
      y: cursorY,
      height: bandHeight,
      lanes: bandLanes,
    });

    canvasWidth = Math.max(canvasWidth, result.width + FLOW_LAYOUT.poolPadding);
    cursorY += bandHeight + (b < bandsCount - 1 ? FLOW_LAYOUT.bandGap : 0);
  }

  // Cross-band edges (wrap): connect last node of band b to first of band b+1
  for (let b = 0; b < bandsCount - 1; b++) {
    const left = seqItems[(b + 1) * maxCols - 1];
    const right = seqItems[(b + 1) * maxCols];
    if (!left || !right) continue;
    const s = allNodes.find((n) => n.id === left.id);
    const t = allNodes.find((n) => n.id === right.id);
    if (!s || !t) continue;
    const sx = s.x + s.width;
    const sy = s.y + s.height / 2;
    const tx = t.x;
    const ty = t.y + t.height / 2;
    // Vertical-first wrap under the band gap, then into next row aligned
    const gapY = bands[b].y + bands[b].height + FLOW_LAYOUT.bandGap / 2;
    allEdges.push({
      id: `wrap-${s.id}-${t.id}`,
      source: s.id,
      target: t.id,
      points: [
        { x: sx, y: sy },
        { x: sx + 28, y: sy },
        { x: sx + 28, y: gapY },
        { x: tx - 28, y: gapY },
        { x: tx - 28, y: ty },
        { x: tx, y: ty },
      ],
    });
  }

  // Stretch columns to fill available width (requirement 10)
  const contentLeft = FLOW_LAYOUT.laneLabelWidth + FLOW_LAYOUT.poolPadding;
  const maxCol = Math.max(0, ...allNodes.map((n) => n.columnIndex));
  const cols = maxCol + 1;
  const desiredWidth = Math.max(availableWidth, canvasWidth);
  const usable = desiredWidth - contentLeft - FLOW_LAYOUT.poolPadding;
  const stretchPitch = Math.max(columnPitch(FLOW_LAYOUT.nodeWidth), usable / cols);

  for (const n of allNodes) {
    n.x = contentLeft + n.columnIndex * stretchPitch;
  }

  // Rebuild edge endpoints after stretch
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  for (const e of allEdges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    if (e.id.startsWith("wrap-")) {
      const sx = s.x + s.width;
      const sy = s.y + s.height / 2;
      const tx = t.x;
      const ty = t.y + t.height / 2;
      const gapY =
        (bands[s.bandIndex]?.y || 0) +
        (bands[s.bandIndex]?.height || 0) +
        FLOW_LAYOUT.bandGap / 2;
      e.points = [
        { x: sx, y: sy },
        { x: sx + 28, y: sy },
        { x: sx + 28, y: gapY },
        { x: tx - 28, y: gapY },
        { x: tx - 28, y: ty },
        { x: tx, y: ty },
      ];
    } else {
      e.points = routeOrthogonal(
        s.x + s.width,
        s.y + s.height / 2,
        t.x,
        t.y + t.height / 2,
      );
    }
  }

  const finalWidth = contentLeft + cols * stretchPitch + FLOW_LAYOUT.poolPadding;
  const finalHeight = cursorY + FLOW_LAYOUT.poolPadding;

  return {
    width: finalWidth,
    height: finalHeight,
    laneLabelWidth: FLOW_LAYOUT.laneLabelWidth,
    nodeWidth: FLOW_LAYOUT.nodeWidth,
    bands,
    nodes: allNodes,
    edges: allEdges,
    processName: input.process_name,
    modeLabel,
  };
}
