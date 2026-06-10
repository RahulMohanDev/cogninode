// src/lib/flowGraph.ts
// Pure mapping from the chat's node tree to React Flow graph data — kept
// out of the component so layout/flagging logic is unit-testable and so
// Phase 5's concept-graph editor can share the conventions. Positions
// reuse the existing DFS layout (lib/path.ts): leaves spread on x, depth
// stacks on y.

import { buildTree, layoutTree, findPath } from "./path";
import type {
  Concept, ConceptColor, ConceptEdge, ConceptLink, Node as DbNode,
} from "./db";

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
  style:    { stroke: string; strokeWidth: number };
}

export interface FlowGraph {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

// ── concept maps (knowledge graphs) ────────────────────────────────────

export interface ConceptNodeData {
  label:           string;
  notes:           string;
  color:           ConceptColor;
  chatCount:       number;
  reflectionCount: number;
  [key: string]: unknown;
}

export interface ConceptFlowNode {
  id:       string;
  type:     "concept";
  position: { x: number; y: number };
  data:     ConceptNodeData;
}

export interface ConceptFlowGraph {
  nodes: ConceptFlowNode[];
  edges: FlowGraphEdge[];
}

export function buildConceptFlowGraph(
  concepts: Concept[],
  edges:    ConceptEdge[],
  links:    ConceptLink[],
): ConceptFlowGraph {
  const chatCounts = new Map<string, number>();
  const reflCounts = new Map<string, number>();
  for (const l of links) {
    const map = l.targetType === "chat" ? chatCounts : reflCounts;
    map.set(l.conceptId, (map.get(l.conceptId) ?? 0) + 1);
  }

  const nodes: ConceptFlowNode[] = concepts.map(c => ({
    id:       c._id,
    type:     "concept",
    position: { x: c.x, y: c.y },
    data: {
      label:           c.label,
      notes:           c.notes,
      color:           c.color,
      chatCount:       chatCounts.get(c._id) ?? 0,
      reflectionCount: reflCounts.get(c._id) ?? 0,
    },
  }));

  const placed = new Set(concepts.map(c => c._id));
  const flowEdges: FlowGraphEdge[] = edges
    .filter(e => placed.has(e.source) && placed.has(e.target))
    .map(e => ({
      id:       e._id,
      source:   e.source,
      target:   e.target,
      animated: false,
      style:    { stroke: "var(--line)", strokeWidth: 2 },
    }));

  return { nodes, edges: flowEdges };
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