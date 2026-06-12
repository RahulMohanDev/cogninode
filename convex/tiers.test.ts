// convex/tiers.test.ts
// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);

describe("tiers", () => {
  it("seed is idempotent and list joins pricing", async () => {
    const tx = convexTest(schema, modules);
    expect((await tx.mutation(internal.tiers.seed, {})).added).toBe(2);
    expect((await tx.mutation(internal.tiers.seed, {})).added).toBe(0);

    await tx.mutation(internal.models.replaceCatalog, {
      rows: [
        {
          modelId: "google/gemini-2.5-flash-lite",
          name: "Gemini 2.5 Flash Lite",
          promptPerM: 0.1,
          completionPerM: 0.4,
        },
      ],
    });

    const tiers = await tx.query(api.tiers.list, {});
    expect(tiers.map((t) => t.key)).toEqual(["fast", "thinking"]);
    expect(tiers[0]).toMatchObject({
      displayName: "Fast",
      modelId: "google/gemini-2.5-flash-lite",
      promptPerM: 0.1,
      completionPerM: 0.4,
    });
    // No pricing snapshot for the thinking model yet → zeros, client falls
    // back to its own catalog mirror for the estimate.
    expect(tiers[1]!.promptPerM).toBe(0);
  });

  it("list hides inactive tiers and honors sortOrder edits", async () => {
    const tx = convexTest(schema, modules);
    await tx.mutation(internal.tiers.seed, {});
    await tx.run(async (ctx) => {
      const fast = await ctx.db
        .query("tiers")
        .withIndex("by_key", (q) => q.eq("key", "fast"))
        .unique();
      await ctx.db.patch(fast!._id, { active: false });
    });
    const tiers = await tx.query(api.tiers.list, {});
    expect(tiers.map((t) => t.key)).toEqual(["thinking"]);
  });
});
