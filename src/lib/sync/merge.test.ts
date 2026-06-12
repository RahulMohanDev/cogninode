// src/lib/sync/merge.test.ts
import { describe, expect, it } from "vitest";
import { decideApply, type RemoteRow } from "./merge";

const row = (over: Partial<RemoteRow>): RemoteRow => ({
  table: "chats",
  clientId: "c1",
  modifiedAt: 100,
  deletedAt: null,
  doc: { _id: "c1", title: "x", _modifiedAt: 100 },
  ...over,
});

describe("decideApply", () => {
  it("materializes new rows", () => {
    expect(decideApply(null, row({}))).toBe("put");
  });

  it("newer remote wins, older remote is skipped", () => {
    expect(decideApply(50, row({ modifiedAt: 100 }))).toBe("put");
    expect(decideApply(150, row({ modifiedAt: 100 }))).toBe("skip");
  });

  it("re-applying an already-applied row is a no-op", () => {
    expect(decideApply(100, row({ modifiedAt: 100 }))).toBe("skip");
  });

  it("tombstones win ties and newer comparisons", () => {
    expect(decideApply(100, row({ modifiedAt: 100, deletedAt: 100, doc: null }))).toBe("delete");
    expect(decideApply(50, row({ modifiedAt: 100, deletedAt: 100, doc: null }))).toBe("delete");
    expect(decideApply(150, row({ modifiedAt: 100, deletedAt: 100, doc: null }))).toBe("skip");
  });

  it("tombstone for an absent row stays an idempotent delete", () => {
    expect(decideApply(null, row({ deletedAt: 100, doc: null }))).toBe("delete");
  });

  it("treats unstamped local rows as oldest", () => {
    expect(decideApply(0, row({ modifiedAt: 1 }))).toBe("put");
  });

  it("skips malformed puts without a doc", () => {
    expect(decideApply(50, row({ doc: null }))).toBe("skip");
    expect(decideApply(null, row({ doc: null }))).toBe("skip");
  });
});
