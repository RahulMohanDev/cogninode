// src/lib/db.ts
import Dexie, { type EntityTable } from "dexie";
import { abortNodes }              from "./streamAborts";
import { migrateGraphsToV6 }       from "./graphMigration";
import type { Citation }           from "./stream";

// Re-export so message consumers can pull the Citation shape from `db`.
export type { Citation };

// ── Local types ────────────────────────────────────────────────

export interface Chat {
  _id:           string;   // crypto.randomUUID()
  title:         string;
  rootNodeId:    string;
  currentNodeId: string;
  /** Set ⇒ this is a graph's hidden dock chat (the "ask this graph"
   *  transcript). Excluded from the grove, sidebar, QuickJump, and the
   *  search index — it renders only inside its graph's editor. */
  graphId?:      string;
  createdAt:     number;
  updatedAt:     number;
}

export interface Node {
  _id:       string;
  chatId:    string;
  parentId:  string | null;
  depth:     number;
  label:     string;         // first 60 chars of quote or first message
  createdAt: number;
}

/** One graph-RAG context group cited in an assistant reply: the prompt
 *  tag ("S2") and the canvas node whose attached content fed it. */
export interface RagSourceRef {
  tag:         string;
  graphNodeId: string;
}

export interface Message {
  _id:          string;
  nodeId:       string;
  chatId:       string;
  role:         "user" | "assistant";
  content:      string;
  reasoning?:   string;        // chain-of-thought from reasoning models
  modelId?:     string;
  costUsd?:     number;        // actual API cost — stored post-send
  inputTokens?: number;
  outputTokens?: number;
  pathDepth?:   number;        // path length at send time
  quote?:       string;        // text that triggered this branch
  fileIds?:     string[];      // references to files table
  citations?:   Citation[];    // web-search sources (non-indexed, no migration)
  ragSources?:  RagSourceRef[]; // graph-RAG citations (non-indexed, no migration)
  createdAt:    number;
}

export interface Reflection {
  _id:       string;
  chatId:    string;
  nodeId:    string;
  title:     string;
  body:      string;           // distilled markdown
  updatedAt: number;
}

export interface StoredFile {
  _id:       string;
  name:      string;
  kind:      "image" | "pdf" | "code" | "file";
  mimeType:  string;
  sizeBytes: number;
  content:   string;           // base64 data URL for images; plain text for others
  createdAt: number;
}

// Cached row of the live OpenRouter model catalog (GET /api/v1/models).
// This table is a CACHE, not user data: replaced wholesale on refresh,
// excluded from export/import, safe to wipe.
export interface CatalogModel {
  _id:                 string;     // OpenRouter model id, e.g. "openai/gpt-4o-mini"
  name:                string;     // display name without the vendor prefix
  vendor:              string;
  contextLength:       number;
  promptPerM:          number;     // USD per 1M input tokens
  completionPerM:      number;     // USD per 1M output tokens
  inputModalities:     string[];
  outputModalities:    string[];
  supportedParameters: string[];
  created:             number;     // unix seconds, from the API
}

// Tiny key→value table for app-level bookkeeping (catalog fetchedAt, …).
export interface MetaEntry {
  key:   string;
  value: unknown;
}

// ── Knowledge graphs ───────────────────────────────────────────
// User-engineered RAG corpora: every graph is anchored by a ROOT node
// (the retrieval entry point) and holds unified nodes — each a label +
// notes + color, optionally carrying ATTACHED DATA (a chat, a branch
// subtree, or a reflection). Edges connect anything to anything; the
// resulting structure is exactly what graph-scoped retrieval walks.

export type GraphNodeColor = "coral" | "teal" | "lilac" | "butter";

export interface KnowledgeGraph {
  _id:        string;
  name:       string;
  /** The graph's root node — created with the graph, undeletable. */
  rootNodeId: string;
  createdAt:  number;
  updatedAt:  number;
}

