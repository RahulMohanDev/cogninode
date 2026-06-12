// convex/sync.test.ts
// Server-side sync invariants: per-user monotonic syncSeq, LWW skip of
// stale pushes (idempotent re-pushes), tombstones replacing docs, cursor
// paging, and per-user isolation.
// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);

async function seeded() {
  const tx = convexTest(schema, modules);
  const asA = tx.withIdentity({ subject: "user_a" });
  const asB = tx.withIdentity({ subject: "user_b" });
  await asA.mutation(api.users.ensure, {});
  await asB.mutation(api.users.ensure, {});
  return { tx, asA, asB };
}

const putOp = (clientId: string, modifiedAt: number, title = "t") => ({
  table: "chats",
  clientId,
  op: "put" as const,
  modifiedAt,
  doc: { _id: clientId, title, _modifiedAt: modifiedAt },
});

describe("sync.pushOps", () => {
  it("assigns monotonic seqs and skips stale re-pushes", async () => {
    const { asA } = await seeded();
    const first = await asA.mutation(api.sync.pushOps, {
      ops: [putOp("c1", 100), putOp("c2", 100)],
    });
    expect(first).toEqual({ applied: 2, lastSeq: 2 });

    // Re-push (outbox retry) — same stamps, nothing applies, seq unchanged.
    const retry = await asA.mutation(api.sync.pushOps, {
      ops: [putOp("c1", 100), putOp("c2", 100)],
    });
    expect(retry).toEqual({ applied: 0, lastSeq: 2 });

    // A newer edit re-syncs the row under a new seq.
    const newer = await asA.mutation(api.sync.pushOps, {
      ops: [putOp("c1", 200, "renamed")],
    });
    expect(newer).toEqual({ applied: 1, lastSeq: 3 });
    expect(await asA.query(api.sync.latestSeq, {})).toBe(3);
  });

  it("tombstones drop the doc and win by stamp", async () => {
    const { tx, asA } = await seeded();
    await asA.mutation(api.sync.pushOps, { ops: [putOp("c1", 100)] });
    await asA.mutation(api.sync.pushOps, {
      ops: [{ table: "chats", clientId: "c1", op: "delete" as const, modifiedAt: 150 }],
    });
    const row = await tx.run(async (ctx) => ctx.db.query("syncRows").first());
    expect(row!.deletedAt).toBe(150);
    expect(row!.doc).toBeUndefined();

    // A stale put from a lagging device can't resurrect it.
    const stale = await asA.mutation(api.sync.pushOps, { ops: [putOp("c1", 120)] });
    expect(stale.applied).toBe(0);
  });

  it("ignores unknown tables", async () => {
    const { asA } = await seeded();
    const res = await asA.mutation(api.sync.pushOps, {
      ops: [{ table: "searchVectors", clientId: "v1", op: "put" as const, modifiedAt: 1, doc: {} }],
    });
    expect(res.applied).toBe(0);
  });
});

describe("sync.pullSince", () => {
  it("pages by cursor and isolates users", async () => {
    const { asA, asB } = await seeded();
    await asA.mutation(api.sync.pushOps, {
      ops: [putOp("c1", 100), putOp("c2", 110), putOp("c3", 120)],
    });

    const page1 = await asA.query(api.sync.pullSince, { cursor: 0, limit: 2 });
    expect(page1.rows.map((r) => r.clientId)).toEqual(["c1", "c2"]);
    expect(page1.done).toBe(false);

    const page2 = await asA.query(api.sync.pullSince, {
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.rows.map((r) => r.clientId)).toEqual(["c3"]);
    expect(page2.done).toBe(true);

    // user_b sees nothing of user_a's rows.
    const other = await asB.query(api.sync.pullSince, { cursor: 0 });
    expect(other.rows).toHaveLength(0);
    expect(await asB.query(api.sync.latestSeq, {})).toBe(0);
  });
});
