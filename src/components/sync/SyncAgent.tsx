// src/components/sync/SyncAgent.tsx
// The sync loop's driver. Renders nothing; mounts INSIDE the access gate so
// it only runs once auth + account-linking have settled (never syncs
// another account's local data). Local mode renders null forever.
//
// Push: triggered by the live outbox count (debounced), with a 60s sweep
// for retry after failures. Pull: triggered by the one-doc latestSeq
// subscription — Convex reactivity makes cross-device sync near-realtime
// without polling. Both loops are promise-guarded internally (pushOnce/
// pullOnce coalesce concurrent calls), so StrictMode double-effects and
// overlapping triggers are harmless.

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "../../../convex/_generated/api";
import { db, getMeta } from "../../lib/db";
import { isManagedMode } from "../../lib/managedConfig";
import { ensureInitialSyncEnqueued } from "../../lib/sync/initial";
import { pushLoop } from "../../lib/sync/push";
import { pullOnce } from "../../lib/sync/pull";

export function SyncAgent() {
  // Mode is constant for the app's lifetime (lib/managedConfig.ts), so the
  // conditional mount is hook-safe.
  if (!isManagedMode()) return null;
  return <SyncAgentInner />;
}

function SyncAgentInner() {
  const latest = useQuery(api.sync.latestSeq);
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  const latestRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof latest === "number") latestRef.current = latest;
  }, [latest]);

  // One-time bootstrap: enqueue all existing local rows, then drain.
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void ensureInitialSyncEnqueued()
      .then(() => pushLoop())
      .catch((err) => console.warn("[sync] initial bootstrap failed:", err));
  }, []);

  // Push soon after local writes land (debounce batches bursts).
  useEffect(() => {
    if (pending === 0) return undefined;
    const t = setTimeout(() => {
      void pushLoop().catch((err) => console.warn("[sync] push failed:", err));
    }, 600);
    return () => clearTimeout(t);
  }, [pending]);

  // Sweep: retries failed pushes even when the count didn't change, and
  // re-checks the pull cursor (a pull that errored mid-run has no other
  // re-trigger until the next remote write).
  useEffect(() => {
    const t = setInterval(() => {
      void db.outbox.count().then((n) => {
        if (n > 0) void pushLoop().catch(() => {});
      });
      void (async () => {
        const cursor = (await getMeta<number>("syncCursor")) ?? 0;
        const latest = latestRef.current;
        if (typeof latest === "number" && latest > cursor) await pullOnce();
      })().catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Pull when the server moves past our cursor.
  useEffect(() => {
    if (typeof latest !== "number") return;
    void (async () => {
      const cursor = (await getMeta<number>("syncCursor")) ?? 0;
      if (latest > cursor) await pullOnce();
    })().catch((err) => console.warn("[sync] pull failed:", err));
  }, [latest]);

  // Reconnects flush both directions.
  useEffect(() => {
    const onOnline = (): void => {
      void pushLoop().catch(() => {});
      void pullOnce().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}

export default SyncAgent;
