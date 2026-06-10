// src/lib/models.ts
// Live model catalog from OpenRouter's public GET /api/v1/models (no auth,
// edge-cached, ~340 models with live pricing). Flow:
//
//   ensureCatalog()  — on boot: fetch when the cache is empty; kick off a
//                      background refresh when it's older than the TTL.
//   refreshCatalog() — fetch → map → replace the Dexie `models` table
//                      wholesale (removed models disappear) → stamp meta.
//
// React reads the cache reactively via ModelsProvider; non-React code
// (StreamsProvider.send) resolves through the in-memory mirror kept in
// sync by the provider. Until the first fetch lands, FALLBACK_MODELS from
// cost.ts keeps everything working offline.

import { db, getMeta, type CatalogModel } from "./db";
import {
  FALLBACK_MODELS,
  type CustomModel,
  type ModelDef,
} from "./cost";

export const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
export const CATALOG_TTL_MS  = 24 * 60 * 60 * 1000;
export const CATALOG_FETCHED_AT_KEY = "catalogFetchedAt";

/** Old builtin slug ids → OpenRouter ids. Message history and stored prefs
 *  written before the live catalog keep resolving through this map. The
 *  "flash" target moved to gemini-3.1-flash-lite because its original model
 *  (gemini-2.0-flash-001) no longer exists on OpenRouter. */
export const LEGACY_MODEL_IDS: Record<string, string> = {
  llama:  "meta-llama/llama-3.3-70b-instruct:free",
  flash:  "google/gemini-3.1-flash-lite",
  dsv3:   "deepseek/deepseek-chat",
  "4omini": "openai/gpt-4o-mini",
  dsr1:   "deepseek/deepseek-r1",
  haiku:  "anthropic/claude-haiku-4.5",
  gpt4o:  "openai/gpt-4o",
  sonnet: "anthropic/claude-sonnet-4.5",
};

// ── API mapping ────────────────────────────────────────────────────────

/** The subset of the /api/v1/models record shape we consume. */
export interface OpenRouterApiModel {
  id:              string;
  name:            string;
  created?:        number;
  context_length?: number | null;
  architecture?: {
    input_modalities?:  string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?:     string;   // USD per TOKEN, stringified
    completion?: string;
  };
  supported_parameters?: string[];
}

/** "0.0000005" USD/token → 0.5 USD/M tokens. null for missing, non-finite,
 *  or negative (dynamic-pricing router aliases report "-1"). */
function perM(perToken: string | undefined): number | null {
  if (perToken === undefined) return null;
  const f = parseFloat(perToken);
  if (!Number.isFinite(f) || f < 0) return null;
  // Round to 6 decimals to undo float noise from the per-token scale.
  return Math.round(f * 1e12) / 1e6;
}

/** API names look like "OpenAI: GPT-4o Mini" — split vendor off the front;
 *  fall back to the org segment of the id. */
function splitName(apiName: string, id: string): { vendor: string; name: string } {
  const idx = apiName.indexOf(":");
  if (idx > 0) {
    return {
      vendor: apiName.slice(0, idx).trim(),
      name:   apiName.slice(idx + 1).trim(),
    };
  }
  const org = id.split("/")[0] ?? "";
  const vendor = org ? org.charAt(0).toUpperCase() + org.slice(1) : "";
  return { vendor, name: apiName.trim() };
}

/** Map one API record to a cache row. Returns null for models we can't use
 *  in chat: no text output, or unknown/dynamic pricing. */
export function mapApiModel(raw: OpenRouterApiModel): CatalogModel | null {
  const outputModalities = raw.architecture?.output_modalities ?? [];
  if (!outputModalities.includes("text")) return null;

  const promptPerM     = perM(raw.pricing?.prompt);
  const completionPerM = perM(raw.pricing?.completion);
  if (promptPerM === null || completionPerM === null) return null;

  const { vendor, name } = splitName(raw.name, raw.id);
  return {
    _id:                 raw.id,
    name,
    vendor,
    contextLength:       raw.context_length ?? 0,
    promptPerM,
    completionPerM,
    inputModalities:     raw.architecture?.input_modalities ?? ["text"],
    outputModalities,
    supportedParameters: raw.supported_parameters ?? [],
    created:             raw.created ?? 0,
  };
}

