// src/lib/sync/initial.ts
// First-sync bootstrap: enqueue every existing local row into the outbox
// once per browser. On a fresh device joining an existing account the
// tables are empty and this is a no-op — the pull side materializes
// everything. Both sides meeting in the middle is safe: LWW converges.

import { db, getMeta, setMeta } from "../db";
import { SYNCED_TABLES, type OutboxEntry } from "./capture";

const DONE_KEY = "initialSyncEnqueued";

export async function ensureInitialSyncEnqueued(): Promise<void> {
  if (await getMeta<boolean>(DONE_KEY)) return;
  for (const table of SYNCED_TABLES) {
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
