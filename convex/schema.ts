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
    /** Running total of upstream USD this user's client has reported via
     *  credits.reportUsage. Reconciliation compares it against OpenRouter's
     *  authoritative per-key usage; the gap is `reconcileDriftUsd`. */
    usdReportedTotal: v.optional(v.number()),
    lastReconciledAt: v.optional(v.number()),
    /** authoritative usage − reported usage at last reconcile. Large
     *  positive drift = lost client reports or an extracted key. */
    reconcileDriftUsd: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_clerkUserId", ["clerkUserId"]),

  /** Append-only money trail. `credits` is signed (grants +, spends −);
   *  users.creditsBalance always equals the sum of a user's rows. */
  creditLedger: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("grant_starter"),
      v.literal("purchase"),
      v.literal("message"),
      v.literal("reconcile_adjust"),
    ),
    credits: v.number(),
    usdCost: v.optional(v.number()),
    /** "upstream" = OpenRouter's usage.cost from the final SSE frame;
     *  "estimated" = client fallback math (no upstream cost in response). */
    costSource: v.optional(
      v.union(v.literal("upstream"), v.literal("estimated")),
    ),
    /** Client-generated assistant-message id — the idempotency key for
     *  kind "message" rows (StrictMode/retry safe). */
    messageClientId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    webSearch: v.optional(v.boolean()),
    razorpayPaymentId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_user_message", ["userId", "messageClientId"]),

  /** Razorpay orders. One order = one ₹ pack purchase attempt; `paid` is
   *  applied exactly once (webhook and client confirm race benignly). */
  paymentOrders: defineTable({
    userId: v.id("users"),
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.optional(v.string()),
    amountInr: v.number(),
    credits: v.number(),
    status: v.union(
      v.literal("created"),
      v.literal("paid"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_orderId", ["razorpayOrderId"]),

  /** The Apple-style tier mapping ("Fast" / "Thinking" → concrete model).
   *  Rows are edited in the dashboard — remapping a tier to a new model is
   *  a data change, never a deploy. */
  tiers: defineTable({
    key: v.string(),                 // stable id, e.g. "fast" | "thinking"
    displayName: v.string(),
    blurb: v.string(),
    modelId: v.string(),             // OpenRouter model id
    sortOrder: v.number(),
    active: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** The sync mirror: one generic row store for all eight synced Dexie
   *  tables (IndexedDB stays the client source of truth; this is backup +
   *  cross-device transport). `clientId` is the Dexie `_id` (client UUIDs
   *  are canonical); `syncSeq` is the per-user monotonic pull cursor;
   *  tombstones keep `deletedAt` and drop `doc`. Large file contents live
   *  in Convex File Storage — the doc carries `contentStorageId`. */
  syncRows: defineTable({
    userId: v.id("users"),
    table: v.string(),
    clientId: v.string(),
    /** The row's client-side `_modifiedAt` LWW stamp. */
    modifiedAt: v.number(),
    syncSeq: v.number(),
    deletedAt: v.optional(v.number()),
    doc: v.optional(v.any()),
  })
    .index("by_user_table_client", ["userId", "table", "clientId"])
    .index("by_user_seq", ["userId", "syncSeq"]),

  /** Per-user monotonic sequence backing the one-doc latestSeq
   *  subscription (near-realtime cross-device sync for free). */
  syncState: defineTable({
    userId: v.id("users"),
    lastSeq: v.number(),
  }).index("by_userId", ["userId"]),

  /** Daily snapshot of OpenRouter's public per-model pricing (syncCatalog
   *  cron). Serves tier pricing + credit estimates without trusting the
   *  client's own catalog cache. */
  modelPricing: defineTable({
    modelId: v.string(),
    name: v.string(),
    promptPerM: v.number(),
    completionPerM: v.number(),
    contextLength: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_modelId", ["modelId"]),

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
