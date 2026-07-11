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
    // bus in 10 min, walk 4 min → 6 min buffer
    expect(bufferMinutes(inMinutes(10), 4 * 60, NOW)).toBeCloseTo(6, 5);
  });

  it("is negative when the bus leaves before you arrive", () => {
    // bus in 2 min, walk 5 min → -3 min
    expect(bufferMinutes(inMinutes(2), 5 * 60, NOW)).toBeCloseTo(-3, 5);
  });
});

describe("computeBusFeasibility", () => {
  it("classifies the target bus as ok with a comfortable buffer", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "187", eta: inMinutes(9) }, // walk 2 min → 7 buffer
    ];
    const f = computeBusFeasibility(2 * 60, candidates, "187", NOW);
    expect(f.status).toBe("ok");
    expect(f.buffer).toBeCloseTo(7, 1);
    expect(f.eta).toBe(candidates[0].eta);
    expect(f.walkMinutes).toBeCloseTo(2, 1);
  });

  it("classifies a just-in-time target as tight", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "157", eta: inMinutes(3) }, // walk 2 min → 1 buffer
    ];
    const f = computeBusFeasibility(2 * 60, candidates, "157", NOW);
    expect(f.status).toBe("tight");
  });

  it("classifies an unreachable target as miss", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "157", eta: inMinutes(1) }, // walk 3 min → -2 buffer
    ];
    const f = computeBusFeasibility(3 * 60, candidates, "157", NOW);
    expect(f.status).toBe("miss");
    expect(f.buffer).toBeLessThan(0);
  });

  it("returns unknown when the target service has no live ETA", () => {
    const f = computeBusFeasibility(3 * 60, [], "999", NOW);
    expect(f.status).toBe("unknown");
    expect(f.eta).toBeNull();
    expect(f.alternatives).toHaveLength(0);
  });

  it("surfaces feasible alternatives sorted by soonest, dropping misses", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "157", eta: inMinutes(1) }, // target: miss (walk 3)
      { serviceNo: "961", eta: inMinutes(12) }, // ok, later
      { serviceNo: "77", eta: inMinutes(6) }, // ok, sooner
      { serviceNo: "99", eta: inMinutes(2) }, // miss → dropped (walk 3)
    ];
    const f = computeBusFeasibility(3 * 60, candidates, "157", NOW);
    expect(f.status).toBe("miss");
    const nums = f.alternatives.map((a) => a.serviceNo);
    expect(nums).toEqual(["77", "961"]); // sorted by ETA, misses removed
    expect(f.alternatives.every((a) => a.feasibility !== "miss")).toBe(true);
  });

  it("caps alternatives at three", () => {
    const candidates: BusCandidate[] = [
      { serviceNo: "T", eta: inMinutes(20) },
      { serviceNo: "A", eta: inMinutes(6) },
      { serviceNo: "B", eta: inMinutes(7) },
      { serviceNo: "C", eta: inMinutes(8) },
      { serviceNo: "D", eta: inMinutes(9) },
    ];
    const f = computeBusFeasibility(60, candidates, "T", NOW);
    expect(f.alternatives).toHaveLength(3);
    expect(f.alternatives.map((a) => a.serviceNo)).toEqual(["A", "B", "C"]);
  });
});
