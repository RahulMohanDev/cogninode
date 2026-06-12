// src/lib/searchFileDocs.test.ts
// Integration check (real Dexie via fake-indexeddb): uploaded files become
// per-chunk search docs, images stay out, and loadDoc returns exactly what
// collectAllDocs emitted — the symmetry the embedding backfill's textHash
// diff depends on.

import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "./db";
import { collectAllDocs, loadDoc, parseDocId } from "./search/docs";
import { CHUNK_MAX_CHARS } from "./docrag/chunk";

const para = "Garbage collection in the JVM uses generational heaps. ".repeat(8).trim();
const bigText = Array.from({ length: 12 }, () => para).join("\n\n"); // multi-chunk

beforeAll(async () => {
  await db.files.bulkAdd([
    {
      _id: "f-pdf", name: "jvm-notes.pdf", kind: "pdf", mimeType: "application/pdf",
      sizeBytes: bigText.length, content: bigText, createdAt: 1,
    },
    {
      _id: "f-code", name: "tiny.ts", kind: "code", mimeType: "text/plain",
      sizeBytes: 30, content: "export const x = 1;", createdAt: 2,
    },
    {
      _id: "f-img", name: "photo.png", kind: "image", mimeType: "image/png",
      sizeBytes: 99, content: "data:image/png;base64,AAAA", createdAt: 3,
    },
  ]);
});

describe("file chunk search docs", () => {
  it("collectAllDocs emits chunk docs for non-image files only", async () => {
    const docs = await collectAllDocs();
    const fileDocs = docs.filter(d => d.kind === "fileChunk");

    expect(fileDocs.some(d => d.rawId.startsWith("f-pdf#"))).toBe(true);
    expect(fileDocs.some(d => d.rawId.startsWith("f-code#"))).toBe(true);
    expect(fileDocs.some(d => d.rawId.startsWith("f-img#"))).toBe(false);

    const pdfDocs = fileDocs.filter(d => d.rawId.startsWith("f-pdf#"));
    expect(pdfDocs.length).toBeGreaterThan(1);          // big file → many chunks
    for (const d of pdfDocs) {
      expect(d.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS + 200);
      expect(d.chatId).toBe("");
      expect(d.nodeId).toBe("");
      expect(d.id).toBe(`f:${d.rawId}`);
    }
  });

  it("puts the file name on chunk 0 only", async () => {
    const docs = await collectAllDocs();
    const pdfDocs = docs.filter(d => d.kind === "fileChunk" && d.rawId.startsWith("f-pdf#"));
    expect(pdfDocs.find(d => d.rawId === "f-pdf#0")!.title).toBe("jvm-notes.pdf");
    for (const d of pdfDocs) {
      if (d.rawId !== "f-pdf#0") expect(d.title).toBe("");
    }
  });

  it("loadDoc is exactly symmetric with collectAllDocs", async () => {
    const docs = await collectAllDocs();
    const fileDocs = docs.filter(d => d.kind === "fileChunk");
    for (const d of fileDocs) {
      const parsed = parseDocId(d.id);
      expect(parsed).not.toBeNull();
      const loaded = await loadDoc(parsed!.kind, parsed!.rawId);
      expect(loaded).toEqual(d);
    }
  });

  it("loadDoc returns null for vanished files and out-of-range chunks", async () => {
    expect(await loadDoc("fileChunk", "no-such-file#0")).toBeNull();
    expect(await loadDoc("fileChunk", "f-pdf#9999")).toBeNull();
    expect(await loadDoc("fileChunk", "garbage")).toBeNull();
  });
});
