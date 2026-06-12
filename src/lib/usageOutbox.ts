// src/lib/usageOutbox.ts
// Durable queue for usage reports (managed sends only). The report is
// written to Dexie meta in the same breath as the assistant message, so a
// killed tab can't lose a charge — the next session drains it. The server
// mutation is idempotent by messageClientId, so re-sending after an unclear
// failure is always safe. (Deliberately tiny: this is the dress rehearsal
// for Phase E's full sync outbox.)

import { api } from "../../convex/_generated/api";
import { getConvexClient } from "./convexClient";
import { db, setMeta } from "./db";

const PREFIX = "usage:";

export interface UsageReport {
  /** The assistant message's client `_id` — the idempotency key. */
  messageClientId: string;
  usdCost:         number;
  costSource:      "upstream" | "estimated";
  modelId:         string;
  inputTokens:     number;
  outputTokens:    number;
  webSearch:       boolean;
}

export async function enqueueUsageReport(report: UsageReport): Promise<void> {
  await setMeta(PREFIX + report.messageClientId, report);
}

// One drain at a time per tab; concurrent calls coalesce. Cross-tab double
// drains are harmless (server-side idempotency).
let draining = false;

export async function drainUsageOutbox(): Promise<void> {
  const client = getConvexClient();
  if (!client || draining) return;
  draining = true;
  try {
    const rows = await db.meta.where("key").startsWith(PREFIX).toArray();
    for (const row of rows) {
      const r = row.value as UsageReport;
      try {
        await client.mutation(api.credits.reportUsage, {
          messageClientId: r.messageClientId,
          usdCost:         r.usdCost,
          costSource:      r.costSource,
          modelId:         r.modelId,
          inputTokens:     r.inputTokens,
          outputTokens:    r.outputTokens,
          webSearch:       r.webSearch,
        });
        await db.meta.delete(row.key);
      } catch (err) {
        // Auth not ready / offline / server hiccup — keep the row, retry on
        // the next drain (next send or next app open).
        console.warn("[credits] usage report failed — will retry:", err);
      }
    }
  } finally {
    draining = false;
  }
}
