// src/lib/knowledge.ts
// CRUD helpers for knowledge graphs. All multi-table mutations run in one
// Dexie transaction so liveQuery observers see single committed states;
// graph.updatedAt is touched on every content change so the /graphs list
// sorts by real activity.

import {
  db, newId,
  type Concept, type ConceptColor, type ConceptEdge, type GraphSource,
} from "./db";

export const CONCEPT_COLORS: ConceptColor[] = ["coral", "teal", "lilac", "butter"];

const touchGraph = (graphId: string) =>
  db.graphs.update(graphId, { updatedAt: Date.now() });

// ── graphs ─────────────────────────────────────────────────────

export async function createGraph(name = "New graph"): Promise<string> {
  const _id = newId();
  await db.graphs.add({
    _id,
    name:      name.trim() || "New graph",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return _id;
}

export async function renameGraph(graphId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.graphs.update(graphId, { name: trimmed, updatedAt: Date.now() });
}

export async function deleteGraph(graphId: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.graphs, db.concepts, db.conceptEdges, db.graphSources],
    async () => {
      await db.concepts.where("graphId").equals(graphId).delete();
      await db.conceptEdges.where("graphId").equals(graphId).delete();
      await db.graphSources.where("graphId").equals(graphId).delete();
      await db.graphs.delete(graphId);
    },
  );
}

// ── concepts ───────────────────────────────────────────────────

