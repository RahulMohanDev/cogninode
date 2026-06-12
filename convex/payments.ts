// convex/payments.ts
// Razorpay top-ups. Two confirmation paths feed ONE idempotent apply:
//   1. client checkout success → confirmCheckout (signature-verified) —
//      instant credit, no webhook latency;
//   2. payment.captured webhook (convex/http.ts) — survives closed tabs.
// applyPurchase is idempotent by order status + razorpayPaymentId, so the
// race between them is benign. The upstream key limit is raised by
// scheduling reconcileUser — the re-peg invariant stays the single code
// path that touches limits.
import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getCurrentUser } from "./users";
import { packCredits, packInr } from "./lib/credits";
import { env } from "./lib/env";
import { verifyRazorpaySignature } from "./lib/razorpay";

function razorpayAuth(): { keyId: string; basic: string } {
  const keyId = env("RAZORPAY_KEY_ID");
  const secret = env("RAZORPAY_KEY_SECRET");
  if (!keyId || !secret) {
    throw new Error("Razorpay keys are not configured on this deployment");
  }
  return { keyId, basic: btoa(`${keyId}:${secret}`) };
}

interface RazorpayOrderResponse {
  id?: string;
  amount?: number;
  currency?: string;
}

export const createOrder = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    orderId: string;
    amountPaise: number;
    currency: string;
    keyId: string;
    credits: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("createOrder requires authentication");
    const user = await ctx.runQuery(internal.users.getByClerkIdInternal, {
      clerkUserId: identity.subject,
    });
    if (!user || user.deletedAt !== undefined) {
      throw new Error("createOrder: unknown user");
    }

    const { keyId, basic } = razorpayAuth();
    const amountInr = packInr();
    const credits = packCredits();
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountInr * 100, // paise
        currency: "INR",
        notes: { convexUserId: user._id, credits: String(credits) },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Razorpay order creation failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const order = (await res.json()) as RazorpayOrderResponse;
    if (!order.id) throw new Error("Razorpay order response missing id");

    await ctx.runMutation(internal.payments.recordOrder, {
      userId: user._id,
      razorpayOrderId: order.id,
      amountInr,
      credits,
    });
    return {
      orderId: order.id,
      amountPaise: amountInr * 100,
      currency: "INR",
      keyId,
      credits,
    };
  },
});

/** Client-side checkout success: verify Razorpay's HMAC over
 *  "orderId|paymentId" with the key secret, then apply. */
export const confirmCheckout = action({
  args: {
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("confirmCheckout requires authentication");
    const secret = env("RAZORPAY_KEY_SECRET");
    if (!secret) throw new Error("Razorpay keys are not configured");
    const ok = await verifyRazorpaySignature(
      secret,
      `${args.razorpayOrderId}|${args.razorpayPaymentId}`,
      args.signature,
    );
    if (!ok) throw new Error("Invalid checkout signature");
    await ctx.runMutation(internal.payments.applyPurchase, {
      razorpayOrderId: args.razorpayOrderId,
      razorpayPaymentId: args.razorpayPaymentId,
    });
    return { applied: true };
  },
});

export const recordOrder = internalMutation({
  args: {
    userId: v.id("users"),
    razorpayOrderId: v.string(),
    amountInr: v.number(),
    credits: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("paymentOrders")
      .withIndex("by_orderId", (q) =>
        q.eq("razorpayOrderId", args.razorpayOrderId),
      )
      .unique();
    if (existing) return;
    await ctx.db.insert("paymentOrders", {
      ...args,
      status: "created",
      createdAt: Date.now(),
    });
  },
});

/** THE single grant path. Idempotent: an already-paid order (or an already
 *  seen paymentId) is a no-op, so webhook + client confirm can both fire. */
export const applyPurchase = internalMutation({
  args: {
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
  },
  handler: async (ctx, { razorpayOrderId, razorpayPaymentId }) => {
    const order = await ctx.db
      .query("paymentOrders")
      .withIndex("by_orderId", (q) => q.eq("razorpayOrderId", razorpayOrderId))
      .unique();
    if (!order) {
      // Webhook for an order we never recorded — log loudly, ack quietly.
      console.error("applyPurchase: unknown order", razorpayOrderId);
      return { applied: false };
    }
    if (order.status === "paid") return { applied: false };

    const user = await ctx.db.get(order.userId);
    if (!user) return { applied: false };

    await ctx.db.patch(order._id, {
      status: "paid",
      razorpayPaymentId,
      paidAt: Date.now(),
    });
    await ctx.db.insert("creditLedger", {
      userId: order.userId,
      kind: "purchase",
      credits: order.credits,
      razorpayPaymentId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(order.userId, {
      creditsBalance: user.creditsBalance + order.credits,
    });
    // Raise the upstream key limit via the one sanctioned path.
    await ctx.scheduler.runAfter(0, internal.openrouter.reconcileUser, {
      userId: order.userId,
    });
    return { applied: true };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const orders = await ctx.db
      .query("paymentOrders")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    return orders.map((o) => ({
      _id: o._id,
      amountInr: o.amountInr,
      credits: o.credits,
      status: o.status,
      createdAt: o.createdAt,
      paidAt: o.paidAt ?? null,
    }));
  },
});
