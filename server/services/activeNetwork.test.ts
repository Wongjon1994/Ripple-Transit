import { describe, it, expect } from "vitest";
import {
  planarMeters,
  pointToSegmentMeters,
  samplePath,
  SegmentGrid,
  routeCoverage,
  comfortLabel,
  activeKcal,
  decodePolyline5,
  type Pt,
} from "./activeNetwork.js";

// Around SG latitude, 0.001° lat ≈ 111.3 m, 0.001° lng ≈ 111.3 m (cos ≈ 1).
const P = (lat: number, lng: number): Pt => ({ lat, lng });

describe("planarMeters", () => {
  it("is ~111.3m per 0.001° of latitude", () => {
    expect(planarMeters(P(1.3, 103.8), P(1.301, 103.8))).toBeCloseTo(111.3, 0);
  });
});

describe("pointToSegmentMeters", () => {
  const a = P(1.3, 103.8);
  const b = P(1.3, 103.81); // ~1.1km east-west segment

  it("is ~0 on the segment", () => {
    expect(pointToSegmentMeters(P(1.3, 103.805), a, b)).toBeLessThan(0.01);
  });

  it("measures perpendicular offset from the middle", () => {
    // 0.0002° lat north of the line ≈ 22m
    expect(pointToSegmentMeters(P(1.3002, 103.805), a, b)).toBeCloseTo(22.3, 0);
  });

  it("clamps to endpoints beyond the segment", () => {
    // 0.001° west of a ≈ 111m from endpoint a
    expect(pointToSegmentMeters(P(1.3, 103.799), a, b)).toBeCloseTo(111.3, 0);
  });
});

describe("samplePath", () => {
  it("resamples long edges to ~30m spacing", () => {
    const path = [P(1.3, 103.8), P(1.3, 103.801)]; // ~111m
    const samples = samplePath(path, 30);
    expect(samples.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < samples.length; i++) {
      expect(planarMeters(samples[i - 1], samples[i])).toBeLessThanOrEqual(31);
    }
  });
});

describe("SegmentGrid + routeCoverage", () => {
  // Network: an east-west park connector along lat 1.3.
  const grid = new SegmentGrid();
  grid.addLine([P(1.3, 103.8), P(1.3, 103.82)]);

  it("indexes segments and finds nearby points", () => {
    expect(grid.size).toBe(1);
    expect(grid.isNear(P(1.3001, 103.81))).toBe(true); // ~11m off
    expect(grid.isNear(P(1.302, 103.81))).toBe(false); // ~222m off
  });

  it("scores a route fully on the network at 100%", () => {
    const c = routeCoverage([P(1.3, 103.802), P(1.3, 103.812)], grid);
    expect(c.pct).toBe(100);
    expect(c.totalMeters).toBeGreaterThan(1000);
  });

  it("scores an off-network route at 0%", () => {
    const c = routeCoverage([P(1.35, 103.802), P(1.35, 103.812)], grid);
    expect(c.pct).toBe(0);
  });

  it("scores a half-on route near 50%", () => {
    // First 1.1km on the connector, then turns north away from it.
    const c = routeCoverage(
      [P(1.3, 103.8), P(1.3, 103.81), P(1.31, 103.81)],
      grid,
    );
    expect(c.pct).toBeGreaterThan(35);
    expect(c.pct).toBeLessThan(65);
  });
});

describe("comfortLabel", () => {
  it("maps coverage bands to tones", () => {
    expect(comfortLabel(85).tone).toBe("ok");
    expect(comfortLabel(45).tone).toBe("neutral");
    expect(comfortLabel(10).tone).toBe("warning");
  });
});

describe("activeKcal", () => {
  it("estimates walk > cycle per km", () => {
    expect(activeKcal("walk", 2000)).toBe(110);
    expect(activeKcal("cycle", 2000)).toBe(56);
  });
});

describe("decodePolyline5", () => {
  it("round-trips a known Google example", () => {
    // Canonical polyline example: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const pts = decodePolyline5("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(38.5, 5);
    expect(pts[0].lng).toBeCloseTo(-120.2, 5);
    expect(pts[2].lat).toBeCloseTo(43.252, 5);
    expect(pts[2].lng).toBeCloseTo(-126.453, 5);
  });
});
