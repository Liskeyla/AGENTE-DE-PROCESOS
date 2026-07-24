"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { FLOW_THEME, type LaidOutLane } from "@/lib/flowDiagram/types";

export type SwimlaneNodeData = {
  lanes: LaidOutLane[];
  width: number;
  laneLabelWidth: number;
  height: number;
};

function SwimlaneNodeComponent({ data }: NodeProps) {
  const d = data as SwimlaneNodeData;
  return (
    <div
      style={{ width: d.width, height: d.height, pointerEvents: "none" }}
      className="relative"
      aria-hidden
    >
      {d.lanes.map((lane) => {
        const bar = FLOW_THEME.laneBars[lane.index % FLOW_THEME.laneBars.length];
        const bg = FLOW_THEME.laneBgs[lane.index % FLOW_THEME.laneBgs.length];
        return (
          <div
            key={lane.index}
            className="absolute left-0 border-b box-border"
            style={{
              top: lane.y,
              width: d.width,
              height: lane.height,
              background: bg,
              borderColor: FLOW_THEME.swimlaneBorder,
            }}
          >
            <div
              className="absolute left-0 top-0 bottom-0 flex items-center justify-center px-2 text-white text-xs font-bold text-center leading-snug break-words"
              style={{ width: d.laneLabelWidth, background: bar }}
            >
              {lane.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const SwimlaneNode = memo(SwimlaneNodeComponent);
