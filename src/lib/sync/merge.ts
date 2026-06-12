// src/lib/sync/merge.ts
// Pure conflict resolution for pull-applies: last-write-wins on the
// `_modifiedAt` stamp, whole-row granularity (the documented v1 tradeoff —
// two devices editing the SAME row inside one sync lag lose the older
// edit). Ties go to the tombstone: deletes are deliberate acts; an equal
// non-delete tie keeps local (stability — re-applying an already-applied
// row must be a no-op).
//
// Crucially: a pulled chat tombstone maps to a PLAIN row delete, never to
// the local deleteChat cascade — the originating device already synced
// every cascade effect (child tombstones, graph-node detaches) as its own
// rows.

export interface RemoteRow {
  table:      string;
  clientId:   string;
  modifiedAt: number;
  deletedAt:  number | null;
  doc:        Record<string, unknown> | null;
}

export type ApplyDecision = "put" | "delete" | "skip";

/** @param localModifiedAt the local row's `_modifiedAt`; 0 when the row
 *  exists but predates stamping; null when the row doesn't exist. */
export function decideApply(
  localModifiedAt: number | null,
  remote: RemoteRow,
): ApplyDecision {
  const isTombstone = remote.deletedAt !== null;
  if (localModifiedAt === null) {
    // Nothing local: materialize puts; tombstones have nothing to delete
    // but "delete" keeps the operation idempotent and harmless.
    return isTombstone ? "delete" : remote.doc ? "put" : "skip";
  }
  if (remote.modifiedAt < localModifiedAt) return "skip";
  if (remote.modifiedAt === localModifiedAt) {
    return isTombstone ? "delete" : "skip";
  }
  if (isTombstone) return "delete";
  return remote.doc ? "put" : "skip";
}
