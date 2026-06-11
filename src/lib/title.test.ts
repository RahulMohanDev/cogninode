// src/lib/title.test.ts
import { describe, expect, it } from "vitest";
import { buildTitlePrompt, sanitizeTitle } from "./title";

describe("sanitizeTitle", () => {
  it("passes a clean title through", () => {
    expect(sanitizeTitle("Dexie Migration Bug")).toBe("Dexie Migration Bug");
  });

  it("strips wrapping quotes and backticks", () => {
    expect(sanitizeTitle('"Dexie Migration Bug"')).toBe("Dexie Migration Bug");
    expect(sanitizeTitle("'Tab Naming UX'")).toBe("Tab Naming UX");
    expect(sanitizeTitle("`Graph RAG Retrieval`")).toBe("Graph RAG Retrieval");
    expect(sanitizeTitle("“Smart” quotes everywhere”")).toBe("Smart” quotes everywhere");
  });

  it("strips markdown emphasis and a Title: prefix", () => {
    expect(sanitizeTitle("**Bold Title**")).toBe("Bold Title");
    expect(sanitizeTitle("Title: Vector Search Setup")).toBe("Vector Search Setup");
  });

  it("keeps only the first non-empty line", () => {
    expect(sanitizeTitle("\nReact Hooks Cleanup\nSecond line")).toBe("React Hooks Cleanup");
  });

  it("drops trailing punctuation but keeps inner punctuation", () => {
    expect(sanitizeTitle("Fixing CORS, again.")).toBe("Fixing CORS, again");
    expect(sanitizeTitle("What is RAG?")).toBe("What is RAG?");
    expect(sanitizeTitle("Thinking…")).toBe("Thinking");
  });

  it("collapses whitespace", () => {
    expect(sanitizeTitle("  Too   many\tspaces  ")).toBe("Too many spaces");
  });

  it("caps length at 60 chars with an ellipsis", () => {
    const long = "x".repeat(80);
    const out  = sanitizeTitle(long);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string when nothing usable remains", () => {
    expect(sanitizeTitle("")).toBe("");
    expect(sanitizeTitle('""')).toBe("");
    expect(sanitizeTitle("   \n  ")).toBe("");
  });
});

describe("buildTitlePrompt", () => {
  it("embeds question and answer, whitespace-collapsed", () => {
    const p = buildTitlePrompt("why is\nmy build  slow", "Because of\n\nbundling");
    expect(p).toContain("why is my build slow");
    expect(p).toContain("Because of bundling");
  });

  it("clips oversized inputs", () => {
    const p = buildTitlePrompt("q".repeat(2000), "a".repeat(2000));
    expect(p.length).toBeLessThan(1400);
  });
});
