import { describe, it, expect } from "vitest";
import { rankResults } from "./nearest.js";

const r = (durationS: number, steps: number, fare: number) => ({
  durationS,
  steps,
  fare,
});

describe("rankResults (Decision 6 tie-break)", () => {
  it("orders primarily by duration outside the 60s window", () => {
    const out = rankResults([r(600, 0, 0), r(400, 2, 2), r(900, 0, 0)]);
    expect(out.map((x) => x.durationS)).toEqual([400, 600, 900]);
  });

  it("breaks near-ties by fewer transit steps first", () => {
    const out = rankResults([r(610, 2, 0), r(600, 0, 0)]);
    expect(out[0].steps).toBe(0);
  });

  it("then by lower fare", () => {
    const out = rankResults([r(600, 1, 1.7), r(620, 1, 1.1)]);
    expect(out[0].fare).toBe(1.1);
  });

  it("walk-only ($0, 0 steps) dominates near-ties naturally", () => {
    const walk = r(650, 0, 0);
    const bus = r(600, 1, 1.19);
    expect(rankResults([bus, walk])[0]).toBe(walk);
  });
});
