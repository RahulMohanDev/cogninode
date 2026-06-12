// src/lib/credits.ts
// Client copy of the credit constants + display math. The server mirror is
// convex/lib/credits.ts — keep both trivially small and in sync. Pinned:
// 1 credit = $0.0005 of OpenRouter API cost (≈ one cheap-model message),
// sold at ₹0.10 (2× markup). The SERVER's usdToCredits is authoritative for
// charging; this copy renders estimates and per-message chips.

export const USD_PER_CREDIT = 0.0005;
export const CREDIT_PRICE_INR = 0.10;
/** Mirror of the server's flat surcharge for web-search sends whose
 *  response carried no upstream cost (convex/lib/credits.ts) — the
 *  per-reply chip must show what the ledger actually deducted. */
export const WEB_SEARCH_FALLBACK_USD = 0.02;

/** The USD figure the server charges for a message — surcharge included. */
export function chargedUsd(
  costUsd: number,
  costSource: "upstream" | "estimated" | undefined,
  webSearch: boolean | undefined,
): number {
  return costUsd + (webSearch && costSource === "estimated" ? WEB_SEARCH_FALLBACK_USD : 0);
}

/** Per-message charge: whole credits, minimum 1. Ratio rounded to 6dp
 *  before ceil so float noise can't bump a message into the next credit.
 *  Must match convex/lib/credits.ts usdToCredits exactly. */
export function usdToCredits(usd: number): number {
  if (!(usd > 0)) return 1;
  const ratio = Math.round((usd / USD_PER_CREDIT) * 1e6) / 1e6;
  return Math.max(1, Math.ceil(ratio));
}

/** "1 credit" / "3,200 credits" */
export function formatCredits(n: number): string {
  return `${n.toLocaleString()} ${Math.abs(n) === 1 ? "credit" : "credits"}`;
}

/** Compact chip form: "3 cr" */
export function formatCreditsShort(n: number): string {
  return `${n.toLocaleString()} cr`;
}

/** Composer-pill estimate: "~1 cr", "~14 cr" */
export function formatCreditsEstimate(usd: number): string {
  return `~${usdToCredits(usd)} cr`;
}

// A "typical" message for per-model credit estimates on picker rows:
// ~1.5k input tokens (short path + question) and the same 550-token output
// convention estimateCostUsd uses.
export const EST_MSG_INPUT_TOKENS  = 1500;
export const EST_MSG_OUTPUT_TOKENS = 550;

/** "~N cr / message" figure for a model's picker row. */
export function estimateCreditsPerMessage(
  inputPricePerM: number,
  outputPricePerM: number,
): number {
  const usd =
    (EST_MSG_INPUT_TOKENS * inputPricePerM +
     EST_MSG_OUTPUT_TOKENS * outputPricePerM) / 1_000_000;
  return usdToCredits(usd);
}
