// src/components/graph/GraphNodeView.tsx
// THE node card — every node on a knowledge-graph canvas renders through
// this one component (replaces the old ConceptNode/SourceNode split).
// Variants come from data, never from the React Flow node type:
//
//   · kind "root"  — wider, anchor eyebrow, coral ring, no delete.
//   · attachment   — type icon + live subtitle, stale = dashed coral.
//   · glow         — pulsing lilac ring while graph-RAG cites this node.
//
// A selection NodeToolbar carries the quick actions (open data,
// unfold, delete); the side panel owns the full edit surface.

import { createContext, useContext } from "react";
import {
  Handle, NodeToolbar, Position,
  type NodeProps, type Node as FlowNode,
} from "@xyflow/react";
import type { GraphNodeColor } from "../../lib/db";
import type { GraphNodeData } from "../../lib/graphFlow";

export type GraphFlowNodeT = FlowNode<GraphNodeData, "graphNode">;

/** Quick actions the canvas provides to every node card. */
export interface GraphNodeActions {
  onOpen:   (href: string) => void;
  onUnfold: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

export const GraphNodeActionsContext = createContext<GraphNodeActions>({
  onOpen:   () => {},
  onUnfold: () => {},
  onDelete: () => {},
});

const BORDER: Record<GraphNodeColor, string> = {
  coral: "tw:border-coral", teal: "tw:border-teal",
  lilac: "tw:border-lilac", butter: "tw:border-butter",
};
const DOT: Record<GraphNodeColor, string> = {
  coral: "tw:bg-coral", teal: "tw:bg-teal",
  lilac: "tw:bg-lilac", butter: "tw:bg-butter",
};

const handleStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  background: "var(--ink-3)",
  border: "2px solid var(--bg-3)",
};

function TypeIcon({ type }: { type: "chat" | "node" | "reflection" }) {
  if (type === "reflection") {
    return (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.8 8 C4 4.7 12 4.7 14.2 8 C12 11.3 4 11.3 1.8 8 Z" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      </svg>
    );
  }
  if (type === "node") {
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

function AnchorIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 6 V14 M3.5 10.5 C3.5 12.5 5.5 14 8 14 C10.5 14 12.5 12.5 12.5 10.5"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ToolbarButton({
  title, onClick, danger, children,
}: {
  title:    string;
  onClick:  () => void;
  danger?:  boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`tw:h-[26px] tw:px-2 tw:inline-flex tw:items-center tw:gap-1 tw:rounded-[7px] tw:text-[11px] tw:font-medium ${danger ? "tw:text-coral tw:hover:bg-[color-mix(in_oklab,var(--coral)_16%,transparent)]" : "tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"}`}
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={title}
    >
      {children}
    </button>
  );
}

export function GraphNodeView({ id, data, selected }: NodeProps<GraphFlowNodeT>) {
  const actions = useContext(GraphNodeActionsContext);
  const isRoot  = data.kind === "root";
  const a       = data.attachment;
  const stale   = a?.stale ?? false;
  const hasActions = Boolean((a && a.href && !stale) || a?.unfoldable || !isRoot);

  const border = stale
    ? "tw:border-dashed tw:border-coral"
    : BORDER[data.color];
  const ring = data.glow
    ? "tw:animate-[ragGlow_1.8s_ease-in-out_infinite]"
    : selected
      ? "tw:shadow-[0_0_0_3px_color-mix(in_oklab,var(--lilac)_38%,transparent)]"
      : isRoot
        ? "tw:shadow-[0_0_0_4px_color-mix(in_oklab,var(--coral)_18%,transparent)]"
        : "tw:shadow-1 tw:hover:shadow-2";

  return (
    <div
      className={`tw:border-2 tw:rounded-[12px] tw:bg-bg-3 tw:py-3 tw:px-3.5 ${isRoot ? "tw:w-[250px]" : "tw:w-[200px]"} tw:text-[13px] tw:cursor-pointer tw:transition-[box-shadow,border-color] tw:duration-150 tw:ease-[ease] ${border} ${ring}`}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      <NodeToolbar isVisible={selected && hasActions} position={Position.Top} offset={8}>
        <div className="tw:flex tw:items-center tw:gap-0.5 tw:p-0.5 tw:rounded-[9px] tw:bg-bg-3 tw:border tw:border-line tw:shadow-2">
          {a && a.href && !stale && (
            <ToolbarButton title="Open the underlying data" onClick={() => actions.onOpen(a.href)}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3 H13 V10 M13 3 L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              open
            </ToolbarButton>
          )}
          {a?.unfoldable && (
            <ToolbarButton title="Expand this chat's branch tree into linked cards" onClick={() => actions.onUnfold(id)}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="3" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="13" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 4.6 V8 M8 8 L3 11.4 M8 8 L13 11.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              unfold
            </ToolbarButton>
          )}
          {!isRoot && (
            <ToolbarButton danger title="Delete node (the underlying chat/reflection is untouched)" onClick={() => actions.onDelete(id)}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 4 H13 M6 4 V3 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 V4 M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              delete
            </ToolbarButton>
          )}
        </div>
      </NodeToolbar>

      <div className={`tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:mb-1 tw:flex tw:items-center tw:gap-[5px] tw:min-w-0 ${stale ? "tw:text-coral" : isRoot ? "tw:text-coral" : "tw:text-ink-3"}`}>
        {isRoot ? (
          <>
            <AnchorIcon />
            root
          </>
        ) : a ? (
          <>
            <TypeIcon type={a.type} />
            <span className="tw:truncate">{data.subtitle}</span>
            {a.type === "node" && a.scope === "subtree" && (
              <span className="tw:ml-auto tw:normal-case tw:tracking-normal tw:text-[9px] tw:text-ink-4 tw:flex-none" title="This node's data covers the whole subtree">+tree</span>
            )}
          </>
        ) : (
          <>
            <span className={`tw:w-[7px] tw:h-[7px] tw:rounded-[50%] ${DOT[data.color]}`} />
            node
          </>
        )}
      </div>

      <div className={`tw:font-display tw:font-semibold ${isRoot ? "tw:text-[16px]" : "tw:text-[14px]"} tw:tracking-[-0.01em] tw:leading-[1.2] tw:text-balance ${stale ? "tw:text-ink-3 tw:line-through" : "tw:text-ink"}`}>
        {data.title}
      </div>

      {data.notes && (
        <div className="tw:text-[11px] tw:text-ink-3 tw:mt-1 tw:truncate" title={data.notes}>
          {data.notes}
        </div>
      )}
    </div>
  );
}

export default GraphNodeView;
