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

/** Per-message charge: whole credits, minimum 1. The ratio is rounded to 6
 *  decimals before ceil so float noise (0.001/0.0005 → 2.0000000000000004)
 *  can't bump a message into the next credit. Mirror of the client's
 *  src/lib/credits.ts — keep in sync. */
export function usdToCredits(usd: number): number {
  if (!(usd > 0)) return 1;
  const ratio = Math.round((usd / usdPerCredit()) * 1e6) / 1e6;
  return Math.max(1, Math.ceil(ratio));
}

/** Flat surcharge applied when a send used OpenRouter's web plugin but the
 *  response carried no upstream cost (estimated fallback) — the plugin fee
 *  (~$0.02 at 5 results) would otherwise go uncharged entirely. When the
 *  upstream usage.cost is present it already includes the plugin fee. */
export const WEB_SEARCH_FALLBACK_USD = 0.02;

/** The one credit pack: ₹300 → 3,000 credits (≈52% gross margin after
 *  Razorpay ~2.36% all-in and OpenRouter's 5.5% credit-purchase fee). */
export function packInr(): number {
  return envNumber("PACK_INR", 300);
}

export function packCredits(): number {
  return envNumber("PACK_CREDITS", 3000);
}

/** Drift below this is absorbed into margin: auto-title calls (~$0.0001
 *  per session) and rounding noise stay free. Above it, reconciliation
 *  DOCKS the credits — client usage reports are an optimistic fast path,
 *  but OpenRouter's authoritative per-key usage is what ultimately bills.
 *  Without docking, a client that under-reports (or never reports) would
 *  keep its balance — and the re-peg would keep refilling its upstream
 *  headroom — forever. Worst-case free ride: this allowance per cycle. */
export const DRIFT_ALLOWANCE_USD = 0.005;

export interface ReconcilePlan {
  /** Credits to dock via a reconcile_adjust ledger row (0 = none). */
  dockCredits: number;
  /** Drift in USD that the dock covers (0 when below allowance). */
  dockUsd: number;
  /** Upstream limit to PATCH: usage + budget of the post-dock balance. */
  targetLimitUsd: number;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Pure reconciliation math (unit-tested; the action applies it). */
export function planReconcile(
  usageUsd: number,
  reportedUsd: number,
  balanceCredits: number,
): ReconcilePlan {
  const drift = round6(usageUsd - reportedUsd);
  const dock = drift > DRIFT_ALLOWANCE_USD;
  const dockUsd = dock ? drift : 0;
  const dockCredits = dock
    ? Math.max(1, Math.ceil(round6(drift / usdPerCredit())))
    : 0;
  const newBalance = balanceCredits - dockCredits;
  return {
    dockCredits,
    dockUsd,
    targetLimitUsd: round6(
      usageUsd + creditsToUsdBudget(Math.max(0, newBalance)),
    ),
  };
}
