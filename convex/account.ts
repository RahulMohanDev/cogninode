// convex/account.ts
// Account deletion: wipe the server-side mirror (sync rows in batches —
// the per-transaction write cap means we can't drop everything in one
// mutation — plus their file-storage blobs), then soft-delete the user,
// which also disables the OpenRouter key upstream. The credit ledger and
// payment orders are KEPT for accounting (they carry ids, not content).
// The client follows up with Clerk's own user.delete() and a local wipe.
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH = 300;

export const deleteMyData = action({
  args: {},
  handler: async (ctx): Promise<{ rowsDeleted: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("deleteMyData requires authentication");
    const user = await ctx.runQuery(internal.users.getByClerkIdInternal, {
      clerkUserId: identity.subject,
    });
    if (!user) return { rowsDeleted: 0 };

    let rowsDeleted = 0;
    for (let i = 0; i < 10_000; i++) {
      const res = await ctx.runMutation(internal.account.deleteSyncBatch, {
        userId: user._id,
      });
      rowsDeleted += res.deleted;
      for (const storageId of res.storageIds) {
        try {
          await ctx.storage.delete(storageId);
        } catch {
          // already gone — fine
        }
      }
      if (res.done) break;
    }
    // Soft-delete + upstream key disable (scheduled inside markDeleted).
    await ctx.runMutation(internal.users.markDeleted, {
      clerkUserId: identity.subject,
    });
    return { rowsDeleted };
  },
});

export const deleteSyncBatch = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("syncRows")
      .withIndex("by_user_seq", (q) => q.eq("userId", userId))
      .take(BATCH);
    const storageIds: Array<import("./_generated/dataModel").Id<"_storage">> = [];
    for (const row of rows) {
      const doc = row.doc as { contentStorageId?: string } | undefined;
      if (doc?.contentStorageId) {
        storageIds.push(doc.contentStorageId as import("./_generated/dataModel").Id<"_storage">);
      }
      await ctx.db.delete(row._id);
    }
    const done = rows.length < BATCH;
    if (done) {
      const state = await ctx.db
        .query("syncState")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      if (state) await ctx.db.delete(state._id);
    }
    return { deleted: rows.length, storageIds, done };
  },
});
