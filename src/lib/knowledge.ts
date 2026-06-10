// src/lib/knowledge.ts
// CRUD helpers for knowledge graphs. All multi-table mutations run in one
// Dexie transaction so liveQuery observers see single committed states;
// graph.updatedAt is touched on every content change so the /graphs list
// sorts by real activity.

import {
  db, newId,
  type Concept, type ConceptColor, type ConceptEdge, type ConceptLink,
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
    [db.graphs, db.concepts, db.conceptEdges, db.conceptLinks],
    async () => {
      await db.concepts.where("graphId").equals(graphId).delete();
      await db.conceptEdges.where("graphId").equals(graphId).delete();
      await db.conceptLinks.where("graphId").equals(graphId).delete();
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
    [db.concepts, db.conceptEdges, db.conceptLinks, db.graphs],
    async () => {
      await db.conceptEdges.where("source").equals(conceptId).delete();
      await db.conceptEdges.where("target").equals(conceptId).delete();
      await db.conceptLinks.where("conceptId").equals(conceptId).delete();
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
    await db.conceptEdges.add({ _id, graphId, source, target });
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

// ── attachments ────────────────────────────────────────────────

export async function attachToConcept(opts: {
  graphId:    string;
  conceptId:  string;
  targetType: ConceptLink["targetType"];
  targetId:   string;
}): Promise<string> {
  return db.transaction("rw", db.conceptLinks, db.graphs, async () => {
    const existing = await db.conceptLinks
      .where("conceptId").equals(opts.conceptId)
      .filter(l => l.targetType === opts.targetType && l.targetId === opts.targetId)
      .first();
    if (existing) return existing._id;
    const _id = newId();
    await db.conceptLinks.add({
      _id,
      graphId:    opts.graphId,
      conceptId:  opts.conceptId,
      targetType: opts.targetType,
      targetId:   opts.targetId,
      createdAt:  Date.now(),
    });
    await touchGraph(opts.graphId);
    return _id;
  });
}

export async function detachLink(linkId: string): Promise<void> {
  await db.conceptLinks.delete(linkId);
}

/** Spread new concepts on a loose grid so untouched ones never stack. */
export function nextConceptPosition(count: number): { x: number; y: number } {
  return {
    x: 80 + (count % 5) * 250,
    y: 80 + Math.floor(count / 5) * 150,
  };
}

export type { ConceptEdge };