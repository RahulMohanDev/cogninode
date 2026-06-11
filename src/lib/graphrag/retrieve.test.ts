// src/lib/graphrag/retrieve.test.ts
import { describe, it, expect } from "vitest";
import { rankCorpusHits, PROXIMITY_ALPHA } from "./retrieve";
import { RRF_K } from "../search/fusion";
import type { GraphCorpus } from "./corpus";
import type { KeywordHit } from "../search/keywordIndex";
import type { VectorHit } from "../search/vectorStore";

const kw  = (id: string, score = 1): KeywordHit => ({ id, score, terms: [] });
const sem = (id: string, score = 1): VectorHit  => ({ id, score });

function corpusStub(
  docOwners: Record<string, string>,
  dists:     Record<string, number>,
): GraphCorpus {
  return {
    graphId: "g1",
    rootGraphNodeId: "R",
    docIds: new Set(Object.keys(docOwners)),
    docToGraphNode: new Map(Object.entries(docOwners)),
    distFromRoot: new Map(Object.entries(dists)),
    pathLabels: new Map(),
    parentByNode: new Map(),
    nodesById: new Map(),
    edges: [],
  };
}

describe("rankCorpusHits", () => {
  it("keeps only corpus docs — global hits outside the graph vanish", () => {
    const corpus = corpusStub({ "m:1": "A" }, { A: 0 });
    const ranked = rankCorpusHits([kw("m:other"), kw("m:1")], null, corpus);
    expect(ranked.map(r => r.docId)).toEqual(["m:1"]);
    expect(ranked[0]!.graphNodeId).toBe("A");
  });

  it("re-weights by the owner's distance from the root", () => {
    // m:1 ranks FIRST by keywords but lives far from the root; m:2 ranks
    // second but sits on the root — proximity flips the order.
    const corpus = corpusStub({ "m:1": "FAR", "m:2": "NEAR" }, { FAR: 4, NEAR: 0 });
    const ranked = rankCorpusHits([kw("m:1"), kw("m:2")], null, corpus);
    expect(ranked.map(r => r.docId)).toEqual(["m:2", "m:1"]);

    const near = 1 / (RRF_K + 2);                                 // rank 1 → 1/(60+1+1)
    const far  = (1 / (RRF_K + 1)) / (1 + PROXIMITY_ALPHA * 4);   // rank 0, dist 4
    expect(ranked[0]!.score).toBeCloseTo(near, 10);
    expect(ranked[1]!.score).toBeCloseTo(far, 10);
  });

  it("RRF rewards docs both engines found", () => {
    const corpus = corpusStub({ "m:1": "A", "m:2": "A" }, { A: 0 });
    const ranked = rankCorpusHits(
      [kw("m:1"), kw("m:2")],     // keywords prefer m:1
      [sem("m:2")],               // semantic only saw m:2
      corpus,
    );
    expect(ranked[0]!.docId).toBe("m:2");   // 1/62 + 1/61 beats 1/61
  });

  it("semantic null degrades cleanly to keyword-only ordering", () => {
    const corpus = corpusStub({ "m:1": "A", "m:2": "A" }, { A: 1 });
    const ranked = rankCorpusHits([kw("m:1"), kw("m:2")], null, corpus);
    expect(ranked.map(r => r.docId)).toEqual(["m:1", "m:2"]);
  });
});
