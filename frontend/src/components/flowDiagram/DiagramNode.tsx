"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { wrapText } from "@/lib/flowDiagram/measure";
import { FLOW_LAYOUT, FLOW_THEME, type FlowNodeKind } from "@/lib/flowDiagram/types";

export type DiagramNodeData = {
  kind: FlowNodeKind;
  label: string;
  number?: number;
  statusNote?: string;
  width: number;
  height: number;
};

function DiagramNodeComponent({ data }: NodeProps) {
  const d = data as DiagramNodeData;
  const { kind, label, number, statusNote, width, height } = d;

  if (kind === "start" || kind === "end") {
    const isStart = kind === "start";
    const stroke = isStart ? FLOW_THEME.startBorder : FLOW_THEME.endBorder;
    const fill = isStart ? FLOW_THEME.startFill : FLOW_THEME.endFill;
    const lines = wrapText(label, width - 12, 12, 2);
    return (
      <div
        className="flex flex-col items-center justify-start"
        style={{ width, height, fontFamily: "Inter, Roboto, Segoe UI, sans-serif" }}
      >
        <Handle type="target" position={Position.Left} className="!opacity-0" />
        <div
          className="rounded-full flex items-center justify-center text-[11px] font-bold"
          style={{
            width: FLOW_LAYOUT.startEndRadius * 2,
            height: FLOW_LAYOUT.startEndRadius * 2,
            background: fill,
            border: `${isStart ? 3 : 4}px solid ${stroke}`,
            color: stroke,
          }}
        >
          {isStart ? "Inicio" : "Fin"}
        </div>
        <div className="mt-1.5 text-center text-[12px] leading-tight" style={{ color: FLOW_THEME.text }}>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      </div>
    );
  }

  if (kind === "decision") {
    const lines = wrapText(label, width - 12, FLOW_LAYOUT.fontSize, FLOW_LAYOUT.maxLines);
    return (
      <div
        className="relative flex flex-col items-center"
        style={{ width, height, fontFamily: "Inter, Roboto, Segoe UI, sans-serif" }}
      >
        <Handle type="target" position={Position.Left} className="!opacity-0" />
        {number != null ? (
          <span className="text-[11px] font-bold mb-1" style={{ color: FLOW_THEME.header }}>
            {number}
          </span>
        ) : null}
        <div
          className="w-12 h-12 rotate-45 border-2 flex items-center justify-center shadow-sm"
          style={{
            background: FLOW_THEME.gatewayFill,
            borderColor: FLOW_THEME.gatewayBorder,
          }}
        >
          <span className="-rotate-45 text-sm font-bold text-amber-800">?</span>
        </div>
        <div
          className="mt-2 text-center font-semibold leading-5"
          style={{ fontSize: FLOW_LAYOUT.fontSize, color: FLOW_THEME.textStrong }}
        >
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      </div>
    );
  }

  const lines = wrapText(
    label,
    width - FLOW_LAYOUT.nodePadding * 2,
    FLOW_LAYOUT.fontSize,
    FLOW_LAYOUT.maxLines,
  );

  return (
    <div
      className="relative bg-white"
      style={{
        width,
        height,
        borderRadius: FLOW_LAYOUT.borderRadius,
        border: `${FLOW_LAYOUT.borderWidth}px solid ${FLOW_THEME.activityBorder}`,
        boxShadow: FLOW_LAYOUT.shadow,
        padding: FLOW_LAYOUT.nodePadding,
        fontFamily: "Inter, Roboto, Segoe UI, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {number != null ? (
        <span
          className="absolute flex items-center justify-center text-[11px] font-bold text-white rounded-full"
          style={{
            left: 8,
            top: 8,
            width: FLOW_LAYOUT.numberBadge,
            height: FLOW_LAYOUT.numberBadge,
            background: FLOW_THEME.header,
          }}
        >
          {number}
        </span>
      ) : null}
      <div
        className="font-semibold leading-5 pt-4"
        style={{
          fontSize: FLOW_LAYOUT.fontSize,
          color: FLOW_THEME.textStrong,
          wordBreak: "normal",
          overflowWrap: "break-word",
        }}
      >
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      {statusNote ? (
        <p className="text-[10px] mt-1 text-slate-500 truncate">{statusNote}</p>
      ) : null}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeComponent);
