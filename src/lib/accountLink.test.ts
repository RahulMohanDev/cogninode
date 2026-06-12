// src/lib/accountLink.test.ts
import { describe, expect, it } from "vitest";
import { decideAccountLink } from "./accountLink";

describe("decideAccountLink", () => {
  it("stamps a never-claimed browser", () => {
    expect(decideAccountLink(undefined, "user_a", false)).toEqual({ kind: "fresh" });
    expect(decideAccountLink(undefined, "user_a", true)).toEqual({ kind: "fresh" });
  });

  it("passes the same owner through", () => {
    expect(decideAccountLink("user_a", "user_a", true)).toEqual({ kind: "match" });
    expect(decideAccountLink("user_a", "user_a", false)).toEqual({ kind: "match" });
  });

  it("blocks a different owner when local data exists", () => {
    expect(decideAccountLink("user_a", "user_b", true)).toEqual({
      kind: "mismatch",
      previousOwner: "user_a",
    });
  });

  it("restamps a stale owner over an empty browser", () => {
    expect(decideAccountLink("user_a", "user_b", false)).toEqual({ kind: "fresh" });
  });

  it("treats an empty-string stamp as unclaimed", () => {
    expect(decideAccountLink("", "user_b", true)).toEqual({ kind: "fresh" });
  });
});
