// src/lib/flowGraph.ts
// Pure mapping from the chat's node tree to React Flow graph data — kept
// out of the component so layout/flagging logic is unit-testable and so
// Phase 5's concept-graph editor can share the conventions. Positions
// reuse the existing DFS layout (lib/path.ts): leaves spread on x, depth
// stacks on y.

import { buildTree, layoutTree, findPath } from "./path";
import type {
  Concept, ConceptColor, ConceptEdge, GraphSource, Node as DbNode,
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
  style:    { stroke: string; strokeWidth: number; strokeDasharray?: string };
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
  /** Connected chat + branch sources (via edges). */
  chatCount:       number;
  reflectionCount: number;
  [key: string]: unknown;
}

export interface SourceNodeData {
  title:      string;
  subtitle:   string;        // "chat" | "branch · <chat>" | "reflection"
  targetType: GraphSource["targetType"];
  targetId:   string;
  /** Open destination, precomputed: /chat/… or /reflections?open=… */
  href:       string;
  stale:      boolean;       // underlying chat/branch/reflection is gone
  [key: string]: unknown;
}

export interface ConceptFlowNode {
  id:       string;
  type:     "concept";
  position: { x: number; y: number };
  data:     ConceptNodeData;
}

export interface SourceFlowNode {
  id:       string;
  type:     "source";
  position: { x: number; y: number };
  data:     SourceNodeData;
}

export interface ConceptFlowGraph {
  nodes: Array<ConceptFlowNode | SourceFlowNode>;
  edges: FlowGraphEdge[];
}

export interface SourceResolvers {
  chatTitle:       (chatId: string) => string | undefined;
  /** Branch label + owning chat (undefined when the node is gone). */
  nodeInfo:        (nodeId: string) => { label: string; chatId: string; chatTitle: string; isRoot: boolean } | undefined;
  reflectionTitle: (reflectionId: string) => string | undefined;
}

export function resolveSourceDisplay(s: GraphSource, resolve: SourceResolvers): SourceNodeData {
  return sourceData(s, resolve);
}

function sourceData(s: GraphSource, resolve: SourceResolvers): SourceNodeData {
  if (s.targetType === "chat") {
    const title = resolve.chatTitle(s.targetId);
    return {
      title: title ?? "(deleted chat)", subtitle: "chat",
      targetType: s.targetType, targetId: s.targetId,
      href: `/chat/${s.targetId}`, stale: title === undefined,
    };
  }
  if (s.targetType === "node") {
    const info = resolve.nodeInfo(s.targetId);
    // A chat's root node IS the chat (labels stay in sync) — display it as
    // one, so unfolded trees don't carry a redundant wrapper card.
    if (info?.isRoot) {
      return {
        title: info.label, subtitle: "chat",
        targetType: s.targetType, targetId: s.targetId,
        href: `/chat/${info.chatId}`, stale: false,
      };
    }
    return {
      title:    info?.label ?? "(deleted branch)",
      subtitle: info ? `branch · ${info.chatTitle}` : "branch",
      targetType: s.targetType, targetId: s.targetId,
      href:  info ? `/chat/${info.chatId}?node=${s.targetId}` : "",
      stale: info === undefined,
    };
  }
  const title = resolve.reflectionTitle(s.targetId);
  return {
    title: title ?? "(deleted reflection)", subtitle: "reflection",
    targetType: s.targetType, targetId: s.targetId,
    href: `/reflections?open=${s.targetId}`, stale: title === undefined,
  };
}

export function buildConceptFlowGraph(
  concepts: Concept[],
  sources:  GraphSource[],
  edges:    ConceptEdge[],
  resolve:  SourceResolvers,
): ConceptFlowGraph {
  const sourceById  = new Map(sources.map(s => [s._id, s]));
  const conceptIds  = new Set(concepts.map(c => c._id));

  // Per-concept attachment badges = connected sources, via edges.
  const chatCounts = new Map<string, number>();
  const reflCounts = new Map<string, number>();
  for (const e of edges) {
    const pairs: Array<[string, string]> = [[e.source, e.target], [e.target, e.source]];
    for (const [maybeConcept, maybeSource] of pairs) {
      if (!conceptIds.has(maybeConcept)) continue;
      const s = sourceById.get(maybeSource);
      if (!s) continue;
      const map = s.targetType === "reflection" ? reflCounts : chatCounts;
      map.set(maybeConcept, (map.get(maybeConcept) ?? 0) + 1);
    }
  }

  const nodes: Array<ConceptFlowNode | SourceFlowNode> = [
    ...concepts.map((c): ConceptFlowNode => ({
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
    })),
    ...sources.map((s): SourceFlowNode => ({
      id:       s._id,
      type:     "source",
      position: { x: s.x, y: s.y },
      data:     sourceData(s, resolve),
    })),
  ];

  const placed = new Set([...conceptIds, ...sourceById.keys()]);
  const flowEdges: FlowGraphEdge[] = edges
    .filter(e => placed.has(e.source) && placed.has(e.target))
    .map(e => ({
      id:       e._id,
      source:   e.source,
      target:   e.target,
      animated: false,
      // Lineage edges (laid down by unfolding a chat tree) render dashed;
      // every edge the USER draws is an equal, solid connection.
      style: e.kind === "lineage"
        ? { stroke: "var(--line)", strokeWidth: 1.5, strokeDasharray: "6 4" }
        : { stroke: "var(--line)", strokeWidth: 2 },
    }));

  return { nodes, edges: flowEdges };
}

// ── unfolding chat subtrees onto the canvas ────────────────────────────
// Dropping a chat/branch from the Library expands the WHOLE subtree into
// individual source cards (lineage edges mirroring parentage) so the user
// can prune branches they don't want classified. Pure planning — the
// editor persists the result.

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