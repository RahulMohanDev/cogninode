// src/lib/docrag/retrieve.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";
import { rankFileHits, retrieveForFiles, FILE_MAX_EXCERPTS } from "./retrieve";
import { RRF_K } from "../search/fusion";
import { db } from "../db";
import type { KeywordHit } from "../search/keywordIndex";
import type { VectorHit } from "../search/vectorStore";

const kw  = (id: string, score = 1): KeywordHit => ({ id, score, terms: [] });
const sem = (id: string, score = 1): VectorHit  => ({ id, score });

describe("rankFileHits", () => {
  it("keeps only allowed chunk docs — global hits outside the corpus vanish", () => {
    const allowed = new Set(["f:a#0", "f:a#1"]);
    const ranked = rankFileHits(
      [kw("f:a#0"), kw("m:other-message"), kw("f:zz#4")],
      null,
      allowed,
    );
    expect(ranked.map(r => r.docId)).toEqual(["f:a#0"]);
  });

  it("boosts chunks found by both engines", () => {
    const allowed = new Set(["f:a#0", "f:a#1", "f:a#2"]);
    const ranked = rankFileHits(
      [kw("f:a#0"), kw("f:a#1")],
      [sem("f:a#1"), sem("f:a#2")],
      allowed,
    );
    expect(ranked[0]!.docId).toBe("f:a#1");   // rank 2 keyword + rank 1 semantic
  });

  it("degrades to keyword-only when semantic is null", () => {
    const allowed = new Set(["f:a#0", "f:a#1"]);
    const ranked = rankFileHits([kw("f:a#1"), kw("f:a#0")], null, allowed);
    expect(ranked.map(r => r.docId)).toEqual(["f:a#1", "f:a#0"]);
    expect(ranked[0]!.score).toBeCloseTo(1 / (RRF_K + 1));
  });

  it("is deterministic on ties", () => {
    const allowed = new Set(["f:a#0", "f:b#0"]);
    const ranked = rankFileHits([kw("f:b#0")], [sem("f:a#0")], allowed);
    // Equal RRF scores → lexicographic by doc id (fusion's tiebreak).
    expect(ranked.map(r => r.docId)).toEqual(["f:a#0", "f:b#0"]);
  });
});

describe("retrieveForFiles — blank query fallback", () => {
  const para = (label: string, n: number) =>
    Array.from({ length: n }, (_, i) => `Paragraph ${i} of ${label}, with some real length to it.`).join("\n\n");

  beforeAll(async () => {
    // Recent createdAt: initKeyword's orphan sweep must spare these
    // (they're unreferenced by any message, like a just-attached file).
    await db.files.bulkAdd([
      { _id: "rf-doc", name: "long.pdf", kind: "pdf", mimeType: "application/pdf",
        sizeBytes: 1, content: para("long", 200), createdAt: Date.now() },
      { _id: "rf-img", name: "pic.png", kind: "image", mimeType: "image/png",
        sizeBytes: 1, content: "data:image/png;base64,AA", createdAt: Date.now() },
    ]);
  });

  it("surfaces each document's opening chunks when the query is blank", async () => {
    const r = await retrieveForFiles(["rf-doc", "rf-img", "rf-gone"], "   ");
    expect(r.semanticUsed).toBe(false);
    expect(r.matchedQuery).toBe(false);
    expect(r.excerpts.length).toBeGreaterThan(0);
    expect(r.excerpts.length).toBeLessThanOrEqual(FILE_MAX_EXCERPTS);
    expect(r.excerpts[0]).toMatchObject({ fileId: "rf-doc", chunkIndex: 0, fileName: "long.pdf" });
    expect(r.excerpts[0]!.text).toContain("Paragraph 0 of long");
    // Images and vanished files are excluded from corpus and metadata both.
    expect(r.files.map(f => f.fileId)).toEqual(["rf-doc"]);
    expect(r.files[0]!.chunkCount).toBeGreaterThan(1);
  });

  it("falls back to opening chunks when nothing matches a real query", async () => {
    const r = await retrieveForFiles(["rf-doc"], "xylophone quasar nothing-in-doc");
    expect(r.matchedQuery).toBe(false);
    expect(r.excerpts.length).toBeGreaterThan(0);
    expect(r.excerpts[0]).toMatchObject({ fileId: "rf-doc", chunkIndex: 0 });
  });

  it("ranks matching chunks when the query hits the document", async () => {
    const r = await retrieveForFiles(["rf-doc"], "Paragraph 150 of long");
    expect(r.matchedQuery).toBe(true);
    expect(r.excerpts.length).toBeGreaterThan(0);
  });
});
