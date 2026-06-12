// src/lib/sync/initial.ts
// First-sync bootstrap: enqueue every existing local row into the outbox
// once per browser. On a fresh device joining an existing account the
// tables are empty and this is a no-op — the pull side materializes
// everything. Both sides meeting in the middle is safe: LWW converges.

import { db, getMeta, setMeta } from "../db";
import { markRemoteApply, SYNCED_TABLES, type OutboxEntry } from "./capture";

const DONE_KEY = "initialSyncEnqueued";

export async function ensureInitialSyncEnqueued(): Promise<void> {
  if (await getMeta<boolean>(DONE_KEY)) return;
  for (const table of SYNCED_TABLES) {
    // Backfill `_modifiedAt` for rows written while the browser ran in
    // LOCAL mode (no capture middleware → no stamps; the v7 upgrade only
    // backfills rows that existed at upgrade time). Without a stamp the
    // row would push as "oldest", letting ANY stale remote copy beat it.
    // The transaction is remote-tagged: this is bookkeeping, not an edit —
    // it must neither bump stamps to "now" nor enqueue capture entries
    // (we enqueue explicitly below).
    await db.transaction("rw", db.table(table), db.outbox, async () => {
      markRemoteApply();
      await db.table(table).toCollection().modify((row) => {
        const r = row as Record<string, unknown>;
        if (typeof r["_modifiedAt"] !== "number") {
          r["_modifiedAt"] =
            (typeof r["updatedAt"] === "number" ? r["updatedAt"] : undefined) ??
            (typeof r["createdAt"] === "number" ? r["createdAt"] : undefined) ??
            Date.now();
        }
      });
    });

    const entries: OutboxEntry[] = [];
    await db.table(table).each((row) => {
      const r = row as Record<string, unknown>;
      const id = r["_id"];
      if (typeof id !== "string") return;
      entries.push({
        table,
        rowId: id,
        op: "put",
        at: typeof r["_modifiedAt"] === "number" ? (r["_modifiedAt"] as number) : Date.now(),
      });
    });
    for (let i = 0; i < entries.length; i += 500) {
      await db.outbox.bulkAdd(entries.slice(i, i + 500));
    }
  }
  await setMeta(DONE_KEY, true);
}
