// src/lib/search/docs.ts
// The unified "search doc" model: every searchable thing (message,
// reflection, branch label, chat title, graph node) becomes one flat doc
// with a namespaced id, so the keyword index, the vector store, and the
// results UI all speak the same language.
//
// Graph-owned dock chats ("ask this graph" transcripts) are EXCLUDED —
// indexing RAG answers would feed them back into the next retrieval.

import { db } from "../db";

export type SearchDocKind = "message" | "reflection" | "node" | "chat" | "graphNode";

export interface SearchDoc {
  /** Namespaced id: "m:<id>" | "r:<id>" | "n:<id>" | "c:<id>" | "g:<id>". */
  id:     string;
  kind:   SearchDocKind;
  /** Owning chat id — or the GRAPH id for graphNode docs (used the same
   *  way for grouping/navigation). */
  chatId: string;
  /** Node to open for this hit (chat docs use the chat's currentNodeId;
   *  empty for graph nodes). */
  nodeId: string;
  /** Title-ish field (reflection title, node label, chat title, graph-node label). */
  title:  string;
  /** Body text (message content, reflection body, graph-node notes). */
  text:   string;
  /** Underlying record id without the namespace prefix. */
  rawId:  string;
}

const KIND_PREFIX: Record<SearchDocKind, string> = {
  message: "m", reflection: "r", node: "n", chat: "c", graphNode: "g",
};

export const docId = (kind: SearchDocKind, rawId: string): string =>
  `${KIND_PREFIX[kind]}:${rawId}`;

export function parseDocId(id: string): { kind: SearchDocKind; rawId: string } | null {
  const prefix = id.slice(0, 2);
  const rawId  = id.slice(2);
  if (!rawId) return null;
  switch (prefix) {
    case "m:": return { kind: "message",    rawId };
    case "r:": return { kind: "reflection", rawId };
    case "n:": return { kind: "node",       rawId };
    case "c:": return { kind: "chat",       rawId };
    case "g:": return { kind: "graphNode",  rawId };
    default:   return null;
  }
}

/** FNV-1a 32-bit — cheap content hash to detect docs needing re-embedding. */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Snapshot every searchable doc from Dexie. Used for the boot-time index
 *  build and for the embedding backfill diff. */
export async function collectAllDocs(): Promise<SearchDoc[]> {
  const [allChats, nodes, messages, reflections, graphNodes] = await Promise.all([
    db.chats.toArray(),
    db.nodes.toArray(),
    db.messages.toArray(),
    db.reflections.toArray(),
    db.graphNodes.toArray(),
  ]);

  // Dock chats (and everything inside them) stay out of the index.
  const chats = allChats.filter(c => !c.graphId);
  const chatById = new Map(chats.map(c => [c._id, c]));

  const docs: SearchDoc[] = [];

  for (const c of chats) {
    docs.push({
      id: docId("chat", c._id), kind: "chat", chatId: c._id,
      nodeId: c.currentNodeId || c.rootNodeId,
      title: c.title, text: "", rawId: c._id,
    });
  }
  for (const n of nodes) {
    // Root nodes mirror the chat title — indexing both would double every
    // chat-title hit, so roots are skipped.
    if (n.parentId === null) continue;
    if (!chatById.has(n.chatId)) continue;
    docs.push({
      id: docId("node", n._id), kind: "node", chatId: n.chatId,
      nodeId: n._id, title: n.label, text: "", rawId: n._id,
    });
  }
  for (const m of messages) {
    if (!m.content.trim()) continue;
    if (!chatById.has(m.chatId)) continue;
    docs.push({
      id: docId("message", m._id), kind: "message", chatId: m.chatId,
      nodeId: m.nodeId, title: "", text: m.content, rawId: m._id,
    });
  }
  for (const r of reflections) {
    if (!chatById.has(r.chatId)) continue;
    docs.push({
      id: docId("reflection", r._id), kind: "reflection", chatId: r.chatId,
      nodeId: r.nodeId, title: r.title, text: r.body, rawId: r._id,
    });
  }
  for (const g of graphNodes) {
    // Only the user's OWN words index here — attachment-derived titles are
    // already covered by their underlying chat/node/reflection docs.
    if (!g.label.trim() && !g.notes.trim()) continue;
    docs.push({
      id: docId("graphNode", g._id), kind: "graphNode", chatId: g.graphId,
      nodeId: "", title: g.label, text: g.notes, rawId: g._id,
    });
  }

  return docs;
}

/** Is this chat (by id) a graph-owned dock chat — or gone entirely? */
async function chatExcluded(chatId: string): Promise<boolean> {
  const c = await db.chats.get(chatId);
  return !c || Boolean(c.graphId);
}

/** Load a single doc fresh from Dexie (post-write incremental updates). */
export async function loadDoc(kind: SearchDocKind, rawId: string): Promise<SearchDoc | null> {
  switch (kind) {
    case "message": {
      const m = await db.messages.get(rawId);
      if (!m || !m.content.trim()) return null;
      if (await chatExcluded(m.chatId)) return null;
      return { id: docId(kind, rawId), kind, chatId: m.chatId, nodeId: m.nodeId, title: "", text: m.content, rawId };
    }
    case "reflection": {
      const r = await db.reflections.get(rawId);
      if (!r) return null;
      if (await chatExcluded(r.chatId)) return null;
      return { id: docId(kind, rawId), kind, chatId: r.chatId, nodeId: r.nodeId, title: r.title, text: r.body, rawId };
    }
    case "node": {
      const n = await db.nodes.get(rawId);
      if (!n || n.parentId === null) return null;
      if (await chatExcluded(n.chatId)) return null;
      return { id: docId(kind, rawId), kind, chatId: n.chatId, nodeId: n._id, title: n.label, text: "", rawId };
    }
    case "chat": {
      const c = await db.chats.get(rawId);
      if (!c || c.graphId) return null;
      return { id: docId(kind, rawId), kind, chatId: c._id, nodeId: c.currentNodeId || c.rootNodeId, title: c.title, text: "", rawId };
    }
    case "graphNode": {
      const g = await db.graphNodes.get(rawId);
      if (!g || (!g.label.trim() && !g.notes.trim())) return null;
      return { id: docId(kind, rawId), kind, chatId: g.graphId, nodeId: "", title: g.label, text: g.notes, rawId };
    }
  }
}