// src/lib/sync/reset.ts
// Resets all per-account sync bookkeeping. MUST run whenever this browser
// changes hands between Clerk accounts (the owner stamp changes) and when
// managed-mode "Clear all data" wipes the local cache: the pull cursor,
// the initial-enqueue marker, the outbox, queued usage reports, and the
// blob-upload cache are all scoped to ONE account — leaking any of them
// across accounts either strands the new account behind a foreign cursor
// (cloud data never pulls), pushes the old account's tombstones/charges
// under the new identity, or reuses another user's blob references.

import { db } from "../db";

const META_PREFIXES = ["usage:", "fileBlobUpload:"];
const META_KEYS = ["syncCursor", "initialSyncEnqueued", "lastSyncedAt"];

export async function resetSyncState(): Promise<void> {
  await db.transaction("rw", [db.outbox, db.meta], async () => {
    await db.outbox.clear();
    await db.meta.bulkDelete(META_KEYS);
    for (const prefix of META_PREFIXES) {
      await db.meta.where("key").startsWith(prefix).delete();
    }
  });
}