export interface GraphNodeAttachment {
  type:     "chat" | "node" | "reflection";
  targetId: string;
  /** Branch ("node") attachments only — how much of the chat tree this
   *  node's data covers: the whole subtree (default for fresh drops) or
   *  exactly one chat-tree node (cards produced by Unfold). */
  scope?:   "subtree" | "single";
}

export interface GraphNode {
  _id:       string;
  graphId:   string;
  kind:      "root" | "node";
  /** "" ⇒ derive the display title from the attachment (tracks renames). */
  label:     string;
  notes:     string;        // freeform markdown-ish notes
  color:     GraphNodeColor;
  x:         number;        // canvas position, persisted on drag
  y:         number;
  /** The node's data: the underlying messages/reflection become this
   *  node's retrieval corpus. Absent ⇒ purely organizational node. */
  attachment?: GraphNodeAttachment;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  _id:     string;
  graphId: string;
  source:  string;          // graph-node id (undirected — source/target read symmetric)
  target:  string;
  label?:  string;
  /** "lineage" = created by unfolding a chat subtree (mirrors branch
   *  parentage, rendered dashed). User-drawn edges carry no kind. */
  kind?:   "lineage";
}

// ── Legacy graph shapes (schema ≤5 / export ≤3) ────────────────
// Kept only for the v6 upgrade migration and the backup importer.

/** @deprecated v5 name for {@link GraphNodeColor}. */
export type ConceptColor = GraphNodeColor;

/** Legacy (schema ≤5 / export ≤3) concept row — merged into graphNodes in v6. */
export interface Concept {
  _id:       string;
  graphId:   string;
  label:     string;
  notes:     string;
  color:     ConceptColor;
  x:         number;
  y:         number;
  createdAt: number;
  updatedAt: number;
}

/** Legacy (schema ≤5 / export ≤3) edge row — copied to graphEdges in v6. */
export type ConceptEdge = GraphEdge;

/** Legacy (schema ≤5 / export ≤3) canvas source — merged into graphNodes
 *  (as attachment-bearing nodes) in v6. */
export interface GraphSource {
  _id:        string;
  graphId:    string;
  targetType: "chat" | "node" | "reflection";
  targetId:   string;
  x:          number;
  y:          number;
  createdAt:  number;
}

/** Legacy (schema ≤4 / export v2) panel-attachment shape. The table was
 *  replaced by graphSources + edges in v5; this type remains for the
 *  import converter. */
export interface ConceptLink {
  _id:        string;
  graphId:    string;
  conceptId:  string;
  targetType: "chat" | "reflection";
  targetId:   string;
  createdAt:  number;
}

// One embedding per searchable doc (message / reflection / graph node),
// keyed by the search doc id ("m:<id>" / "r:<id>" / "g:<id>"). Vectors are
// pre-normalized so cosine similarity reduces to a dot product. `textHash`
// detects content edits that require re-embedding; `model` scopes rows to
// the embedding model that produced them (switching models wipes + rebuilds).
export interface SearchVector {
  _id:       string;     // search doc id, e.g. "m:<messageId>"
  kind:      "message" | "reflection" | "graphNode";
  /** Owning chat id — or the GRAPH id for graphNode docs. */
  chatId:    string;
  nodeId:    string;
  model:     string;     // embedding model id from EMBEDDING_MODELS
  dims:      number;
  vector:    ArrayBuffer; // Float32Array buffer, length === dims
  textHash:  string;
  updatedAt: number;
}

// ── Dexie database ─────────────────────────────────────────────

export const db = new Dexie("cogninode") as Dexie & {
  chats:       EntityTable<Chat,        "_id">;
  nodes:       EntityTable<Node,        "_id">;
  messages:    EntityTable<Message,     "_id">;
  reflections: EntityTable<Reflection,  "_id">;
  files:       EntityTable<StoredFile,  "_id">;
  models:      EntityTable<CatalogModel, "_id">;
  meta:        EntityTable<MetaEntry,   "key">;
  searchVectors: EntityTable<SearchVector, "_id">;
  graphs:     EntityTable<KnowledgeGraph, "_id">;
  graphNodes: EntityTable<GraphNode,     "_id">;
  graphEdges: EntityTable<GraphEdge,     "_id">;
};

