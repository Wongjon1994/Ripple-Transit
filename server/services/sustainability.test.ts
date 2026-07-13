import { describe, it, expect } from "vitest";
import {
  itineraryCo2Grams,
  drivingCo2Grams,
  equivalents,
  sustainabilityScore,
  EMISSION_G_PER_KM,
} from "./sustainability.js";
import type { RouteLeg } from "../../shared/types.js";

const leg = (type: RouteLeg["type"], distanceM: number): RouteLeg => ({
  type,
  startPoint: { lat: 0, lng: 0 },
  endPoint: { lat: 0, lng: 0 },
  duration: 0,
  distance: distanceM,
});

describe("itineraryCo2Grams", () => {
  it("sums per-leg emissions and ignores walking", () => {
    // 2km MRT (30) + 3km bus (80) + 1km walk (0) = 60 + 240 = 300 g
    const g = itineraryCo2Grams([
      leg("mrt", 2000),
      leg("bus", 3000),
      leg("walk", 1000),
    ]);
    expect(g).toBe(300);
  });

  it("is zero for an all-walking route", () => {
    expect(itineraryCo2Grams([leg("walk", 1500)])).toBe(0);
  });
});

describe("drivingCo2Grams", () => {
  it("scales taxi/car by distance", () => {
    const { taxiGrams, carGrams } = drivingCo2Grams(10);
    expect(taxiGrams).toBe(10 * EMISSION_G_PER_KM.taxi);
    expect(carGrams).toBe(10 * EMISSION_G_PER_KM.car);
  });
});

describe("equivalents", () => {
  it("derives km-driven and tree-days from grams saved", () => {
    const e = equivalents(1700); // ~10 km of car driving
    expect(e.kmDriven).toBeCloseTo(10, 0);
    expect(e.treeDays).toBeGreaterThan(0);
  });

  it("clamps negatives to zero", () => {
    expect(equivalents(-500)).toEqual({ kmDriven: 0, treeDays: 0 });
  });
});

describe("sustainabilityScore", () => {
  it("is high when the route emits far less than a car", () => {
    expect(sustainabilityScore(100, 1000)).toBe(90);
  });
  it("is 100 when there is no car baseline", () => {
    expect(sustainabilityScore(100, 0)).toBe(100);
  });
});
