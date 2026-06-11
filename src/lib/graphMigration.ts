// src/lib/graphMigration.ts
// Pure v5 → v6 transform for the knowledge-graph rework: concepts and
// graphSources merge into one unified graphNodes table, every graph gains
// a root node, and conceptEdges copy over as graphEdges. Pure function —
// the Dexie upgrade (db.ts) and the backup importer (export.ts) both run
// their rows through here, and tests exercise it without IndexedDB.

import type {
  Concept, ConceptEdge, GraphEdge, GraphNode, GraphSource,
} from "./db";

export interface V6MigrationInput {
  graphs:   Array<{ _id: string; name: string }>;
  concepts: Concept[];
  sources:  GraphSource[];
  edges:    ConceptEdge[];
  now:      number;
  newId:    () => string;
}

export interface V6MigrationOutput {
  graphNodes:    GraphNode[];
  graphEdges:    GraphEdge[];
  /** graphId → the freshly created root node's id. */
  rootIdByGraph: Map<string, string>;
}

/** Vertical clearance between the new root and the old content's top edge. */
const ROOT_LIFT = 240;

export function migrateGraphsToV6(input: V6MigrationInput): V6MigrationOutput {
  const graphNodes: GraphNode[] = [];

  // Concepts keep their ids — edges referencing them stay valid.
  for (const c of input.concepts) {
    graphNodes.push({
      _id: c._id, graphId: c.graphId, kind: "node",
      label: c.label, notes: c.notes, color: c.color,
      x: c.x, y: c.y,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
    });
  }

  // Sources keep their ids too. label "" = derive the display title from
  // the attachment at render time, so titles keep tracking renames.
  // Pre-v6 unfolded trees were one card per chat-tree node, so scope
  // "single" preserves exactly what each card already meant.
  for (const s of input.sources) {
    graphNodes.push({
      _id: s._id, graphId: s.graphId, kind: "node",
      label: "", notes: "", color: "teal",
      x: s.x, y: s.y,
      attachment: {
        type:     s.targetType,
        targetId: s.targetId,
        ...(s.targetType === "node" ? { scope: "single" as const } : {}),
      },
      createdAt: s.createdAt, updatedAt: s.createdAt,
    });
  }

  // Every graph (including empty ones) gets a root node, centered above
  // the bounding box of whatever the graph already holds.
  const rootIdByGraph = new Map<string, string>();
  for (const g of input.graphs) {
    const mine = graphNodes.filter(n => n.graphId === g._id);
    let x = 0;
    let y = 0;
    if (mine.length > 0) {
      const xs = mine.map(n => n.x);
      const ys = mine.map(n => n.y);
      x = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
      y = Math.round(Math.min(...ys) - ROOT_LIFT);
    }
    const rootId = input.newId();
    rootIdByGraph.set(g._id, rootId);
    graphNodes.push({
      _id: rootId, graphId: g._id, kind: "root",
      label: g.name, notes: "", color: "coral",
      x, y,
      createdAt: input.now, updatedAt: input.now,
    });
  }

  // Edges copy verbatim: ids and endpoints survive unchanged.
  const graphEdges: GraphEdge[] = input.edges.map(e => ({
    _id: e._id, graphId: e.graphId, source: e.source, target: e.target,
    ...(e.label !== undefined ? { label: e.label } : {}),
    ...(e.kind ? { kind: e.kind } : {}),
  }));

  return { graphNodes, graphEdges, rootIdByGraph };
}
