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
 * All `candidates` are interchangeable buses for this leg — services that board
 * at the same stop and reach the same alighting stop. The recommended bus is
 * the soonest one you can actually catch; the rest are same-leg alternatives
 * ordered by arrival time.
 *
 * @param walkSeconds  time to walk from current position to the boarding stop
 * @param candidates   interchangeable upcoming buses at the stop
 * @param now          reference time in ms (defaults to Date.now())
 */
export function computeBusFeasibility(
  walkSeconds: number,
  candidates: BusCandidate[],
  now: number = Date.now(),
): BusLegFeasibility {
  const walkMinutes = Math.round(walkSeconds / 60);

  const scored = candidates
    .filter((c) => c.eta)
    .map((c) => {
      const buffer = Math.round(bufferMinutes(c.eta!, walkSeconds, now));
      return {
        serviceNo: c.serviceNo,
        eta: c.eta!,
        buffer,
        feasibility: classify(buffer),
      };
    })
    .sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime());

  if (scored.length === 0) {
    return {
      status: "unknown",
      buffer: 0,
      eta: null,
      serviceNo: undefined,
      walkMinutes,
      alternatives: [],
    };
  }

  // Recommended = soonest catchable (not a miss); fall back to the soonest.
  const primary = scored.find((s) => s.feasibility !== "miss") ?? scored[0];

  const alternatives: BusAlternative[] = scored
    .filter((s) => !(s.serviceNo === primary.serviceNo && s.eta === primary.eta))
    .filter((s) => s.feasibility !== "miss")
    .slice(0, 4)
    .map((s) => ({
      serviceNo: s.serviceNo,
      eta: s.eta,
      buffer: s.buffer,
      feasibility: s.feasibility,
      reroute: s.serviceNo !== primary.serviceNo,
    }));

  return {
    status: primary.feasibility,
    buffer: primary.buffer,
    eta: primary.eta,
    serviceNo: primary.serviceNo,
    walkMinutes,
    alternatives,
  };
}
