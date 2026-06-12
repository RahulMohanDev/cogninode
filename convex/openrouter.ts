// convex/openrouter.ts
// Talks to OpenRouter's Management API (https://openrouter.ai/api/v1/keys)
// with the deployment-level OPENROUTER_MANAGEMENT_KEY. Creates one runtime
// key per user with a USD spend `limit` — the upstream enforcement backstop
// for the credits system. The raw key is returned exactly ONCE at creation;
// if we ever fail to store it, the orphaned key must be disabled upstream
// before re-provisioning (handled below).
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { creditsToUsdBudget, starterCredits } from "./lib/credits";
import { env } from "./lib/env";

const KEYS_URL = "https://openrouter.ai/api/v1/keys";

function managementKey(): string {
  const key = env("OPENROUTER_MANAGEMENT_KEY");
  if (!key) throw new Error("OPENROUTER_MANAGEMENT_KEY is not configured");
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${managementKey()}`,
    "Content-Type": "application/json",
  };
}

interface CreatedKeyResponse {
  key?: string;
  data?: { hash?: string; limit?: number | null };
}

export const provisionKey = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    // Idempotency: webhook retries and ensure() can both schedule us.
    const existing = await ctx.runQuery(internal.keys.getForUserInternal, {
      userId,
    });
    if (existing) {
      await ctx.runMutation(internal.users.setKeyStatus, {
        userId,
        keyStatus: "active",
      });
      return;
    }
    const user = await ctx.runQuery(internal.users.getInternal, { userId });
    if (!user || user.deletedAt !== undefined) return;

    try {
      // Limit covers the user's full current balance (starter grant now;
      // after Phase B the reconciliation re-peg owns this number).
      const limitUsd = creditsToUsdBudget(user.creditsBalance || starterCredits());
      const res = await fetch(KEYS_URL, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: `cogninode:${user.clerkUserId}`,
          limit: limitUsd,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter key creation failed: HTTP ${res.status} ${body.slice(0, 300)}`);
      }
      const payload = (await res.json()) as CreatedKeyResponse;
      const rawKey = payload.key;
      const hash = payload.data?.hash;
      if (!rawKey || !hash) {
        // Never log the raw key — log only which fields were present.
        throw new Error(
          `OpenRouter key creation returned unexpected shape (key: ${Boolean(rawKey)}, hash: ${Boolean(hash)})`,
        );
      }
      const result = await ctx.runMutation(internal.keys.store, {
        userId,
        apiKey: rawKey,
        keyHash: hash,
        limitUsd,
      });
      if (!result.stored) {
        // Lost a race with another provisioning run — this key's raw value
        // is now orphaned; disable it upstream so it can't be used.
        await disableUpstream(hash);
      }
    } catch (err) {
      await ctx.runMutation(internal.users.setKeyStatus, {
        userId,
        keyStatus: "error",
      });
      throw err;
    }
  },
});

interface RuntimeKeyInfo {
  data?: { usage?: number; limit?: number | null; limit_remaining?: number | null };
}

/** THE RE-PEG INVARIANT. The key's upstream USD limit must always equal
 *  (authoritative usage so far) + (the USD budget the current credit
 *  balance buys). This single rule:
 *   - absorbs costs we deliberately don't charge (auto-titles) into margin,
 *   - heals client under-reporting (killed tabs, failed outbox drains),
 *   - keeps the upstream 402 backstop aligned with "balance ≈ 0".
 *  Top-ups don't PATCH the limit directly — they bump the balance and run
 *  this, so there is exactly one code path that touches the limit. */
export const reconcileUser = internalAction({
  args: { userId: v.id("users") },
  // Return types annotated on the reconcile* trio: they reference
  // internal.openrouter.* from inside this module, and without annotations
  // TS flags the self-referential inference (TS7022).
  handler: async (ctx, { userId }): Promise<void> => {
    const keyRow = await ctx.runQuery(internal.keys.getForUserInternal, { userId });
    if (!keyRow || keyRow.disabled) return;
    const user = await ctx.runQuery(internal.users.getInternal, { userId });
    if (!user || user.deletedAt !== undefined) return;

    // Authoritative per-key usage — queried with the RUNTIME key itself
    // (O(1), no management-key pagination across all customers).
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${keyRow.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`key info fetch failed: HTTP ${res.status}`);
    }
    const info = (await res.json()) as RuntimeKeyInfo;
    const usage = typeof info.data?.usage === "number" ? info.data.usage : 0;

    const targetLimit =
      Math.round(
        (usage + creditsToUsdBudget(Math.max(0, user.creditsBalance))) * 1e6,
      ) / 1e6;
    if (Math.abs(targetLimit - keyRow.limitUsd) > 0.001) {
      const patch = await fetch(`${KEYS_URL}/${keyRow.keyHash}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ limit: targetLimit }),
      });
      if (!patch.ok) {
        const body = await patch.text();
        throw new Error(`limit re-peg failed: HTTP ${patch.status} ${body.slice(0, 300)}`);
      }
      await ctx.runMutation(internal.keys.setLimit, {
        userId,
        limitUsd: targetLimit,
      });
    }

    const driftUsd =
      Math.round((usage - (user.usdReportedTotal ?? 0)) * 1e6) / 1e6;
    // Loud log → alertable via Convex log streams. Positive drift beyond
    // noise = lost client reports or an extracted key being used outside
    // the app; auto-titles contribute a small expected baseline.
    if (driftUsd > 0.5 || (usage > 1 && driftUsd / usage > 0.1)) {
      console.error(
        `[alert] reconcile drift $${driftUsd} for user ${userId} (usage $${usage})`,
      );
    }
    await ctx.runMutation(internal.users.recordReconcile, { userId, driftUsd });
  },
});

/** Cron entry: fan reconciliation out over all active users, staggered so
 *  the management API never sees a burst. */
export const reconcileAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const userIds = await ctx.runQuery(internal.users.listActiveIdsInternal, {});
    for (let i = 0; i < userIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * 2000,
        internal.openrouter.reconcileUser,
        { userId: userIds[i]! },
      );
    }
    return { scheduled: userIds.length };
  },
});

/** Client-callable belt-and-braces: run my own reconcile (fired once on app
 *  open, and right after a top-up lands). */
export const reconcileMe = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("reconcileMe requires authentication");
    const user = await ctx.runQuery(internal.users.getByClerkIdInternal, {
      clerkUserId: identity.subject,
    });
    if (!user) return;
    await ctx.runAction(internal.openrouter.reconcileUser, { userId: user._id });
  },
});

export const disableKey = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const row = await ctx.runQuery(internal.keys.getForUserInternal, { userId });
    if (!row || row.disabled) return;
    await disableUpstream(row.keyHash);
    await ctx.runMutation(internal.keys.setDisabled, { userId, disabled: true });
  },
});

async function disableUpstream(hash: string): Promise<void> {
  const res = await fetch(`${KEYS_URL}/${hash}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ disabled: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter key disable failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
}
