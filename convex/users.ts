// convex/users.ts
// User rows keyed on the Clerk user id. Two creation paths, both idempotent:
// the Clerk webhook (convex/http.ts) and the client-called `ensure` mutation
// (fires once on first authenticated mount). `ensure` exists so local dev
// and webhook outages never strand a signed-in user without a row — svix
// retries make the webhook re-deliver, so every write here must tolerate
// running twice.
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { starterCredits } from "./lib/credits";

export async function userByClerkId(ctx: QueryCtx, clerkUserId: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
}

/** Resolve the calling user's row, or null when unauthenticated/unknown. */
export async function getCurrentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await userByClerkId(ctx, identity.subject);
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.deletedAt !== undefined) return null;
    return {
      _id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      keyStatus: user.keyStatus,
      creditsBalance: user.creditsBalance,
    };
  },
});

interface ClerkProfile {
  clerkUserId: string;
  email?: string;
  name?: string;
}

/** Shared upsert. Creates the row (status "provisioning") and schedules key
 *  provisioning exactly once; on an existing row it only refreshes profile
 *  fields, re-scheduling provisioning only from the "error" state. */
async function upsertUser(ctx: MutationCtx, profile: ClerkProfile) {
  const existing = await userByClerkId(ctx, profile.clerkUserId);
  if (!existing) {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkUserId: profile.clerkUserId,
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.name ? { name: profile.name } : {}),
      keyStatus: "provisioning",
      creditsBalance: starterCredits(),
      createdAt: now,
    });
    // Ledger invariant: creditsBalance always equals the sum of the user's
    // ledger rows — the starter grant lands in the same transaction.
    await ctx.db.insert("creditLedger", {
      userId,
      kind: "grant_starter",
      credits: starterCredits(),
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.openrouter.provisionKey, { userId });
    return userId;
  }
  await ctx.db.patch(existing._id, {
    ...(profile.email ? { email: profile.email } : {}),
    ...(profile.name ? { name: profile.name } : {}),
  });
  if (existing.keyStatus === "error") {
    await ctx.db.patch(existing._id, { keyStatus: "provisioning" });
    await ctx.scheduler.runAfter(0, internal.openrouter.provisionKey, {
      userId: existing._id,
    });
  }
  return existing._id;
}

/** Called by the client once per session after sign-in. Also the retry
 *  button's path when provisioning landed in "error". */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("ensure requires authentication");
    await upsertUser(ctx, {
      clerkUserId: identity.subject,
      ...(typeof identity.email === "string" && identity.email
        ? { email: identity.email }
        : {}),
      ...(typeof identity.name === "string" && identity.name
        ? { name: identity.name }
        : {}),
    });
  },
});

export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertUser(ctx, {
      clerkUserId: args.clerkUserId,
      ...(args.email ? { email: args.email } : {}),
      ...(args.name ? { name: args.name } : {}),
    });
  },
});

export const markDeleted = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const user = await userByClerkId(ctx, clerkUserId);
    if (!user || user.deletedAt !== undefined) return;
    await ctx.db.patch(user._id, { deletedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.openrouter.disableKey, {
      userId: user._id,
    });
  },
});

export const setKeyStatus = internalMutation({
  args: {
    userId: v.id("users"),
    keyStatus: v.union(
      v.literal("provisioning"),
      v.literal("active"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, { userId, keyStatus }) => {
    await ctx.db.patch(userId, { keyStatus });
  },
});

export const getInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

export const getByClerkIdInternal = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    return await userByClerkId(ctx, clerkUserId);
  },
});

/** Ids of all live (non-deleted, key-active) users — the reconcile cron's
 *  fan-out list. Fine as a full scan until the user count says otherwise. */
export const listActiveIdsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.deletedAt === undefined && u.keyStatus === "active")
      .map((u) => u._id);
  },
});

export const recordReconcile = internalMutation({
  args: { userId: v.id("users"), driftUsd: v.number() },
  handler: async (ctx, { userId, driftUsd }) => {
    await ctx.db.patch(userId, {
      lastReconciledAt: Date.now(),
      reconcileDriftUsd: driftUsd,
    });
  },
});
