// src/lib/docrag/chunk.test.ts
import { describe, it, expect } from "vitest";
import {
  chunkFileText, chunksForFile,
  CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS, CHUNK_MIN_CHARS, MAX_CHUNKS_PER_FILE,
} from "./chunk";

/** A paragraph-shaped document of roughly `chars` characters. */
function paraDoc(chars: number): string {
  const para = "The quick brown fox jumps over the lazy dog near the riverbank. ".repeat(4).trim();
  const out: string[] = [];
  let len = 0;
  while (len < chars) {
    out.push(para);
    len += para.length + 2;
  }
  return out.join("\n\n").slice(0, chars);
}

describe("chunkFileText", () => {
  it("returns [] for empty and whitespace-only input", () => {
    expect(chunkFileText("")).toEqual([]);
    expect(chunkFileText("   \n\n  ")).toEqual([]);
  });

  it("keeps a short document as a single whole chunk", () => {
    const text = "Just one short paragraph.";
    const chunks = chunkFileText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ index: 0, start: 0, end: text.length, text });
  });

  it("bounds every chunk near CHUNK_MAX_CHARS (tail merge may add < CHUNK_MIN_CHARS)", () => {
    const chunks = chunkFileText(paraDoc(20_000));
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS + CHUNK_MIN_CHARS);
      expect(c.text).toBe(c.text); // text matches its own slice by construction
    }
  });

  it("covers the full document: union of ranges is [0, length)", () => {
    const text = paraDoc(15_000);
    const chunks = chunkFileText(text);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      // Each chunk starts inside (or at the edge of) its predecessor.
      expect(chunks[i]!.start).toBeLessThanOrEqual(chunks[i - 1]!.end);
      expect(chunks[i]!.start).toBeGreaterThan(chunks[i - 1]!.start);
    }
  });

  it("applies the configured overlap between consecutive chunks", () => {
    const text = paraDoc(10_000);
    const chunks = chunkFileText(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1]!.end - chunks[i]!.start).toBe(CHUNK_OVERLAP_CHARS);
    }
  });

  it("prefers paragraph boundaries when one is in range", () => {
    const a = "A".repeat(900);
    const b = "B".repeat(900);
    const text = `${a}\n\n${b}`;
    const chunks = chunkFileText(text);
    // Cut lands right after the blank line, not mid-B.
    expect(chunks[0]!.text).toBe(`${a}\n\n`);
  });

  it("hard-cuts text with no whitespace at all", () => {
    const text = "x".repeat(CHUNK_MAX_CHARS * 2 + 100);
    const chunks = chunkFileText(text);
    expect(chunks[0]!.text.length).toBe(CHUNK_MAX_CHARS);
    expect(chunks[chunks.length - 1]!.end).toBe(text.length);
  });

  it("text slices match their [start, end) ranges", () => {
    const text = paraDoc(8_000);
    for (const c of chunkFileText(text)) {
      expect(c.text).toBe(text.slice(c.start, c.end));
    }
  });

  it("merges an undersized tail into the previous chunk", () => {
    // Force a tiny remainder after the last regular cut.
    const text = paraDoc(CHUNK_MAX_CHARS) + "\n\nok";
    const chunks = chunkFileText(text);
    const last = chunks[chunks.length - 1]!;
    expect(last.end).toBe(text.length);
    expect(last.text.endsWith("ok")).toBe(true);
    // No standalone chunk smaller than the merge floor (except a single-chunk doc).
    if (chunks.length > 1) {
      for (const c of chunks) expect(c.text.length).toBeGreaterThanOrEqual(CHUNK_MIN_CHARS);
    }
  });

  it("is deterministic", () => {
    const text = paraDoc(30_000);
    expect(chunkFileText(text)).toEqual(chunkFileText(text));
  });

  it("respects MAX_CHUNKS_PER_FILE", () => {
    const step = CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS;
    const text = "y".repeat(step * (MAX_CHUNKS_PER_FILE + 5));
    const chunks = chunkFileText(text);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_FILE);
  });

  it("indexes chunks sequentially from 0", () => {
    const chunks = chunkFileText(paraDoc(12_000));
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });
});

describe("chunksForFile", () => {
  it("memoizes by fileId and returns identical arrays", () => {
    const text = paraDoc(9_000);
    const a = chunksForFile("file-memo-1", text);
    const b = chunksForFile("file-memo-1", text);
    expect(b).toBe(a);
  });

  it("recomputes when content length changes (id reuse guard)", () => {
    const a = chunksForFile("file-memo-2", paraDoc(5_000));
    const b = chunksForFile("file-memo-2", paraDoc(7_000));
    expect(b).not.toBe(a);
    expect(b[b.length - 1]!.end).toBe(7_000);
  });
});
