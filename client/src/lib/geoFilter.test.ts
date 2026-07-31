import { describe, it, expect } from "vitest";
import { stepGeoFilter, EMPTY_GEO_FILTER, type GeoFix } from "./geoFilter.js";

const fix = (lat: number, lng: number, accuracy: number, t: number): GeoFix => ({
  lat,
  lng,
  accuracy,
  t,
});

describe("stepGeoFilter", () => {
  it("accepts the first fix as-is", () => {
    const r = stepGeoFilter(EMPTY_GEO_FILTER, fix(1.3, 103.85, 10, 1000));
    expect(r.position).toEqual({ lat: 1.3, lng: 103.85 });
  });

  it("snaps to a precise nearby fix", () => {
    const a = stepGeoFilter(EMPTY_GEO_FILTER, fix(1.3, 103.85, 8, 1000));
    const b = stepGeoFilter(a.state, fix(1.3001, 103.85, 8, 2000)); // ~11 m, precise
    expect(b.position.lat).toBeCloseTo(1.3001, 5);
  });

  it("drops a fuzzy fix that isn't sharper than the current lock", () => {
    const a = stepGeoFilter(EMPTY_GEO_FILTER, fix(1.3, 103.85, 8, 1000));
    const b = stepGeoFilter(a.state, fix(1.302, 103.85, 120, 2000)); // 120 m > 65
    expect(b.position).toEqual(a.position); // held, not teleported
  });

  it("rejects an implausible jump on a non-precise fix", () => {
    const a = stepGeoFilter(EMPTY_GEO_FILTER, fix(1.3, 103.85, 8, 1000));
    // ~440 m in 1 s ⇒ 440 m/s, with a fuzzy 40 m fix ⇒ multipath, reject
    const b = stepGeoFilter(a.state, fix(1.304, 103.85, 40, 2000));
    expect(b.position).toEqual(a.position);
  });

  it("accepts a real walking step (precise, plausible speed)", () => {
    const a = stepGeoFilter(EMPTY_GEO_FILTER, fix(1.3, 103.85, 10, 1000));
    const b = stepGeoFilter(a.state, fix(1.30015, 103.85, 10, 6000)); // ~17 m / 5 s
    expect(b.position.lat).toBeGreaterThan(a.position.lat);
  });

  it("eases (does not snap) toward a fuzzy-but-acceptable fix", () => {
    const a = stepGeoFilter(EMPTY_GEO_FILTER, fix(1.3, 103.85, 10, 1000));
    const b = stepGeoFilter(a.state, fix(1.3003, 103.85, 45, 6000)); // acc 45 ⇒ alpha 0.35
    // Moved toward the fix but not all the way there.
    expect(b.position.lat).toBeGreaterThan(1.3);
    expect(b.position.lat).toBeLessThan(1.3003);
  });
});