db.version(1).stores({
  chats:       "_id, updatedAt",
  nodes:       "_id, chatId, parentId",
  messages:    "_id, nodeId, chatId, createdAt",
  reflections: "_id, nodeId, chatId",
  files:       "_id, createdAt",
});

// v2: live model catalog cache + meta bookkeeping. Existing tables carry over.
db.version(2).stores({
  models: "_id, vendor",
  meta:   "key",
});

// v3: semantic-search embeddings (cache — rebuildable from messages).
db.version(3).stores({
  searchVectors: "_id, model, chatId",
});

// v4: knowledge graphs (concept maps with chat/reflection attachments).
db.version(4).stores({
  graphs:       "_id, updatedAt",
  concepts:     "_id, graphId",
  conceptEdges: "_id, graphId, source, target",
  conceptLinks: "_id, graphId, conceptId, targetId",
});

// v5: attachments become first-class canvas nodes (graphSources) wired to
// concepts via ordinary edges — the playground/traversal model. Existing
// conceptLinks rows migrate to one source per (graph, target) plus an
// edge per linking concept; the table is then dropped.
db.version(5).stores({
  graphSources: "_id, graphId, targetId",
  conceptLinks: null,
}).upgrade(async tx => {
  const links = await tx.table("conceptLinks").toArray() as ConceptLink[];
  if (links.length === 0) return;
  const concepts = await tx.table("concepts").toArray() as Concept[];
  const conceptById = new Map(concepts.map(c => [c._id, c]));
  const sourceIdByKey = new Map<string, string>();
  let spread = 0;
  for (const l of links) {
    const key = `${l.graphId}:${l.targetId}`;
    let sourceId = sourceIdByKey.get(key);
    if (!sourceId) {
      sourceId = crypto.randomUUID();
      sourceIdByKey.set(key, sourceId);
      const c = conceptById.get(l.conceptId);
      await tx.table("graphSources").add({
        _id:        sourceId,
        graphId:    l.graphId,
        targetType: l.targetType,
        targetId:   l.targetId,
        x:          (c?.x ?? 0) + 260,
        y:          (c?.y ?? 0) + 40 + (spread++ % 4) * 90,
        createdAt:  l.createdAt ?? Date.now(),
      });
    }
    await tx.table("conceptEdges").add({
      _id:     crypto.randomUUID(),
      graphId: l.graphId,
      source:  l.conceptId,
      target:  sourceId,
    });
  }
});

// v6: the unified-node model. concepts + graphSources merge into ONE
// graphNodes table (a node = label/notes/color + optional attached data),
// conceptEdges copy to graphEdges, and every graph gains an undeletable
// ROOT node that anchors graph-scoped retrieval. chats gains a graphId
// index so each graph can own a hidden "ask this graph" dock chat.
db.version(6).stores({
  chats:        "_id, updatedAt, graphId",
  graphNodes:   "_id, graphId, attachment.targetId",
  graphEdges:   "_id, graphId, source, target",
  concepts:     null,
  conceptEdges: null,
  graphSources: null,
}).upgrade(async tx => {
  const [graphs, concepts, sources, edges] = await Promise.all([
    tx.table("graphs").toArray()        as Promise<Array<{ _id: string; name: string }>>,
    tx.table("concepts").toArray()      as Promise<Concept[]>,
    tx.table("graphSources").toArray()  as Promise<GraphSource[]>,
    tx.table("conceptEdges").toArray()  as Promise<ConceptEdge[]>,
  ]);
  const out = migrateGraphsToV6({
    graphs, concepts, sources, edges,
    now: Date.now(), newId: () => crypto.randomUUID(),
  });
  if (out.graphNodes.length > 0) await tx.table("graphNodes").bulkAdd(out.graphNodes);
  if (out.graphEdges.length > 0) await tx.table("graphEdges").bulkAdd(out.graphEdges);
  for (const [graphId, rootNodeId] of out.rootIdByGraph) {
    await tx.table("graphs").update(graphId, { rootNodeId });
  }
});

