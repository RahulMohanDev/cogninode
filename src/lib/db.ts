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
      // Build content — handle image attachments for multimodal
      if (msg.role === "user" && msg.fileIds?.length) {
        const files = await db.files
          .where("_id").anyOf(msg.fileIds)
          .toArray();

        const parts: unknown[] = [{ type: "text", text: msg.content }];
        for (const file of files) {
          if (file.kind === "image") {
            parts.push({ type: "image_url", image_url: { url: file.content } });
          }
          // PDF and code content was already appended to msg.content during compose
        }
        result.push({ role: "user", content: parts });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
  }

  return result;
}
