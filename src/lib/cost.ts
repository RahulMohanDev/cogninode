// src/lib/cost.ts

export interface ModelDef {
  id:              string;
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

export const BUILTIN_MODELS: ModelDef[] = [
  { id: "llama",  name: "Llama 3.1 70B",    vendor: "Meta",      tag: "free",
    openRouterId: "meta-llama/llama-3.1-70b-instruct:free",
    inputPricePerM: 0,     outputPricePerM: 0     },
  { id: "flash",  name: "Gemini Flash 2.0",  vendor: "Google",    tag: "budget · fast",
    openRouterId: "google/gemini-flash-2.0",
    inputPricePerM: 0.10,  outputPricePerM: 0.40  },
  { id: "dsv3",   name: "DeepSeek V3",       vendor: "DeepSeek",  tag: "budget · strong",
    openRouterId: "deepseek/deepseek-chat",
    inputPricePerM: 0.32,  outputPricePerM: 0.89  },
  { id: "4omini", name: "GPT-4o Mini",       vendor: "OpenAI",    tag: "value",
    openRouterId: "openai/gpt-4o-mini",
    inputPricePerM: 0.165, outputPricePerM: 0.66  },
  { id: "dsr1",   name: "DeepSeek R1",       vendor: "DeepSeek",  tag: "reasoning",
    openRouterId: "deepseek/deepseek-r1",
    inputPricePerM: 0.605, outputPricePerM: 2.41  },
  { id: "haiku",  name: "Claude Haiku 4.5",  vendor: "Anthropic", tag: "mid",
    openRouterId: "anthropic/claude-haiku-4-5",
    inputPricePerM: 1.10,  outputPricePerM: 5.50  },
  { id: "gpt4o",  name: "GPT-4o",            vendor: "OpenAI",    tag: "premium",
    openRouterId: "openai/gpt-4o",
    inputPricePerM: 2.75,  outputPricePerM: 11.00 },
  { id: "sonnet", name: "Claude Sonnet 4.5", vendor: "Anthropic", tag: "premium",
    openRouterId: "anthropic/claude-sonnet-4-5",
    inputPricePerM: 3.30,  outputPricePerM: 16.50 },
];

// Merged list including user-added custom models from localStorage prefs
export function getAllModels(customModels: CustomModel[] = []): ModelDef[] {
  return [...BUILTIN_MODELS, ...customModels];
}

export function getModel(id: string, customModels: CustomModel[] = []): ModelDef | undefined {
  return getAllModels(customModels).find(m => m.id === id);
}

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
