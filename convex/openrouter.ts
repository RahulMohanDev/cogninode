// convex/openrouter.ts
// Talks to OpenRouter's Management API (https://openrouter.ai/api/v1/keys)
// with the deployment-level OPENROUTER_MANAGEMENT_KEY. Creates one runtime
// key per user with a USD spend `limit` — the upstream enforcement backstop
// for the credits system. The raw key is returned exactly ONCE at creation;
// if we ever fail to store it, the orphaned key must be disabled upstream
// before re-provisioning (handled below).
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
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
