// src/lib/graphrag/corpus.test.ts
import { describe, it, expect } from "vitest";
import { buildCorpus, type CorpusSourceData } from "./corpus";
import type {
  Chat, GraphEdge, GraphNode, Message, Node as DbNode, Reflection,
} from "../db";

// Chat c1: n1 (root) → n2 → n3, one message per node.
const chat: Chat = {
  _id: "c1", title: "Java chat", rootNodeId: "n1", currentNodeId: "n3",
  createdAt: 0, updatedAt: 0,
};
const chatNode = (id: string, parentId: string | null, depth: number): DbNode =>
  ({ _id: id, chatId: "c1", parentId, depth, label: `branch ${id}`, createdAt: depth });
const msg = (id: string, nodeId: string): Message => ({
  _id: id, nodeId, chatId: "c1", role: "user", content: `content of ${id}`, createdAt: 0,
});
const refl: Reflection = {
  _id: "r1", chatId: "c1", nodeId: "n2", title: "PECS rule", body: "producer extends…", updatedAt: 0,
};

const gnode = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  _id: id, graphId: "g1", kind: "node", label: "", notes: "", color: "teal",
  x: 0, y: 0, createdAt: 0, updatedAt: 0, ...over,
});
const edge = (id: string, s: string, t: string): GraphEdge =>
  ({ _id: id, graphId: "g1", source: s, target: t });

function makeData(graphNodes: GraphNode[], graphEdges: GraphEdge[]): CorpusSourceData {
  return {
    graph: { _id: "g1", name: "Root", rootNodeId: "R", createdAt: 0, updatedAt: 0 },
    graphNodes, graphEdges,
    chats: [chat],
    chatNodes: [chatNode("n1", null, 0), chatNode("n2", "n1", 1), chatNode("n3", "n2", 2)],
    messages: [msg("m1", "n1"), msg("m2", "n2"), msg("m3", "n3")],
    reflections: [refl],
  };
}

// The canonical fixture:
//   R(root, "Root") ── A(chat c1) ── B(branch n2 subtree, "Generics") ── F(reflection r1)
//   R ── E(plain node with notes)
//   C(branch n3, single) is DISCONNECTED.
const NODES = [
  gnode("R", { kind: "root", label: "Root", createdAt: 0 }),
  gnode("A", { attachment: { type: "chat", targetId: "c1" }, createdAt: 1 }),
  gnode("B", { label: "Generics", attachment: { type: "node", targetId: "n2", scope: "subtree" }, createdAt: 2 }),
  gnode("F", { attachment: { type: "reflection", targetId: "r1" }, createdAt: 3 }),
  gnode("E", { label: "Key idea", notes: "important context", createdAt: 4 }),
  gnode("C", { label: "C", attachment: { type: "node", targetId: "n3", scope: "single" }, createdAt: 5 }),
];
const EDGES = [
  edge("e1", "R", "A"),
  edge("e2", "A", "B"),
  edge("e3", "B", "F"),
  edge("e4", "E", "R"),   // direction irrelevant
];

describe("buildCorpus", () => {
  const corpus = buildCorpus(makeData(NODES, EDGES));

  it("expands attachments into message/reflection docs plus the nodes' own words", () => {
    expect(corpus.docIds).toEqual(new Set([
      "g:R",            // root label
      "g:B", "g:E", "g:C",   // labeled / noted nodes
      "m:m1", "m:m2", "m:m3",
      "r:r1",
    ]));
    // A has neither label nor notes — no g-doc for it.
    expect(corpus.docIds.has("g:A")).toBe(false);
  });

  it("BFS distances from the root; disconnected nodes park past the frontier", () => {
    expect(corpus.distFromRoot.get("R")).toBe(0);
    expect(corpus.distFromRoot.get("A")).toBe(1);
    expect(corpus.distFromRoot.get("E")).toBe(1);
    expect(corpus.distFromRoot.get("B")).toBe(2);
    expect(corpus.distFromRoot.get("F")).toBe(3);
    expect(corpus.distFromRoot.get("C")).toBe(3 + 2);   // maxFinite + 2
  });

  it("overlapping coverage resolves to the owner nearest the root", () => {
    // m2/m3 are covered by A (whole chat, dist 1), B (subtree, dist 2),
    // and C (single, disconnected) — A wins everywhere.
    expect(corpus.docToGraphNode.get("m:m1")).toBe("A");
    expect(corpus.docToGraphNode.get("m:m2")).toBe("A");
    expect(corpus.docToGraphNode.get("m:m3")).toBe("A");
    expect(corpus.docToGraphNode.get("r:r1")).toBe("F");
    expect(corpus.docToGraphNode.get("g:B")).toBe("B");
  });

  it("path labels walk BFS parents using live display titles", () => {
    expect(corpus.pathLabels.get("B")).toEqual(["Root", "Java chat", "Generics"]);
    expect(corpus.pathLabels.get("F")).toEqual(["Root", "Java chat", "Generics", "PECS rule"]);
    expect(corpus.pathLabels.get("C")).toEqual(["C"]);   // disconnected: stands alone
  });

  it("scope governs how much of the chat tree a branch attachment covers", () => {
    const single = buildCorpus(makeData(
      [gnode("R", { kind: "root", label: "Root" }),
       gnode("S", { attachment: { type: "node", targetId: "n2", scope: "single" } })],
      [edge("e1", "R", "S")],
    ));
    expect([...single.docIds].filter(d => d.startsWith("m:"))).toEqual(["m:m2"]);

    const subtree = buildCorpus(makeData(
      [gnode("R", { kind: "root", label: "Root" }),
       gnode("S", { attachment: { type: "node", targetId: "n2", scope: "subtree" } })],
      [edge("e1", "R", "S")],
    ));
    expect(new Set([...subtree.docIds].filter(d => d.startsWith("m:"))))
      .toEqual(new Set(["m:m2", "m:m3"]));
  });

  it("stale attachments contribute nothing — the node's own words remain", () => {
    const corpus2 = buildCorpus(makeData(
      [gnode("R", { kind: "root", label: "Root" }),
       gnode("X", { label: "Ghost holder", attachment: { type: "node", targetId: "gone" } }),
       gnode("Y", { attachment: { type: "reflection", targetId: "gone-too" } })],
      [],
    ));
    expect([...corpus2.docIds].filter(d => d.startsWith("m:"))).toEqual([]);
    expect([...corpus2.docIds].filter(d => d.startsWith("r:"))).toEqual([]);
    expect(corpus2.docIds.has("g:X")).toBe(true);
  });
});