// ── Meta helpers ───────────────────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

// ── Typed helpers ──────────────────────────────────────────────

export function newId(): string {
  return crypto.randomUUID();
}

// Create a new chat with its root node in one transaction
export async function createChat(title = "New chat"): Promise<string> {
  const chatId = newId();
  const rootId = newId();

  await db.transaction("rw", db.chats, db.nodes, async () => {
    await db.nodes.add({
      _id:       rootId,
      chatId,
      parentId:  null,
      depth:     0,
      label:     title,
      createdAt: Date.now(),
    });
    await db.chats.add({
      _id:           chatId,
      title,
      rootNodeId:    rootId,
      currentNodeId: rootId,
      createdAt:     Date.now(),
      updatedAt:     Date.now(),
    });
  });

  return chatId;
}

// Create a branch node from a parent
export async function createBranch(params: {
  chatId:   string;
  parentId: string;
  depth:    number;
  label:    string;
}): Promise<string> {
  const nodeId = newId();

  await db.transaction("rw", db.nodes, db.chats, async () => {
    await db.nodes.add({
      _id:       nodeId,
      chatId:    params.chatId,
      parentId:  params.parentId,
      depth:     params.depth,
      label:     params.label,
      createdAt: Date.now(),
    });
    await db.chats.update(params.chatId, {
      currentNodeId: nodeId,
      updatedAt:     Date.now(),
    });
  });

  return nodeId;
}

// Rename a chat. Updates both the chat title and its root node's label so
// the sidebar tree, breadcrumb, and QuickJump all stay consistent.
export async function renameChat(chatId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  await db.transaction("rw", db.chats, db.nodes, async () => {
    const chat = await db.chats.get(chatId);
    if (!chat) return;
    await db.chats.update(chatId, { title: trimmed, updatedAt: Date.now() });
    await db.nodes.update(chat.rootNodeId, { label: trimmed });
  });
}

// Rename a branch node. Updates the node's label. If the node is a chat's
// ROOT node, the chat title is the same concept — keep them in sync by
// updating the chat title too (mirror of renameChat).
export async function renameNode(nodeId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  await db.transaction("rw", db.nodes, db.chats, async () => {
    const node = await db.nodes.get(nodeId);
    if (!node) return;
    await db.nodes.update(nodeId, { label: trimmed });
    const chat = await db.chats.get(node.chatId);
    if (chat && chat.rootNodeId === nodeId) {
      await db.chats.update(node.chatId, { title: trimmed, updatedAt: Date.now() });
    }
  });
}

