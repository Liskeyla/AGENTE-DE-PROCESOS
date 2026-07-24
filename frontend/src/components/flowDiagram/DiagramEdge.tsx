"use client";

import { memo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { FLOW_THEME } from "@/lib/flowDiagram/types";

export type DiagramEdgeData = {
  points?: Array<{ x: number; y: number }>;
  label?: string;
};

/** Arista ortogonal 90° usando los puntos del layout engine. */
function DiagramEdgeComponent({
  id,
  data,
  markerEnd,
  style,
  label,
}: EdgeProps) {
  const d = (data || {}) as DiagramEdgeData;
  const points = d.points || [];
  if (points.length < 2) return null;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
    .join(" ");
  const mid = points[Math.floor(points.length / 2)];
  const edgeLabel = d.label || (typeof label === "string" ? label : undefined);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: FLOW_THEME.arrow,
          strokeWidth: 2,
          ...style,
        }}
      />
      {edgeLabel ? (
        <text
          x={mid.x}
          y={mid.y - 6}
          textAnchor="middle"
          className="text-[11px] font-semibold fill-amber-800"
          style={{ pointerEvents: "none" }}
        >
          {edgeLabel}
        </text>
      ) : null}
    </>
  );
}

export const DiagramEdge = memo(DiagramEdgeComponent);
