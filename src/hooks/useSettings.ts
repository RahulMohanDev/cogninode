// src/hooks/useSettings.ts
import { useState, useCallback } from "react";
import type { CustomModel } from "../lib/cost";

export type { CustomModel };

const KEYS = {
  apiKey:  "cogninode_api_key",
  prefs:   "cogninode_prefs",
} as const;

export interface Prefs {
  defaultModelId:  string;
  branchMode:      "follow" | "stay";
  customModels:    CustomModel[];
}

const DEFAULT_PREFS: Prefs = {
  defaultModelId: "flash",
  branchMode:     "follow",
  customModels:   [],
};

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEYS.prefs) ?? "{}") };
  } catch { return DEFAULT_PREFS; }
}

export function useSettings() {
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
      return next;
    });
  }, []);

  return { apiKey, setApiKey, clearApiKey, prefs, setPref };
}
