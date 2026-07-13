import type { RouteLeg } from "../../shared/types.js";

/**
 * Approximate well-to-wheel CO₂ intensity (grams per km) for Singapore.
 * Rail is grid-electric; bus is diesel/hybrid; taxi/car are single-occupant ICE.
 * These are defensible planning estimates, not audited figures.
 */
export const EMISSION_G_PER_KM = {
  walk: 0,
  mrt: 30,
  bus: 80,
  taxi: 180,
  car: 170,
} as const;

/** CO₂ (grams) for a transit itinerary, summed across its legs. */
export function itineraryCo2Grams(
  legs: Pick<RouteLeg, "type" | "distance">[],
): number {
  const total = legs.reduce((sum, l) => {
    const km = l.distance / 1000;
    const factor =
      l.type === "mrt"
        ? EMISSION_G_PER_KM.mrt
        : l.type === "bus"
          ? EMISSION_G_PER_KM.bus
          : EMISSION_G_PER_KM.walk;
    return sum + km * factor;
  }, 0);
  return Math.round(total);
}

/** CO₂ (grams) for driving the same distance by taxi / private car. */
export function drivingCo2Grams(driveKm: number): {
  taxiGrams: number;
  carGrams: number;
} {
  return {
    taxiGrams: Math.round(driveKm * EMISSION_G_PER_KM.taxi),
    carGrams: Math.round(driveKm * EMISSION_G_PER_KM.car),
  };
}

/** Human-friendly equivalents for a CO₂ saving (grams). */
export function equivalents(savedGrams: number): {
  kmDriven: number;
  treeDays: number;
} {
  const saved = Math.max(0, savedGrams);
  return {
    // km of car driving avoided
    kmDriven: Math.round((saved / EMISSION_G_PER_KM.car) * 10) / 10,
    // a mature tree absorbs ~57.5 g CO₂/day
    treeDays: Math.round((saved / 57.5) * 10) / 10,
  };
}

/** 0–100 "greenness" score for a route vs a private-car baseline. */
export function sustainabilityScore(
  routeGrams: number,
  carGrams: number,
): number {
  if (carGrams <= 0) return 100;
  const ratio = routeGrams / carGrams; // lower is greener
  return Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));
}
