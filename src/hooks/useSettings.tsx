// src/hooks/useSettings.tsx
// App-wide settings (OpenRouter key + prefs) held in a single React context
// so every consumer shares one source of truth. This matters for the key:
// when one place clears it (a 401 reset, the Settings "Remove key" button),
// the gate — which lives in a different part of the tree — must immediately
// re-render and show the setup screen. Independent useState copies would
// each hold their own stale value, so the change is lifted here instead.
//
// Two key sources since the managed backend landed: the user's own BYOK key
// (localStorage, exactly the original behavior) and the per-user MANAGED key
// (provisioned server-side, pushed in by AuthGate after sign-in, held in
// memory only — never persisted). `apiKey` resolves BYOK-first; `keySource`
// tells send paths which pool the call spends (BYOK = the user's own
// OpenRouter account, managed = cogninode credits).
import {
  createContext, useCallback, useContext, useMemo, useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_MODEL_ID, DEFAULT_PINNED_MODEL_IDS, type CustomModel,
} from "../lib/cost";
import { LEGACY_MODEL_IDS } from "../lib/models";

export type ThemeMode = "light" | "dark";

const KEYS = {
  apiKey:  "cogninode_api_key",
  prefs:   "cogninode_prefs",
  theme:   "cogninode_theme",
} as const;

export interface Prefs {
  defaultModelId:  string;
  branchMode:      "follow" | "stay";
  customModels:    CustomModel[];
  theme:           ThemeMode;
  /** Slim the left sidebar to an icon-only rail. Toggled via ⌃B / the rail
   *  button; lives here (not local state) so the .shell grid in the page
   *  shells and the .side rail share one source of truth. */
  sidebarCollapsed: boolean;
  /** Models starred in the picker — float to the top. Defaults to the
   *  curated set from cost.ts. */
  pinnedModelIds:  string[];
  /** Hybrid search: keyword works always; when this is on, an embedding
   *  model downloads in the background and upgrades retrieval to
   *  keyword+semantic. Turning it off deletes vectors + cached weights. */
  semanticSearch:  boolean;
  /** Which local embedding model powers semantic search — an id from
   *  EMBEDDING_MODELS (lib/search/embedding/models.ts). */
  embeddingModelId: string;
  /** Follow the reply (and a thinking model's reasoning) to the bottom as it
   *  streams. On by default; turn off to keep the scroll where you put it. */
  autoScroll:      boolean;
}

const DEFAULT_PREFS: Prefs = {
  defaultModelId: DEFAULT_MODEL_ID,
  branchMode:     "follow",
  customModels:   [],
  theme:          "dark",
  sidebarCollapsed: false,
  pinnedModelIds: DEFAULT_PINNED_MODEL_IDS,
  semanticSearch: true,
  embeddingModelId: "bge-small",
  autoScroll:     true,
};

function readStoredTheme(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(KEYS.theme);
    if (raw === "light" || raw === "dark") return raw;
    return null;
  } catch {
    return null;
  }
}

function loadPrefs(): Prefs {
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEYS.prefs) ?? "{}") as Partial<Prefs>;
  } catch { /* ignore */ }
  // Theme has its own dedicated localStorage key (consumed by the pre-paint
  // bootstrap in index.html) — that takes precedence over a stale prefs blob.
  const themeFromKey = readStoredTheme();
  const merged: Prefs = {
    ...DEFAULT_PREFS,
    ...stored,
    ...(themeFromKey ? { theme: themeFromKey } : {}),
  };
  // Migrate pre-catalog prefs: old builtin slugs ("flash") → OpenRouter ids.
  const legacyDefault = LEGACY_MODEL_IDS[merged.defaultModelId];
  if (legacyDefault) merged.defaultModelId = legacyDefault;
  if (!Array.isArray(merged.pinnedModelIds)) {
    merged.pinnedModelIds = DEFAULT_PINNED_MODEL_IDS;
  }
  return merged;
}

/** Apply a theme to the document and persist it. Safe to call before React mounts. */
export function applyTheme(mode: ThemeMode): void {
  try {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem(KEYS.theme, mode);
  } catch { /* ignore */ }
}

export type KeySource = "byok" | "managed";

export interface SettingsContextValue {
  /** Resolved key for OpenRouter calls: BYOK when the user set their own,
   *  else the managed per-user key (empty until AuthGate pushes it). */
  apiKey:      string;
  /** Which pool `apiKey` draws from. Only meaningful while apiKey is set. */
  keySource:   KeySource;
  /** Set/clear the BYOK key (names kept from the BYOK-only era — every
   *  existing consumer keeps compiling). */
  setApiKey:   (key: string) => void;
  clearApiKey: () => void;
  /** Internal: AuthGate pushes the managed key here after sign-in (and
   *  clears it on sign-out). Nothing else should call this. */
  setManagedKey: (key: string) => void;
  prefs:       Prefs;
  setPref:     <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setTheme:    (mode: ThemeMode) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [byokKey, _setByokKey] = useState(() => {
    try {
      return localStorage.getItem(KEYS.apiKey) ?? "";
    } catch {
      return "";
    }
  });
  // In-memory only — the managed key must never touch localStorage.
  const [managedKey, setManagedKey] = useState("");
  const [prefs,  _setPrefs]  = useState<Prefs>(loadPrefs);

  const setApiKey = useCallback((key: string) => {
    try {
      localStorage.setItem(KEYS.apiKey, key.trim());
    } catch { /* ignore */ }
    _setByokKey(key.trim());
  }, []);

  const clearApiKey = useCallback(() => {
    try {
      localStorage.removeItem(KEYS.apiKey);
    } catch { /* ignore */ }
    _setByokKey("");
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    _setPrefs(prev => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(KEYS.prefs, JSON.stringify(next));
      } catch { /* ignore */ }
      // Theme is the single side-effect-bearing pref: mirror it to the
      // <html> attribute and its dedicated key so the pre-paint bootstrap
      // sees the latest value on next load.
      if (key === "theme") applyTheme(value as ThemeMode);
      return next;
    });
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setPref("theme", mode);
  }, [setPref]);

  const apiKey    = byokKey || managedKey;
  const keySource: KeySource = byokKey ? "byok" : "managed";

  const value = useMemo<SettingsContextValue>(() => ({
    apiKey, keySource, setApiKey, clearApiKey, setManagedKey,
    prefs, setPref, setTheme,
  }), [apiKey, keySource, setApiKey, clearApiKey, setManagedKey,
       prefs, setPref, setTheme]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used inside <SettingsProvider>");
  }
  return ctx;
}
