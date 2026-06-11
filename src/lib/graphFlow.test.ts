// src/lib/graphFlow.test.ts
import { describe, it, expect } from "vitest";
import {
  buildGraphFlow, displayTitle, planTidyLayout,
  TIDY_X_GAP, TIDY_Y_GAP,
  type SourceResolvers,
} from "./graphFlow";
import type { GraphEdge, GraphNode } from "./db";

const gnode = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  _id: id, graphId: "g1", kind: "node", label: id, notes: "", color: "teal",
  x: 0, y: 0, createdAt: 0, updatedAt: 0, ...over,
});
const edge = (id: string, source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge =>
  ({ _id: id, graphId: "g1", source, target, ...over });

const resolvers: SourceResolvers = {
  chatTitle: id => (id === "c1" ? "Java learning" : undefined),
  nodeInfo: id =>
    id === "n1" ? { label: "generics deep dive", chatId: "c1", chatTitle: "Java learning", isRoot: false }
    : id === "root1" ? { label: "Java learning", chatId: "c1", chatTitle: "Java learning", isRoot: true }
    : undefined,
  reflectionTitle: id => (id === "r1" ? "PECS rule" : undefined),
};

describe("displayTitle", () => {
  it("plain nodes: label, or the untitled fallback", () => {
    expect(displayTitle(gnode("a", { label: "Generics" }), resolvers))
      .toEqual({ title: "Generics", subtitle: "", href: "", stale: false });
    expect(displayTitle(gnode("a", { label: "  " }), resolvers).title).toBe("Untitled node");
  });

  it("a user-set label always wins over the attachment title", () => {
    const n = gnode("a", {
      label: "My name",
      attachment: { type: "chat", targetId: "c1" },
    });
    const d = displayTitle(n, resolvers);
    expect(d.title).toBe("My name");
    expect(d.subtitle).toBe("chat");
    expect(d.href).toBe("/chat/c1");
  });

  it("empty labels derive from the attachment (titles track renames)", () => {
    const d = displayTitle(
      gnode("a", { label: "", attachment: { type: "chat", targetId: "c1" } }),
      resolvers,
    );
    expect(d).toEqual({ title: "Java learning", subtitle: "chat", href: "/chat/c1", stale: false });
  });

  it("branch attachments carry the owning chat in the subtitle + deep link", () => {
    const d = displayTitle(
      gnode("a", { label: "", attachment: { type: "node", targetId: "n1", scope: "subtree" } }),
      resolvers,
    );
    expect(d.title).toBe("generics deep dive");
    expect(d.subtitle).toBe("branch · Java learning");
    expect(d.href).toBe("/chat/c1?node=n1");
  });

  it("displays a chat's root node AS the chat (no wrapper semantics)", () => {
    const d = displayTitle(
      gnode("a", { label: "", attachment: { type: "node", targetId: "root1", scope: "single" } }),
      resolvers,
    );
    expect(d.subtitle).toBe("chat");
    expect(d.title).toBe("Java learning");
    expect(d.href).toBe("/chat/c1");
  });

  it("marks attachments whose targets are gone as stale", () => {
    const d = displayTitle(
      gnode("a", { label: "", attachment: { type: "chat", targetId: "ghost" } }),
      resolvers,
    );
    expect(d.stale).toBe(true);
    expect(d.title).toBe("(deleted chat)");
    expect(d.href).toBe("");
    const r = displayTitle(
      gnode("a", { label: "", attachment: { type: "reflection", targetId: "ghost" } }),
      resolvers,
    );
    expect(r.stale).toBe(true);
  });

  it("resolves reflections", () => {
    const d = displayTitle(
      gnode("a", { label: "", attachment: { type: "reflection", targetId: "r1" } }),
      resolvers,
    );
    expect(d).toEqual({ title: "PECS rule", subtitle: "reflection", href: "/reflections?open=r1", stale: false });
  });
});

describe("buildGraphFlow", () => {
  it("emits one node type; the root is undeletable and everything keeps its position", () => {
    const g = buildGraphFlow(
      [gnode("root", { kind: "root", label: "Java", x: 10, y: 20 }), gnode("a", { x: 120, y: 80 })],
      [],
      resolvers,
    );
    expect(g.nodes.every(n => n.type === "graphNode")).toBe(true);
    const root = g.nodes.find(n => n.id === "root")!;
    expect(root.deletable).toBe(false);
    expect(root.position).toEqual({ x: 10, y: 20 });
    expect(root.data.kind).toBe("root");
    expect(g.nodes.find(n => n.id === "a")!.deletable).toBeUndefined();
  });

  it("computes unfoldability: chats and subtree branches expand, single cards and reflections don't", () => {
    const nodes = [
      gnode("chat",   { label: "", attachment: { type: "chat", targetId: "c1" } }),
      gnode("sub",    { label: "", attachment: { type: "node", targetId: "n1", scope: "subtree" } }),
      gnode("single", { label: "", attachment: { type: "node", targetId: "n1", scope: "single" } }),
      gnode("refl",   { label: "", attachment: { type: "reflection", targetId: "r1" } }),
      gnode("stale",  { label: "", attachment: { type: "chat", targetId: "ghost" } }),
    ];
    const g = buildGraphFlow(nodes, [], resolvers);
    const att = (id: string) => g.nodes.find(n => n.id === id)!.data.attachment!;
    expect(att("chat").unfoldable).toBe(true);
    expect(att("sub").unfoldable).toBe(true);
    expect(att("single").unfoldable).toBe(false);
    expect(att("refl").unfoldable).toBe(false);
    expect(att("stale").unfoldable).toBe(false);   // nothing to unfold when the chat is gone
  });

  it("lights up exactly the glow set", () => {
    const g = buildGraphFlow(
      [gnode("a"), gnode("b")],
      [],
      resolvers,
      { glowIds: new Set(["b"]) },
    );
    expect(g.nodes.find(n => n.id === "a")!.data.glow).toBe(false);
    expect(g.nodes.find(n => n.id === "b")!.data.glow).toBe(true);
  });

  it("dashes only lineage edges, carries labels, drops missing endpoints", () => {
    const g = buildGraphFlow(
      [gnode("a"), gnode("b")],
      [
        edge("e1", "a", "b", { kind: "lineage" }),
        edge("e2", "a", "b", { label: "depends on" }),
        edge("e3", "a", "ghost"),
      ],
      resolvers,
    );
    expect(g.edges.map(e => e.id).sort()).toEqual(["e1", "e2"]);
    expect(g.edges.find(e => e.id === "e1")!.style.strokeDasharray).toBe("6 4");
    expect(g.edges.find(e => e.id === "e2")!.style.strokeDasharray).toBeUndefined();
    expect(g.edges.find(e => e.id === "e2")!.label).toBe("depends on");
  });
});

describe("planTidyLayout", () => {
  // root R at (100, 50); A and B hang off R; C hangs off A; D–E are a
  // disconnected island.
  const NODES = [
    gnode("R", { kind: "root", x: 100, y: 50 }),
    gnode("A", { x: 0,  y: 999, createdAt: 1 }),
    gnode("B", { x: 10, y: 999, createdAt: 2 }),
    gnode("C", { x: 5,  y: 999, createdAt: 3 }),
    gnode("D", { x: 700, y: 0, createdAt: 4 }),
    gnode("E", { x: 800, y: 0, createdAt: 5 }),
  ];
  const EDGES = [
    edge("e1", "R", "A"),
    edge("e2", "B", "R"),     // direction is irrelevant — the map is undirected
    edge("e3", "A", "C"),
    edge("e4", "D", "E"),
  ];

  it("anchors the root at its current position and stacks BFS depths below", () => {
    const plan = planTidyLayout(NODES, EDGES, "R");
    const at = (id: string) => plan.find(p => p.id === id)!;
    expect(at("R")).toMatchObject({ x: 100, y: 50 });
    expect(at("A").y).toBe(50 + TIDY_Y_GAP);
    expect(at("B").y).toBe(50 + TIDY_Y_GAP);
    expect(at("C").y).toBe(50 + 2 * TIDY_Y_GAP);
    // Siblings keep the user's left-to-right order (A.x < B.x) and spread.
    expect(at("A").x).toBeLessThan(at("B").x);
    expect(Math.abs(at("B").x - at("C").x)).toBe(TIDY_X_GAP);
  });

  it("stacks disconnected islands below the main tree, as their own trees", () => {
    const plan = planTidyLayout(NODES, EDGES, "R");
    const at = (id: string) => plan.find(p => p.id === id)!;
    const mainMaxY = Math.max(at("R").y, at("A").y, at("B").y, at("C").y);
    expect(at("D").y).toBeGreaterThan(mainMaxY);     // island starts below
    expect(at("E").y).toBe(at("D").y + TIDY_Y_GAP);  // E hangs under D
    expect(at("D").x).toBe(100);                      // aligned with the root
  });

  it("lays out every node exactly once and bails when the root is missing", () => {
    const plan = planTidyLayout(NODES, EDGES, "R");
    expect(plan.map(p => p.id).sort()).toEqual(["A", "B", "C", "D", "E", "R"]);
    expect(planTidyLayout(NODES, EDGES, "nope")).toEqual([]);
  });
});
