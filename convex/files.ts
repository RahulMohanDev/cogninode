// convex/files.ts
// Convex File Storage endpoints for the sync layer. StoredFile.content can
// be multi-MB (base64 images, full PDFs-as-text) — over the 1 MiB document
// cap — so large contents upload as blobs and the synced doc carries only
// a `contentStorageId` reference (see src/lib/sync/fileSync.ts).
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("generateUploadUrl requires authentication");
    return await ctx.storage.generateUploadUrl();
  },
});

export const getUrls = query({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const out: Array<{ storageId: string; url: string | null }> = [];
    for (const storageId of storageIds.slice(0, 50)) {
      out.push({ storageId, url: await ctx.storage.getUrl(storageId) });
    }
    return out;
  },
});