// Walk DFS path from a node to root, return flat message array for prompt
export async function buildPathMessages(
  chatId: string,
  nodeId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string | unknown[] }>> {
  const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
  const nodeMap  = new Map(allNodes.map(n => [n._id, n]));

  // Walk to root
  const path: Node[] = [];
  let currentId: string | null = nodeId;
  while (currentId) {
    const node = nodeMap.get(currentId);
    if (!node) break;
    path.unshift(node);
    currentId = node.parentId;
  }

  // Collect messages in path order
  const result: Array<{ role: "user" | "assistant"; content: string | unknown[] }> = [];

  for (const node of path) {
    const msgs = await db.messages
      .where("nodeId").equals(node._id)
      .sortBy("createdAt");

    for (const msg of msgs) {
      // User messages with attachments: inject file content here so the
      // composer textarea stays clean (no giant <document> blob visible to
      // the user) while the model still sees the full document context.
      if (msg.role === "user" && msg.fileIds?.length) {
        const files = await db.files
          .where("_id").anyOf(msg.fileIds)
          .toArray();

        const images    = files.filter(f => f.kind === "image");
        const nonImages = files.filter(f => f.kind !== "image");

        // Build the text portion: file context first (so the question reads
        // naturally after the attached material), then the branch quote (if
        // any), then the user's typed text.
        const textChunks: string[] = [];
        for (const file of nonImages) {
          if (file.kind === "pdf") {
            textChunks.push(`<document name="${file.name}">\n${file.content}\n</document>`);
          } else if (file.kind === "code") {
            const ext = file.name.split(".").pop() ?? "";
            textChunks.push("```" + ext + "\n" + file.content + "\n```");
          } else {
            textChunks.push(`<file name="${file.name}">\n${file.content}\n</file>`);
          }
        }
        if (msg.quote) {
          const quoted = msg.quote.split("\n").map(l => `> ${l}`).join("\n");
          textChunks.push(
            `> Context — branched from this excerpt of the prior reply:\n${quoted}`,
          );
        }
        if (msg.content) textChunks.push(msg.content);
        const textContent = textChunks.join("\n\n");

        if (images.length === 0) {
          // Pure text — keep as a string for broadest model compatibility.
          result.push({ role: "user", content: textContent });
        } else {
          const parts: unknown[] = [{ type: "text", text: textContent }];
          for (const img of images) {
            parts.push({ type: "image_url", image_url: { url: img.content } });
          }
          result.push({ role: "user", content: parts });
        }
      } else if (msg.role === "user" && msg.quote) {
        // User message with a branch quote but no file attachments: prepend
        // the quote block so the model sees what the follow-up refers to.
        const quoted = msg.quote.split("\n").map(l => `> ${l}`).join("\n");
        const quoteBlock =
          `> Context — branched from this excerpt of the prior reply:\n${quoted}`;
        const textContent = msg.content
          ? `${quoteBlock}\n\n${msg.content}`
          : quoteBlock;
        result.push({ role: "user", content: textContent });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
  }

  return result;
}

// ── Cascade-delete helpers ─────────────────────────────────────
// These helpers preserve referential integrity by collecting the full set
// of node ids being removed up front, then deleting messages / reflections
// keyed by those ids in one rw transaction. Files are only purged when
// they're not referenced by any surviving message — uploads can be
// re-attached across branches and we don't want to orphan a still-used
// blob.

/** DETACH graph-node attachments whose underlying chat/branch/reflection
 *  is being deleted. The node itself survives — notes, color, position,
 *  and every edge stay on the canvas — with the last-known title baked
 *  into the label when the user never set one. Must run inside a
 *  transaction that includes graphNodes. Returns how many were detached. */
async function detachAttachmentsByTargets(
  titleByTargetId: Map<string, string>,
): Promise<number> {
  if (titleByTargetId.size === 0) return 0;
  const targetIds = [...titleByTargetId.keys()];
  return db.graphNodes
    .where("attachment.targetId").anyOf(targetIds)
    .modify(node => {
      const baked = (node.attachment && titleByTargetId.get(node.attachment.targetId))
        || "(deleted source)";
      delete node.attachment;
      if (!node.label.trim()) node.label = baked;
      node.updatedAt = Date.now();
    });
}

/** Collect a node and all its descendants in a chat into an id set. */
function collectSubtreeIds(nodes: Node[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const arr = childrenByParent.get(n.parentId) ?? [];
    arr.push(n._id);
    childrenByParent.set(n.parentId, arr);
  }
  const out = new Set<string>();
  const walk = (id: string): void => {
    if (out.has(id)) return;
    out.add(id);
    const kids = childrenByParent.get(id) ?? [];
    for (const k of kids) walk(k);
  };
  walk(rootId);
  return out;
}

export interface DeleteSubtreeResult {
  nodesDeleted:    number;
  messagesDeleted: number;
  reflectionsDeleted: number;
  filesDeleted:    number;
  /** Graph nodes that kept living on a canvas but lost their attached data. */
  detachedGraphNodes: number;
  /** The parent node of the deleted subtree, or null when the root was deleted. */
  parentNodeId:    string | null;
}

/**
 * Recursively delete `nodeId` and all of its descendants in `chatId`.
 * Removes all messages, reflections, and orphaned files in one transaction.
 * If the chat's `currentNodeId` lived inside the deleted subtree, the chat
 * is repointed to the parent of `nodeId` (or its root, if parent is null).
 * Does NOT delete the chat itself even when called on the root — callers
 * that want "delete whole chat" semantics should use `deleteChat`.
 */
export async function deleteNodeSubtree(
  chatId: string,
  nodeId: string,
): Promise<DeleteSubtreeResult> {
  return db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files, db.graphNodes],
    async () => {
      const chat = await db.chats.get(chatId);
      if (!chat) {
        return {
          nodesDeleted: 0, messagesDeleted: 0, reflectionsDeleted: 0,
          filesDeleted: 0, detachedGraphNodes: 0, parentNodeId: null,
        };
      }
      const target = await db.nodes.get(nodeId);
      if (!target || target.chatId !== chatId) {
        return {
          nodesDeleted: 0, messagesDeleted: 0, reflectionsDeleted: 0,
          filesDeleted: 0, detachedGraphNodes: 0, parentNodeId: null,
        };
      }

      const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
      const doomedIds = collectSubtreeIds(allNodes, nodeId);
      const doomedArr = [...doomedIds];

      // Abort any in-flight streams for nodes about to be wiped. Done
      // inside the transaction (right after we know the doomed set) so
      // the cascade-delete is atomic w.r.t. the stream-state cleanup
      // that follows when StreamsProvider sees the abort.
      abortNodes(doomedArr);

      // Collect file ids that *would* be orphaned by removing these messages.
      const doomedMessages = await db.messages
        .where("nodeId").anyOf(doomedArr)
        .toArray();
      const candidateFileIds = new Set<string>();
      for (const m of doomedMessages) {
        if (m.fileIds) for (const f of m.fileIds) candidateFileIds.add(f);
      }

      // Survivors: messages in this chat whose node is NOT in the doomed set,
      // plus all messages in OTHER chats (cross-chat file reuse via import is
      // possible). We only need to know which files they reference.
      const stillUsedFileIds = new Set<string>();
      if (candidateFileIds.size > 0) {
        const allMsgs = await db.messages.toArray();
        for (const m of allMsgs) {
          if (m.chatId === chatId && doomedIds.has(m.nodeId)) continue;
          if (!m.fileIds) continue;
          for (const f of m.fileIds) {
            if (candidateFileIds.has(f)) stillUsedFileIds.add(f);
          }
        }
      }
      const orphanFileIds = [...candidateFileIds].filter(f => !stillUsedFileIds.has(f));

      // Reflections by node id.
      const doomedReflections = await db.reflections
        .where("nodeId").anyOf(doomedArr)
        .toArray();

      await db.messages.where("nodeId").anyOf(doomedArr).delete();
      await db.reflections.where("nodeId").anyOf(doomedArr).delete();
      await db.nodes.bulkDelete(doomedArr);
      if (orphanFileIds.length > 0) await db.files.bulkDelete(orphanFileIds);
      // Graph nodes that held these branches/reflections as data keep
      // living on their canvases — detached, titles baked in.
      const nodeLabelById = new Map(allNodes.map(n => [n._id, n.label]));
      const detachTitles = new Map<string, string>();
      for (const id of doomedArr) {
        detachTitles.set(id, nodeLabelById.get(id) || "(deleted branch)");
      }
      for (const r of doomedReflections) {
        detachTitles.set(r._id, r.title || "(deleted reflection)");
      }
      const detachedGraphNodes = await detachAttachmentsByTargets(detachTitles);

      // Repoint currentNodeId if it was inside the deleted subtree.
      const parentNodeId: string | null = target.parentId;
      if (doomedIds.has(chat.currentNodeId)) {
        const repoint = parentNodeId ?? chat.rootNodeId;
        // If we also deleted the root (shouldn't happen via this helper —
        // deleteChat handles that — but defensively check), fall back to
        // any surviving node.
        if (doomedIds.has(repoint)) {
          const survivor = allNodes.find(n => !doomedIds.has(n._id));
          if (survivor) {
            await db.chats.update(chatId, {
              currentNodeId: survivor._id,
              updatedAt:     Date.now(),
            });
          }
        } else {
          await db.chats.update(chatId, {
            currentNodeId: repoint,
            updatedAt:     Date.now(),
          });
        }
      } else {
        await db.chats.update(chatId, { updatedAt: Date.now() });
      }

      return {
        nodesDeleted:       doomedArr.length,
        messagesDeleted:    doomedMessages.length,
        reflectionsDeleted: doomedReflections.length,
        filesDeleted:       orphanFileIds.length,
        detachedGraphNodes,
        parentNodeId,
      };
    },
  );
}

