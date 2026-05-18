// src/lib/db.ts
import Dexie, { type EntityTable } from "dexie";

// ── Local types ────────────────────────────────────────────────

export interface Chat {
  _id:           string;   // crypto.randomUUID()
  title:         string;
  rootNodeId:    string;
  currentNodeId: string;
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

export interface Message {
  _id:          string;
  nodeId:       string;
  chatId:       string;
  role:         "user" | "assistant";
  content:      string;
  modelId?:     string;
  costUsd?:     number;        // actual API cost — stored post-send
  inputTokens?: number;
  outputTokens?: number;
  pathDepth?:   number;        // path length at send time
  quote?:       string;        // text that triggered this branch
  fileIds?:     string[];      // references to files table
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

// ── Dexie database ─────────────────────────────────────────────

export const db = new Dexie("cogninode") as Dexie & {
  chats:       EntityTable<Chat,        "_id">;
  nodes:       EntityTable<Node,        "_id">;
  messages:    EntityTable<Message,     "_id">;
  reflections: EntityTable<Reflection,  "_id">;
  files:       EntityTable<StoredFile,  "_id">;
};

db.version(1).stores({
  chats:       "_id, updatedAt",
  nodes:       "_id, chatId, parentId",
  messages:    "_id, nodeId, chatId, createdAt",
  reflections: "_id, nodeId, chatId",
  files:       "_id, createdAt",
});

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
        // naturally after the attached material), then the user's text.
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
    [db.chats, db.nodes, db.messages, db.reflections, db.files],
    async () => {
      const chat = await db.chats.get(chatId);
      if (!chat) {
        return {
          nodesDeleted: 0, messagesDeleted: 0,
          reflectionsDeleted: 0, filesDeleted: 0, parentNodeId: null,
        };
      }
      const target = await db.nodes.get(nodeId);
      if (!target || target.chatId !== chatId) {
        return {
          nodesDeleted: 0, messagesDeleted: 0,
          reflectionsDeleted: 0, filesDeleted: 0, parentNodeId: null,
        };
      }

      const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
      const doomedIds = collectSubtreeIds(allNodes, nodeId);
      const doomedArr = [...doomedIds];

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
        parentNodeId,
      };
    },
  );
}

export interface DeleteChatResult {
  nodesDeleted:    number;
  messagesDeleted: number;
  reflectionsDeleted: number;
  filesDeleted:    number;
}

/**
 * Delete an entire chat: its row, every node, every message, every
 * reflection, and any files orphaned by the removal. Single transaction.
 */
export async function deleteChat(chatId: string): Promise<DeleteChatResult> {
  return db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files],
    async () => {
      const chat = await db.chats.get(chatId);
      if (!chat) {
        return { nodesDeleted: 0, messagesDeleted: 0, reflectionsDeleted: 0, filesDeleted: 0 };
      }

      const nodes = await db.nodes.where("chatId").equals(chatId).toArray();
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

      return {
        nodesDeleted:       nodes.length,
        messagesDeleted:    messages.length,
        reflectionsDeleted: reflections.length,
        filesDeleted:       orphanFileIds.length,
      };
    },
  );
}
