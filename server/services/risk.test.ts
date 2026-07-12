import { describe, it, expect } from "vitest";
import { computeRouteRisk } from "./risk.js";
import type { Itinerary, RouteLeg } from "../../shared/types.js";

const walk = (min: number): RouteLeg => ({
  type: "walk",
  startPoint: { lat: 0, lng: 0 },
  endPoint: { lat: 0, lng: 0 },
  duration: min * 60,
  distance: min * 80,
});

const bus = (status: "ok" | "tight" | "miss"): RouteLeg => ({
  type: "bus",
  startPoint: { lat: 0, lng: 0 },
  endPoint: { lat: 0, lng: 0 },
  duration: 600,
  distance: 3000,
  busNo: "1",
  busLegFeasibility: { status, buffer: 0, walkMinutes: 5, eta: null, alternatives: [] },
});

const mrt = (lineCode: string): RouteLeg => ({
  type: "mrt",
  startPoint: { lat: 0, lng: 0 },
  endPoint: { lat: 0, lng: 0 },
  duration: 600,
  distance: 5000,
  lineCode,
});

const itin = (legs: RouteLeg[], transfers = 0): Itinerary => ({
  duration: legs.reduce((a, l) => a + l.duration, 0),
  fare: 2,
  transfers,
  legs,
});

const dry = { wet: false, disruptedLines: new Set<string>() };

describe("computeRouteRisk", () => {
  it("is low risk for a comfortable single-transfer trip", () => {
    const r = computeRouteRisk(itin([walk(5), bus("ok"), mrt("NS")], 1), dry);
    expect(r.level).toBe("low");
    expect(r.score).toBe(0);
  });

  it("flags a tight bus connection as some risk", () => {
    const r = computeRouteRisk(itin([walk(3), bus("tight")]), dry);
    expect(r.level).toBe("moderate");
    expect(r.reasons).toContain("Tight bus connection");
  });

  it("compounds a missed bus with transfers into high risk", () => {
    const r = computeRouteRisk(itin([bus("miss"), mrt("EW"), mrt("CC")], 2), dry);
    expect(r.score).toBeGreaterThanOrEqual(4);
    expect(r.level).toBe("high");
  });

  it("raises risk when an MRT line on the path is disrupted", () => {
    const ctx = { wet: false, disruptedLines: new Set(["NE"]) };
    const r = computeRouteRisk(itin([mrt("NE")]), ctx);
    expect(r.reasons.some((x) => x.includes("NE"))).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(2);
  });

  it("raises risk for a live traffic incident on a bus leg", () => {
    const base = computeRouteRisk(itin([walk(3), bus("ok")]), dry);
    const withJam = computeRouteRisk(itin([walk(3), bus("ok")]), {
      ...dry,
      trafficAlerts: [{ severe: true, label: "Accident on AYE" }],
    });
    expect(withJam.score).toBeGreaterThan(base.score);
    expect(withJam.reasons).toContain("Accident on AYE");
  });

  it("adds rain exposure weighted by walking time", () => {
    const wet = { wet: true, disruptedLines: new Set<string>() };
    const light = computeRouteRisk(itin([walk(4), bus("ok")]), wet);
    const heavy = computeRouteRisk(itin([walk(20), bus("ok")]), wet);
    expect(heavy.score).toBeGreaterThan(light.score);
    expect(heavy.reasons.some((x) => /Rain/.test(x))).toBe(true);
  });
});
