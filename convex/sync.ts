// convex/sync.ts
// Server side of the local-first sync layer. The client pushes outbox ops
// (LWW by the row's `_modifiedAt` stamp) and pulls by syncSeq cursor; the
// one-doc `latestSeq` query is the reactive "something changed" signal a
// device subscribes to. One mutation = one Convex transaction, so a Dexie
// cascade pushed as one batch lands atomically.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

const SYNCED_TABLES = new Set([
  "chats", "nodes", "messages", "reflections",
  "files", "graphs", "graphNodes", "graphEdges",
]);

const MAX_OPS_PER_PUSH = 400;
const MAX_PULL_LIMIT = 200;

export const pushOps = mutation({
  args: {
    ops: v.array(
      v.object({
        table: v.string(),
        clientId: v.string(),
        op: v.union(v.literal("put"), v.literal("delete")),
        modifiedAt: v.number(),
        doc: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, { ops }) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.deletedAt !== undefined) {
      throw new Error("pushOps requires authentication");
    }
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    let lastSeq = state?.lastSeq ?? 0;
    let applied = 0;

    for (const op of ops.slice(0, MAX_OPS_PER_PUSH)) {
      if (!SYNCED_TABLES.has(op.table)) continue;
      const existing = await ctx.db
        .query("syncRows")
        .withIndex("by_user_table_client", (q) =>
          q.eq("userId", user._id).eq("table", op.table).eq("clientId", op.clientId),
        )
        .unique();
      // Server-side LWW mirror of the client's decideApply: an equal or
      // newer mirror row wins, making re-pushed batches free.
      if (existing && existing.modifiedAt >= op.modifiedAt) continue;
      lastSeq++;
      if (existing) {
        // A replaced or tombstoned files row releases its old blob —
        // nothing else ever cleans Convex storage up.
        const oldStorageId = (existing.doc as { contentStorageId?: string } | undefined)
          ?.contentStorageId;
        const newStorageId = (op.doc as { contentStorageId?: string } | undefined)
          ?.contentStorageId;
        if (oldStorageId && oldStorageId !== newStorageId) {
          try {
            await ctx.storage.delete(oldStorageId as Parameters<typeof ctx.storage.delete>[0]);
          } catch {
            // already gone — fine
          }
        }
        await ctx.db.patch(existing._id, {
          modifiedAt: op.modifiedAt,
          syncSeq: lastSeq,
          deletedAt: op.op === "delete" ? op.modifiedAt : undefined,
          doc: op.op === "delete" ? undefined : op.doc,
        });
      } else {
        await ctx.db.insert("syncRows", {
          userId: user._id,
          table: op.table,
          clientId: op.clientId,
          modifiedAt: op.modifiedAt,
          syncSeq: lastSeq,
          ...(op.op === "delete"
            ? { deletedAt: op.modifiedAt }
            : { doc: op.doc }),
        });
      }
      applied++;
    }

    if (lastSeq !== (state?.lastSeq ?? 0)) {
      if (state) {
        await ctx.db.patch(state._id, { lastSeq });
      } else {
        await ctx.db.insert("syncState", { userId: user._id, lastSeq });
      }
    }
    return { applied, lastSeq };
  },
});

export const pullSince = query({
  args: { cursor: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { cursor, limit }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { rows: [], nextCursor: cursor, done: true };
    const take = Math.min(limit ?? MAX_PULL_LIMIT, MAX_PULL_LIMIT);
    const rows = await ctx.db
      .query("syncRows")
      .withIndex("by_user_seq", (q) =>
        q.eq("userId", user._id).gt("syncSeq", cursor),
      )
      .take(take);
    const last = rows[rows.length - 1];
    return {
      rows: rows.map((r) => ({
        table: r.table,
        clientId: r.clientId,
        modifiedAt: r.modifiedAt,
        deletedAt: r.deletedAt ?? null,
        doc: (r.doc ?? null) as Record<string, unknown> | null,
        syncSeq: r.syncSeq,
      })),
      nextCursor: last ? last.syncSeq : cursor,
      done: rows.length < take,
    };
  },
});

/** The one-doc reactive subscription: bumps whenever anything lands. */
export const latestSeq = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    return state?.lastSeq ?? 0;
  },
});
