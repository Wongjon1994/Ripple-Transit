import { describe, it, expect } from "vitest";
import {
  classify,
  bufferMinutes,
  computeBusFeasibility,
  OK_THRESHOLD_MIN,
  type BusCandidate,
} from "./feasibility.js";

// Fixed reference time so ETAs are deterministic.
const NOW = Date.parse("2026-07-11T08:00:00+08:00");
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe("classify", () => {
  it("returns miss for negative buffer", () => {
    expect(classify(-0.1)).toBe("miss");
    expect(classify(-5)).toBe("miss");
  });

  it("returns tight for a small positive buffer", () => {
    expect(classify(0)).toBe("tight");
    expect(classify(OK_THRESHOLD_MIN - 0.1)).toBe("tight");
  });

  it("returns ok at or above the threshold", () => {
    expect(classify(OK_THRESHOLD_MIN)).toBe("ok");
    expect(classify(10)).toBe("ok");
  });
});

describe("bufferMinutes", () => {
  it("is minutes-until-bus minus walk minutes", () => {
    expect(bufferMinutes(inMinutes(10), 4 * 60, NOW)).toBeCloseTo(6, 5);
  });

  it("is negative when the bus leaves before you arrive", () => {
    expect(bufferMinutes(inMinutes(2), 5 * 60, NOW)).toBeCloseTo(-3, 5);
  });
});

describe("computeBusFeasibility", () => {
  const walk = (min: number) => min * 60;

  it("recommends the soonest CATCHABLE interchangeable bus", () => {
    // 157 arrives first but is unreachable (walk 3 > 1); 77 is the soonest catchable.
    const candidates: BusCandidate[] = [
      { serviceNo: "157", eta: inMinutes(1) },
      { serviceNo: "77", eta: inMinutes(6) },
      { serviceNo: "961", eta: inMinutes(12) },
    ];
    const f = computeBusFeasibility(walk(3), candidates, NOW);
    expect(f.serviceNo).toBe("77");
    expect(f.status).toBe("ok");
    expect(f.eta).toBe(candidates[1].eta);
    // Remaining catchable buses become same-leg alternatives (misses dropped).
    expect(f.alternatives.map((a) => a.serviceNo)).toEqual(["961"]);
  });

  it("orders alternatives by arrival time and caps at four", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "A", eta: inMinutes(4) },
      { serviceNo: "B", eta: inMinutes(5) },
      { serviceNo: "C", eta: inMinutes(6) },
      { serviceNo: "D", eta: inMinutes(7) },
      { serviceNo: "E", eta: inMinutes(8) },
      { serviceNo: "F", eta: inMinutes(9) },
    ];
    const f = computeBusFeasibility(walk(1), candidates, NOW);
    expect(f.serviceNo).toBe("A"); // soonest catchable
    expect(f.alternatives.map((a) => a.serviceNo)).toEqual(["B", "C", "D", "E"]);
  });

  it("falls back to the soonest bus when none are catchable", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "10", eta: inMinutes(1) },
      { serviceNo: "12", eta: inMinutes(2) },
    ];
    const f = computeBusFeasibility(walk(5), candidates, NOW);
    expect(f.serviceNo).toBe("10");
    expect(f.status).toBe("miss");
    expect(f.buffer).toBeLessThan(0);
    expect(f.alternatives).toHaveLength(0); // misses are not offered
  });

  it("is unknown with no live candidates", () => {
    const f = computeBusFeasibility(walk(3), [], NOW);
    expect(f.status).toBe("unknown");
    expect(f.serviceNo).toBeUndefined();
    expect(f.eta).toBeNull();
    expect(f.alternatives).toHaveLength(0);
  });

  it("rounds walk minutes", () => {
    const f = computeBusFeasibility(150, [{ serviceNo: "1", eta: inMinutes(10) }], NOW);
    expect(f.walkMinutes).toBe(3); // 150s → 2.5 → 3
  });
});
