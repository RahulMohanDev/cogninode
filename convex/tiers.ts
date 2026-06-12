// convex/tiers.ts
// The simple-mode tier catalog. `list` joins each active tier with the
// modelPricing snapshot so the client can price "~N credits / message"
// without trusting its own catalog cache. Remapping tiers is a dashboard
// data edit; `seed` only plants the defaults once.
import { internalMutation, query } from "./_generated/server";

export interface TierListing {
  key: string;
  displayName: string;
  blurb: string;
  modelId: string;
  promptPerM: number;
  completionPerM: number;
}

export const list = query({
  args: {},
  handler: async (ctx): Promise<TierListing[]> => {
    const rows = await ctx.db.query("tiers").collect();
    const active = rows
      .filter((t) => t.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const out: TierListing[] = [];
    for (const tier of active) {
      const pricing = await ctx.db
        .query("modelPricing")
        .withIndex("by_modelId", (q) => q.eq("modelId", tier.modelId))
        .unique();
      out.push({
        key: tier.key,
        displayName: tier.displayName,
        blurb: tier.blurb,
        modelId: tier.modelId,
        promptPerM: pricing?.promptPerM ?? 0,
        completionPerM: pricing?.completionPerM ?? 0,
      });
    }
    return out;
  },
});

/** Plant the default tiers (idempotent — existing keys are left alone).
 *  Run once from the dashboard after the first deploy. */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults = [
      {
        key: "fast",
        displayName: "Fast",
        blurb: "Mail, quick questions, everyday answers",
        modelId: "google/gemini-2.5-flash-lite",
        sortOrder: 0,
      },
      {
        key: "thinking",
        displayName: "Thinking",
        blurb: "Studying, deep understanding, hard problems",
        modelId: "anthropic/claude-sonnet-4.5",
        sortOrder: 1,
      },
    ];
    let added = 0;
    for (const d of defaults) {
      const existing = await ctx.db
        .query("tiers")
        .withIndex("by_key", (q) => q.eq("key", d.key))
        .unique();
      if (existing) continue;
      await ctx.db.insert("tiers", { ...d, active: true, updatedAt: Date.now() });
      added++;
    }
    return { added };
  },
});
