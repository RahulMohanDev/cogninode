// src/lib/sync/push.ts
// Outbox drain: read a window of captured ops, dedupe per row (latest op
// wins — a put followed by a delete pushes only the tombstone), read fresh
// payloads from Dexie at push time, and ship one pushOps batch. Outbox rows
// delete only after the server acknowledges; the mutation is LWW-idempotent
// so unclear failures simply re-push. A row that grew a NEWER outbox entry
// outside this window re-pushes later and the server skips it by stamp.

import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "../convexClient";
import { db, setMeta } from "../db";
import type { OutboxEntry } from "./capture";
import { prepareFileDocForPush } from "./fileSync";

const WINDOW = 200;
/** Rough serialized-size budget per batch — well under Convex's 16 MiB
 *  arg cap even after JSON overhead. */
const CHAR_BUDGET = 700_000;
/** A single doc above ~900k chars can't fit a Convex document anyway —
 *  skip it loudly rather than wedging the queue forever. */
const DOC_CHAR_CAP = 900_000;

export interface PushResult {
  pushed: number;
  remaining: number;
}

interface PushOp {
  table: string;
  clientId: string;
  op: "put" | "delete";
  modifiedAt: number;
  doc?: Record<string, unknown>;
}

let pushing = false;

export async function pushOnce(): Promise<PushResult> {
  const client = getConvexClient();
  if (!client || pushing) return { pushed: 0, remaining: 0 };
  pushing = true;
  try {
    const window = await db.outbox.orderBy("seq").limit(WINDOW).toArray();
    if (window.length === 0) return { pushed: 0, remaining: 0 };

    // Latest entry per row wins within the window.
    const latest = new Map<string, OutboxEntry>();
    for (const entry of window) latest.set(`${entry.table}:${entry.rowId}`, entry);

    const ops: PushOp[] = [];
    const consumedSeqs: number[] = [];
    const deferredSeqs = new Set<number>();
    let chars = 0;

    for (const entry of latest.values()) {
      if (chars > CHAR_BUDGET) { deferredSeqs.add(entry.seq!); continue; }
      if (entry.op === "delete") {
        ops.push({
          table: entry.table,
          clientId: entry.rowId,
          op: "delete",
          modifiedAt: entry.at,
        });
        continue;
      }
      const row = (await db.table(entry.table).get(entry.rowId)) as
        | Record<string, unknown>
        | undefined;
      if (!row) continue; // deleted since capture — its tombstone entry covers it
      let doc: Record<string, unknown> | null = row;
      if (entry.table === "files") {
        doc = await prepareFileDocForPush(client, row);
        if (!doc) {
          console.warn(`[sync] file ${entry.rowId} exceeds the sync size cap — left local-only`);
          continue;
        }
      }
      const size = JSON.stringify(doc).length;
      if (size > DOC_CHAR_CAP) {
        console.warn(`[sync] ${entry.table}/${entry.rowId} too large to sync (${size} chars) — left local-only`);
        continue;
      }
      chars += size;
      const modifiedAt =
        typeof row["_modifiedAt"] === "number" ? row["_modifiedAt"] : entry.at;
      ops.push({ table: entry.table, clientId: entry.rowId, op: "put", modifiedAt, doc });
    }

    // Every window entry whose row made it into (or was superseded within)
    // this batch is consumed; deferred-over-budget entries stay queued.
    for (const entry of window) {
      if (!deferredSeqs.has(entry.seq!)) consumedSeqs.push(entry.seq!);
    }

    if (ops.length > 0) {
      await client.mutation(api.sync.pushOps, { ops });
    }
    await db.outbox.bulkDelete(consumedSeqs);
    await setMeta("lastSyncedAt", Date.now());
    const remaining = await db.outbox.count();
    return { pushed: ops.length, remaining };
  } finally {
    pushing = false;
  }
}

/** Drain until empty (or an error leaves the rest for the retry timer). */
export async function pushLoop(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const { remaining, pushed } = await pushOnce();
    if (remaining === 0 || pushed === 0) return;
  }
}
