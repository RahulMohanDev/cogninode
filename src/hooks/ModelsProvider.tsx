// src/hooks/ModelsProvider.tsx
// Reactive view over the live model catalog cached in Dexie (lib/models.ts).
// One liveQuery at the top of the tree; every consumer (Composer picker,
// Settings sections, Message headers, cost estimates) reads through this
// context instead of opening its own subscription. Also keeps the module-
// level mirror in sync so non-React code (StreamsProvider.send) resolves
// the same list synchronously.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, getMeta } from "../lib/db";
import {
  FALLBACK_MODELS,
  type ModelDef,
} from "../lib/cost";
import {
  CATALOG_FETCHED_AT_KEY,
  catalogToModelDef,
  ensureCatalog,
  refreshCatalog,
  resolveModelFrom,
  setCatalogMirror,
} from "../lib/models";
import { useSettings } from "./useSettings";

export interface ModelsContextValue {
  /** Effective model list: live catalog (or fallback snapshot) + customs. */
  models:       ModelDef[];
  /** Raw cached catalog size. 0 = fallback list in use (no fetch yet). */
  catalogCount: number;
  /** When the catalog was last fetched, or null before the first fetch. */
  fetchedAt:    number | null;
  refreshing:   boolean;
  /** Manual refresh — throws on failure so callers can toast the error. */
  refresh:      () => Promise<{ count: number }>;
  /** Resolve a stored model id (custom → catalog → legacy slug map). */
  resolve:      (id: string | undefined) => ModelDef | undefined;
  pinnedIds:    string[];
  togglePinned: (id: string) => void;
}

const ModelsContext = createContext<ModelsContextValue | null>(null);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const { prefs, setPref } = useSettings();
  const [refreshing, setRefreshing] = useState(false);

  // Boot: fetch the catalog when empty, background-refresh when stale.
  useEffect(() => {
    void ensureCatalog();
  }, []);

  const catalogRows = useLiveQuery(() => db.models.toArray(), [], []);
  const fetchedAt = useLiveQuery(
    async () => (await getMeta<number>(CATALOG_FETCHED_AT_KEY)) ?? null,
    [],
    null,
  );

  // Live catalog mapped + sorted for stable picker grouping; fallback list
  // until the first fetch lands.
  const effective = useMemo<ModelDef[]>(() => {
    if (!catalogRows || catalogRows.length === 0) return FALLBACK_MODELS;
    const defs = catalogRows.map(catalogToModelDef);
    defs.sort((a, b) =>
      a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    return defs;
  }, [catalogRows]);

  // Mirror for synchronous resolution outside React (StreamsProvider.send).
  useEffect(() => {
    setCatalogMirror(effective);
  }, [effective]);

  const models = useMemo<ModelDef[]>(
    () => [...effective, ...prefs.customModels],
    [effective, prefs.customModels],
  );

  const resolve = useCallback(
    (id: string | undefined) => resolveModelFrom(id, effective, prefs.customModels),
    [effective, prefs.customModels],
  );

  const refresh = useCallback(async (): Promise<{ count: number }> => {
    setRefreshing(true);
    try {
      const { count } = await refreshCatalog();
      return { count };
    } finally {
      setRefreshing(false);
    }
  }, []);

  const togglePinned = useCallback((id: string) => {
    const cur = prefs.pinnedModelIds;
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    setPref("pinnedModelIds", next);
  }, [prefs.pinnedModelIds, setPref]);

  const value = useMemo<ModelsContextValue>(() => ({
    models,
    catalogCount: catalogRows?.length ?? 0,
    fetchedAt,
    refreshing,
    refresh,
    resolve,
    pinnedIds: prefs.pinnedModelIds,
    togglePinned,
  }), [models, catalogRows, fetchedAt, refreshing, refresh, resolve, prefs.pinnedModelIds, togglePinned]);

  return (
    <ModelsContext.Provider value={value}>
      {children}
    </ModelsContext.Provider>
  );
}

export function useModels(): ModelsContextValue {
  const ctx = useContext(ModelsContext);
  if (!ctx) throw new Error("useModels must be used inside <ModelsProvider>");
  return ctx;
}