// convex/crons.ts
// Scheduled maintenance. Reconciliation is the safety net for the whole
// credits system (see the re-peg invariant in convex/openrouter.ts);
// pricing sync keeps tier estimates honest as OpenRouter reprices models.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile user keys",
  { hours: 6 },
  internal.openrouter.reconcileAll,
  {},
);

crons.daily(
  "sync model pricing",
  { hourUTC: 1, minuteUTC: 30 },
  internal.models.syncCatalog,
  {},
);

export default crons;
