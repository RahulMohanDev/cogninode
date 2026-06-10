// src/lib/flowGraph.test.ts
import { describe, it, expect } from "vitest";
import {
  buildChatFlowGraph, buildConceptFlowGraph, planSubtreeSources,
  FLOW_X_GAP, FLOW_Y_GAP, SOURCE_X_GAP, SOURCE_Y_GAP,
} from "./flowGraph";
import type { Concept, ConceptEdge, GraphSource, Node as DbNode } from "./db";

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
  const source = (id: string, targetType: GraphSource["targetType"], targetId: string, x = 0, y = 0): GraphSource =>
    ({ _id: id, graphId: "g1", targetType, targetId, x, y, createdAt: 0 });

  const resolvers = {
    chatTitle: (id: string) => (id === "c1" ? "Java learning" : undefined),
    nodeInfo:  (id: string) =>
      id === "n1" ? { label: "generics deep dive", chatId: "c1", chatTitle: "Java learning", isRoot: false }
      : id === "root1" ? { label: "Java learning", chatId: "c1", chatTitle: "Java learning", isRoot: true }
      : undefined,
    reflectionTitle: (id: string) => (id === "r1" ? "PECS rule" : undefined),
  };

  it("emits concept and source nodes; badges count connected sources by type", () => {
    const g = buildConceptFlowGraph(
      [concept("java", 120, 80)],
      [source("s1", "chat", "c1", 400, 80), source("s2", "node", "n1"), source("s3", "reflection", "r1")],
      [edge("e1", "java", "s1"), edge("e2", "s2", "java"), edge("e3", "java", "s3")],
      resolvers,
    );
    const java = g.nodes.find(n => n.id === "java")!;
    expect(java.position).toEqual({ x: 120, y: 80 });
    expect(java.data.chatCount).toBe(2);          // chat + branch sources
    expect(java.data.reflectionCount).toBe(1);
    const s1 = g.nodes.find(n => n.id === "s1")!;
    expect(s1.type).toBe("source");
    expect(s1.data.title).toBe("Java learning");
    expect((s1.data as { href: string }).href).toBe("/chat/c1");
    const s2 = g.nodes.find(n => n.id === "s2")!;
    expect(s2.data.subtitle).toBe("branch · Java learning");
    expect((s2.data as { href: string }).href).toBe("/chat/c1?node=n1");
    expect(g.edges).toHaveLength(3);
  });

  it("marks sources whose targets are gone as stale", () => {
    const g = buildConceptFlowGraph(
      [],
      [source("s1", "chat", "ghost"), source("s2", "node", "ghost2")],
      [],
      resolvers,
    );
    const s1 = g.nodes.find(n => n.id === "s1")!;
    expect((s1.data as { stale: boolean }).stale).toBe(true);
    expect(s1.data.title).toBe("(deleted chat)");
    expect((g.nodes.find(n => n.id === "s2")!.data as { stale: boolean }).stale).toBe(true);
  });

  it("drops edges whose endpoints are missing", () => {
    const g = buildConceptFlowGraph(
      [concept("a"), concept("b")],
      [],
      [edge("e1", "a", "b"), edge("e2", "a", "ghost")],
      resolvers,
    );
    expect(g.edges.map(e => e.id)).toEqual(["e1"]);
  });

  it("dashes only kind:'lineage' edges — user-drawn edges are equal and solid", () => {
    const g = buildConceptFlowGraph(
      [concept("k1")],
      [source("s1", "chat", "c1"), source("s2", "node", "n1")],
      [
        { ...edge("e1", "s1", "s2"), kind: "lineage" as const },
        edge("e2", "s1", "s2"),       // user-drawn source↔source: solid
        edge("e3", "k1", "s1"),
      ],
      resolvers,
    );
    expect(g.edges.find(e => e.id === "e1")!.style.strokeDasharray).toBe("6 4");
    expect(g.edges.find(e => e.id === "e2")!.style.strokeDasharray).toBeUndefined();
    expect(g.edges.find(e => e.id === "e3")!.style.strokeDasharray).toBeUndefined();
  });

  it("displays a chat's root node AS the chat (no wrapper semantics)", () => {
    const g = buildConceptFlowGraph(
      [],
      [source("s1", "node", "root1")],
      [],
      resolvers,
    );
    const s1 = g.nodes.find(n => n.id === "s1")!;
    expect(s1.data.subtitle).toBe("chat");
    expect(s1.data.title).toBe("Java learning");
    expect((s1.data as { href: string }).href).toBe("/chat/c1");
  });
});

describe("planSubtreeSources", () => {
  // root → a → a1 ; root → b
  const CHAT_NODES: DbNode[] = [
    node("root", null, 0, "What are classes"),
    node("a", "root", 1, "Java"),
    node("a1", "a", 2, "Type erasure"),
    node("b", "root", 1, "Metaclasses"),
  ];

  it("chat drop: roots at the ROOT NODE (no wrapper card); the canvas mirrors the chat", () => {
    const plan = planSubtreeSources("c1", CHAT_NODES, null, { x: 1000, y: 500 });
    expect(plan).toHaveLength(4);
    expect(plan.every(p => p.targetType === "node")).toBe(true);

    const root = plan.find(p => p.targetId === "root")!;
    expect(root.parentTargetId).toBeNull();
    expect(root).toMatchObject({ x: 1000, y: 500 });

    const a = plan.find(p => p.targetId === "a")!;
    expect(a.parentTargetId).toBe("root");
    expect(a.y).toBe(500 + SOURCE_Y_GAP);

    const a1 = plan.find(p => p.targetId === "a1")!;
    expect(a1.parentTargetId).toBe("a");
    expect(a1.y).toBe(500 + 2 * SOURCE_Y_GAP);

    const b = plan.find(p => p.targetId === "b")!;
    expect(Math.abs(b.x - a.x)).toBe(SOURCE_X_GAP); // siblings spread on x
  });

  it("branch drop: plans only that subtree, rooted at origin", () => {
    const plan = planSubtreeSources("c1", CHAT_NODES, "a", { x: 0, y: 0 });
    expect(plan.map(p => p.targetId).sort()).toEqual(["a", "a1"]);
    const a = plan.find(p => p.targetId === "a")!;
    expect(a.targetType).toBe("node");
    expect(a.parentTargetId).toBeNull();
    expect(a).toMatchObject({ x: 0, y: 0 });
    expect(plan.find(p => p.targetId === "a1")!.parentTargetId).toBe("a");
  });

  it("single-node chat plans one root-node card", () => {
    const plan = planSubtreeSources("c1", [node("root", null, 0)], null, { x: 5, y: 5 });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ targetType: "node", targetId: "root", parentTargetId: null });
  });
});