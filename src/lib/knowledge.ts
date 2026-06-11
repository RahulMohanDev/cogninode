// src/lib/knowledge.ts
// CRUD helpers for knowledge graphs. All multi-table mutations run in one
// Dexie transaction so liveQuery observers see single committed states;
// graph.updatedAt is touched on every content change so the /graphs list
// sorts by real activity.
//
// The model (schema v6): a graph is a user-engineered RAG corpus. One
// undeletable ROOT node anchors it; every other node is label + notes +
// color with OPTIONAL attached data (a chat, a branch subtree, or a
// reflection) whose underlying messages are that node's retrieval corpus.

import {
  db, deleteChat, newId,
  type Chat, type GraphNode, type GraphNodeAttachment, type GraphNodeColor,
} from "./db";
import { planSubtreeSources } from "./flowGraph";

export const GRAPH_NODE_COLORS: GraphNodeColor[] = ["coral", "teal", "lilac", "butter"];

const touchGraph = (graphId: string) =>
  db.graphs.update(graphId, { updatedAt: Date.now() });

// ── graphs ─────────────────────────────────────────────────────

/** Create a graph WITH its root node (the retrieval anchor) in one tx. */
export async function createGraph(name = "New graph"): Promise<string> {
  const graphId = newId();
  const rootId  = newId();
  const label   = name.trim() || "New graph";
  await db.transaction("rw", db.graphs, db.graphNodes, async () => {
    await db.graphNodes.add({
      _id: rootId, graphId, kind: "root",
      label, notes: "", color: "coral",
      x: 0, y: 0,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    await db.graphs.add({
      _id: graphId, name: label, rootNodeId: rootId,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  return graphId;
}

/** Rename a graph. The root node IS the graph's name — keep them in sync
 *  (mirror of renameChat ↔ root-node-label in db.ts). */
export async function renameGraph(graphId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.transaction("rw", db.graphs, db.graphNodes, async () => {
    const graph = await db.graphs.get(graphId);
    if (!graph) return;
    await db.graphs.update(graphId, { name: trimmed, updatedAt: Date.now() });
    await db.graphNodes.update(graph.rootNodeId, { label: trimmed, updatedAt: Date.now() });
  });
}

/** Delete a graph, its nodes/edges, and its hidden dock chat (if any).
 *  The dock chat goes through deleteChat for the full cascade — that's a
 *  separate transaction over a different table set, run after ours. */
export async function deleteGraph(graphId: string): Promise<void> {
  const dock = await db.chats.where("graphId").equals(graphId).first();
  await db.transaction("rw", [db.graphs, db.graphNodes, db.graphEdges], async () => {
    await db.graphNodes.where("graphId").equals(graphId).delete();
    await db.graphEdges.where("graphId").equals(graphId).delete();
    await db.graphs.delete(graphId);
  });
  if (dock) await deleteChat(dock._id);
}

// ── nodes ──────────────────────────────────────────────────────

export async function createNode(
  graphId: string,
  opts: {
    label?: string;
    x: number;
    y: number;
    color?: GraphNodeColor;
    attachment?: GraphNodeAttachment;
  },
): Promise<string> {
  const _id = newId();
  await db.transaction("rw", db.graphNodes, db.graphs, async () => {
    await db.graphNodes.add({
      _id, graphId, kind: "node",
      label: opts.label?.trim() ?? "",
      notes: "",
      color: opts.color ?? "teal",
      x: Math.round(opts.x),
      y: Math.round(opts.y),
      ...(opts.attachment ? { attachment: opts.attachment } : {}),
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    await touchGraph(graphId);
  });
  return _id;
}

export async function updateNode(
  nodeId: string,
  patch: Partial<Pick<GraphNode, "label" | "notes" | "color">>,
): Promise<void> {
  const node = await db.graphNodes.get(nodeId);
  if (!node) return;
  await db.transaction("rw", db.graphNodes, db.graphs, async () => {
    await db.graphNodes.update(nodeId, { ...patch, updatedAt: Date.now() });
    // Renaming the root renames the graph (and vice versa via renameGraph).
    if (node.kind === "root" && patch.label !== undefined && patch.label.trim()) {
      await db.graphs.update(node.graphId, { name: patch.label.trim(), updatedAt: Date.now() });
    } else {
      await touchGraph(node.graphId);
    }
  });
}

export async function moveNode(nodeId: string, x: number, y: number): Promise<void> {
  await db.graphNodes.update(nodeId, {
    x: Math.round(x), y: Math.round(y), updatedAt: Date.now(),
  });
}

/** Bulk position write (multi-drag, Tidy layout) — one tx, one re-render. */
export async function moveNodes(
  items: Array<{ id: string; x: number; y: number }>,
): Promise<void> {
  if (items.length === 0) return;
  await db.transaction("rw", db.graphNodes, async () => {
    for (const it of items) {
      await db.graphNodes.update(it.id, {
        x: Math.round(it.x), y: Math.round(it.y), updatedAt: Date.now(),
      });
    }
  });
}

/** Delete a node and every edge touching it. The ROOT is undeletable —
 *  returns false and leaves everything in place. */
export async function deleteNode(nodeId: string): Promise<boolean> {
  const node = await db.graphNodes.get(nodeId);
  if (!node || node.kind === "root") return false;
  await db.transaction("rw", [db.graphNodes, db.graphEdges, db.graphs], async () => {
    await db.graphEdges.where("source").equals(nodeId).delete();
    await db.graphEdges.where("target").equals(nodeId).delete();
    await db.graphNodes.delete(nodeId);
    await touchGraph(node.graphId);
  });
  return true;
}

/** Drop a node's attached data; the node, notes, and edges stay. When the
 *  user never set a label, the attachment's last display title is baked in
 *  so the card doesn't go blank. */
export async function detachNode(nodeId: string, bakedLabel: string): Promise<void> {
  const node = await db.graphNodes.get(nodeId);
  if (!node?.attachment) return;
  await db.transaction("rw", db.graphNodes, db.graphs, async () => {
    await db.graphNodes.where("_id").equals(nodeId).modify(n => {
      delete n.attachment;
      if (!n.label.trim()) n.label = bakedLabel.trim() || "Untitled node";
      n.updatedAt = Date.now();
    });
    await touchGraph(node.graphId);
  });
}

/** Place attached data on the canvas as a node. One node per
 *  (graph, attachment target) — re-adding an existing target returns it
 *  instead, so drags from the library never duplicate. */
export async function addAttachedNode(
  graphId: string,
  opts: { attachment: GraphNodeAttachment; x: number; y: number },
): Promise<{ id: string; created: boolean }> {
  return db.transaction("rw", db.graphNodes, db.graphs, async () => {
    const existing = await db.graphNodes
      .where("attachment.targetId").equals(opts.attachment.targetId)
      .filter(n => n.graphId === graphId)
      .first();
    if (existing) return { id: existing._id, created: false };
    const _id = newId();
    await db.graphNodes.add({
      _id, graphId, kind: "node",
      label: "", notes: "", color: "teal",
      x: Math.round(opts.x), y: Math.round(opts.y),
      attachment: opts.attachment,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    await touchGraph(graphId);
    return { id: _id, created: true };
  });
}

// ── edges ──────────────────────────────────────────────────────

/** Connect two nodes. Self-loops and duplicates (either direction — the
 *  map reads as undirected) are ignored; returns the edge id either way,
 *  or null for a rejected self-loop. */
export async function addEdge(
  graphId: string,
  source: string,
  target: string,
  kind?: "lineage",
): Promise<string | null> {
  if (source === target) return null;
  return db.transaction("rw", db.graphEdges, db.graphs, async () => {
    const existing = await db.graphEdges
      .where("graphId").equals(graphId)
      .filter(e =>
        (e.source === source && e.target === target) ||
        (e.source === target && e.target === source))
      .first();
    if (existing) return existing._id;
    const _id = newId();
    await db.graphEdges.add({ _id, graphId, source, target, ...(kind ? { kind } : {}) });
    await touchGraph(graphId);
    return _id;
  });
}

/** Set or clear an edge's label (empty/whitespace clears it). */
export async function updateEdge(edgeId: string, patch: { label?: string }): Promise<void> {
  const edge = await db.graphEdges.get(edgeId);
  if (!edge) return;
  await db.transaction("rw", db.graphEdges, db.graphs, async () => {
    if (patch.label !== undefined) {
      const label = patch.label.trim();
      await db.graphEdges.where("_id").equals(edgeId).modify(e => {
        if (label) e.label = label;
        else delete e.label;
      });
    }
    await touchGraph(edge.graphId);
  });
}

export async function deleteEdge(edgeId: string): Promise<void> {
  const edge = await db.graphEdges.get(edgeId);
  if (!edge) return;
  await db.transaction("rw", db.graphEdges, db.graphs, async () => {
    await db.graphEdges.delete(edgeId);
    await touchGraph(edge.graphId);
  });
}

/** Cut every edge touching a node (the node itself stays). */
export async function disconnectNode(nodeId: string): Promise<number> {
  const node = await db.graphNodes.get(nodeId);
  if (!node) return 0;
  return db.transaction("rw", db.graphEdges, db.graphs, async () => {
    const a = await db.graphEdges.where("source").equals(nodeId).delete();
    const b = await db.graphEdges.where("target").equals(nodeId).delete();
    if (a + b > 0) await touchGraph(node.graphId);
    return a + b;
  });
}

/** Widen/narrow how much of the chat tree a branch attachment covers. */
export async function setAttachmentScope(
  nodeId: string,
  scope: "subtree" | "single",
): Promise<void> {
  const node = await db.graphNodes.get(nodeId);
  if (!node?.attachment || node.attachment.type !== "node") return;
  await db.transaction("rw", db.graphNodes, db.graphs, async () => {
    await db.graphNodes.update(nodeId, {
      attachment: { ...node.attachment!, scope },
      updatedAt:  Date.now(),
    });
    await touchGraph(node.graphId);
  });
}

// ── attaching from dialogs (TopBar / Reflections page) ─────────────────

/** Place attached data near an existing node and wire an edge to it. */
export async function attachTargetToNode(opts: {
  graphId:    string;
  nodeId:     string;
  attachment: GraphNodeAttachment;
}): Promise<void> {
  const anchor   = await db.graphNodes.get(opts.nodeId);
  const siblings = await db.graphEdges.where("source").equals(opts.nodeId).count();
  const { id } = await addAttachedNode(opts.graphId, {
    attachment: opts.attachment,
    x: (anchor?.x ?? 0) + 280,
    y: (anchor?.y ?? 0) + 40 + (siblings % 4) * 90,
  });
  await addEdge(opts.graphId, opts.nodeId, id);
}

// ── unfolding ──────────────────────────────────────────────────

async function planNodeUnfold(node: GraphNode): Promise<{
  chatId: string;
  plan:   ReturnType<typeof planSubtreeSources>;
} | null> {
  const a = node.attachment;
  if (!a || a.type === "reflection") return null;
  if (a.type === "node" && a.scope === "single") return null;
  const chatId = a.type === "chat"
    ? a.targetId
    : (await db.nodes.get(a.targetId))?.chatId;
  if (!chatId) return null;   // stale attachment
  const chatNodes = await db.nodes.where("chatId").equals(chatId).toArray();
  const plan = planSubtreeSources(
    chatId, chatNodes,
    a.type === "chat" ? null : a.targetId,
    { x: node.x, y: node.y },
  );
  return plan.length > 0 ? { chatId, plan } : null;
}

/**
 * Unfold a chat / subtree-branch node into one card per chat-tree node,
 * joined by dashed lineage edges, ready for pruning.
 *
 * The ORIGINAL node becomes the subtree-root card in place (same _id, its
 * attachment narrows to scope "single") — so its user-drawn edges, notes,
 * label, and position all survive, and React Flow never remounts it.
 * Idempotent: existing cards keep their positions, lineage edges dedupe.
 */
export async function unfoldNode(
  graphId:     string,
  graphNodeId: string,
): Promise<{ added: number } | null> {
  const node = await db.graphNodes.get(graphNodeId);
  if (!node) return null;
  const planned = await planNodeUnfold(node);
  if (!planned) return null;
  const { plan } = planned;

  return db.transaction("rw", [db.graphNodes, db.graphEdges, db.graphs], async () => {
    const idByTarget = new Map<string, string>();
    let added = 0;

    const rootItem = plan.find(p => p.parentTargetId === null);
    if (!rootItem) return null;
    const conflict = await db.graphNodes
      .where("attachment.targetId").equals(rootItem.targetId)
      .filter(n => n.graphId === graphId && n._id !== graphNodeId)
      .first();
    if (conflict) {
      // Another card already holds this target (e.g. the chat was unfolded
      // before and re-dropped). Keep the one-node-per-(graph, target)
      // invariant: wire lineage through the existing card; leave this node's
      // attachment untouched.
      idByTarget.set(rootItem.targetId, conflict._id);
    } else {
      await db.graphNodes.update(graphNodeId, {
        attachment: { type: "node", targetId: rootItem.targetId, scope: "single" },
        updatedAt:  Date.now(),
      });
      idByTarget.set(rootItem.targetId, graphNodeId);
    }

    for (const item of plan) {
      if (item.parentTargetId === null) continue;
      const { id, created } = await addAttachedNode(graphId, {
        attachment: { type: "node", targetId: item.targetId, scope: "single" },
        x: item.x, y: item.y,
      });
      idByTarget.set(item.targetId, id);
      if (created) added++;
    }

    for (const item of plan) {
      if (!item.parentTargetId) continue;
      const parent = idByTarget.get(item.parentTargetId);
      const child  = idByTarget.get(item.targetId);
      if (parent && child) await addEdge(graphId, parent, child, "lineage");
    }

    await touchGraph(graphId);
    return { added };
  });
}

// ── the graph's dock chat ("ask this graph") ───────────────────────────

/** One hidden, linear chat per graph: found by the chats.graphId index or
 *  created on first use. Lookup + create share a tx so concurrent calls
 *  can't double-create. */
export async function getOrCreateGraphChat(graphId: string): Promise<Chat> {
  return db.transaction("rw", db.chats, db.nodes, db.graphs, async () => {
    const existing = await db.chats.where("graphId").equals(graphId).first();
    if (existing) return existing;
    const graph  = await db.graphs.get(graphId);
    const title  = `${graph?.name ?? "Graph"} — graph chat`;
    const chatId = newId();
    const rootId = newId();
    await db.nodes.add({
      _id: rootId, chatId, parentId: null, depth: 0,
      label: title, createdAt: Date.now(),
    });
    const chat: Chat = {
      _id: chatId, title, rootNodeId: rootId, currentNodeId: rootId,
      graphId, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await db.chats.add(chat);
    return chat;
  });
}

// ── misc ───────────────────────────────────────────────────────

/** Spread new nodes on a loose grid so untouched ones never stack. */
export function nextNodePosition(count: number): { x: number; y: number } {
  return {
    x: 80 + (count % 5) * 250,
    y: 80 + Math.floor(count / 5) * 150,
  };
}
