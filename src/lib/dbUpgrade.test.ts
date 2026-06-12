// src/lib/dbUpgrade.test.ts
// Integration check for the REAL Dexie v6 upgrade: seed a v5-shaped
// "cogninode" database (concepts + graphSources + conceptEdges), then let
// the real db module open it and assert the unified-node migration — and
// that the dotted attachment.targetId index actually works in Dexie.

import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(async () => {
  // Recreate the legacy schema exactly as db.ts versions 1–5 declare it.
  const legacy = new Dexie("cogninode");
  legacy.version(1).stores({
    chats:       "_id, updatedAt",
    nodes:       "_id, chatId, parentId",
    messages:    "_id, nodeId, chatId, createdAt",
    reflections: "_id, nodeId, chatId",
    files:       "_id, createdAt",
  });
  legacy.version(2).stores({ models: "_id, vendor", meta: "key" });
  legacy.version(3).stores({ searchVectors: "_id, model, chatId" });
  legacy.version(4).stores({
    graphs:       "_id, updatedAt",
    concepts:     "_id, graphId",
    conceptEdges: "_id, graphId, source, target",
    conceptLinks: "_id, graphId, conceptId, targetId",
  });
  legacy.version(5).stores({
    graphSources: "_id, graphId, targetId",
    conceptLinks: null,
  });
  await legacy.open();

  await legacy.table("graphs").add({ _id: "g1", name: "Java prep", createdAt: 1, updatedAt: 1 });
  await legacy.table("concepts").add({
    _id: "k1", graphId: "g1", label: "JVM", notes: "runtime stuff",
    color: "butter", x: 100, y: 200, createdAt: 1, updatedAt: 2,
  });
  await legacy.table("graphSources").add({
    _id: "s1", graphId: "g1", targetType: "node", targetId: "n9",
    x: 360, y: 200, createdAt: 3,
  });
  await legacy.table("graphSources").add({
    _id: "s2", graphId: "g1", targetType: "chat", targetId: "c7",
    x: 360, y: 340, createdAt: 4,
  });
  await legacy.table("conceptEdges").add({
    _id: "e1", graphId: "g1", source: "k1", target: "s1",
  });
  legacy.close();
});

describe("dexie v6 upgrade (real db module)", () => {
  it("merges concepts + sources into graphNodes, roots the graph, keeps edges", async () => {
    const { db } = await import("./db");
    await db.open();

    // Concept carried over verbatim (same id, no attachment).
    const k1 = await db.graphNodes.get("k1");
    expect(k1).toMatchObject({
      kind: "node", label: "JVM", notes: "runtime stuff",
      color: "butter", x: 100, y: 200,
    });
    expect(k1?.attachment).toBeUndefined();

    // Sources became attached nodes; old per-branch cards stay "single".
    const s1 = await db.graphNodes.get("s1");
    expect(s1?.attachment).toEqual({ type: "node", targetId: "n9", scope: "single" });
    const s2 = await db.graphNodes.get("s2");
    expect(s2?.attachment).toEqual({ type: "chat", targetId: "c7" });
    expect(s2?.label).toBe("");

    // Edge copied verbatim into graphEdges. (v7 backfills the sync layer's
    // `_modifiedAt` stamp onto every synced row — strip it; it's
    // infra-owned and asserted in its own test below.)
    const edges = (await db.graphEdges.toArray()).map(e => {
      const { _modifiedAt, ...rest } = e as typeof e & { _modifiedAt?: number };
      expect(typeof _modifiedAt).toBe("number");
      return rest;
    });
    expect(edges).toEqual([
      { _id: "e1", graphId: "g1", source: "k1", target: "s1" },
    ]);

    // The graph gained its root, named after it, above the old content.
    const graph = await db.graphs.get("g1");
    expect(graph?.rootNodeId).toBeTruthy();
    const root = await db.graphNodes.get(graph!.rootNodeId);
    expect(root).toMatchObject({ kind: "root", label: "Java prep", color: "coral" });
    expect(root!.y).toBeLessThan(200);

    // Legacy tables are gone.
    const tableNames = db.tables.map(t => t.name);
    expect(tableNames).not.toContain("concepts");
    expect(tableNames).not.toContain("conceptEdges");
    expect(tableNames).not.toContain("graphSources");
  });

  it("the dotted attachment.targetId index resolves (cascade-detach depends on it)", async () => {
    const { db } = await import("./db");
    const hits = await db.graphNodes.where("attachment.targetId").anyOf(["n9", "c7"]).toArray();
    expect(hits.map(n => n._id).sort()).toEqual(["s1", "s2"]);
    // Unattached rows are simply absent from the index.
    const none = await db.graphNodes.where("attachment.targetId").equals("k1").count();
    expect(none).toBe(0);
  });

  it("detach via deleteReflection-style modify removes the key and bakes the title", async () => {
    const { db } = await import("./db");
    // Simulate what detachAttachmentsByTargets does on s2.
    await db.graphNodes.where("attachment.targetId").anyOf(["c7"]).modify(node => {
      delete node.attachment;
      if (!node.label.trim()) node.label = "Old chat title";
      node.updatedAt = Date.now();
    });
    const s2 = await db.graphNodes.get("s2");
    expect(s2?.attachment).toBeUndefined();
    expect(s2?.label).toBe("Old chat title");
    // And it left the index.
    expect(await db.graphNodes.where("attachment.targetId").equals("c7").count()).toBe(0);
  });
});
