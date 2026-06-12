// src/hooks/useTiers.tsx
// Simple-mode tier catalog (Fast / Thinking → concrete model + pricing).
// Same dual-mode pattern as useCredits: the context mounts in both modes,
// the Convex subscription lives in a managed-only bridge. The latest server
// result is snapshotted into Dexie meta so the picker works offline / while
// the subscription warms (mirrors setCatalogMirror's role for the catalog).

import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isManagedMode } from "../lib/managedConfig";
import { getMeta, setMeta } from "../lib/db";

export interface Tier {
  key: string;
  displayName: string;
  blurb: string;
  modelId: string;
  promptPerM: number;
  completionPerM: number;
}

const SNAPSHOT_KEY = "tiersSnapshot";

interface TiersContextValue {
  /** Active tiers in display order; null in local mode or before any data
   *  (live or snapshot) is available — consumers fall back to advanced. */
  tiers: Tier[] | null;
}

const TiersContext = createContext<TiersContextValue>({ tiers: null });

export function TiersProvider({ children }: { children: ReactNode }) {
  const managed = isManagedMode();
  const [tiers, setTiers] = useState<Tier[] | null>(null);

  // Last-known snapshot keeps simple mode alive before the live query
  // resolves (and offline). Live data always wins once it lands.
  useEffect(() => {
    if (!managed) return;
    void getMeta<Tier[]>(SNAPSHOT_KEY).then((snap) => {
      if (snap && snap.length > 0) {
        setTiers((prev) => prev ?? snap);
      }
    });
  }, [managed]);

  const value = useMemo<TiersContextValue>(() => ({ tiers }), [tiers]);

  return (
    <TiersContext.Provider value={value}>
      {children}
      {managed && <TiersBridge onTiers={setTiers} />}
    </TiersContext.Provider>
  );
}

function TiersBridge({ onTiers }: { onTiers: (t: Tier[] | null) => void }) {
  const rows = useQuery(api.tiers.list);
  useEffect(() => {
    if (rows === undefined) return;
    if (rows.length === 0) {
      onTiers(null); // unseeded deployment — fall back to advanced picker
      return;
    }
    onTiers(rows);
    void setMeta(SNAPSHOT_KEY, rows);
  }, [rows, onTiers]);
  return null;
}

export function useTiers(): TiersContextValue {
  return useContext(TiersContext);
}
