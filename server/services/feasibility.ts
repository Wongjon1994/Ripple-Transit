import type {
  BusLegFeasibility,
  BusAlternative,
  FeasibilityStatus,
} from "../../shared/types.js";

/**
 * Bus feasibility (Phase 12).
 *
 * Given how long it takes to walk to the stop and when each bus is due,
 * classify whether the commuter can realistically catch it.
 *
 *   buffer (min) = minutesUntilBus − walkMinutes
 *     buffer ≥ OK_THRESHOLD    → "ok"     (comfortable)
 *     0 ≤ buffer < OK_THRESHOLD → "tight"  (doable but rushed)
 *     buffer < 0               → "miss"   (bus leaves before you arrive)
 */
export const OK_THRESHOLD_MIN = 2;

export function classify(bufferMin: number): Exclude<
  FeasibilityStatus,
  "unknown"
> {
  if (bufferMin < 0) return "miss";
  if (bufferMin < OK_THRESHOLD_MIN) return "tight";
  return "ok";
}

export interface BusCandidate {
  serviceNo: string;
  eta: string | null; // ISO timestamp
  /** true if this is a different service that still reaches the alighting stop
   *  (a re-route), false/undefined for later arrivals of the planned service. */
  reroute?: boolean;
}

export function minutesUntil(iso: string, now: number): number {
  return (new Date(iso).getTime() - now) / 60000;
}

export function bufferMinutes(
  etaIso: string,
  walkSeconds: number,
  now: number,
): number {
  return minutesUntil(etaIso, now) - walkSeconds / 60;
}

/**
 * Build the feasibility summary for a bus leg.
 *
 * @param walkSeconds   time to walk from current position to the boarding stop
 * @param candidates    upcoming buses at the stop (target service + alternatives)
 * @param targetService the bus number the itinerary wants you to take
 * @param now           reference time in ms (defaults to Date.now())
 */
export function computeBusFeasibility(
  walkSeconds: number,
  candidates: BusCandidate[],
  targetService: string | undefined,
  now: number = Date.now(),
): BusLegFeasibility {
  const walkMinutes = round1(walkSeconds / 60);

  // The primary bus: the target service's next arrival if present.
  const target = candidates.find(
    (c) => c.serviceNo === targetService && c.eta,
  );

  let status: FeasibilityStatus = "unknown";
  let buffer = 0;
  let eta: string | null = null;

  if (target?.eta) {
    buffer = round1(bufferMinutes(target.eta, walkSeconds, now));
    status = classify(buffer);
    eta = target.eta;
  }

  // Alternatives: later arrivals of the planned service and re-route options
  // (different services that reach the same stop). Same-route first, then
  // re-routes, each by soonest arrival; misses dropped; capped at 3.
  const alternatives: BusAlternative[] = candidates
    .filter((c) => c.eta && c.eta !== eta)
    .map((c) => {
      const b = round1(bufferMinutes(c.eta!, walkSeconds, now));
      return {
        serviceNo: c.serviceNo,
        eta: c.eta!,
        buffer: b,
        feasibility: classify(b),
        reroute: c.reroute ?? false,
      };
    })
    .filter((a) => a.feasibility !== "miss")
    .sort(
      (a, b) =>
        Number(a.reroute) - Number(b.reroute) ||
        new Date(a.eta).getTime() - new Date(b.eta).getTime(),
    )
    .slice(0, 3);

  return { status, buffer, eta, walkMinutes, alternatives };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
