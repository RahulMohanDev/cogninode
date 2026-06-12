// convex/admin.ts
// Operator dashboard queries — internal-only, run from the Convex
// dashboard's function runner. No client access.
import { internalQuery } from "./_generated/server";

export const overview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const orders = await ctx.db.query("paymentOrders").collect();
    const live = users.filter((u) => u.deletedAt === undefined);
    const hourAgo = Date.now() - 3_600_000;
    return {
      users: live.length,
      deletedUsers: users.length - live.length,
      keyStatuses: {
        active: live.filter((u) => u.keyStatus === "active").length,
        provisioning: live.filter((u) => u.keyStatus === "provisioning").length,
        error: live.filter((u) => u.keyStatus === "error").length,
      },
      creditsOutstanding: live.reduce((s, u) => s + Math.max(0, u.creditsBalance), 0),
      negativeBalances: live.filter((u) => u.creditsBalance < 0).length,
      // Top drift = lost usage reports or an extracted key — investigate.
      topDriftUsd: live
        .map((u) => ({ id: u._id, drift: u.reconcileDriftUsd ?? 0 }))
        .sort((a, b) => b.drift - a.drift)
        .slice(0, 5),
      paidOrders: orders.filter((o) => o.status === "paid").length,
      revenueInr: orders
        .filter((o) => o.status === "paid")
        .reduce((s, o) => s + o.amountInr, 0),
      // Orders stuck unpaid for >1h — webhook problems or abandonment.
      staleOrders: orders.filter(
        (o) => o.status === "created" && o.createdAt < hourAgo,
      ).length,
    };
  },
});
