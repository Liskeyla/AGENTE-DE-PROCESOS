"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { layoutFlowDiagram } from "@/lib/flowDiagram/layout";
import {
  FLOW_LAYOUT,
  type FlowDiagramInput,
  type FlowLayoutResult,
  type LaidOutNode,
} from "@/lib/flowDiagram/types";
import { estimateTextHeight } from "@/lib/flowDiagram/measure";

const LANE_PALETTE = [
  { bg: "#eef4ff", bar: "#2952CC", border: "#b8c9e0" },
  { bg: "#ecfdf5", bar: "#059669", border: "#a7f3d0" },
  { bg: "#fff7ed", bar: "#ea580c", border: "#fed7aa" },
  { bg: "#fefce8", bar: "#ca8a04", border: "#fde047" },
  { bg: "#faf5ff", bar: "#7c3aed", border: "#e9d5ff" },
  { bg: "#f0f9ff", bar: "#0284c7", border: "#bae6fd" },
];

function EdgePath({
  points,
  label,
  markerId,
}: {
  points: Array<{ x: number; y: number }>;
  label?: string;
  markerId: string;
}) {
  if (points.length < 2) return null;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const mid = points[Math.floor(points.length / 2)];
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke="#455a64"
        strokeWidth={2}
        strokeLinejoin="miter"
        strokeLinecap="square"
        markerEnd={`url(#${markerId})`}
      />
      {label ? (
        <text
          x={mid.x}
          y={mid.y - 6}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="#92400e"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function NodeBox({ node, shadowId }: { node: LaidOutNode; shadowId: string }) {
  const { borderColor, borderWidth, borderRadius, fontSize, lineHeight, maxLines, nodePaddingX, nodePaddingY } =
    FLOW_LAYOUT;

  if (node.kind === "start" || node.kind === "end") {
    const isStart = node.kind === "start";
    const fill = isStart ? "#e8f5e9" : "#ffebee";
    const stroke = isStart ? "#2e7d32" : "#c62828";
    const cx = node.x + node.width / 2;
    const cy = node.y + 28;
    const { lines } = estimateTextHeight(node.label, node.width - 8, 11, 14, 2);
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={22}
          fill={fill}
          stroke={stroke}
          strokeWidth={isStart ? 3 : 4}
        />
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          fill={stroke}
        >
          {isStart ? "Inicio" : "Fin"}
        </text>
        {lines.map((line, i) => (
          <text
            key={i}
            x={cx}
            y={cy + 36 + i * 14}
            textAnchor="middle"
            fontSize={11}
            fill="#475569"
          >
            {line}
          </text>
        ))}
      </g>
    );
  }

  if (node.kind === "decision") {
    const size = 52;
    const cx = node.x + node.width / 2;
    const cy = node.y + size / 2 + 4;
    const { lines } = estimateTextHeight(
      node.label,
      node.width - 8,
      fontSize,
      lineHeight,
      maxLines,
    );
    return (
      <g>
        <rect
          x={cx - size / 2}
          y={cy - size / 2}
          width={size}
          height={size}
          fill="#fff8e1"
          stroke="#f57c00"
          strokeWidth={2}
          transform={`rotate(45 ${cx} ${cy})`}
          rx={4}
        />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={14} fontWeight={700} fill="#92400e">
          ?
        </text>
        {node.number != null ? (
          <text x={cx} y={cy - size / 2 - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1e3a5f">
            {node.number}
          </text>
        ) : null}
        {lines.map((line, i) => (
          <text
            key={i}
            x={cx}
            y={cy + size / 2 + 18 + i * lineHeight}
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={600}
            fill="#1a1a1a"
          >
            {line}
          </text>
        ))}
      </g>
    );
  }

  const { lines } = estimateTextHeight(
    node.label,
    node.width - nodePaddingX * 2,
    fontSize,
    lineHeight,
    maxLines,
  );
  const textBlockH = lines.length * lineHeight;
  const contentTop = node.y + (node.height - textBlockH) / 2;
  const isSystem = node.kind === "system";

  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={borderRadius}
        ry={borderRadius}
        fill="#ffffff"
        stroke={isSystem ? "#64748b" : borderColor}
        strokeWidth={borderWidth}
        filter={`url(#${shadowId})`}
      />
      {node.number != null ? (
        <g>
          <circle cx={node.x + 18} cy={node.y + 16} r={9} fill="#1e3a5f" />
          <text
            x={node.x + 18}
            y={node.y + 20}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill="#fff"
          >
            {node.number}
          </text>
        </g>
      ) : null}
      {lines.map((line, i) => (
        <text
          key={i}
          x={node.x + node.width / 2}
          y={contentTop + i * lineHeight + lineHeight * 0.8}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight={600}
          fill="#1a1a1a"
        >
          {line}
        </text>
      ))}
      {node.statusNote ? (
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height - 8}
          textAnchor="middle"
          fontSize={10}
          fill="#64748b"
        >
          {node.statusNote.length > 28
            ? `${node.statusNote.slice(0, 27)}…`
            : node.statusNote}
        </text>
      ) : null}
    </g>
  );
}

function DiagramSvg({ layout, diagramKey }: { layout: FlowLayoutResult; diagramKey: string }) {
  const arrowId = `flow-arrow-${diagramKey}`;
  const shadowId = `flow-shadow-${diagramKey}`;
  return (
    <svg
      className="bizagi-flow-canvas"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Diagrama de flujo ${layout.modeLabel}: ${layout.processName}`}
      style={{ display: "block", maxWidth: "none" }}
    >
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 12 12"
          refX={10}
          refY={6}
          markerWidth={8}
          markerHeight={8}
          orient="auto-start-reverse"
        >
          <path d="M0 0 L12 6 L0 12 Z" fill="#455a64" />
        </marker>
        <filter id={shadowId} x="-8%" y="-8%" width="116%" height="120%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.18" />
        </filter>
      </defs>

      {layout.bands.map((band) =>
        band.lanes.map((lane) => {
          const palette = LANE_PALETTE[lane.colorIndex % LANE_PALETTE.length];
          return (
            <g key={`lane-${band.index}-${lane.index}`}>
              <rect
                x={layout.laneLabelWidth}
                y={lane.y}
                width={Math.max(0, layout.width - layout.laneLabelWidth)}
                height={lane.height}
                fill={palette.bg}
                stroke={palette.border}
                strokeWidth={1}
              />
            </g>
          );
        }),
      )}

      {layout.edges.map((e) => (
        <EdgePath key={e.id} points={e.points} label={e.label} markerId={arrowId} />
      ))}

      {layout.nodes.map((n) => (
        <NodeBox key={n.id} node={n} shadowId={shadowId} />
      ))}
    </svg>
  );
}

export function FlowDiagramCanvas({
  diagram,
  organizationName,
}: {
  diagram: FlowDiagramInput;
  organizationName?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [layout, setLayout] = useState<FlowLayoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diagramKey = useMemo(
    () => diagram.process_name.replace(/\W+/g, "-").slice(0, 40) || "flow",
    [diagram.process_name],
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(720, Math.floor(el.clientWidth || 1100));
      setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const input = useMemo(() => diagram, [diagram]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    layoutFlowDiagram(input, width)
      .then((result) => {
        if (!cancelled) setLayout(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error de layout");
      });
    return () => {
      cancelled = true;
    };
  }, [input, width]);

  return (
    <div
      ref={hostRef}
      className="bizagi-export-block rounded-lg border-2 bg-white shadow-sm overflow-visible"
      style={{ borderColor: "#1e3a5f" }}
      data-process-name={diagram.process_name}
    >
      <div
        className="px-4 py-2.5 text-white text-sm font-bold"
        style={{ backgroundColor: "#1e3a5f" }}
      >
        Diagrama de flujo {layout?.modeLabel || "TO BE"}: {diagram.process_name}
        {organizationName ? ` — ${organizationName}` : ""}
      </div>
      <div className="p-3 bg-[#f7f9fc] overflow-x-auto">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !layout ? (
          <p className="text-sm text-slate-500 py-8 text-center">Calculando layout profesional…</p>
        ) : (
          <div
            className="bizagi-flow-sequence flex"
            style={{ width: layout.width, minWidth: "100%" }}
          >
            {/* Fixed swimlane headers (sticky on horizontal scroll) */}
            <div
              className="bizagi-lane-label shrink-0 sticky left-0 z-20 shadow-md relative"
              style={{ width: layout.laneLabelWidth, height: layout.height }}
            >
              {layout.bands.flatMap((band) =>
                band.lanes.map((lane) => {
                  const palette = LANE_PALETTE[lane.colorIndex % LANE_PALETTE.length];
                  return (
                    <div
                      key={`sticky-${band.index}-${lane.index}`}
                      className="absolute flex items-center px-2.5 text-white text-xs font-bold leading-snug break-words"
                      style={{
                        top: lane.y,
                        left: 0,
                        width: layout.laneLabelWidth,
                        height: lane.height,
                        backgroundColor: palette.bar,
                      }}
                    >
                      {lane.label}
                    </div>
                  );
                }),
              )}
            </div>
            <div style={{ marginLeft: -layout.laneLabelWidth }}>
              <DiagramSvg layout={layout} diagramKey={diagramKey} />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-600 border border-slate-200 rounded-lg bg-white px-3 py-2">
          <span className="font-bold text-slate-700 uppercase tracking-wide">Leyenda</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-600 bg-emerald-50" /> Inicio
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full border-[3px] border-red-600 bg-red-50" /> Fin
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 h-3.5 rounded bg-white" style={{ border: "2px solid #2952CC" }} /> Actividad
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rotate-45 border-2 border-amber-500 bg-amber-50" /> Decisión
          </span>
        </div>
      </div>
    </div>
  );
}
