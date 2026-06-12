// src/lib/sync/capture.ts
// Write capture for the sync layer. A DBCore middleware stamps every
// add/put on the synced tables with `_modifiedAt` (the LWW clock — separate
// from domain `updatedAt`, whose semantics drive UI ordering and must not
// change) and records an outbox entry IN THE SAME IndexedDB transaction, so
// a captured write and its outbox row commit or roll back together. Zero
// call-site changes: db.ts's transactional helpers and every component
// write flow through unchanged.
//
// Two pieces make that possible:
//  1. a `_createTransaction` override (the dexie-observable pattern) adds
//     the outbox store to every readwrite transaction that touches a
//     synced table — callers never have to remember it;
//  2. pull-applies tag their TRANSACTION (not a module flag — a concurrent
//     local write in another transaction must still be captured) and the
//     middleware skips tagged transactions, which also preserves the
//     remote row's original `_modifiedAt`.
//
// Installed only in managed mode — local mode must never accumulate an
// outbox nobody drains.

import Dexie, { type DBCore, type Middleware } from "dexie";

export const SYNCED_TABLES = [
  "chats", "nodes", "messages", "reflections",
  "files", "graphs", "graphNodes", "graphEdges",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

const SYNCED = new Set<string>(SYNCED_TABLES);

export function isSyncedTable(name: string): name is SyncedTable {
  return SYNCED.has(name);
}

/** Outbox row. `seq` is the auto-increment drain order. */
export interface OutboxEntry {
  seq?:  number;
  table: SyncedTable;
  rowId: string;
  op:    "put" | "delete";
  at:    number;
}

const REMOTE_FLAG = "__cogninodeApplyingRemote";

/** Call INSIDE a db.transaction() zone to mark every write in it as a
 *  remote apply (no stamping, no outbox capture). */
export function markRemoteApply(): void {
  const tx = Dexie.currentTransaction as unknown as
    | Record<string, unknown>
    | null;
  if (!tx) throw new Error("markRemoteApply must run inside a transaction");
  tx[REMOTE_FLAG] = true;
}

function inRemoteApply(): boolean {
  const tx = Dexie.currentTransaction as unknown as
    | Record<string, unknown>
    | null;
  return Boolean(tx && tx[REMOTE_FLAG]);
}

/** Schema upgrades must pass through untouched: Dexie rebuilds the
 *  middleware stack per version step, so during pre-v7 steps the outbox
 *  store doesn't exist yet (capturing would throw and BRICK the upgrade),
 *  and during the v7 step the backfill's Collection.modify surfaces here
 *  as puts — stamping would clobber the historical `_modifiedAt` values
 *  the upgrade just computed and spuriously enqueue the whole database. */
function inVersionChange(trans: unknown): boolean {
  return (trans as { mode?: string } | null)?.mode === "versionchange";
}

interface TxCreator {
  _createTransaction: (
    mode: IDBTransactionMode,
    storeNames: string[],
    dbschema: Record<string, unknown>,
    parent?: unknown,
  ) => unknown;
}

export function setupSyncCapture(db: Dexie): void {
  // 1. Outbox joins every rw transaction that can touch a synced table.
  const creator = db as unknown as TxCreator;
  const origCreate = creator._createTransaction.bind(db);
  creator._createTransaction = (mode, storeNames, dbschema, parent) => {
    const needsOutbox =
      mode === "readwrite" &&
      Boolean(dbschema["outbox"]) &&
      !storeNames.includes("outbox") &&
      storeNames.some((n) => SYNCED.has(n));
    const names = needsOutbox ? [...storeNames, "outbox"] : storeNames;
    return origCreate(mode, names, dbschema, parent);
  };

  // 2. Stamp + capture at the DBCore level (Collection.modify and
  //    Table.update both surface here as full-object puts).
  const middleware: Middleware<DBCore> = {
    stack: "dbcore",
    name: "syncCapture",
    create(core: DBCore): DBCore {
      return {
        ...core,
        table(name: string) {
          const table = core.table(name);
          if (!SYNCED.has(name)) return table;
          return {
            ...table,
            mutate(req) {
              if (inRemoteApply() || inVersionChange(req.trans)) {
                return table.mutate(req);
              }
              // Belt-and-braces: if this middleware stack was built before
              // the outbox store existed, capture is impossible — pass
              // through rather than throw.
              let outboxTable: ReturnType<DBCore["table"]>;
              try {
                outboxTable = core.table("outbox");
              } catch {
                return table.mutate(req);
              }
              const now = Date.now();
              const entries: OutboxEntry[] = [];
              if (req.type === "add" || req.type === "put") {
                for (const value of req.values) {
                  const obj = value as Record<string, unknown>;
                  obj["_modifiedAt"] = now;
                  const key = obj["_id"];
                  if (typeof key === "string") {
                    entries.push({ table: name as SyncedTable, rowId: key, op: "put", at: now });
                  }
                }
              } else if (req.type === "delete") {
                for (const key of req.keys) {
                  if (typeof key === "string") {
                    entries.push({ table: name as SyncedTable, rowId: key, op: "delete", at: now });
                  }
                }
              } else if (req.type === "deleteRange") {
                // clear() and range deletes are not captured — the only
                // call sites are full local wipes, which deliberately do
                // not propagate (see clearAllUserData).
                console.warn(`[sync] deleteRange on ${name} not captured — server copy unaffected`);
              }
              return table.mutate(req).then(async (res) => {
                if (entries.length > 0) {
                  await outboxTable
                    .mutate({ type: "add", trans: req.trans, values: entries });
                }
                return res;
              });
            },
          };
        },
      };
    },
  };
  db.use(middleware);
}
