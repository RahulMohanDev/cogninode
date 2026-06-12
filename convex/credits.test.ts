// convex/credits.test.ts
// Money-path invariants: one charge per assistant message (outbox retries
// must be free), balance always equals the ledger sum, estimated web-search
// sends carry the plugin surcharge, and the starter grant lands in the
// ledger at user creation.
// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);

async function seededUser() {
  const tx = convexTest(schema, modules);
  const asUser = tx.withIdentity({ subject: "user_a" });
  await asUser.mutation(api.users.ensure, {});
  return { tx, asUser };
}

const baseReport = {
  usdCost: 0.0023,
  costSource: "upstream" as const,
  modelId: "google/gemini-2.5-flash",
  inputTokens: 1200,
  outputTokens: 500,
  webSearch: false,
};

describe("starter grant", () => {
  it("lands in the ledger at creation, balance matches", async () => {
    const { tx, asUser } = await seededUser();
    const rows = await tx.run(async (ctx) => ctx.db.query("creditLedger").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("grant_starter");
    expect(rows[0]!.credits).toBe(100);
    expect(await asUser.query(api.credits.balance, {})).toBe(100);
  });
});

describe("reportUsage", () => {
  it("charges ceil(usd / 0.0005) with a 1-credit floor", async () => {
    const { asUser } = await seededUser();
    // 0.0023 / 0.0005 = 4.6 → 5 credits
    const res = await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      messageClientId: "m1",
    });
    expect(res).toEqual({ credits: 5, duplicate: false });
    expect(await asUser.query(api.credits.balance, {})).toBe(95);

    const tiny = await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      usdCost: 0.000001,
      messageClientId: "m2",
    });
    expect(tiny.credits).toBe(1);
  });

  it("is idempotent by messageClientId", async () => {
    const { asUser } = await seededUser();
    await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      messageClientId: "m1",
    });
    const dupe = await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      messageClientId: "m1",
    });
    expect(dupe.duplicate).toBe(true);
    expect(await asUser.query(api.credits.balance, {})).toBe(95);
  });

  it("adds the web-search surcharge only on estimated costs", async () => {
    const { asUser } = await seededUser();
    // Upstream cost already includes the plugin fee — no surcharge.
    const upstream = await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      webSearch: true,
      messageClientId: "m1",
    });
    expect(upstream.credits).toBe(5);
    // Estimated fallback: + $0.02 → (0.0023 + 0.02) / 0.0005 = 44.6 → 45.
    const estimated = await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      costSource: "estimated",
      webSearch: true,
      messageClientId: "m2",
    });
    expect(estimated.credits).toBe(45);
  });

  it("lets the balance go negative but keeps the ledger consistent", async () => {
    const { tx, asUser } = await seededUser();
    await asUser.mutation(api.credits.reportUsage, {
      ...baseReport,
      usdCost: 0.06, // 120 credits > 100 starter
      messageClientId: "m1",
    });
    const balance = await asUser.query(api.credits.balance, {});
    expect(balance).toBe(-20);
    const sum = await tx.run(async (ctx) => {
      const rows = await ctx.db.query("creditLedger").collect();
      return rows.reduce((s, r) => s + r.credits, 0);
    });
    expect(sum).toBe(balance);
  });

  it("rejects unauthenticated reports", async () => {
    const tx = convexTest(schema, modules);
    await expect(
      tx.mutation(api.credits.reportUsage, {
        ...baseReport,
        messageClientId: "m1",
      }),
    ).rejects.toThrow(/requires authentication/);
  });
});

describe("backfillStarterGrants", () => {
  it("adds rows only for users missing one", async () => {
    const { tx } = await seededUser();
    // Simulate a pre-ledger user: row without a grant.
    await tx.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: "user_old",
        keyStatus: "active",
        creditsBalance: 100,
        createdAt: 1,
      });
    });
    const res = await tx.mutation(internal.credits.backfillStarterGrants, {});
    expect(res.added).toBe(1);
    const again = await tx.mutation(internal.credits.backfillStarterGrants, {});
    expect(again.added).toBe(0);
  });
});
