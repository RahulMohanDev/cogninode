// src/lib/graphFlow.ts
// Pure mapping from the unified knowledge-graph model (graphNodes +
// graphEdges) to React Flow data, plus the BFS-from-root "Tidy" layout.
// Kept out of the components so display rules and layout are unit-testable.

import { buildTree, layoutTree } from "./path";
import type {
  GraphEdge, GraphNode, GraphNodeAttachment, GraphNodeColor, Node as DbNode,
} from "./db";
import type { FlowGraphEdge } from "./flowGraph";

export const TIDY_X_GAP = 260;
export const TIDY_Y_GAP = 180;

/** Library-drawer → canvas drag payload (custom MIME keeps foreign drops out). */
export const DRAG_MIME = "application/x-cogninode-source";

export interface DragPayload {
  targetType: "chat" | "node" | "reflection";
  targetId:   string;
  title:      string;
}

export interface SourceResolvers {
  chatTitle:       (chatId: string) => string | undefined;
  /** Branch label + owning chat (undefined when the node is gone). */
  nodeInfo:        (nodeId: string) => { label: string; chatId: string; chatTitle: string; isRoot: boolean } | undefined;
  reflectionTitle: (reflectionId: string) => string | undefined;
}

export interface NodeDisplay {
  /** The node's own label when set, else the attachment's live title. */
  title:    string;
  /** "chat" | "branch · <chat>" | "reflection" — "" for plain nodes. */
  subtitle: string;
  /** Open destination (/chat/… or /reflections?open=…) — "" when none. */
  href:     string;
  stale:    boolean;  // underlying chat/branch/reflection is gone
}

/** Resolve what a graph node should display. A user-set label always wins;
 *  empty labels derive from the attachment so titles track renames. */
export function displayTitle(n: GraphNode, resolve: SourceResolvers): NodeDisplay {
  const a   = n.attachment;
  const own = n.label.trim();
  if (!a) {
    return { title: own || "Untitled node", subtitle: "", href: "", stale: false };
  }
  if (a.type === "chat") {
    const t = resolve.chatTitle(a.targetId);
    return {
      title:    own || t || "(deleted chat)",
      subtitle: "chat",
      href:     t === undefined ? "" : `/chat/${a.targetId}`,
      stale:    t === undefined,
    };
  }
  if (a.type === "node") {
    const info = resolve.nodeInfo(a.targetId);
    // A chat's root node IS the chat (labels stay in sync) — display it as
    // one, so unfolded trees don't carry a redundant wrapper card.
    if (info?.isRoot) {
      return { title: own || info.label, subtitle: "chat", href: `/chat/${info.chatId}`, stale: false };
    }
    return {
      title:    own || info?.label || "(deleted branch)",
      subtitle: info ? `branch · ${info.chatTitle}` : "branch",
      href:     info ? `/chat/${info.chatId}?node=${a.targetId}` : "",
      stale:    info === undefined,
    };
  }
  const t = resolve.reflectionTitle(a.targetId);
  return {
    title:    own || t || "(deleted reflection)",
    subtitle: "reflection",
    href:     t === undefined ? "" : `/reflections?open=${a.targetId}`,
    stale:    t === undefined,
  };
}

export interface GraphNodeData {
  kind:     "root" | "node";
  title:    string;
  subtitle: string;
  notes:    string;
  color:    GraphNodeColor;
  attachment?: {
    type:       GraphNodeAttachment["type"];
    targetId:   string;
    scope?:     "subtree" | "single";
    href:       string;
    stale:      boolean;
    /** Chat / subtree-branch attachments can expand into linked cards. */
    unfoldable: boolean;
  };
  /** Lit up because graph-RAG just retrieved from this node. */
  glow: boolean;
  [key: string]: unknown;   // React Flow's node-data constraint
}

export interface GraphFlowNode {
  id:       string;
  type:     "graphNode";
  position: { x: number; y: number };
  data:     GraphNodeData;
  /** false on the root — React Flow then ignores Backspace/Delete for it. */
  deletable?: boolean;
}

export interface GraphFlow {
  nodes: GraphFlowNode[];
  edges: FlowGraphEdge[];
}

