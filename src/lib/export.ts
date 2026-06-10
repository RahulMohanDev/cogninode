// src/lib/export.ts
import {
  db, newId,
  type Chat, type Concept, type ConceptEdge, type ConceptLink,
  type GraphSource, type KnowledgeGraph, type Message, type Node,
  type Reflection, type StoredFile,
} from "./db";

// v2 added knowledge graphs (concepts/edges/conceptLinks); v3 replaces
// conceptLinks with canvas source nodes (graphSources). Older backups
// import fine: v1 has no graph fields, v2 conceptLinks are converted to
// sources + edges on the way in.
export const EXPORT_VERSION = 3;

export interface ExportPayload {
  version:     number;
  exportedAt:  number;
  chats:       Chat[];
  nodes:       Node[];
  messages:    Message[];
  reflections: Reflection[];
  files:       StoredFile[];
  graphs?:       KnowledgeGraph[];
  concepts?:     Concept[];
  conceptEdges?: ConceptEdge[];
  graphSources?: GraphSource[];
  /** v2 backups only — converted to graphSources + edges on import. */
  conceptLinks?: ConceptLink[];
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
    graphs:       await db.graphs.toArray(),
    concepts:     await db.concepts.toArray(),
    conceptEdges: await db.conceptEdges.toArray(),
    graphSources: await db.graphSources.toArray(),
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
  chatsAdded:  number;
  skipped:     number;
  graphsAdded: number;
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

  // Knowledge graphs merge the same way chats do: graphs whose id already
  // exists are skipped wholesale; concepts/edges/links come along only
  // with their (new) graph. Links pointing at chats/reflections that
  // don't make it across are tolerated by the UI, not filtered here.
  const existingGraphIds = new Set(await db.graphs.toCollection().primaryKeys());
  const newGraphs   = (payload.graphs ?? []).filter(g => !existingGraphIds.has(g._id));
  const newGraphIds = new Set(newGraphs.map(g => g._id));
  const newConcepts = (payload.concepts ?? []).filter(c => newGraphIds.has(c.graphId));
  const newEdges    = (payload.conceptEdges ?? []).filter(e => newGraphIds.has(e.graphId));
  const newSources  = (payload.graphSources ?? []).filter(s => newGraphIds.has(s.graphId));

  // v2 backups: convert conceptLinks → one source per (graph, target) +
  // an edge per linking concept, mirroring the schema-v5 migration.
  const v2Links = (payload.conceptLinks ?? []).filter(l => newGraphIds.has(l.graphId));
  if (v2Links.length > 0) {
    const conceptById = new Map(newConcepts.map(c => [c._id, c]));
    const sourceIdByKey = new Map<string, string>();
    let spread = 0;
    for (const l of v2Links) {
      const key = `${l.graphId}:${l.targetId}`;
      let sourceId = sourceIdByKey.get(key);
      if (!sourceId) {
        sourceId = newId();
        sourceIdByKey.set(key, sourceId);
        const c = conceptById.get(l.conceptId);
        newSources.push({
          _id:        sourceId,
          graphId:    l.graphId,
          targetType: l.targetType,
          targetId:   l.targetId,
          x:          (c?.x ?? 0) + 260,
          y:          (c?.y ?? 0) + 40 + (spread++ % 4) * 90,
          createdAt:  l.createdAt ?? Date.now(),
        });
      }
      newEdges.push({ _id: newId(), graphId: l.graphId, source: l.conceptId, target: sourceId });
    }
  }

  await db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files,
     db.graphs, db.concepts, db.conceptEdges, db.graphSources],
    async () => {
      await db.chats.bulkAdd(newChats);
      await db.nodes.bulkAdd(newNodes);
      await db.messages.bulkAdd(newMessages);
      await db.reflections.bulkAdd(newReflections);
      await db.files.bulkAdd(newFiles);
      await db.graphs.bulkAdd(newGraphs);
      await db.concepts.bulkAdd(newConcepts);
      await db.conceptEdges.bulkAdd(newEdges);
      await db.graphSources.bulkAdd(newSources);
    }
  );

  return {
    chatsAdded:  newChats.length,
    skipped:     payload.chats.length - newChats.length,
    graphsAdded: newGraphs.length,
  };
}