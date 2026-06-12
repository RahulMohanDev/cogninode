// src/lib/sync/fileSync.ts
// File-content handling for sync. StoredFile.content (base64 data URL or
// plain text) can exceed Convex's 1 MiB document cap, so contents above the
// inline threshold upload to Convex File Storage and the synced doc carries
// `contentStorageId` instead. Pull rehydrates content BEFORE the apply
// transaction (network inside an IndexedDB transaction would auto-commit
// it), so the StoredFile shape the rest of the app sees never changes —
// buildPathMessages, doc-RAG, and search are none the wiser. Files are
// effectively immutable (created once, deleted by cascade), which keeps
// this simple.

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConvexReactClient } from "convex/react";
import { getMeta, setMeta } from "../db";
import type { RemoteRow } from "./merge";

/** Contents at or below this inline straight into the synced doc. */
export const INLINE_SYNC_MAX_CHARS = 64_000;

/** Hard skip above this (~30 MB) — matches the app's own attach limits. */
export const SYNC_FILE_MAX_CHARS = 30_000_000;

interface FileDocLike extends Record<string, unknown> {
  content?: unknown;
  contentStorageId?: unknown;
}

/** Prepare a files-table row for push. Returns null when the row must be
 *  skipped (over the hard cap). Files are immutable, so a successful blob
 *  upload is cached by row id + length — outbox re-pushes (initial-enqueue
 *  duplicates, lost-ack retries) reuse the storageId instead of orphaning
 *  a fresh paid blob each attempt. */
export async function prepareFileDocForPush(
  client: ConvexReactClient,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const content = typeof row["content"] === "string" ? row["content"] : "";
  if (content.length > SYNC_FILE_MAX_CHARS) return null;
  if (content.length <= INLINE_SYNC_MAX_CHARS) return row;

  const rowId = typeof row["_id"] === "string" ? row["_id"] : "";
  const cacheKey = `fileBlobUpload:${rowId}`;
  const cached = await getMeta<{ len: number; storageId: string }>(cacheKey);
  if (cached && cached.len === content.length) {
    return { ...row, content: "", contentStorageId: cached.storageId };
  }

  const uploadUrl = await client.mutation(api.files.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
  if (!res.ok) throw new Error(`file upload failed: HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: string };
  await setMeta(cacheKey, { len: content.length, storageId });
  return { ...row, content: "", contentStorageId: storageId };
}

/** Rehydrate pulled file docs: swap contentStorageId back into inline
 *  content. Mutates the rows' docs in place. Throws when any blob can't be
 *  fetched — the pull cursor must NOT advance past a page that wasn't
 *  fully applied (a silently dropped row would never be retried). */
export async function hydrateRemoteFileDocs(
  client: ConvexReactClient,
  rows: RemoteRow[],
): Promise<RemoteRow[]> {
  const needing = rows.filter(
    (r) =>
      r.table === "files" &&
      r.doc !== null &&
      typeof (r.doc as FileDocLike)["contentStorageId"] === "string",
  );
  if (needing.length === 0) return rows;

  const ids = needing.map(
    (r) => (r.doc as FileDocLike)["contentStorageId"] as Id<"_storage">,
  );
  const urls = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 50) {
    const page = await client.query(api.files.getUrls, {
      storageIds: ids.slice(i, i + 50),
    });
    for (const { storageId, url } of page) urls.set(storageId, url);
  }

  for (const row of needing) {
    const doc = row.doc as FileDocLike;
    const storageId = doc["contentStorageId"] as string;
    const url = urls.get(storageId);
    if (!url) throw new Error(`[sync] blob URL unavailable for ${storageId}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[sync] file blob fetch failed: HTTP ${res.status}`);
    doc["content"] = await res.text();
    delete doc["contentStorageId"];
  }
  return rows;
}
