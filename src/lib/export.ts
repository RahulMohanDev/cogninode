// src/lib/export.ts
import {
  db, newId,
  type Chat, type Concept, type ConceptEdge, type ConceptLink,
  type GraphEdge, type GraphNode, type GraphSource, type KnowledgeGraph,
  type Message, type Node, type Reflection, type StoredFile,
} from "./db";
import { migrateGraphsToV6 } from "./graphMigration";

// v2 added knowledge graphs (concepts/edges/conceptLinks); v3 replaced
// conceptLinks with canvas source nodes (graphSources); v4 is the unified
// node model (graphNodes + graphEdges + per-graph roots). Older backups
// import fine — v2/v3 graph data runs through the same migrateGraphsToV6
// transform the schema upgrade uses.
export const EXPORT_VERSION = 4;

/** Payload graphs: rootNodeId only exists from v4 on. */
type ExportedGraph = Omit<KnowledgeGraph, "rootNodeId"> & { rootNodeId?: string };

export interface ExportPayload {
  version:     number;
  exportedAt:  number;
  chats:       Chat[];
  nodes:       Node[];
  messages:    Message[];
  reflections: Reflection[];
  files:       StoredFile[];
  graphs?:     ExportedGraph[];
  /** v4+ */
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
  /** v2–v3 backups only — converted to graphNodes + graphEdges on import. */
  concepts?:     Concept[];
  conceptEdges?: ConceptEdge[];
  graphSources?: GraphSource[];
  /** v2 backups only. */
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
    graphs:      await db.graphs.toArray(),
    graphNodes:  await db.graphNodes.toArray(),
    graphEdges:  await db.graphEdges.toArray(),
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

  const newChatsRaw = payload.chats.filter(c => !existingChatIds.has(c._id));
  const newChatIds = new Set(newChatsRaw.map(c => c._id));

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
  // exists are skipped wholesale; nodes/edges come along only with their
  // (new) graph. Attachments pointing at chats/reflections that don't make
  // it across are tolerated by the UI (stale display), not filtered here.
  const existingGraphIds = new Set(await db.graphs.toCollection().primaryKeys());
  const newGraphsRaw = (payload.graphs ?? []).filter(g => !existingGraphIds.has(g._id));
  const newGraphIds  = new Set(newGraphsRaw.map(g => g._id));
  let keptGraphIds = newGraphIds;

  let newGraphs:     KnowledgeGraph[] = [];
  let newGraphNodes: GraphNode[] = [];
  let newGraphEdges: GraphEdge[] = [];

  if (payload.version >= 4) {
    newGraphs     = newGraphsRaw.filter((g): g is KnowledgeGraph => Boolean(g.rootNodeId));
    keptGraphIds  = new Set(newGraphs.map(g => g._id));
    newGraphNodes = (payload.graphNodes ?? []).filter(n => keptGraphIds.has(n.graphId));
    newGraphEdges = (payload.graphEdges ?? []).filter(e => keptGraphIds.has(e.graphId));
  } else if (newGraphsRaw.length > 0) {
    // v2/v3: assemble the legacy rows, then run the SAME transform the
    // schema-v6 upgrade uses — concepts + sources merge into graphNodes,
    // every imported graph gains its root.
    const concepts = (payload.concepts ?? []).filter(c => newGraphIds.has(c.graphId));
    const edges    = (payload.conceptEdges ?? []).filter(e => newGraphIds.has(e.graphId));
    const sources  = (payload.graphSources ?? []).filter(s => newGraphIds.has(s.graphId));

    // v2 backups: conceptLinks → one source per (graph, target) + an edge
    // per linking concept, mirroring the schema-v5 migration.
    const v2Links = (payload.conceptLinks ?? []).filter(l => newGraphIds.has(l.graphId));
    if (v2Links.length > 0) {
      const conceptById = new Map(concepts.map(c => [c._id, c]));
      const sourceIdByKey = new Map<string, string>();
      let spread = 0;
      for (const l of v2Links) {
        const key = `${l.graphId}:${l.targetId}`;
        let sourceId = sourceIdByKey.get(key);
        if (!sourceId) {
          sourceId = newId();
          sourceIdByKey.set(key, sourceId);
          const c = conceptById.get(l.conceptId);
          sources.push({
            _id:        sourceId,
            graphId:    l.graphId,
            targetType: l.targetType,
            targetId:   l.targetId,
            x:          (c?.x ?? 0) + 260,
            y:          (c?.y ?? 0) + 40 + (spread++ % 4) * 90,
            createdAt:  l.createdAt ?? Date.now(),
          });
        }
        edges.push({ _id: newId(), graphId: l.graphId, source: l.conceptId, target: sourceId });
      }
    }

    const out = migrateGraphsToV6({
      graphs: newGraphsRaw.map(g => ({ _id: g._id, name: g.name })),
      concepts, sources, edges,
      now: Date.now(), newId,
    });
    newGraphNodes = out.graphNodes;
    newGraphEdges = out.graphEdges;
    newGraphs = newGraphsRaw.map(g => ({
      _id: g._id, name: g.name,
      rootNodeId: out.rootIdByGraph.get(g._id)!,
      createdAt: g.createdAt, updatedAt: g.updatedAt,
    }));
  }

  // Dock-chat links only survive when their graph comes along too — a
  // graphId pointing at a skipped/missing graph would hide the chat
  // everywhere with no editor to surface it.
  const newChats = newChatsRaw.map(c => {
    if (!c.graphId || keptGraphIds.has(c.graphId)) return c;
    const { graphId: _dropped, ...rest } = c;
    return rest as Chat;
  });

  await db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files,
     db.graphs, db.graphNodes, db.graphEdges],
    async () => {
      await db.chats.bulkAdd(newChats);
      await db.nodes.bulkAdd(newNodes);
      await db.messages.bulkAdd(newMessages);
      await db.reflections.bulkAdd(newReflections);
      await db.files.bulkAdd(newFiles);
      await db.graphs.bulkAdd(newGraphs);
      await db.graphNodes.bulkAdd(newGraphNodes);
      await db.graphEdges.bulkAdd(newGraphEdges);
    }
  );

  return {
    chatsAdded:  newChats.length,
    skipped:     payload.chats.length - newChats.length,
    graphsAdded: newGraphs.length,
  };
}
