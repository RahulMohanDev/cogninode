// src/lib/sync/pull.ts
// Incremental pull: page through syncRows past the local cursor, hydrate
// file blobs OUTSIDE the transaction (network inside an IndexedDB
// transaction auto-commits it), then apply each page in ONE rw transaction
// tagged as a remote apply — the capture middleware skips tagged
// transactions, so pulled writes neither re-enter the outbox (echo loop)
// nor get re-stamped (which would break LWW convergence). The cursor only
// advances past fully-applied pages.

import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "../convexClient";
import { db, getMeta, setMeta } from "../db";
import { isSyncedTable, markRemoteApply } from "./capture";
import { decideApply, type RemoteRow } from "./merge";
import { hydrateRemoteFileDocs } from "./fileSync";

const CURSOR_KEY = "syncCursor";
const PAGE = 200;

let pulling = false;

export async function pullOnce(): Promise<{ applied: number }> {
  const client = getConvexClient();
  if (!client || pulling) return { applied: 0 };
  pulling = true;
  try {
    let applied = 0;
    let cursor = (await getMeta<number>(CURSOR_KEY)) ?? 0;
    for (let page = 0; page < 200; page++) {
      const res = await client.query(api.sync.pullSince, { cursor, limit: PAGE });
      if (res.rows.length > 0) {
        const rows = await hydrateRemoteFileDocs(client, res.rows as RemoteRow[]);
        applied += await applyPage(rows);
      }
      cursor = res.nextCursor;
      await setMeta(CURSOR_KEY, cursor);
      if (res.done) break;
    }
    await setMeta("lastSyncedAt", Date.now());
    return { applied };
  } finally {
    pulling = false;
  }
}

async function applyPage(rows: RemoteRow[]): Promise<number> {
  let applied = 0;
  await db.transaction(
    "rw",
    [db.chats, db.nodes, db.messages, db.reflections, db.files,
     db.graphs, db.graphNodes, db.graphEdges, db.outbox],
    async () => {
      markRemoteApply();
      for (const row of rows) {
        if (!isSyncedTable(row.table)) continue;
        const tbl = db.table(row.table);
        const local = (await tbl.get(row.clientId)) as
          | Record<string, unknown>
          | undefined;
        const localStamp = local
          ? typeof local["_modifiedAt"] === "number"
            ? (local["_modifiedAt"] as number)
            : 0
          : null;
        const decision = decideApply(localStamp, row);
        if (decision === "put" && row.doc) {
          await tbl.put(row.doc);
          applied++;
        } else if (decision === "delete") {
          // Plain row delete — never the cascading helpers; the
          // originating device synced every cascade effect itself.
          await tbl.delete(row.clientId);
          applied++;
        }
      }
    },
  );
  return applied;
}
