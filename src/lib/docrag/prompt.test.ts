// src/lib/docrag/prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildFileContext } from "./prompt";
import type { FileExcerpt, FileRetrievalResult } from "./retrieve";

const ex = (fileId: string, chunkIndex: number, fileName: string, text: string, score = 1): FileExcerpt => ({
  docId: `f:${fileId}#${chunkIndex}`, fileId, chunkIndex, fileName, text, score,
});

const result = (
  excerpts: FileExcerpt[],
  files: FileRetrievalResult["files"],
  matchedQuery = true,
): FileRetrievalResult => ({ query: "q", excerpts, files, semanticUsed: true, matchedQuery });

const fileMeta = (fileId: string, name: string, chunkCount = 10) =>
  ({ fileId, name, chars: 50_000, chunkCount });

describe("buildFileContext", () => {
  it("returns empty for no files at all", () => {
    const r = buildFileContext(result([], []));
    expect(r.text).toBe("");
    expect(r.tokensEstimated).toBe(0);
  });

  it("zero hits → explicit no-match block naming the documents", () => {
    const r = buildFileContext(result([], [fileMeta("a", "spec.pdf"), fileMeta("b", "notes.txt")]));
    expect(r.text).toContain("# Attached document excerpts");
    expect(r.text).toContain("spec.pdf");
    expect(r.text).toContain("notes.txt");
    expect(r.text).toContain("No passages in these documents matched");
    expect(r.tokensEstimated).toBeGreaterThan(0);
  });

  it("groups per file in rank order, excerpts in rank order within a group", () => {
    const r = buildFileContext(result(
      [
        ex("b", 7, "second.pdf", "B7 text"),
        ex("a", 4, "first.pdf",  "A4 text"),
        ex("b", 2, "second.pdf", "B2 text"),
      ],
      [fileMeta("a", "first.pdf"), fileMeta("b", "second.pdf")],
    ));
    // Rank order of first appearance: second.pdf group leads.
    expect(r.text.indexOf("## second.pdf")).toBeLessThan(r.text.indexOf("## first.pdf"));
    // Within the group, RANK order (budget cuts the tail — the tail must be
    // the least relevant, not the latest in the document): part 8 first.
    expect(r.text.indexOf("[part 8/10]")).toBeLessThan(r.text.indexOf("[part 3/10]"));
    expect(r.text).toContain("B2 text");
    expect(r.text).toContain("(50000 chars, 10 parts)");
    expect(r.text).toContain("# Instructions");
  });

  it("the budget never evicts the top-ranked excerpt in favor of earlier-in-document ones", () => {
    const filler = (i: number) => ex("a", i, "big.pdf", `filler chunk ${i} ` + "z".repeat(1_300), 0.1);
    const excerpts = [
      ex("a", 50, "big.pdf", "THE ANSWER chunk " + "w".repeat(1_300), 9),  // rank 1, late in doc
      ...Array.from({ length: 11 }, (_, i) => filler(i)),
    ];
    const r = buildFileContext(result(excerpts, [fileMeta("a", "big.pdf", 60)]));
    expect(r.text).toContain("THE ANSWER chunk");
  });

  it("greedy budget fill never ships a header without its first excerpt", () => {
    const big = "x".repeat(2_000);
    const r = buildFileContext(result(
      [ex("a", 0, "first.pdf", big), ex("b", 0, "second.pdf", big)],
      [fileMeta("a", "first.pdf"), fileMeta("b", "second.pdf")],
    ), 700); // 2800 chars budget — fits one excerpt, not two
    expect(r.text).toContain("## first.pdf");
    expect(r.text).toContain(big.slice(0, 50));
    expect(r.text).not.toContain("## second.pdf");
  });

  it("labels opening-chunk fallbacks instead of claiming relevance", () => {
    const r = buildFileContext(result(
      [ex("a", 0, "spec.pdf", "opening text")],
      [fileMeta("a", "spec.pdf")],
      false,
    ));
    expect(r.text).toContain("No passage matched the current question directly");
    expect(r.text).not.toContain("most relevant to the user's");
    expect(r.text).toContain("opening text");
  });

  it("caps the zero-hit document list", () => {
    const files = Array.from({ length: 20 }, (_, i) => fileMeta(`f${i}`, `doc-${i}.pdf`));
    const r = buildFileContext(result([], files));
    expect(r.text).toContain("doc-0.pdf");
    expect(r.text).toContain("doc-11.pdf");
    expect(r.text).not.toContain("doc-12.pdf");
    expect(r.text).toContain("(… 8 more)");
  });

  it("stays within the configured budget", () => {
    const excerpts = Array.from({ length: 12 }, (_, i) =>
      ex("a", i, "big.pdf", `chunk ${i} ` + "y".repeat(1_300)));
    const budgetTokens = 1000;
    const r = buildFileContext(result(excerpts, [fileMeta("a", "big.pdf", 12)]), budgetTokens);
    expect(r.text.length).toBeLessThanOrEqual(budgetTokens * 4 + 600); // + instructions tail
  });
});
