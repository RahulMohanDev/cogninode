// src/lib/streamAborts.ts
// Module-level registry of in-flight stream AbortControllers, keyed by
// nodeId. Lives outside React so non-React callers (notably the Dexie
// cascade-delete helpers in db.ts) can abort streams without taking a
// dependency on the React tree.
//
// The StreamsProvider is responsible for registering / unregistering the
// controllers as streams start and finish. db.ts only ever calls
// `abortNodes` when it's about to wipe the underlying records.

const aborters = new Map<string, AbortController>();

export function registerAborter(nodeId: string, controller: AbortController): void {
  // If a stale entry exists (defensive — shouldn't happen in normal flow
  // because the provider guards against double-send to the same nodeId),
  // abort and replace it. Leaking the old controller would mean the next
  // abortNodes call only fires for the newest stream.
  const existing = aborters.get(nodeId);
  if (existing && existing !== controller) {
    try { existing.abort(); } catch { /* ignore */ }
  }
  aborters.set(nodeId, controller);
}

export function unregisterAborter(nodeId: string): void {
  aborters.delete(nodeId);
}

/** Abort any registered streams for the given nodeIds and drop them from
 *  the registry. Safe to call with ids that never had a stream. */
export function abortNodes(nodeIds: Iterable<string>): void {
  for (const id of nodeIds) {
    const ctrl = aborters.get(id);
    if (!ctrl) continue;
    try { ctrl.abort(); } catch { /* ignore */ }
    aborters.delete(id);
  }
}
