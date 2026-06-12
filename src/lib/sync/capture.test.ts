// src/lib/sync/capture.test.ts
// The capture middleware is the sync layer's most load-bearing piece:
// every write must produce exactly one outbox entry in the same
// transaction, remote applies must produce NONE (the echo-loop guard) and
// must not be re-stamped, and transactions that didn't declare the outbox
// must still be able to write it.
import "fake-indexeddb/auto";
import Dexie, { type EntityTable } from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  markRemoteApply,
  setupSyncCapture,
  type OutboxEntry,
} from "./capture";

interface Row {
  _id: string;
  title: string;
  _modifiedAt?: number;
}

type TestDb = Dexie & {
  chats: EntityTable<Row, "_id">;
  outbox: EntityTable<OutboxEntry, "seq">;
};

let db: TestDb;

beforeEach(() => {
  db = new Dexie(`capture-test-${Math.random()}`) as TestDb;
  db.version(1).stores({ chats: "_id", meta: "key", outbox: "++seq" });
  setupSyncCapture(db);
});

afterEach(async () => {
  await db.delete();
});

describe("sync capture middleware", () => {
  it("stamps _modifiedAt and records put entries", async () => {
    await db.chats.add({ _id: "c1", title: "hello" });
    const row = await db.chats.get("c1");
    expect(typeof row!._modifiedAt).toBe("number");

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ table: "chats", rowId: "c1", op: "put" });
  });

  it("captures updates (DBCore put) and deletes", async () => {
    await db.chats.add({ _id: "c1", title: "hello" });
    await db.chats.update("c1", { title: "renamed" });
    await db.chats.delete("c1");
    const ops = (await db.outbox.orderBy("seq").toArray()).map((e) => e.op);
    expect(ops).toEqual(["put", "put", "delete"]);
  });

  it("captures Collection.modify as puts with fresh stamps", async () => {
    await db.chats.add({ _id: "c1", title: "a" });
    const before = (await db.chats.get("c1"))!._modifiedAt!;
    await new Promise((r) => setTimeout(r, 2));
    await db.chats.toCollection().modify((c) => { c.title = "b"; });
    const after = (await db.chats.get("c1"))!._modifiedAt!;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(await db.outbox.count()).toBe(2);
  });

  it("works inside transactions that didn't declare the outbox", async () => {
    await db.transaction("rw", db.chats, async () => {
      await db.chats.add({ _id: "c1", title: "tx" });
    });
    expect(await db.outbox.count()).toBe(1);
  });

  it("remote applies are not captured and keep their stamp (echo guard)", async () => {
    await db.transaction("rw", db.chats, db.outbox, async () => {
      markRemoteApply();
      await db.chats.put({ _id: "c1", title: "remote", _modifiedAt: 12345 });
      await db.chats.delete("missing");
    });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.chats.get("c1"))!._modifiedAt).toBe(12345);
  });

  it("a concurrent local write outside the remote-apply transaction is still captured", async () => {
    const remote = db.transaction("rw", db.chats, db.outbox, async () => {
      markRemoteApply();
      await db.chats.put({ _id: "r1", title: "remote", _modifiedAt: 1 });
    });
    const local = db.chats.add({ _id: "l1", title: "local" });
    await Promise.all([remote, local]);
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.rowId).toBe("l1");
  });

  it("rolls outbox entries back with their failed transaction", async () => {
    await expect(
      db.transaction("rw", db.chats, async () => {
        await db.chats.add({ _id: "c1", title: "doomed" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.outbox.count()).toBe(0);
    expect(await db.chats.count()).toBe(0);
  });
});
