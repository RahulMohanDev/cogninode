// src/hooks/useSearchState.ts
// Reactive view over the search service's state machine. Module-level
// subscribe/snapshot functions keep identities stable for
// useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { searchService, type SearchState } from "../lib/search/service";

const subscribe   = (cb: () => void): (() => void) => searchService.subscribe(cb);
const getSnapshot = (): SearchState => searchService.getState();

export function useSearchState(): SearchState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Short human label for the semantic layer's current phase. */
export function semanticStatusLabel(s: SearchState): string {
  switch (s.semantic) {
    case "off":         return "keyword only";
    case "starting":    return "semantic: preparing…";
    case "downloading": return `semantic: downloading ${s.downloadPct}%`;
    case "indexing":    return `semantic: indexing ${s.indexed}/${s.indexTotal}`;
    case "ready":       return "hybrid search";
    case "error":       return "semantic unavailable";
  }
}