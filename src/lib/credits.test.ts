// src/lib/credits.test.ts
import { describe, expect, it } from "vitest";
import { formatCredits, formatCreditsEstimate, usdToCredits } from "./credits";

describe("usdToCredits", () => {
  it("floors at one credit", () => {
    expect(usdToCredits(0)).toBe(1);
    expect(usdToCredits(-1)).toBe(1);
    expect(usdToCredits(0.000001)).toBe(1);
    expect(usdToCredits(0.0005)).toBe(1);
  });

  it("ceils partial credits", () => {
    expect(usdToCredits(0.00051)).toBe(2);
    expect(usdToCredits(0.0009)).toBe(2);
    expect(usdToCredits(0.001)).toBe(2);
    expect(usdToCredits(0.0011)).toBe(3);
  });

  it("is immune to float-division noise at exact multiples", () => {
    // 0.0015 / 0.0005 = 3.0000000000000004 in raw FP — must stay 3.
    expect(usdToCredits(0.0015)).toBe(3);
    expect(usdToCredits(0.003)).toBe(6);
    expect(usdToCredits(0.0405)).toBe(81);
  });

  it("scales to thinking-tier costs", () => {
    expect(usdToCredits(0.05)).toBe(100);   // big sonnet-class message
    expect(usdToCredits(0.02)).toBe(40);    // web-search fallback surcharge
  });
});

describe("formatting", () => {
  it("pluralizes", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(2)).toBe("2 credits");
    expect(formatCredits(3000)).toBe("3,000 credits");
  });

  it("renders estimates", () => {
    expect(formatCreditsEstimate(0)).toBe("~1 cr");
    expect(formatCreditsEstimate(0.0023)).toBe("~5 cr");
  });
});
