// src/hooks/useSettings.tsx
// App-wide settings (OpenRouter key + prefs) held in a single React context
// so every consumer shares one source of truth. This matters for the key:
// when one place clears it (a 401 reset, the Settings "Remove key" button),
// the gate — which lives in a different part of the tree — must immediately
// re-render and show the setup screen. Independent useState copies would
// each hold their own stale value, so the change is lifted here instead.
import {
  createContext, useCallback, useContext, useMemo, useState,
  type ReactNode,
} from "react";
import type { CustomModel } from "../lib/cost";

export type { CustomModel };

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
}

const DEFAULT_PREFS: Prefs = {
  defaultModelId: "flash",
  branchMode:     "follow",
  customModels:   [],
  theme:          "dark",
  sidebarCollapsed: false,
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
  return {
    ...DEFAULT_PREFS,
    ...stored,
    ...(themeFromKey ? { theme: themeFromKey } : {}),
  };
}

/** Apply a theme to the document and persist it. Safe to call before React mounts. */
export function applyTheme(mode: ThemeMode): void {
  try {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem(KEYS.theme, mode);
  } catch { /* ignore */ }
}

export interface SettingsContextValue {
  apiKey:      string;
  setApiKey:   (key: string) => void;
  clearApiKey: () => void;
  prefs:       Prefs;
  setPref:     <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setTheme:    (mode: ThemeMode) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [apiKey, _setApiKey] = useState(() => localStorage.getItem(KEYS.apiKey) ?? "");
  const [prefs,  _setPrefs]  = useState<Prefs>(loadPrefs);

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem(KEYS.apiKey, key.trim());
    _setApiKey(key.trim());
  }, []);

  const clearApiKey = useCallback(() => {
    localStorage.removeItem(KEYS.apiKey);
    _setApiKey("");
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    _setPrefs(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(KEYS.prefs, JSON.stringify(next));
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

  const value = useMemo<SettingsContextValue>(() => ({
    apiKey, setApiKey, clearApiKey, prefs, setPref, setTheme,
  }), [apiKey, setApiKey, clearApiKey, prefs, setPref, setTheme]);

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
