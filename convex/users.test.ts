// convex/users.test.ts
// Server-function tests via convex-test (in-memory Convex runtime). The
// load-bearing invariants: webhook double-delivery never duplicates a user,
// raw keys are only ever visible to their authenticated owner, and the
// starter balance is granted exactly once at creation.
// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Explicit array form — the README's `!(*.*.*)` extglob matches nothing
// under rolldown-vite's glob impl, so convex-test can't find _generated.
const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);

function t() {
  return convexTest(schema, modules);
}

describe("users.upsertFromClerk", () => {
  it("is idempotent under webhook re-delivery", async () => {
    const tx = t();
    await tx.mutation(internal.users.upsertFromClerk, {
      clerkUserId: "user_a",
      email: "a@example.com",
    });
    await tx.mutation(internal.users.upsertFromClerk, {
      clerkUserId: "user_a",
      email: "a@example.com",
    });
    const rows = await tx.run(async (ctx) => ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keyStatus).toBe("provisioning");
    expect(rows[0]!.creditsBalance).toBe(100);
  });

  it("updates profile fields without touching balance", async () => {
    const tx = t();
    await tx.mutation(internal.users.upsertFromClerk, { clerkUserId: "user_a" });
    await tx.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      await ctx.db.patch(user!._id, { creditsBalance: 42 });
    });
    await tx.mutation(internal.users.upsertFromClerk, {
      clerkUserId: "user_a",
      email: "new@example.com",
    });
    const user = await tx.run(async (ctx) => ctx.db.query("users").first());
    expect(user!.email).toBe("new@example.com");
    expect(user!.creditsBalance).toBe(42);
  });
});

describe("users.ensure", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(t().mutation(api.users.ensure, {})).rejects.toThrow(
      /requires authentication/,
    );
  });

  it("creates the row from the session identity, once", async () => {
    const tx = t();
    const asUser = tx.withIdentity({ subject: "user_b", email: "b@example.com" });
    await asUser.mutation(api.users.ensure, {});
    await asUser.mutation(api.users.ensure, {});
    const rows = await tx.run(async (ctx) => ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clerkUserId).toBe("user_b");
  });
});

describe("users.current", () => {
  it("returns null when unauthenticated or unknown", async () => {
    const tx = t();
    expect(await tx.query(api.users.current, {})).toBeNull();
    expect(
      await tx.withIdentity({ subject: "ghost" }).query(api.users.current, {}),
    ).toBeNull();
  });

  it("hides soft-deleted users", async () => {
    const tx = t();
    const asUser = tx.withIdentity({ subject: "user_c" });
    await asUser.mutation(api.users.ensure, {});
    expect(await asUser.query(api.users.current, {})).not.toBeNull();
    await tx.mutation(internal.users.markDeleted, { clerkUserId: "user_c" });
    expect(await asUser.query(api.users.current, {})).toBeNull();
  });
});

describe("keys.getMine", () => {
  it("returns the raw key only to its owner", async () => {
    const tx = t();
    const asA = tx.withIdentity({ subject: "user_a" });
    const asB = tx.withIdentity({ subject: "user_b" });
    await asA.mutation(api.users.ensure, {});
    await asB.mutation(api.users.ensure, {});

    const userA = await tx.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "user_a"))
        .unique(),
    );
    await tx.mutation(internal.keys.store, {
      userId: userA!._id,
      apiKey: "sk-or-v1-raw",
      keyHash: "hash_a",
      limitUsd: 0.05,
    });

    expect(await tx.query(api.keys.getMine, {})).toBeNull();
    expect(await asB.query(api.keys.getMine, {})).toBeNull();
    expect(await asA.query(api.keys.getMine, {})).toEqual({
      apiKey: "sk-or-v1-raw",
      disabled: false,
    });
  });

  it("store is first-write-wins and activates the user", async () => {
    const tx = t();
    const asA = tx.withIdentity({ subject: "user_a" });
    await asA.mutation(api.users.ensure, {});
    const userA = await tx.run(async (ctx) => ctx.db.query("users").first());

    const first = await tx.mutation(internal.keys.store, {
      userId: userA!._id,
      apiKey: "sk-1",
      keyHash: "h1",
      limitUsd: 0.05,
    });
    const second = await tx.mutation(internal.keys.store, {
      userId: userA!._id,
      apiKey: "sk-2",
      keyHash: "h2",
      limitUsd: 0.05,
    });
    expect(first.stored).toBe(true);
    expect(second.stored).toBe(false);
    expect(await asA.query(api.keys.getMine, {})).toEqual({
      apiKey: "sk-1",
      disabled: false,
    });
    expect((await asA.query(api.users.current, {}))!.keyStatus).toBe("active");
  });
});
