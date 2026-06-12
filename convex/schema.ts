// convex/schema.ts
// Server-side schema. Convex mirrors and serves what the client can't hold
// safely: user identity, the per-user OpenRouter runtime key, and (from
// Phase B on) the credits ledger. Synced chat data arrives in Phase E.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    /** Clerk user id (`identity.subject`) — the cross-system join key. */
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    /** Lifecycle of the per-user OpenRouter key. The client gate shows an
     *  interstitial while "provisioning" and a retry panel on "error". */
    keyStatus: v.union(
      v.literal("provisioning"),
      v.literal("active"),
      v.literal("error"),
    ),
    /** Denormalized credit balance. Every ledger-writing mutation updates it
     *  in the same transaction, so it can never drift from the ledger. */
    creditsBalance: v.number(),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_clerkUserId", ["clerkUserId"]),

  openrouterKeys: defineTable({
    userId: v.id("users"),
    /** Raw runtime key — returned by OpenRouter exactly once at creation.
     *  Only `keys.getMine` (auth-gated to the owner) ever returns it. */
    apiKey: v.string(),
    /** Management hash used for PATCH /api/v1/keys/{hash} (limit re-pegs,
     *  disable kill switch). */
    keyHash: v.string(),
    /** Current upstream USD spend limit — the hard enforcement backstop. */
    limitUsd: v.number(),
    disabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),
});
