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
import { creditsToUsdBudget, planReconcile, starterCredits } from "./lib/credits";
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
      // the reconciliation re-peg owns this number afterwards). Clamped —
      // a negative balance must never reach OpenRouter as a limit.
      const limitUsd = creditsToUsdBudget(
        Math.max(0, user.creditsBalance) || starterCredits(),
      );
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

/** THE RE-PEG INVARIANT, with authoritative billing. OpenRouter's per-key
 *  usage is the ground truth: drift between it and what the client
 *  reported gets DOCKED from the balance (above a small allowance that
 *  keeps auto-titles free), and only then is the key's upstream limit
 *  re-pegged to usage + the post-dock balance's budget. Client usage
 *  reports are an optimistic fast path — a client that under-reports or
 *  never reports settles up here, so skipped reports buy at most
 *  DRIFT_ALLOWANCE_USD per cycle instead of an ever-refilling limit.
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

    const reported = user.usdReportedTotal ?? 0;
    const plan = planReconcile(usage, reported, user.creditsBalance);

    if (plan.dockCredits > 0) {
      // Settle the unreported spend: ledger row + balance dock + true-up
      // of usdReportedTotal to the authoritative figure (so the next
      // cycle's drift starts from zero).
      await ctx.runMutation(internal.credits.applyReconcileAdjust, {
        userId,
        credits: plan.dockCredits,
        usdCost: plan.dockUsd,
        reportedTotal: usage,
      });
    }

    if (Math.abs(plan.targetLimitUsd - keyRow.limitUsd) > 0.001) {
      const patch = await fetch(`${KEYS_URL}/${keyRow.keyHash}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ limit: plan.targetLimitUsd }),
      });
      if (!patch.ok) {
        const body = await patch.text();
        throw new Error(`limit re-peg failed: HTTP ${patch.status} ${body.slice(0, 300)}`);
      }
      await ctx.runMutation(internal.keys.setLimit, {
        userId,
        limitUsd: plan.targetLimitUsd,
      });
    }

    const driftUsd = Math.round((usage - reported) * 1e6) / 1e6;
    // Loud log → alertable via Convex log streams. Big drift = lost client
    // reports or an extracted key being used outside the app (it's billed
    // either way now, but the pattern is worth eyes).
    if (driftUsd > 0.5 || (usage > 1 && driftUsd / usage > 0.1)) {
      console.error(
        `[alert] reconcile drift $${driftUsd} for user ${userId} (usage $${usage}) — docked ${plan.dockCredits} credits`,
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
