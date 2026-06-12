// convex/keys.ts
// The per-user OpenRouter runtime key. `getMine` is the ONLY function that
// ever returns the raw key, and only to its authenticated owner — never log
// the key, never widen this surface.
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.deletedAt !== undefined) return null;
    const row = await ctx.db
      .query("openrouterKeys")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!row) return null;
    return { apiKey: row.apiKey, disabled: row.disabled };
  },
});

export const getForUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("openrouterKeys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

/** Persist a freshly provisioned key and flip the user active — one
 *  transaction so the gate can never observe an active user without a key. */
export const store = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.string(),
    keyHash: v.string(),
    limitUsd: v.number(),
  },
  handler: async (ctx, { userId, apiKey, keyHash, limitUsd }) => {
    const existing = await ctx.db
      .query("openrouterKeys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    // Idempotency under double-scheduled provisioning: first write wins. A
    // second provisioned key can't be stored — the caller must disable it
    // upstream (provisionKey only POSTs after re-checking, so this is rare).
    if (existing) return { stored: false as const };
    await ctx.db.insert("openrouterKeys", {
      userId,
      apiKey,
      keyHash,
      limitUsd,
      disabled: false,
      createdAt: Date.now(),
    });
    await ctx.db.patch(userId, { keyStatus: "active" });
    return { stored: true as const };
  },
});

export const setDisabled = internalMutation({
  args: { userId: v.id("users"), disabled: v.boolean() },
  handler: async (ctx, { userId, disabled }) => {
    const row = await ctx.db
      .query("openrouterKeys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { disabled });
  },
});
