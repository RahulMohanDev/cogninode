// src/lib/cost.ts
// Cost math + display formatting, and the OFFLINE FALLBACK model list.
//
// The app's model catalog is live: fetched from OpenRouter's public
// GET /api/v1/models and cached in Dexie (see lib/models.ts). The fallback
// list below exists only so the app works on first load without network —
// it's a snapshot of 8 popular catalog entries. Ids ARE OpenRouter ids, so
// fallback and live records mix freely and message history stays resolvable
// either way. Prices verified against the live API on 2026-06-10.

export interface ModelDef {
  id:              string;   // OpenRouter model id (legacy slugs resolve via LEGACY_MODEL_IDS)
  name:            string;
  openRouterId:    string;
  inputPricePerM:  number;   // USD per million input tokens
  outputPricePerM: number;   // USD per million output tokens
  vendor:          string;
  tag:             string;
}

export interface CustomModel extends ModelDef {
  isCustom: true;
}

export const FALLBACK_MODELS: ModelDef[] = [
  { id: "meta-llama/llama-3.3-70b-instruct:free", openRouterId: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B",      vendor: "Meta",      tag: "free",
    inputPricePerM: 0,    outputPricePerM: 0     },
  { id: "google/gemini-3.1-flash-lite", openRouterId: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite", vendor: "Google", tag: "budget · fast",
    inputPricePerM: 0.25, outputPricePerM: 1.50  },
  { id: "deepseek/deepseek-chat", openRouterId: "deepseek/deepseek-chat",
    name: "DeepSeek V3",        vendor: "DeepSeek",  tag: "budget · strong",
    inputPricePerM: 0.20, outputPricePerM: 0.80  },
  { id: "openai/gpt-4o-mini", openRouterId: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",        vendor: "OpenAI",    tag: "value",
    inputPricePerM: 0.15, outputPricePerM: 0.60  },
  { id: "deepseek/deepseek-r1", openRouterId: "deepseek/deepseek-r1",
    name: "DeepSeek R1",        vendor: "DeepSeek",  tag: "reasoning",
    inputPricePerM: 0.70, outputPricePerM: 2.50  },
  { id: "anthropic/claude-haiku-4.5", openRouterId: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",   vendor: "Anthropic", tag: "mid",
    inputPricePerM: 1.00, outputPricePerM: 5.00  },
  { id: "openai/gpt-4o", openRouterId: "openai/gpt-4o",
    name: "GPT-4o",             vendor: "OpenAI",    tag: "premium",
    inputPricePerM: 2.50, outputPricePerM: 10.00 },
  { id: "anthropic/claude-sonnet-4.5", openRouterId: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",  vendor: "Anthropic", tag: "premium",
    inputPricePerM: 3.00, outputPricePerM: 15.00 },
];

/** Default model for fresh installs — the budget-fast slot. */
export const DEFAULT_MODEL_ID = "google/gemini-3.1-flash-lite";

/** Default pinned set: the curated 8 float to the top of the picker. */
export const DEFAULT_PINNED_MODEL_IDS: string[] = FALLBACK_MODELS.map(m => m.id);

// ── Cost calculation ───────────────────────────────────────────

export const roughTokens = (text: string): number =>
  Math.ceil((text ?? "").length / 4);

export function calculateCostUsd(
  inputTokens:  number,
  outputTokens: number,
  model:        ModelDef,
): number {
  return (inputTokens  * model.inputPricePerM  / 1_000_000) +
         (outputTokens * model.outputPricePerM / 1_000_000);
}

export function estimateCostUsd(
  composerText: string,
  pathMessages: Array<{ content: string }>,
  model:        ModelDef,
): number {
  const inputTok =
    roughTokens(composerText) +
    pathMessages.reduce((s, m) => s + roughTokens(m.content), 0);
  return calculateCostUsd(inputTok, 550, model);
}

// ── Display formatting ─────────────────────────────────────────

export function formatCost(costUsd: number): string {
  if (costUsd === 0)       return "free";
  if (costUsd < 0.000_1)  return "< $0.0001";
  if (costUsd < 0.01)     return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(3)}`;
}

// In the composer: "~$0.0023" or "~free"
export function formatEstimate(costUsd: number): string {
  return costUsd === 0 ? "~free" : `~${formatCost(costUsd)}`;
}

/** Compact per-M price for picker rows: 0.25 → "$0.25", 10 → "$10". */
export function formatPerM(usdPerM: number): string {
  if (usdPerM === 0) return "free";
  const s = usdPerM < 1 ? usdPerM.toFixed(2) : usdPerM.toFixed(usdPerM % 1 === 0 ? 0 : 2);
  return `$${s}`;
}