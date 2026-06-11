// src/lib/graphrag/prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildGraphContext, GRAPH_CONTEXT_BUDGET_TOKENS } from "./prompt";
import type { GraphCorpus } from "./corpus";
import type { RetrievalResult, RetrievedBlock } from "./retrieve";
import type { GraphNode } from "../db";

const gnode = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  _id: id, graphId: "g1", kind: "node", label: id, notes: "", color: "teal",
  x: 0, y: 0, createdAt: 0, updatedAt: 0, ...over,
});

function corpusStub(): GraphCorpus {
  const root = gnode("R", { kind: "root", label: "Interview Prep Java", notes: "Everything for the loop." });
  const jvm  = gnode("JVM", { label: "JVM", createdAt: 1 });
  const gc   = gnode("GC", { label: "GC tuning", createdAt: 2 });
  return {
    graphId: "g1",
    rootGraphNodeId: "R",
    docIds: new Set(["g:R", "g:JVM", "g:GC", "m:1", "m:2", "m:3"]),
    docToGraphNode: new Map([
      ["g:R", "R"], ["g:JVM", "JVM"], ["g:GC", "GC"],
      ["m:1", "JVM"], ["m:2", "JVM"], ["m:3", "GC"],
    ]),
    distFromRoot: new Map([["R", 0], ["JVM", 1], ["GC", 2]]),
    pathLabels: new Map([
      ["R", ["Interview Prep Java"]],
      ["JVM", ["Interview Prep Java", "JVM"]],
      ["GC", ["Interview Prep Java", "JVM", "GC tuning"]],
    ]),
    parentByNode: new Map([["R", null], ["JVM", "R"], ["GC", "JVM"]]),
    nodesById: new Map([["R", root], ["JVM", jvm], ["GC", gc]]),
    edges: [
      { _id: "e1", graphId: "g1", source: "R", target: "JVM", label: "part of" },
      { _id: "e2", graphId: "g1", source: "JVM", target: "GC" },
    ],
  };
}

const block = (
  docId: string, graphNodeId: string, text: string,
  over: Partial<RetrievedBlock> = {},
): RetrievedBlock => ({
  docId, graphNodeId, kind: "message", title: "", text,
  role: "user", score: 1, ...over,
});

function retrievalStub(blocks: RetrievedBlock[]): RetrievalResult {
  return { query: "how does GC work", blocks, corpus: corpusStub(), semanticUsed: true };
}

describe("buildGraphContext", () => {
  it("anchors on the root, maps the graph, and tags groups [S1..] in rank order", () => {
    const r = retrievalStub([
      block("m:3", "GC",  "use G1 for most services", { role: "assistant" }),
      block("m:1", "JVM", "the JVM loads classes in phases"),
      block("m:2", "JVM", "JIT kicks in after warmup", { role: "assistant" }),
    ]);
    const out = buildGraphContext(r);

    expect(out.text).toContain('answering inside "Interview Prep Java"');
    expect(out.text).toContain("# Root: Interview Prep Java");
    expect(out.text).toContain("Everything for the loop.");
    // Outline: indented labels with edge labels where present.
    expect(out.text).toContain("# Graph map");
    expect(out.text).toContain("- JVM — part of");
    // Excerpt groups: one tag per graph node, path headers, role prefixes.
    expect(out.text).toContain("### [S1] Interview Prep Java › JVM › GC tuning");
    expect(out.text).toContain("### [S2] Interview Prep Java › JVM");
    expect(out.text).toContain("(assistant) use G1 for most services");
    expect(out.text).toContain("(user) the JVM loads classes in phases");
    // Both JVM blocks share the S2 group — no third tag.
    expect(out.text).not.toContain("[S3]");
    expect(out.sources).toEqual([
      { tag: "S1", graphNodeId: "GC" },
      { tag: "S2", graphNodeId: "JVM" },
    ]);
    expect(out.text).toContain("Cite source groups inline like [S1]");
  });

  it("stays inside the budget and never ships a header without content", () => {
    const fat = "x".repeat(3000);
    const r = retrievalStub([
      block("m:1", "JVM", fat),
      block("m:2", "JVM", fat),
      block("m:3", "GC",  fat),
    ]);
    const budgetTokens = 1200;   // tiny: room for ~1 group
    const out = buildGraphContext(r, budgetTokens);
    expect(out.text.length).toBeLessThanOrEqual(budgetTokens * 4);
    // The shipped sources are exactly the groups whose first block fit.
    for (const s of out.sources) {
      expect(out.text).toContain(`[${s.tag}]`);
    }
    expect(out.sources.length).toBeLessThan(2);
    expect(out.tokensEstimated).toBeLessThanOrEqual(budgetTokens);
  });

  it("empty retrieval: scope + map still ship, with the add-sources instruction", () => {
    const out = buildGraphContext(retrievalStub([]));
    expect(out.sources).toEqual([]);
    expect(out.text).not.toContain("# Retrieved context");
    expect(out.text).toContain("# Graph map");
    expect(out.text).toContain("suggest which chats, branches, or notes");
  });

  it("default budget produces a sane estimate", () => {
    const out = buildGraphContext(retrievalStub([block("m:1", "JVM", "short")]));
    expect(out.tokensEstimated).toBeGreaterThan(0);
    expect(out.tokensEstimated).toBeLessThanOrEqual(GRAPH_CONTEXT_BUDGET_TOKENS);
  });

  it("no corpus (graph vanished mid-flight) returns the empty context", () => {
    const out = buildGraphContext({ query: "q", blocks: [], corpus: null, semanticUsed: false });
    expect(out).toEqual({ text: "", sources: [], tokensEstimated: 0 });
  });
});
