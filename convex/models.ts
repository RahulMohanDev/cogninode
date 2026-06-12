// convex/models.ts
// Server-side snapshot of OpenRouter's public model pricing, refreshed by
// the daily cron. Tier pricing (Phase D) and any server-side cost checks
// read from here — never from the client's own catalog cache.
import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

interface ApiModel {
  id?: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string | number; completion?: string | number };
}

function perM(perToken: string | number | undefined): number {
  const n = Number(perToken ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1e6 * 1e4) / 1e4; // USD/M tokens, 4dp
}

export const syncCatalog = internalAction({
  args: {},
  handler: async (ctx) => {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`models fetch failed: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: ApiModel[] };
    const rows = (json.data ?? [])
      .filter((m): m is ApiModel & { id: string } => Boolean(m.id))
      .map((m) => ({
        modelId: m.id,
        name: m.name ?? m.id,
        promptPerM: perM(m.pricing?.prompt),
        completionPerM: perM(m.pricing?.completion),
        ...(typeof m.context_length === "number"
          ? { contextLength: m.context_length }
          : {}),
      }));
    if (rows.length === 0) throw new Error("models fetch returned no data");
    await ctx.runMutation(internal.models.replaceCatalog, { rows });
    return { count: rows.length };
  },
});

export const replaceCatalog = internalMutation({
  args: {
    rows: v.array(
      v.object({
        modelId: v.string(),
        name: v.string(),
        promptPerM: v.number(),
        completionPerM: v.number(),
        contextLength: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    for (const row of rows) {
      const existing = await ctx.db
        .query("modelPricing")
        .withIndex("by_modelId", (q) => q.eq("modelId", row.modelId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { ...row, updatedAt: now });
      } else {
        await ctx.db.insert("modelPricing", { ...row, updatedAt: now });
      }
    }
  },
});

export const pricingFor = query({
  args: { modelIds: v.array(v.string()) },
  handler: async (ctx, { modelIds }) => {
    const out = [];
    for (const modelId of modelIds.slice(0, 50)) {
      const row = await ctx.db
        .query("modelPricing")
        .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
        .unique();
      if (row) {
        out.push({
          modelId: row.modelId,
          promptPerM: row.promptPerM,
          completionPerM: row.completionPerM,
        });
      }
    }
    return out;
  },
});
