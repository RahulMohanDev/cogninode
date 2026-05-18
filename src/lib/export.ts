// src/lib/export.ts
import { db, type Chat, type Node, type Message, type Reflection, type StoredFile } from "./db";

export const EXPORT_VERSION = 1;

export interface ExportPayload {
  version:     number;
  exportedAt:  number;
  chats:       Chat[];
  nodes:       Node[];
  messages:    Message[];
  reflections: Reflection[];
  files:       StoredFile[];
}

// ── Export ────────────────────────────────────────────────────

export async function exportAllChats(): Promise<void> {
  const payload: ExportPayload = {
    version:     EXPORT_VERSION,
    exportedAt:  Date.now(),
    chats:       await db.chats.toArray(),
    nodes:       await db.nodes.toArray(),
    messages:    await db.messages.toArray(),
    reflections: await db.reflections.toArray(),
    files:       await db.files.toArray(),   // includes base64 images — can be large
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const date = new Date().toISOString().split("T")[0];
  a.href     = url;
  a.download = `cogninode-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Import ────────────────────────────────────────────────────

export async function importFromJson(file: File): Promise<{
  chatsAdded: number;
  skipped:    number;
}> {
  const text = await file.text();
  const payload = JSON.parse(text) as ExportPayload;

  if (!payload.version || payload.version > EXPORT_VERSION) {
    throw new Error(`Unsupported backup version: ${payload.version}`);
  }

  // Find existing IDs to detect conflicts
  const existingChatIds = new Set(await db.chats.toCollection().primaryKeys());

  const newChats = payload.chats.filter(c => !existingChatIds.has(c._id));
  const newChatIds = new Set(newChats.map(c => c._id));

  // Only import data that belongs to new chats (avoid overwriting existing data)
  const newNodes       = payload.nodes.filter(n => newChatIds.has(n.chatId));
  const newMessages    = payload.messages.filter(m => newChatIds.has(m.chatId));
  const newReflections = payload.reflections.filter(r => newChatIds.has(r.chatId));

  // For files: import only those referenced by new messages
  const newFileIds = new Set(
    newMessages.flatMap(m => m.fileIds ?? [])
  );
  const newFiles = (payload.files ?? []).filter(f => newFileIds.has(f._id));

  await db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files],
    async () => {
      await db.chats.bulkAdd(newChats);
      await db.nodes.bulkAdd(newNodes);
      await db.messages.bulkAdd(newMessages);
      await db.reflections.bulkAdd(newReflections);
      await db.files.bulkAdd(newFiles);
    }
  );

  return {
    chatsAdded: newChats.length,
    skipped:    payload.chats.length - newChats.length,
  };
}
