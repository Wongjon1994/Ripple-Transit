import { describe, it, expect } from "vitest";
import { estimateTaxiFare, classifyAvailability } from "./taxi.js";

describe("estimateTaxiFare", () => {
  it("is the flag-down for a near-zero distance", () => {
    expect(estimateTaxiFare(0)).toBeCloseTo(4.4, 2);
  });

  it("adds metered distance and increases monotonically", () => {
    const f5 = estimateTaxiFare(5000);
    const f10 = estimateTaxiFare(10000);
    const f15 = estimateTaxiFare(15000);
    expect(f5).toBeGreaterThan(4.4);
    expect(f10).toBeGreaterThan(f5);
    expect(f15).toBeGreaterThan(f10);
  });

  it("charges a finer rate beyond 10 km", () => {
    // per-metre rate after 10km (per 350m) is higher than before (per 400m)
    const before = estimateTaxiFare(10000) - estimateTaxiFare(9000); // 1km @ 400m
    const after = estimateTaxiFare(15000) - estimateTaxiFare(14000); // 1km @ 350m
    expect(after).toBeGreaterThan(before);
  });
});

describe("classifyAvailability", () => {
  it("maps counts to levels", () => {
    expect(classifyAvailability(10).availability).toBe("available");
    expect(classifyAvailability(4).availability).toBe("limited");
    expect(classifyAvailability(0).availability).toBe("unavailable");
  });
  it("gives shorter waits when more taxis are near", () => {
    expect(classifyAvailability(12).waitMin).toBeLessThan(
      classifyAvailability(1).waitMin,
    );
  });
});
