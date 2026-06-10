// src/components/graph/ConceptNode.tsx
// Editable concept card for the knowledge-graph editor. Same design
// language as the TreeMap's branch cards; visible handles top/bottom for
// drag-to-connect, attachment counts in the eyebrow, a one-line notes
// teaser underneath the label.

import { Handle, Position, type NodeProps, type Node as FlowNode } from "@xyflow/react";
import type { ConceptColor } from "../../lib/db";
import type { ConceptNodeData } from "../../lib/flowGraph";

const BORDER: Record<ConceptColor, string> = {
  coral: "tw:border-coral", teal: "tw:border-teal",
  lilac: "tw:border-lilac", butter: "tw:border-butter",
};
const DOT: Record<ConceptColor, string> = {
  coral: "tw:bg-coral", teal: "tw:bg-teal",
  lilac: "tw:bg-lilac", butter: "tw:bg-butter",
};

export type ConceptFlowNode = FlowNode<ConceptNodeData, "concept">;

const handleStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  background: "var(--ink-3)",
  border: "2px solid var(--bg-3)",
};

export function ConceptNode({ data, selected }: NodeProps<ConceptFlowNode>) {
  return (
    <div
      className={`tw:border-2 tw:rounded-[12px] tw:bg-bg-3 tw:py-3 tw:px-3.5 tw:w-[200px] tw:text-[13px] tw:cursor-pointer tw:transition-[box-shadow,border-color] tw:duration-150 tw:ease-[ease] ${BORDER[data.color]} ${selected ? "tw:shadow-[0_0_0_3px_color-mix(in_oklab,var(--lilac)_38%,transparent)]" : "tw:shadow-1 tw:hover:shadow-2"}`}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      <div className="tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:mb-1 tw:flex tw:items-center tw:gap-[5px] tw:text-ink-3">
        <span className={`tw:w-[7px] tw:h-[7px] tw:rounded-[50%] ${DOT[data.color]}`} />
        concept
        <span className="tw:ml-auto tw:flex tw:items-center tw:gap-1.5 tw:normal-case tw:tracking-normal">
          {data.chatCount > 0 && (
            <span className="tw:inline-flex tw:items-center tw:gap-[3px]" title={`${data.chatCount} chat${data.chatCount === 1 ? "" : "s"} attached`}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 3.5 H13.5 V11 H8.5 L5.5 13.5 V11 H2.5 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              {data.chatCount}
            </span>
          )}
          {data.reflectionCount > 0 && (
            <span className="tw:inline-flex tw:items-center tw:gap-[3px]" title={`${data.reflectionCount} reflection${data.reflectionCount === 1 ? "" : "s"} attached`}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M1.8 8 C4 4.7 12 4.7 14.2 8 C12 11.3 4 11.3 1.8 8 Z" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="8" cy="8" r="1.6" fill="currentColor" />
              </svg>
              {data.reflectionCount}
            </span>
          )}
        </span>
      </div>

      <div className="tw:font-display tw:font-semibold tw:text-[14px] tw:tracking-[-0.01em] tw:leading-[1.2] tw:text-balance tw:text-ink">
        {data.label || "Untitled concept"}
      </div>

      {data.notes && (
        <div className="tw:text-[11px] tw:text-ink-3 tw:mt-1 tw:truncate" title={data.notes}>
          {data.notes}
        </div>
      )}
    </div>
  );
}

export default ConceptNode;