export async function createConcept(
  graphId: string,
  opts: { label?: string; x: number; y: number; color?: ConceptColor },
): Promise<string> {
  const _id = newId();
  await db.transaction("rw", db.concepts, db.graphs, async () => {
    await db.concepts.add({
      _id,
      graphId,
      label:     opts.label?.trim() || "New concept",
      notes:     "",
      color:     opts.color ?? "teal",
      x:         Math.round(opts.x),
      y:         Math.round(opts.y),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await touchGraph(graphId);
  });
  return _id;
}

export async function updateConcept(
  conceptId: string,
  patch: Partial<Pick<Concept, "label" | "notes" | "color">>,
): Promise<void> {
  const concept = await db.concepts.get(conceptId);
  if (!concept) return;
  await db.transaction("rw", db.concepts, db.graphs, async () => {
    await db.concepts.update(conceptId, { ...patch, updatedAt: Date.now() });
    await touchGraph(concept.graphId);
  });
}

export async function moveConcept(conceptId: string, x: number, y: number): Promise<void> {
  await db.concepts.update(conceptId, {
    x: Math.round(x), y: Math.round(y), updatedAt: Date.now(),
  });
}

export async function deleteConcept(conceptId: string): Promise<void> {
  const concept = await db.concepts.get(conceptId);
  if (!concept) return;
  await db.transaction(
    "rw",
    [db.concepts, db.conceptEdges, db.graphs],
    async () => {
      // Edges go; connected source nodes stay on the canvas.
      await db.conceptEdges.where("source").equals(conceptId).delete();
      await db.conceptEdges.where("target").equals(conceptId).delete();
      await db.concepts.delete(conceptId);
      await touchGraph(concept.graphId);
    },
  );
}

// ── edges ──────────────────────────────────────────────────────

/** Connect two concepts. Self-loops and duplicates (either direction —
 *  the map reads as undirected) are ignored; returns the edge id either
 *  way, or null for a rejected self-loop. */
export async function addConceptEdge(
  graphId: string,
  source: string,
  target: string,
  kind?: "lineage",
): Promise<string | null> {
  if (source === target) return null;
  return db.transaction("rw", db.conceptEdges, db.graphs, async () => {
    const existing = await db.conceptEdges
      .where("graphId").equals(graphId)
      .filter(e =>
        (e.source === source && e.target === target) ||
        (e.source === target && e.target === source))
      .first();
    if (existing) return existing._id;
    const _id = newId();
    await db.conceptEdges.add({ _id, graphId, source, target, ...(kind ? { kind } : {}) });
    await touchGraph(graphId);
    return _id;
  });
}

export async function deleteConceptEdge(edgeId: string): Promise<void> {
  const edge = await db.conceptEdges.get(edgeId);
  if (!edge) return;
  await db.transaction("rw", db.conceptEdges, db.graphs, async () => {
    await db.conceptEdges.delete(edgeId);
    await touchGraph(edge.graphId);
  });
}

// ── source nodes (chats / branches / reflections on the canvas) ────────

/** Place a chat/branch/reflection on the canvas. One source per
 *  (graph, target) — re-adding an existing target returns it instead, so
 *  drags from the library never duplicate. */
export async function addSource(
  graphId: string,
  opts: { targetType: GraphSource["targetType"]; targetId: string; x: number; y: number },
): Promise<{ id: string; created: boolean }> {
  return db.transaction("rw", db.graphSources, db.graphs, async () => {
    const existing = await db.graphSources
      .where("targetId").equals(opts.targetId)
      .filter(s => s.graphId === graphId)
      .first();
    if (existing) return { id: existing._id, created: false };
    const _id = newId();
    await db.graphSources.add({
      _id,
      graphId,
      targetType: opts.targetType,
      targetId:   opts.targetId,
      x:          Math.round(opts.x),
      y:          Math.round(opts.y),
      createdAt:  Date.now(),
    });
    await touchGraph(graphId);
    return { id: _id, created: true };
  });
}

export async function moveSource(sourceId: string, x: number, y: number): Promise<void> {
  await db.graphSources.update(sourceId, { x: Math.round(x), y: Math.round(y) });
}

export async function deleteSource(sourceId: string): Promise<void> {
  const source = await db.graphSources.get(sourceId);
  if (!source) return;
  await db.transaction(
    "rw",
    [db.graphSources, db.conceptEdges, db.graphs],
    async () => {
      await db.conceptEdges.where("source").equals(sourceId).delete();
      await db.conceptEdges.where("target").equals(sourceId).delete();
      await db.graphSources.delete(sourceId);
      await touchGraph(source.graphId);
    },
  );
}

/** Classic "attach to concept": ensure a source node exists (placed near
 *  the concept when new) and wire an edge concept↔source. */
export async function attachToConcept(opts: {
  graphId:    string;
  conceptId:  string;
  targetType: GraphSource["targetType"];
  targetId:   string;
}): Promise<void> {
  const concept = await db.concepts.get(opts.conceptId);
  const siblings = await db.conceptEdges
    .where("source").equals(opts.conceptId).count();
  const { id: sourceId } = await addSource(opts.graphId, {
    targetType: opts.targetType,
    targetId:   opts.targetId,
    x: (concept?.x ?? 0) + 260,
    y: (concept?.y ?? 0) + 40 + (siblings % 4) * 90,
  });
  await addConceptEdge(opts.graphId, opts.conceptId, sourceId);
}

/** Persist a planned subtree unfold (see planSubtreeSources): one source
 *  card per item — deduped, existing cards keep their position — plus
 *  lineage edges mirroring parentage. Returns the root card's id and how
 *  many cards were actually new. */
export async function expandSourceTree(
  graphId: string,
  plan: Array<{
    targetType: "chat" | "node";
    targetId:   string;
    x: number;
    y: number;
    parentTargetId: string | null;
  }>,
): Promise<{ rootSourceId: string | null; added: number }> {
  return db.transaction(
    "rw",
    [db.graphSources, db.conceptEdges, db.graphs],
    async () => {
      const sourceIdByTarget = new Map<string, string>();
      let added = 0;
      let rootSourceId: string | null = null;
      for (const item of plan) {
        const { id, created } = await addSource(graphId, item);
        sourceIdByTarget.set(item.targetId, id);
        if (created) added++;
        if (item.parentTargetId === null) rootSourceId = id;
      }
      for (const item of plan) {
        if (!item.parentTargetId) continue;
        const parent = sourceIdByTarget.get(item.parentTargetId);
        const child  = sourceIdByTarget.get(item.targetId);
        if (parent && child) await addConceptEdge(graphId, parent, child, "lineage");
      }
      return { rootSourceId, added };
    },
  );
}

/** Spread new concepts on a loose grid so untouched ones never stack. */
export function nextConceptPosition(count: number): { x: number; y: number } {
  return {
    x: 80 + (count % 5) * 250,
    y: 80 + Math.floor(count / 5) * 150,
  };
}

export type { ConceptEdge };