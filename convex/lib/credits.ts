// convex/lib/credits.ts
// Server copy of the credit constants. The client mirror lives in
// src/lib/credits.ts — keep both trivially small and in sync. Pinned: 1
// credit = $0.0005 of OpenRouter API cost (≈ one cheap-model message), sold
// to the user at 2× (₹0.10). Overridable per deployment via env vars.

import { env } from "./env";

function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** USD of upstream OpenRouter spend covered by one credit. */
export function usdPerCredit(): number {
  return envNumber("USD_PER_CREDIT", 0.0005);
}

/** Free credits granted to every new signup. */
export function starterCredits(): number {
  return envNumber("STARTER_CREDITS", 100);
}

/** Convert a credit balance to the upstream USD budget it represents.
 *  Rounded to 6 decimals — OpenRouter limits are USD amounts and float
 *  noise (e.g. 0.049999999) would churn the re-peg PATCH for nothing. */
export function creditsToUsdBudget(credits: number): number {
  return Math.round(credits * usdPerCredit() * 1e6) / 1e6;
}