export function buildGraphFlow(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  resolve:    SourceResolvers,
  opts?:      { glowIds?: Set<string> },
): GraphFlow {
  const nodes: GraphFlowNode[] = graphNodes.map(n => {
    const d = displayTitle(n, resolve);
    const a = n.attachment;
    return {
      id:       n._id,
      type:     "graphNode",
      position: { x: n.x, y: n.y },
      ...(n.kind === "root" ? { deletable: false } : {}),
      data: {
        kind:     n.kind,
        title:    d.title,
        subtitle: d.subtitle,
        notes:    n.notes,
        color:    n.color,
        ...(a ? {
          attachment: {
            type:     a.type,
            targetId: a.targetId,
            ...(a.scope ? { scope: a.scope } : {}),
            href:     d.href,
            stale:    d.stale,
            unfoldable: !d.stale &&
              (a.type === "chat" || (a.type === "node" && a.scope !== "single")),
          },
        } : {}),
        glow: opts?.glowIds?.has(n._id) ?? false,
      },
    };
  });

  const placed = new Set(graphNodes.map(n => n._id));
  const edges: FlowGraphEdge[] = graphEdges
    .filter(e => placed.has(e.source) && placed.has(e.target))
    .map(e => ({
      id:       e._id,
      source:   e.source,
      target:   e.target,
      animated: false,
      ...(e.label ? { label: e.label } : {}),
      // Lineage edges (laid down by unfolding a chat tree) render dashed;
      // every edge the USER draws is an equal, solid connection.
      style: e.kind === "lineage"
        ? { stroke: "var(--line)", strokeWidth: 1.5, strokeDasharray: "6 4" }
        : { stroke: "var(--line)", strokeWidth: 2 },
    }));

  return { nodes, edges };
}

/**
 * "Tidy" layout: BFS from the root over the undirected edges (parent =
 * first discoverer, neighbors visited left-to-right by current x so the
 * user's horizontal ordering survives), then the same DFS grid the chat
 * trees use. Disconnected islands stack below the main tree, each tidied
 * as its own tree rooted at its earliest-created node. The root keeps its
 * current position — everything arranges around it.
 */
export function planTidyLayout(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  rootId:     string,
): Array<{ id: string; x: number; y: number }> {
  const byId = new Map(graphNodes.map(n => [n._id, n]));
  if (!byId.has(rootId)) return [];

  const adj = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    if (!byId.has(a) || !byId.has(b)) return;
    const arr = adj.get(a) ?? [];
    arr.push(b);
    adj.set(a, arr);
  };
  for (const e of graphEdges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const seen = new Set<string>();
  const out: Array<{ id: string; x: number; y: number }> = [];

  const layoutComponent = (startId: string, anchor: { x: number; y: number }): number => {
    const parent = new Map<string, string | null>();
    parent.set(startId, null);
    seen.add(startId);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const next = (adj.get(cur) ?? [])
        .filter(id => !seen.has(id))
        .sort((a, b) => (byId.get(a)!.x - byId.get(b)!.x) || a.localeCompare(b));
      for (const nb of next) {
        seen.add(nb);
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
    const pseudo: DbNode[] = [...parent.entries()].map(([id, pid]) => ({
      _id: id, chatId: "", parentId: pid, depth: 0,
      label: "", createdAt: byId.get(id)!.x,   // stable sibling order: left→right
    }));
    const points = layoutTree(buildTree(pseudo));
    const rootPoint = points.find(p => p.nodeId === startId)!;
    let maxY = anchor.y;
    for (const p of points) {
      const x = Math.round(anchor.x + (p.x - rootPoint.x) * TIDY_X_GAP);
      const y = Math.round(anchor.y + (p.y - rootPoint.y) * TIDY_Y_GAP);
      out.push({ id: p.nodeId, x, y });
      if (y > maxY) maxY = y;
    }
    return maxY;
  };

  const root = byId.get(rootId)!;
  let maxY = layoutComponent(rootId, { x: root.x, y: root.y });

  const rest = graphNodes
    .filter(n => !seen.has(n._id))
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const n of rest) {
    if (seen.has(n._id)) continue;
    maxY = layoutComponent(n._id, { x: root.x, y: maxY + Math.round(TIDY_Y_GAP * 1.5) });
  }

  return out;
}
