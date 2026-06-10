// src/lib/flowGraph.test.ts
import { describe, it, expect } from "vitest";
import {
  buildChatFlowGraph, buildConceptFlowGraph, FLOW_X_GAP, FLOW_Y_GAP,
} from "./flowGraph";
import type { Concept, ConceptEdge, ConceptLink, Node as DbNode } from "./db";

const node = (id: string, parentId: string | null, depth: number, label = id): DbNode => ({
  _id: id, chatId: "c1", parentId, depth, label, createdAt: depth,
});

// root → a → a1 ; root → b
const TREE: DbNode[] = [
  node("root", null, 0, "My chat"),
  node("a", "root", 1, "first branch"),
  node("a1", "a", 2, "deeper"),
  node("b", "root", 1, "side track"),
];

describe("buildChatFlowGraph", () => {
  it("maps every node with grid positions from the DFS layout", () => {
    const g = buildChatFlowGraph(TREE, "a1");
    expect(g.nodes).toHaveLength(4);
    const root = g.nodes.find(n => n.id === "root")!;
    expect(root.position.y).toBe(0);
    const a1 = g.nodes.find(n => n.id === "a1")!;
    expect(a1.position.y).toBe(2 * FLOW_Y_GAP);
    expect(a1.position.x % FLOW_X_GAP === 0 || a1.position.x >= 0).toBe(true);
  });

  it("flags the current node and the root→current path", () => {
    const g = buildChatFlowGraph(TREE, "a1");
    const flags = Object.fromEntries(g.nodes.map(n => [n.id, n.data]));
    expect(flags["a1"]!.isCurrent).toBe(true);
    expect(flags["a1"]!.isOnPath).toBe(true);
    expect(flags["a"]!.isOnPath).toBe(true);
    expect(flags["root"]!.isOnPath).toBe(true);
    expect(flags["b"]!.isOnPath).toBe(false);
    expect(flags["b"]!.isCurrent).toBe(false);
  });

  it("animates and colors exactly the path edges", () => {
    const g = buildChatFlowGraph(TREE, "a1");
    const byId = Object.fromEntries(g.edges.map(e => [e.id, e]));
    expect(g.edges).toHaveLength(3);
    expect(byId["root->a"]!.animated).toBe(true);
    expect(byId["a->a1"]!.animated).toBe(true);
    expect(byId["root->b"]!.animated).toBe(false);
    expect(byId["root->a"]!.style.stroke).toBe("var(--coral)");
    expect(byId["root->b"]!.style.stroke).toBe("var(--line)");
  });

  it("caps the depth used for accent colors at 3", () => {
    const deep: DbNode[] = [
      node("r", null, 0),
      node("d1", "r", 1), node("d2", "d1", 2), node("d3", "d2", 3), node("d4", "d3", 4),
    ];
    const g = buildChatFlowGraph(deep, "d4");
    expect(g.nodes.find(n => n.id === "d4")!.data.depth).toBe(3);
  });

  it("falls back to placeholder labels", () => {
    const g = buildChatFlowGraph([node("r", null, 0, ""), node("x", "r", 1, "")], "r");
    expect(g.nodes.find(n => n.id === "r")!.data.label).toBe("root");
    expect(g.nodes.find(n => n.id === "x")!.data.label).toBe("branch L1");
  });
});

describe("buildConceptFlowGraph", () => {
  const concept = (id: string, x = 0, y = 0): Concept => ({
    _id: id, graphId: "g1", label: id, notes: "", color: "teal",
    x, y, createdAt: 0, updatedAt: 0,
  });
  const edge = (id: string, source: string, target: string): ConceptEdge =>
    ({ _id: id, graphId: "g1", source, target });
  const link = (conceptId: string, targetType: "chat" | "reflection"): ConceptLink =>
    ({ _id: `l-${conceptId}-${targetType}-${Math.random()}`, graphId: "g1", conceptId, targetType, targetId: "t", createdAt: 0 });

  it("uses persisted positions and counts attachments per type", () => {
    const g = buildConceptFlowGraph(
      [concept("java", 120, 80), concept("oop")],
      [],
      [link("java", "chat"), link("java", "chat"), link("java", "reflection")],
    );
    const java = g.nodes.find(n => n.id === "java")!;
    expect(java.position).toEqual({ x: 120, y: 80 });
    expect(java.data.chatCount).toBe(2);
    expect(java.data.reflectionCount).toBe(1);
    expect(g.nodes.find(n => n.id === "oop")!.data.chatCount).toBe(0);
  });

  it("drops edges whose endpoints are missing", () => {
    const g = buildConceptFlowGraph(
      [concept("a"), concept("b")],
      [edge("e1", "a", "b"), edge("e2", "a", "ghost")],
      [],
    );
    expect(g.edges.map(e => e.id)).toEqual(["e1"]);
  });
});