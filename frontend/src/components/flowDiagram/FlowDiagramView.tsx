"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download, FileImage, FileType2, Loader2 } from "lucide-react";
import { buildDiagramLayout } from "@/lib/flowDiagram/DiagramLayout";
import { PdfExporter } from "@/lib/flowDiagram/PdfExporter";
import {
  FLOW_LAYOUT,
  FLOW_THEME,
  type FlowDiagramInput,
  type FlowLayoutResult,
} from "@/lib/flowDiagram/types";
import { DiagramNode, type DiagramNodeData } from "./DiagramNode";
import { DiagramEdge } from "./DiagramEdge";
import { SwimlaneNode, type SwimlaneNodeData } from "./Swimlane";

const nodeTypes = {
  diagramNode: DiagramNode,
  swimlaneNode: SwimlaneNode,
};
const edgeTypes = { diagramEdge: DiagramEdge };

function FitViewOnLayout({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = window.setTimeout(() => {
      fitView({ padding: 0.1, duration: 220 });
    }, 60);
    return () => window.clearTimeout(t);
  }, [fitView, layoutKey]);
  return null;
}

function sanitizeFile(name: string) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
}

function FlowCanvasInner({
  diagram,
  organizationName,
}: {
  diagram: FlowDiagramInput;
  organizationName?: string;
}) {
  const [layout, setLayout] = useState<FlowLayoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "svg" | "png" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLayout(null);
    buildDiagramLayout(diagram)
      .then((result) => {
        if (!cancelled) setLayout(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error de layout");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [diagram]);

  const { nodes, edges } = useMemo(() => {
    if (!layout) return { nodes: [] as Node[], edges: [] as Edge[] };

    const swimlane: Node = {
      id: "__swimlanes__",
      type: "swimlaneNode",
      position: { x: 0, y: 0 },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      data: {
        lanes: layout.lanes,
        width: layout.width,
        height: layout.height,
        laneLabelWidth: layout.laneLabelWidth,
      } satisfies SwimlaneNodeData,
      style: { width: layout.width, height: layout.height },
    };

    const rfNodes: Node[] = [
      swimlane,
      ...layout.nodes.map((n) => ({
        id: n.id,
        type: "diagramNode",
        position: { x: n.x, y: n.y },
        draggable: false,
        selectable: false,
        zIndex: 1,
        data: {
          kind: n.kind,
          label: n.label,
          number: n.number,
          statusNote: n.statusNote,
          width: n.width,
          height: n.height,
        } satisfies DiagramNodeData,
        style: { width: n.width, height: n.height },
      })),
    ];

    const rfEdges: Edge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "diagramEdge",
      zIndex: 0,
      data: { points: e.points, label: e.label },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: FLOW_THEME.arrow,
        width: 16,
        height: 16,
      },
    }));

    return { nodes: rfNodes, edges: rfEdges };
  }, [layout]);

  const baseName = useMemo(
    () =>
      sanitizeFile(
        `DIAGRAMA DE FLUJO – ${diagram.process_name} ${organizationName || ""}`.trim(),
      ),
    [diagram.process_name, organizationName],
  );

  const onExport = useCallback(
    async (kind: "pdf" | "svg" | "png") => {
      if (!layout) return;
      setExporting(kind);
      try {
        if (kind === "pdf") {
          await PdfExporter.exportPdf(layout, `${baseName}.pdf`, organizationName);
        } else if (kind === "svg") {
          PdfExporter.exportSvg(layout, `${baseName}.svg`, organizationName);
        } else {
          await PdfExporter.exportPng(layout, `${baseName}.png`, organizationName, 3);
        }
      } finally {
        setExporting(null);
      }
    },
    [layout, baseName, organizationName],
  );

  return (
    <div
      className="bizagi-export-block rounded-lg border-2 bg-white shadow-sm overflow-hidden flex flex-col"
      style={{ borderColor: FLOW_THEME.header }}
      data-process-name={diagram.process_name}
      data-flow-vector="true"
    >
      <div
        className="px-4 py-2.5 text-white text-sm font-bold flex items-center justify-between gap-3"
        style={{
          backgroundColor: FLOW_THEME.header,
          minHeight: FLOW_LAYOUT.headerBarHeight,
        }}
      >
        <span className="truncate">
          Diagrama de flujo {layout?.modeLabel || "TO BE"}: {diagram.process_name}
          {organizationName ? ` — ${organizationName}` : ""}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {(
            [
              ["pdf", "PDF", Download],
              ["svg", "SVG", FileType2],
              ["png", "PNG", FileImage],
            ] as const
          ).map(([kind, label, Icon]) => (
            <button
              key={kind}
              type="button"
              onClick={() => onExport(kind)}
              disabled={!layout || !!exporting}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-medium disabled:opacity-50"
            >
              {exporting === kind ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Icon className="w-3 h-3" />
              )}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative" style={{ height: Math.min(560, Math.max(360, (layout?.height || 400) * 0.55)) }}>
        {error ? (
          <p className="text-sm text-red-600 p-6">{error}</p>
        ) : !layout ? (
          <p className="text-sm text-slate-500 p-8 text-center">Calculando layout ELK…</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnScroll
            zoomOnScroll
            minZoom={0.15}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "diagramEdge" }}
          >
            <Background color="#E2E8F0" gap={20} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeStrokeColor={FLOW_THEME.activityBorder}
              nodeColor={(n) => (n.type === "swimlaneNode" ? "#F1F5F9" : "#fff")}
              maskColor="rgba(23,59,115,0.08)"
            />
            <FitViewOnLayout
              layoutKey={`${layout.width}x${layout.height}-${layout.nodes.length}`}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

export function FlowDiagramView({
  diagram,
  organizationName,
}: {
  diagram: FlowDiagramInput;
  organizationName?: string;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner diagram={diagram} organizationName={organizationName} />
    </ReactFlowProvider>
  );
}

export async function getFlowLayout(diagram: FlowDiagramInput) {
  return buildDiagramLayout(diagram);
}
