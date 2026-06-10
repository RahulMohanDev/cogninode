// src/components/graph/SourceNode.tsx
// Canvas card for an attached chat / branch / reflection — the raw
// material concepts classify. Visually quieter than concept cards
// (muted background, thin border) so the user's own structure stays in
// the foreground; handles on top/bottom make it connectable to anything.

import { Handle, Position, type NodeProps, type Node as FlowNode } from "@xyflow/react";
import type { SourceNodeData } from "../../lib/flowGraph";

export type SourceFlowNodeT = FlowNode<SourceNodeData, "source">;

const handleStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  background: "var(--ink-3)",
  border: "2px solid var(--bg-2)",
};

function TypeIcon({ targetType }: { targetType: SourceNodeData["targetType"] }) {
  if (targetType === "reflection") {
    return (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.8 8 C4 4.7 12 4.7 14.2 8 C12 11.3 4 11.3 1.8 8 Z" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      </svg>
    );
  }
  if (targetType === "node") {
    return (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="3" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="13" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 4.6 V8 M8 8 L3 11.4 M8 8 L13 11.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3.5 H13.5 V11 H8.5 L5.5 13.5 V11 H2.5 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function SourceNode({ data, selected }: NodeProps<SourceFlowNodeT>) {
  return (
    <div
      className={`tw:border tw:rounded-[10px] tw:bg-bg-2 tw:py-2.5 tw:px-3 tw:w-[190px] tw:text-[12.5px] tw:cursor-pointer tw:transition-[box-shadow,border-color] tw:duration-150 tw:ease-[ease] ${data.stale ? "tw:border-dashed tw:border-coral" : "tw:border-line"} ${selected ? "tw:shadow-[0_0_0_3px_color-mix(in_oklab,var(--lilac)_38%,transparent)]" : "tw:hover:border-ink-3"}`}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      <div className={`tw:font-mono tw:text-[9px] tw:tracking-[0.1em] tw:uppercase tw:mb-1 tw:flex tw:items-center tw:gap-[5px] tw:min-w-0 ${data.stale ? "tw:text-coral" : "tw:text-ink-3"}`}>
        <TypeIcon targetType={data.targetType} />
        <span className="tw:truncate">{data.subtitle}</span>
      </div>
      <div className={`tw:font-medium tw:text-[13px] tw:leading-[1.25] tw:text-balance ${data.stale ? "tw:text-ink-3 tw:line-through" : "tw:text-ink"}`}>
        {data.title}
      </div>
    </div>
  );
}

export default SourceNode;