// src/lib/graphMigration.test.ts
import { describe, it, expect } from "vitest";
import { migrateGraphsToV6 } from "./graphMigration";
import type { Concept, ConceptEdge, GraphSource } from "./db";

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
  _id: id, graphId: "g1", label: id, notes: "", color: "lilac",
  x: 0, y: 0, createdAt: 10, updatedAt: 20, ...over,
});
const source = (
  id: string,
  targetType: GraphSource["targetType"],
  over: Partial<GraphSource> = {},
): GraphSource => ({
  _id: id, graphId: "g1", targetType, targetId: `t-${id}`,
  x: 0, y: 0, createdAt: 30, ...over,
});
const edge = (id: string, s: string, t: string, over: Partial<ConceptEdge> = {}): ConceptEdge =>
  ({ _id: id, graphId: "g1", source: s, target: t, ...over });

function makeIdGen(): () => string {
  let i = 0;
  return () => `new-${++i}`;
}

describe("migrateGraphsToV6", () => {
  it("concepts become plain nodes with the SAME ids — edges stay valid", () => {
    const out = migrateGraphsToV6({
      graphs: [{ _id: "g1", name: "Java" }],
      concepts: [concept("k1", { label: "JVM", notes: "the runtime", color: "butter", x: 5, y: 7 })],
      sources: [],
      edges: [],
      now: 99, newId: makeIdGen(),
    });
    const k1 = out.graphNodes.find(n => n._id === "k1")!;
    expect(k1).toMatchObject({
      graphId: "g1", kind: "node", label: "JVM", notes: "the runtime",
      color: "butter", x: 5, y: 7, createdAt: 10, updatedAt: 20,
    });
    expect(k1.attachment).toBeUndefined();
  });

  it("sources become attached nodes; pre-v6 unfolded cards keep their per-branch meaning (scope single)", () => {
    const out = migrateGraphsToV6({
      graphs: [{ _id: "g1", name: "Java" }],
      concepts: [],
      sources: [
        source("s1", "chat",       { targetId: "chat-1" }),
        source("s2", "node",       { targetId: "branch-1" }),
        source("s3", "reflection", { targetId: "refl-1" }),
      ],
      edges: [],
      now: 99, newId: makeIdGen(),
    });
    const byId = new Map(out.graphNodes.map(n => [n._id, n]));
    expect(byId.get("s1")!.attachment).toEqual({ type: "chat", targetId: "chat-1" });
    expect(byId.get("s2")!.attachment).toEqual({ type: "node", targetId: "branch-1", scope: "single" });
    expect(byId.get("s3")!.attachment).toEqual({ type: "reflection", targetId: "refl-1" });
    // label "" ⇒ display derives from the attachment, tracking renames.
    expect(byId.get("s1")!.label).toBe("");
  });

  it("edges copy verbatim — ids, endpoints, labels, lineage kind", () => {
    const out = migrateGraphsToV6({
      graphs: [{ _id: "g1", name: "Java" }],
      concepts: [concept("k1")],
      sources: [source("s1", "chat")],
      edges: [
        edge("e1", "k1", "s1", { label: "covers" }),
        edge("e2", "s1", "k1", { kind: "lineage" }),
      ],
      now: 99, newId: makeIdGen(),
    });
    expect(out.graphEdges).toEqual([
      { _id: "e1", graphId: "g1", source: "k1", target: "s1", label: "covers" },
      { _id: "e2", graphId: "g1", source: "s1", target: "k1", kind: "lineage" },
    ]);
  });

  it("every graph gains a root named after it, centered above the existing bounding box", () => {
    const out = migrateGraphsToV6({
      graphs: [{ _id: "g1", name: "Interview prep Java" }],
      concepts: [concept("k1", { x: 100, y: 300 }), concept("k2", { x: 500, y: 600 })],
      sources: [],
      edges: [],
      now: 99, newId: makeIdGen(),
    });
    const rootId = out.rootIdByGraph.get("g1")!;
    const root = out.graphNodes.find(n => n._id === rootId)!;
    expect(root).toMatchObject({
      kind: "root", label: "Interview prep Java", color: "coral",
      x: 300,            // (100 + 500) / 2
      y: 300 - 240,      // minY - ROOT_LIFT
      createdAt: 99,
    });
  });

  it("empty graphs still get a root, parked at the origin", () => {
    const out = migrateGraphsToV6({
      graphs: [{ _id: "g1", name: "Fresh" }, { _id: "g2", name: "Also fresh" }],
      concepts: [], sources: [], edges: [],
      now: 99, newId: makeIdGen(),
    });
    expect(out.rootIdByGraph.size).toBe(2);
    for (const g of ["g1", "g2"]) {
      const root = out.graphNodes.find(n => n.graphId === g)!;
      expect(root.kind).toBe("root");
      expect(root).toMatchObject({ x: 0, y: 0 });
    }
  });

  it("scopes each root's bounding box to its own graph", () => {
    const out = migrateGraphsToV6({
      graphs: [{ _id: "g1", name: "A" }, { _id: "g2", name: "B" }],
      concepts: [
        concept("k1", { graphId: "g1", x: 0,    y: 0 }),
        concept("k2", { graphId: "g2", x: 9000, y: 9000 }),
      ],
      sources: [], edges: [],
      now: 99, newId: makeIdGen(),
    });
    const r1 = out.graphNodes.find(n => n.graphId === "g1" && n.kind === "root")!;
    const r2 = out.graphNodes.find(n => n.graphId === "g2" && n.kind === "root")!;
    expect(r1.x).toBe(0);
    expect(r2.x).toBe(9000);
  });
});
