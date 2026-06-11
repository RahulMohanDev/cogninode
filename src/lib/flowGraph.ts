// src/lib/flowGraph.ts
// Pure mapping from the chat's node tree to React Flow graph data — kept
// out of the component so layout/flagging logic is unit-testable.
// Positions reuse the existing DFS layout (lib/path.ts): leaves spread on
// x, depth stacks on y. The knowledge-graph canvas mapping lives in
// lib/graphFlow.ts; this module keeps the chat TreeMap + the pure
// subtree-unfold planner the graph editor reuses.

import { buildTree, layoutTree, findPath } from "./path";
import type { Node as DbNode } from "./db";

export const FLOW_X_GAP = 260;
export const FLOW_Y_GAP = 170;
export const FLOW_NODE_WIDTH = 220;

export interface BranchNodeData {
  label:     string;
  eyebrow:   string;
  depth:     number;
  isCurrent: boolean;
  isOnPath:  boolean;
  [key: string]: unknown;   // React Flow's node-data constraint
}

export interface FlowGraphNode {
  id:       string;
  type:     "branch";
  position: { x: number; y: number };
  data:     BranchNodeData;
}

export interface FlowGraphEdge {
  id:       string;
  source:   string;
  target:   string;
  animated: boolean;
  label?:   string;
  style:    { stroke: string; strokeWidth: number; strokeDasharray?: string };
}

export interface FlowGraph {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

// ── unfolding chat subtrees onto the canvas ────────────────────────────
// "Unfold" expands a chat/branch node into one card per chat-tree node
// (lineage edges mirroring parentage) so the user can prune branches they
// don't want in the corpus. Pure planning — knowledge.ts persists it.

export const SOURCE_X_GAP = 230;
export const SOURCE_Y_GAP = 130;

export interface SubtreePlanItem {
  targetType: "chat" | "node";
  targetId:   string;
  x:          number;
  y:          number;
  /** Target id of the parent item (edge gets wired); null for the root. */
  parentTargetId: string | null;
}

/**
 * Plan cards for a chat's subtree. `rootNodeId === null` means a CHAT
 * drop, which roots the plan at the chat's root NODE — every card is a
 * plain conversation node (the canvas mirrors the chat tree; no wrapper
 * "chat" card on top). The root lands at `origin`; descendants spread on
 * the DFS grid below it.
 */
export function planSubtreeSources(
  _chatId:      string,
  chatNodes:    DbNode[],
  rootNodeId:   string | null,
  origin:       { x: number; y: number },
): SubtreePlanItem[] {
  const forest = buildTree(chatNodes);
  const points = layoutTree(forest);
  const pointById = new Map(points.map(p => [p.nodeId, p]));

  // Locate the subtree root node.
  const actualRootId = rootNodeId
    ?? chatNodes.find(n => n.parentId === null)?._id
    ?? null;
  if (!actualRootId) return [];
  const rootPoint = pointById.get(actualRootId);
  if (!rootPoint) return [];

  // Collect the subtree (root + descendants).
  const childrenByParent = new Map<string, DbNode[]>();
  for (const n of chatNodes) {
    if (!n.parentId) continue;
    const arr = childrenByParent.get(n.parentId) ?? [];
    arr.push(n);
    childrenByParent.set(n.parentId, arr);
  }
  const subtreeIds = new Set<string>();
  const walk = (id: string): void => {
    subtreeIds.add(id);
    for (const c of childrenByParent.get(id) ?? []) walk(c._id);
  };
  walk(actualRootId);

  const items: SubtreePlanItem[] = [];
  for (const id of subtreeIds) {
    const p = pointById.get(id);
    const n = chatNodes.find(x => x._id === id);
    if (!p || !n) continue;
    items.push({
      targetType: "node",
      targetId:   id,
      x: origin.x + (p.x - rootPoint.x) * SOURCE_X_GAP,
      y: origin.y + (p.y - rootPoint.y) * SOURCE_Y_GAP,
      parentTargetId: id === actualRootId ? null : n.parentId,
    });
  }
  return items;
}

export function buildChatFlowGraph(dbNodes: DbNode[], currentNodeId: string): FlowGraph {
  const roots  = buildTree(dbNodes);
  const points = layoutTree(roots);
  const onPath = new Set(findPath(dbNodes, currentNodeId));
  const byId   = new Map(dbNodes.map(n => [n._id, n]));

  const nodes: FlowGraphNode[] = [];
  for (const p of points) {
    const n = byId.get(p.nodeId);
    if (!n) continue;
    nodes.push({
      id:       n._id,
      type:     "branch",
      position: { x: p.x * FLOW_X_GAP, y: p.y * FLOW_Y_GAP },
      data: {
        label:     n.label || (n.parentId === null ? "root" : `branch L${n.depth}`),
        eyebrow:   n.parentId === null ? "root" : `branch L${n.depth}`,
        depth:     Math.min(3, n.depth),
        isCurrent: n._id === currentNodeId,
        isOnPath:  onPath.has(n._id),
      },
    });
  }

  const placed = new Set(nodes.map(n => n.id));
  const edges: FlowGraphEdge[] = [];
  for (const n of dbNodes) {
    if (!n.parentId || !placed.has(n.parentId) || !placed.has(n._id)) continue;
    const isPathEdge = onPath.has(n.parentId) && onPath.has(n._id);
    edges.push({
      id:       `${n.parentId}->${n._id}`,
      source:   n.parentId,
      target:   n._id,
      animated: isPathEdge,
      style: isPathEdge
        ? { stroke: "var(--coral)", strokeWidth: 2.5 }
        : { stroke: "var(--line)",  strokeWidth: 2 },
    });
  }

  return { nodes, edges };
}