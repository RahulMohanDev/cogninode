// src/lib/search/search.test.ts
import { describe, it, expect } from "vitest";
import { rrfFuse }             from "./fusion";
import { makeSnippet, collapseText } from "./snippets";
import { KeywordIndex }        from "./keywordIndex";
import { topKByDot }           from "./vectorStore";
import {
  textHash, docId, parseDocId, fileChunkDocId, parseFileChunkRawId,
  type SearchDoc,
} from "./docs";

const doc = (id: string, title: string, text: string): SearchDoc => ({
  id, kind: "message", chatId: "c1", nodeId: "n1", title, text, rawId: id.slice(2),
});

describe("rrfFuse", () => {
  it("boosts documents found by both retrievers", () => {
    const fused = rrfFuse([["a", "b", "c"], ["c", "d"]]);
    expect(fused[0]!.id).toBe("c");          // rank 3 + rank 1 beats rank 1 alone
    expect(fused[0]!.sources).toEqual([0, 1]);
  });

  it("preserves within-list order for single-source docs", () => {
    const fused = rrfFuse([["a", "b"], []]);
    expect(fused.map(f => f.id)).toEqual(["a", "b"]);
  });

  it("is deterministic on score ties", () => {
    const fused = rrfFuse([["b"], ["a"]]);
    expect(fused.map(f => f.id)).toEqual(["a", "b"]);   // tie → lexicographic
  });
});

describe("snippets", () => {
  it("collapses code fences and whitespace", () => {
    expect(collapseText("hi\n\n```js\nlet x = 1;\n```\nworld")).toBe("hi [code] world");
  });

  it("windows around the first match and reports highlight ranges", () => {
    const text = `${"x".repeat(300)} the magic keyword appears here ${"y".repeat(300)}`;
    const s = makeSnippet(text, ["keyword"]);
    expect(s.text).toContain("keyword");
    expect(s.leading).toBe(true);
    expect(s.trailing).toBe(true);
    const [r] = s.ranges;
    expect(r).toBeDefined();
    expect(s.text.slice(r![0], r![1])).toBe("keyword");
  });

  it("merges overlapping term ranges", () => {
    const s = makeSnippet("foobar foo bar", ["foobar", "foo"]);
    // "foobar" and "foo" overlap at position 0 — one merged range.
    expect(s.ranges[0]).toEqual([0, 6]);
  });

  it("falls back to the opening of the text when no term matches", () => {
    const s = makeSnippet("a perfectly ordinary sentence", ["zzz"]);
    expect(s.text).toBe("a perfectly ordinary sentence");
    expect(s.ranges).toEqual([]);
  });
});

describe("KeywordIndex incremental updates", () => {
  it("finds docs after build, loses them after remove, sees edits after upsert", () => {
    const idx = new KeywordIndex();
    idx.build([
      doc("m:1", "", "rust borrow checker lifetimes"),
      doc("m:2", "", "java garbage collector tuning"),
    ]);
    expect(idx.search("borrow")[0]!.id).toBe("m:1");

    idx.remove("m:1");
    expect(idx.search("borrow")).toHaveLength(0);

    idx.upsert(doc("m:2", "", "kotlin coroutines structured concurrency"));
    expect(idx.search("garbage")).toHaveLength(0);
    expect(idx.search("coroutines")[0]!.id).toBe("m:2");
    expect(idx.size).toBe(1);
  });

  it("boosts title matches over body matches", () => {
    const idx = new KeywordIndex();
    idx.build([
      doc("r:1", "Java memory model", "notes about other things"),
      doc("m:1", "", "java mentioned in passing in a long message about java"),
    ]);
    expect(idx.search("java")[0]!.id).toBe("r:1");
  });
});

describe("topKByDot", () => {
  const v = (...xs: number[]) => new Float32Array(xs);
  it("returns the k best by dot product, descending", () => {
    const rows = [
      { id: "a", vector: v(1, 0) },
      { id: "b", vector: v(0.9, 0.1) },
      { id: "c", vector: v(0, 1) },
      { id: "d", vector: v(-1, 0) },
    ];
    const hits = topKByDot(v(1, 0), rows, 2);
    expect(hits.map(h => h.id)).toEqual(["a", "b"]);
    expect(hits[0]!.score).toBeCloseTo(1);
  });

  it("skips dimension mismatches", () => {
    const hits = topKByDot(v(1, 0), [{ id: "bad", vector: v(1, 0, 0) }], 5);
    expect(hits).toHaveLength(0);
  });
});

describe("doc ids", () => {
  it("round-trips through docId/parseDocId", () => {
    for (const kind of ["message", "reflection", "node", "chat"] as const) {
      const id = docId(kind, "abc-123");
      expect(parseDocId(id)).toEqual({ kind, rawId: "abc-123" });
    }
    expect(parseDocId("zz:nope")).toBeNull();
  });

  it("round-trips fileChunk ids with the #index suffix", () => {
    const id = fileChunkDocId("file-9f2", 3);
    expect(id).toBe("f:file-9f2#3");
    expect(parseDocId(id)).toEqual({ kind: "fileChunk", rawId: "file-9f2#3" });
    expect(parseFileChunkRawId("file-9f2#3")).toEqual({ fileId: "file-9f2", chunkIndex: 3 });
  });

  it("parseFileChunkRawId rejects malformed raw ids", () => {
    expect(parseFileChunkRawId("no-hash")).toBeNull();
    expect(parseFileChunkRawId("#3")).toBeNull();          // empty file id
    expect(parseFileChunkRawId("file-1#")).toBeNull();     // empty index
    expect(parseFileChunkRawId("file-1#x")).toBeNull();    // non-numeric
    expect(parseFileChunkRawId("file-1#-2")).toBeNull();   // negative
    expect(parseFileChunkRawId("file-1#1.5")).toBeNull();  // fractional
  });

  it("textHash is stable and content-sensitive", () => {
    expect(textHash("hello")).toBe(textHash("hello"));
    expect(textHash("hello")).not.toBe(textHash("hello!"));
  });
});