/** Delete one reflection; graph nodes that held it as data are detached
 *  (the reflection's title is read BEFORE deleting so it can be baked in). */
export async function deleteReflection(reflectionId: string): Promise<void> {
  await db.transaction("rw", db.reflections, db.graphNodes, async () => {
    const refl = await db.reflections.get(reflectionId);
    await db.reflections.delete(reflectionId);
    await detachAttachmentsByTargets(new Map([
      [reflectionId, refl?.title || "(deleted reflection)"],
    ]));
  });
}

export interface DeleteChatResult {
  nodesDeleted:    number;
  messagesDeleted: number;
  reflectionsDeleted: number;
  filesDeleted:    number;
  /** Graph nodes that kept living on a canvas but lost their attached data. */
  detachedGraphNodes: number;
}

/**
 * Delete an entire chat: its row, every node, every message, every
 * reflection, and any files orphaned by the removal. Single transaction.
 */
export async function deleteChat(chatId: string): Promise<DeleteChatResult> {
  return db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files, db.graphNodes],
    async () => {
      const chat = await db.chats.get(chatId);
      if (!chat) {
        return {
          nodesDeleted: 0, messagesDeleted: 0, reflectionsDeleted: 0,
          filesDeleted: 0, detachedGraphNodes: 0,
        };
      }

      const nodes = await db.nodes.where("chatId").equals(chatId).toArray();
      // Abort any in-flight streams for nodes in this chat before we
      // delete their backing records.
      abortNodes(nodes.map(n => n._id));
      const messages = await db.messages.where("chatId").equals(chatId).toArray();
      const reflections = await db.reflections.where("chatId").equals(chatId).toArray();

      const candidateFileIds = new Set<string>();
      for (const m of messages) {
        if (m.fileIds) for (const f of m.fileIds) candidateFileIds.add(f);
      }
      const stillUsedFileIds = new Set<string>();
      if (candidateFileIds.size > 0) {
        const otherMsgs = await db.messages.where("chatId").notEqual(chatId).toArray();
        for (const m of otherMsgs) {
          if (!m.fileIds) continue;
          for (const f of m.fileIds) {
            if (candidateFileIds.has(f)) stillUsedFileIds.add(f);
          }
        }
      }
      const orphanFileIds = [...candidateFileIds].filter(f => !stillUsedFileIds.has(f));

      await db.messages.where("chatId").equals(chatId).delete();
      await db.reflections.where("chatId").equals(chatId).delete();
      await db.nodes.where("chatId").equals(chatId).delete();
      await db.chats.delete(chatId);
      if (orphanFileIds.length > 0) await db.files.bulkDelete(orphanFileIds);
      // Graph nodes that held this chat, its branches, or its reflections
      // as data keep living on their canvases — detached, titles baked in.
      const detachTitles = new Map<string, string>();
      detachTitles.set(chatId, chat.title || "(deleted chat)");
      for (const n of nodes) detachTitles.set(n._id, n.label || "(deleted branch)");
      for (const r of reflections) detachTitles.set(r._id, r.title || "(deleted reflection)");
      const detachedGraphNodes = await detachAttachmentsByTargets(detachTitles);

      return {
        nodesDeleted:       nodes.length,
        messagesDeleted:    messages.length,
        reflectionsDeleted: reflections.length,
        filesDeleted:       orphanFileIds.length,
        detachedGraphNodes,
      };
    },
  );
}
