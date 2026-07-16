import type {
  BusLegFeasibility,
  BusAlternative,
  FeasibilityStatus,
  RouteLeg,
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
/**
 * Fold live bus waiting into an itinerary's total time.
 *
 * OneMap's `duration` is timetable-based; for a "leave now" trip the real first
 * bus can come earlier or later than the schedule. We shift the whole journey by
 * that difference (live board time − scheduled board time) so the total — and
 * therefore the "fastest" ranking — reflects the wait you'll actually face.
 *
 * `waitSeconds` is the time you'd spend standing at the first stop after walking
 * there (max(0, buffer)); it's surfaced in the UI. Itineraries with no live bus
 * data (MRT-only, or arrivals unavailable) are returned unchanged.
 */
export function applyLiveWaiting(
  legs: RouteLeg[],
  otpDuration: number,
  now: number = Date.now(),
): { duration: number; waitSeconds: number | undefined } {
  const sumLegs = legs.reduce((s, l) => s + l.duration, 0);
  const bus = legs.find(
    (l) => l.type === "bus" && l.busLegFeasibility?.eta,
  );
  const f = bus?.busLegFeasibility;
  if (!bus || !f || !f.eta) {
    return { duration: otpDuration, waitSeconds: undefined };
  }

  const waitSeconds = Math.max(0, f.buffer) * 60;
  const liveBoardMs = new Date(f.eta).getTime();

  let adjusted: number;
  if (bus.startTimeMs != null) {
    // Shift the trip by how late/early the live bus is versus the timetable.
    adjusted = otpDuration + Math.round((liveBoardMs - bus.startTimeMs) / 1000);
  } else {
    // No OTP timestamps: rebuild from pure travel time + live first-bus wait.
    adjusted = sumLegs + waitSeconds;
  }

  return { duration: Math.max(sumLegs, adjusted), waitSeconds };
}

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
