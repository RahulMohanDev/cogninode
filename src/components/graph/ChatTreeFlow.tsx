// src/components/graph/ChatTreeFlow.tsx
// React Flow rendering of a chat's branch tree — the TreeMap overlay body.
// Replaces the hand-rolled SVG+absolute-divs implementation: pan/zoom,
// fit-to-view, minimap, and animated dashes along the active path come
// from the engine; the node cards keep the app's design language (depth-
// colored borders, inverted current node). Read-only: nodes aren't
// draggable or connectable — clicking one jumps the chat there.
//
// Phase 5's knowledge-graph editor reuses this stack (custom node cards +
// shared tokens), so visual conventions established here are load-bearing.
//
// Default-exported for React.lazy: @xyflow/react stays out of the main
// bundle until the first ⌃T.

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { buildChatFlowGraph, FLOW_NODE_WIDTH, type BranchNodeData } from "../../lib/flowGraph";
import { useSettings } from "../../hooks/useSettings";
import type { Node as DbNode } from "../../lib/db";

import { miniMapStyle, useFlowTheme } from "./flowTheme";

// Depth accents — same scale as the sidebar dots / QuickJump / legend.
const BORDER = ["tw:border-coral", "tw:border-teal", "tw:border-lilac", "tw:border-butter"];
const DOT    = ["tw:bg-coral", "tw:bg-teal", "tw:bg-lilac", "tw:bg-butter"];

type BranchFlowNode = FlowNode<BranchNodeData, "branch">;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function BranchNode({ data }: NodeProps<BranchFlowNode>) {
  return (
    <div
      className={`tw:border-2 tw:rounded-[12px] tw:py-3 tw:px-3.5 tw:text-[13px] tw:cursor-pointer tw:transition-[transform,border-color,box-shadow] tw:duration-150 tw:ease-[ease] tw:hover:-translate-y-0.5 tw:hover:shadow-2 ${BORDER[data.depth]} ${
        data.isCurrent
          ? "tw:bg-ink tw:text-bg tw:shadow-[0_12px_28px_-8px_rgba(22,20,19,0.4)]"
          : "tw:bg-bg-3 tw:shadow-1"
      }`}
      style={{
        width: FLOW_NODE_WIDTH,
        ...(data.isOnPath && !data.isCurrent
          ? { borderColor: "var(--coral)", boxShadow: "0 8px 22px -8px rgba(0,0,0,0.28)" }
          : {}),
      }}
    >
      {/* Anchors for edges — invisible, the tree is read-only. */}
      <Handle type="target" position={Position.Top}    className="tw:opacity-0 tw:pointer-events-none" />
      <Handle type="source" position={Position.Bottom} className="tw:opacity-0 tw:pointer-events-none" />

      <div className={`tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:mb-1 tw:flex tw:items-center tw:gap-[5px] ${data.isCurrent ? "tw:text-[color-mix(in_oklab,var(--bg)_70%,transparent)]" : "tw:text-ink-3"}`}>
        <span className={`tw:w-[7px] tw:h-[7px] tw:rounded-[50%] ${DOT[data.depth]}`} />
        {data.eyebrow}
        {data.isCurrent && <span className="tw:ml-auto tw:normal-case tw:tracking-normal">← you're here</span>}
      </div>
      <div className="tw:font-display tw:font-semibold tw:text-[14px] tw:tracking-[-0.01em] tw:leading-[1.2] tw:text-balance">
        {truncate(data.label, 60)}
      </div>
    </div>
  );
}

const nodeTypes = { branch: BranchNode };

export interface ChatTreeFlowProps {
  dbNodes:       DbNode[];
  currentNodeId: string;
  onPick:        (nodeId: string) => void;
}

export default function ChatTreeFlow({ dbNodes, currentNodeId, onPick }: ChatTreeFlowProps) {
  const { prefs } = useSettings();
  const graph = useMemo(
    () => buildChatFlowGraph(dbNodes, currentNodeId),
    [dbNodes, currentNodeId],
  );

  // React Flow's measured node dimensions arrive as node *changes* — with a
  // fully-controlled `nodes` prop and no onNodesChange they were dropped,
  // and the MiniMap (which only draws measured nodes) rendered nothing.
  // useNodesState applies them; the effects re-sync when the data changes.
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes as BranchFlowNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges as FlowEdge[]);
  useEffect(() => { setNodes(graph.nodes as BranchFlowNode[]); }, [graph.nodes, setNodes]);
  useEffect(() => { setEdges(graph.edges as FlowEdge[]); }, [graph.edges, setEdges]);

  // Concrete colors for the MiniMap's SVG attributes, re-read per theme.
  const mini = useFlowTheme(prefs.theme);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      colorMode={prefs.theme}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.75}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      selectionKeyCode={null}
      proOptions={{ hideAttribution: false }}
      onNodeClick={(_e, node) => onPick(node.id)}
      style={{ background: "transparent" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="var(--line)" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => mini.depths[(n.data as BranchNodeData).depth] ?? mini.stroke}
        nodeStrokeWidth={3}
        nodeBorderRadius={4}
        maskColor={mini.mask}
        style={miniMapStyle(mini)}
      />
    </ReactFlow>
  );
}