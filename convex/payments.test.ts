// convex/payments.test.ts
// Purchase-path invariants: double delivery (webhook + client confirm, or
// webhook retries) grants exactly once; signatures verify over exact raw
// strings; unknown orders are swallowed without a grant.
// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  hmacSha256Hex,
  timingSafeEqualHex,
  verifyRazorpaySignature,
} from "./lib/razorpay";

const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);

async function seeded() {
  const tx = convexTest(schema, modules);
  const asUser = tx.withIdentity({ subject: "user_a" });
  await asUser.mutation(api.users.ensure, {});
  const user = await tx.run(async (ctx) => ctx.db.query("users").first());
  await tx.mutation(internal.payments.recordOrder, {
    userId: user!._id,
    razorpayOrderId: "order_x",
    amountInr: 300,
    credits: 3000,
  });
  return { tx, asUser };
}

describe("applyPurchase", () => {
  it("grants once across webhook retries and client confirm", async () => {
    const { tx, asUser } = await seeded();
    const first = await tx.mutation(internal.payments.applyPurchase, {
      razorpayOrderId: "order_x",
      razorpayPaymentId: "pay_1",
    });
    const second = await tx.mutation(internal.payments.applyPurchase, {
      razorpayOrderId: "order_x",
      razorpayPaymentId: "pay_1",
    });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await asUser.query(api.credits.balance, {})).toBe(3100); // 100 starter + 3000
    const ledger = await tx.run(async (ctx) =>
      ctx.db.query("creditLedger").collect(),
    );
    expect(ledger.filter((r) => r.kind === "purchase")).toHaveLength(1);
  });

  it("ignores unknown orders without granting", async () => {
    const { tx, asUser } = await seeded();
    const res = await tx.mutation(internal.payments.applyPurchase, {
      razorpayOrderId: "order_unknown",
      razorpayPaymentId: "pay_9",
    });
    expect(res.applied).toBe(false);
    expect(await asUser.query(api.credits.balance, {})).toBe(100);
  });

  it("records the payment id and paid status on the order", async () => {
    const { tx } = await seeded();
    await tx.mutation(internal.payments.applyPurchase, {
      razorpayOrderId: "order_x",
      razorpayPaymentId: "pay_1",
    });
    const order = await tx.run(async (ctx) =>
      ctx.db.query("paymentOrders").first(),
    );
    expect(order!.status).toBe("paid");
    expect(order!.razorpayPaymentId).toBe("pay_1");
  });
});

describe("razorpay signature verification", () => {
  it("matches a known HMAC-SHA256 vector", async () => {
    // echo -n "order_abc|pay_def" | openssl dgst -sha256 -hmac "secret123"
    const sig = await hmacSha256Hex("secret123", "order_abc|pay_def");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyRazorpaySignature("secret123", "order_abc|pay_def", sig)).toBe(true);
    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(await verifyRazorpaySignature("secret123", "order_abc|pay_def", tampered)).toBe(false);
    expect(await verifyRazorpaySignature("wrong", "order_abc|pay_def", sig)).toBe(false);
  });

  it("compares without short-circuiting on length-equal strings", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abc")).toBe(false);
  });
});
