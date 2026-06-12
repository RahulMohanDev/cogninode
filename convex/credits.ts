// convex/credits.ts
// The credits ledger. Charging happens AFTER a stream completes (the client
// reports the final usage), so a balance may briefly go negative — the
// composer blocks the NEXT send, and the OpenRouter per-key limit is the
// hard upstream backstop. reportUsage is idempotent by the client-generated
// assistant-message id: the usage outbox retries until acknowledged and a
// retry must never double-charge.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import {
  starterCredits,
  usdToCredits,
  WEB_SEARCH_FALLBACK_USD,
} from "./lib/credits";

/** Sanity ceiling per single report — no legitimate message costs this.
 *  A buggy client only hurts its own balance, but cap the blast radius. */
const MAX_REPORT_USD = 50;

export const balance = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.deletedAt !== undefined) return null;
    return user.creditsBalance;
  },
});

export const ledgerMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return rows.map((r) => ({
      _id: r._id,
      kind: r.kind,
      credits: r.credits,
      modelId: r.modelId ?? null,
      createdAt: r.createdAt,
    }));
  },
});

export const reportUsage = mutation({
  args: {
    messageClientId: v.string(),
    usdCost: v.number(),
    costSource: v.union(v.literal("upstream"), v.literal("estimated")),
    modelId: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    webSearch: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("reportUsage requires authentication");

    // Idempotency: one charge per assistant message, ever.
    const existing = await ctx.db
      .query("creditLedger")
      .withIndex("by_user_message", (q) =>
        q.eq("userId", user._id).eq("messageClientId", args.messageClientId),
      )
      .unique();
    if (existing) return { credits: -existing.credits, duplicate: true };

    const surcharge =
      args.webSearch && args.costSource === "estimated"
        ? WEB_SEARCH_FALLBACK_USD
        : 0;
    const usd = Math.min(Math.max(args.usdCost, 0), MAX_REPORT_USD) + surcharge;
    const credits = usdToCredits(usd);

    await ctx.db.insert("creditLedger", {
      userId: user._id,
      kind: "message",
      credits: -credits,
      usdCost: usd,
      costSource: args.costSource,
      messageClientId: args.messageClientId,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      webSearch: args.webSearch,
      createdAt: Date.now(),
    });
    await ctx.db.patch(user._id, {
      creditsBalance: user.creditsBalance - credits,
      usdReportedTotal: (user.usdReportedTotal ?? 0) + usd,
    });
    return { credits, duplicate: false };
  },
});

/** Reconciliation settlement: dock unreported upstream spend (see
 *  planReconcile in lib/credits.ts) and true usdReportedTotal up to the
 *  authoritative figure so the next cycle starts clean. */
export const applyReconcileAdjust = internalMutation({
  args: {
    userId: v.id("users"),
    credits: v.number(),
    usdCost: v.number(),
    reportedTotal: v.number(),
  },
  handler: async (ctx, { userId, credits, usdCost, reportedTotal }) => {
    const user = await ctx.db.get(userId);
    if (!user) return;
    await ctx.db.insert("creditLedger", {
      userId,
      kind: "reconcile_adjust",
      credits: -credits,
      usdCost,
      costSource: "upstream",
      createdAt: Date.now(),
    });
    await ctx.db.patch(userId, {
      creditsBalance: user.creditsBalance - credits,
      usdReportedTotal: reportedTotal,
    });
  },
});

/** One-time backfill: users created before the ledger existed have a
 *  starter balance but no grant row. Run from the dashboard after deploy. */
export const backfillStarterGrants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let added = 0;
    for (const user of users) {
      const grant = await ctx.db
        .query("creditLedger")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .filter((q) => q.eq(q.field("kind"), "grant_starter"))
        .first();
      if (!grant) {
        await ctx.db.insert("creditLedger", {
          userId: user._id,
          kind: "grant_starter",
          credits: starterCredits(),
          createdAt: user.createdAt,
        });
        added++;
      }
    }
    return { added };
  },
});