/** 131072 → "131k", 1048576 → "1M". */
export function formatContext(n: number): string {
  if (!n) return "?";
  if (n >= 1_000_000) {
    const m = Math.round(n / 100_000) / 10;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function catalogToModelDef(c: CatalogModel): ModelDef {
  const reasoning = c.supportedParameters.includes("reasoning");
  return {
    id:              c._id,
    openRouterId:    c._id,
    name:            c.name,
    vendor:          c.vendor,
    tag:             `${formatContext(c.contextLength)} ctx${reasoning ? " · reasoning" : ""}`,
    inputPricePerM:  c.promptPerM,
    outputPricePerM: c.completionPerM,
  };
}

// ── Resolution ─────────────────────────────────────────────────────────

/** Resolve a stored model id against custom models first, then the given
 *  catalog (live rows, or FALLBACK_MODELS when the cache is empty), then
 *  the legacy slug map. undefined = genuinely unknown. */
export function resolveModelFrom(
  id:           string | undefined,
  catalog:      ModelDef[],
  customModels: CustomModel[] = [],
): ModelDef | undefined {
  if (!id) return undefined;
  const custom = customModels.find(m => m.id === id);
  if (custom) return custom;
  const direct = catalog.find(m => m.id === id);
  if (direct) return direct;
  const legacy = LEGACY_MODEL_IDS[id];
  if (legacy) {
    return catalog.find(m => m.id === legacy)
      ?? FALLBACK_MODELS.find(m => m.id === legacy);
  }
  return FALLBACK_MODELS.find(m => m.id === id);
}

// In-memory mirror of the effective catalog so non-React code paths
// (StreamsProvider.send is a plain event handler) can resolve synchronously.
// ModelsProvider keeps it in sync with the Dexie cache.
let mirror: ModelDef[] = FALLBACK_MODELS;

export function setCatalogMirror(defs: ModelDef[]): void {
  mirror = defs.length > 0 ? defs : FALLBACK_MODELS;
}

export function resolveModelSync(
  id:           string | undefined,
  customModels: CustomModel[] = [],
): ModelDef | undefined {
  return resolveModelFrom(id, mirror, customModels);
}

// ── Fetch / refresh / bootstrap ────────────────────────────────────────

export async function fetchCatalog(): Promise<CatalogModel[]> {
  const res = await fetch(MODELS_ENDPOINT);
  if (!res.ok) throw new Error(`OpenRouter /models returned HTTP ${res.status}`);
  const json = await res.json() as { data?: OpenRouterApiModel[] };
  if (!Array.isArray(json.data)) throw new Error("Unexpected /models response shape");
  return json.data
    .map(mapApiModel)
    .filter((m): m is CatalogModel => m !== null);
}

export async function refreshCatalog(): Promise<{ count: number; fetchedAt: number }> {
  const rows = await fetchCatalog();
  if (rows.length === 0) throw new Error("OpenRouter returned an empty catalog");
  const fetchedAt = Date.now();
  await db.transaction("rw", db.models, db.meta, async () => {
    await db.models.clear();
    await db.models.bulkAdd(rows);
    await db.meta.put({ key: CATALOG_FETCHED_AT_KEY, value: fetchedAt });
  });
  return { count: rows.length, fetchedAt };
}

export async function getCatalogFetchedAt(): Promise<number | null> {
  return (await getMeta<number>(CATALOG_FETCHED_AT_KEY)) ?? null;
}

/** Boot-time bootstrap: blocking fetch when the cache is empty (first run),
 *  fire-and-forget refresh when stale. Failures degrade to the fallback
 *  list silently — the app must keep working offline. */
export async function ensureCatalog(): Promise<void> {
  try {
    const count = await db.models.count();
    if (count === 0) {
      await refreshCatalog();
      return;
    }
    const fetchedAt = await getCatalogFetchedAt();
    if (fetchedAt === null || Date.now() - fetchedAt > CATALOG_TTL_MS) {
      void refreshCatalog().catch((err: unknown) => {
        console.warn("[models] background catalog refresh failed:", err);
      });
    }
  } catch (err) {
    console.warn("[models] catalog bootstrap failed — using fallback list:", err);
  }
}