// src/lib/search/docs.ts
// The unified "search doc" model: every searchable thing (message,
// reflection, branch label, chat title, graph node) becomes one flat doc
// with a namespaced id, so the keyword index, the vector store, and the
// results UI all speak the same language.
//
// Graph-owned dock chats ("ask this graph" transcripts) are EXCLUDED —
// indexing RAG answers would feed them back into the next retrieval.

import { db, type StoredFile } from "../db";
import { chunksForFile, invalidateChunkMemo } from "../docrag/chunk";

export type SearchDocKind = "message" | "reflection" | "node" | "chat" | "graphNode" | "fileChunk";

export interface SearchDoc {
  /** Namespaced id: "m:<id>" | "r:<id>" | "n:<id>" | "c:<id>" | "g:<id>"
   *  | "f:<fileId>#<chunkIndex>" (uploaded files index per-chunk). */
  id:     string;
  kind:   SearchDocKind;
  /** Owning chat id — or the GRAPH id for graphNode docs (used the same
   *  way for grouping/navigation). Empty for fileChunk docs: files are
   *  reused across chats, so navigation is resolved at hydrate time. */
  chatId: string;
  /** Node to open for this hit (chat docs use the chat's currentNodeId;
   *  empty for graph nodes and file chunks). */
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
  fileChunk: "f",
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
    case "f:": return { kind: "fileChunk",  rawId };
    default:   return null;
  }
}

export const fileChunkDocId = (fileId: string, chunkIndex: number): string =>
  docId("fileChunk", `${fileId}#${chunkIndex}`);

/** Split a fileChunk rawId ("<fileId>#<chunkIndex>") back into its parts. */
export function parseFileChunkRawId(
  rawId: string,
): { fileId: string; chunkIndex: number } | null {
  const hash = rawId.lastIndexOf("#");
  if (hash <= 0 || hash === rawId.length - 1) return null;
  const chunkIndex = Number(rawId.slice(hash + 1));
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
  return { fileId: rawId.slice(0, hash), chunkIndex };
}

/** Build the SearchDocs for one stored file. The file name rides on chunk
 *  0 only — repeating it would multiply the title-boosted keyword score by
 *  the chunk count. */
export function fileChunkDocs(file: { _id: string; name: string; kind: string; content: string }): SearchDoc[] {
  if (file.kind === "image") return [];
  return chunksForFile(file._id, file.content).map(chunk => ({
    id:     fileChunkDocId(file._id, chunk.index),
    kind:   "fileChunk" as const,
    chatId: "",
    nodeId: "",
    title:  chunk.index === 0 ? file.name : "",
    text:   chunk.text,
    rawId:  `${file._id}#${chunk.index}`,
  }));
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
  const [allChats, nodes, messages, reflections, graphNodes, files] = await Promise.all([
    db.chats.toArray(),
    db.nodes.toArray(),
    db.messages.toArray(),
    db.reflections.toArray(),
    db.graphNodes.toArray(),
    // Filtered in the cursor so image rows' base64 payloads are never
    // retained together in memory (they index nothing anyway).
    db.files.filter(f => f.kind !== "image").toArray(),
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
  for (const f of files) {
    docs.push(...fileChunkDocs(f));
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
    case "fileChunk": {
      // Must stay exactly symmetric with fileChunkDocs/collectAllDocs, or
      // the backfill hash diff churns vectors on every boot.
      const parsed = parseFileChunkRawId(rawId);
      if (!parsed) return null;
      const f = await getFileRow(parsed.fileId);
      if (!f) return null;
      return fileChunkDocs(f).find(d => d.rawId === rawId) ?? null;
    }
  }
}

// ── file-row cache ─────────────────────────────────────────────────
// pumpEmbeds loads chunk docs ONE AT A TIME through loadDoc — without this
// cache every chunk load re-reads (and re-deserializes) the entire file
// row from IndexedDB: O(chunks × fileSize) per file. Rows are immutable
// after upload; deletions invalidate through invalidateFileDocCache.

const FILE_ROW_CACHE_MAX = 4;
const fileRowCache = new Map<string, StoredFile>();

async function getFileRow(fileId: string): Promise<StoredFile | undefined> {
  const cached = fileRowCache.get(fileId);
  if (cached) return cached;
  const f = await db.files.get(fileId);
  if (f) {
    fileRowCache.set(fileId, f);
    if (fileRowCache.size > FILE_ROW_CACHE_MAX) {
      const oldest = fileRowCache.keys().next().value;
      if (oldest !== undefined) fileRowCache.delete(oldest);
    }
  }
  return f;
}

/** Drop everything cached for a file — called by the search service when
 *  its row is created/deleted, so reused ids never serve stale data. */
export function invalidateFileDocCache(fileId: string): void {
  fileRowCache.delete(fileId);
  invalidateChunkMemo(fileId);
}