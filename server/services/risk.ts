import type { Itinerary, RouteRisk } from "../../shared/types.js";

export interface RiskContext {
  wet: boolean;
  disruptedLines: Set<string>;
  /** Live traffic incidents affecting this option's bus legs. */
  trafficAlerts?: { severe: boolean; label: string }[];
  /** Destination opening hours vs this option's arrival time (when the
   *  destination is a known establishment with mapped OSM hours). */
  destination?: {
    openAtArrival: boolean;
    /** Open on arrival but shuts within the grace window. */
    closingSoon: boolean;
    /** Arrival clock label, e.g. "7:15 pm". */
    arrivalLabel: string;
  };
}

/**
 * Explainable per-option risk. Higher score = less reliable. Factors:
 *  - tightest bus connection (miss / tight)
 *  - number of transfers (more failure points)
 *  - MRT line disruptions on the path
 *  - rain exposure, weighted by how much of the trip is on foot
 */
export function computeRouteRisk(
  it: Itinerary,
  ctx: RiskContext,
): RouteRisk {
  let score = 0;
  const reasons: string[] = [];

  let sawMiss = false;
  let sawTight = false;
  for (const leg of it.legs) {
    const s = leg.busLegFeasibility?.status;
    if (s === "miss") sawMiss = true;
    else if (s === "tight") sawTight = true;
  }
  if (sawMiss) {
    score += 3;
    reasons.push("You may miss a bus connection");
  } else if (sawTight) {
    score += 2;
    reasons.push("Tight bus connection");
  }

  if (it.transfers >= 2) {
    score += 1;
    reasons.push(`${it.transfers} transfers`);
  }

  const disrupted = it.legs
    .filter(
      (l) => l.type === "mrt" && l.lineCode && ctx.disruptedLines.has(l.lineCode),
    )
    .map((l) => l.lineCode!);
  if (disrupted.length) {
    score += 2;
    reasons.push(`${[...new Set(disrupted)].join(", ")} line disruption`);
  }

  // Live platform crowding at a boarding MRT station (PCDRealTime).
  const crowded = it.legs.filter((l) => l.type === "mrt" && l.crowd === "h");
  if (crowded.length) {
    score += 1;
    reasons.push(
      `Crowded platform at ${crowded[0].startStation ?? "an MRT station"}`,
    );
  }

  // Live road traffic on a bus leg (accident / heavy traffic / breakdown).
  if (ctx.trafficAlerts?.length) {
    const severe = ctx.trafficAlerts.some((a) => a.severe);
    score += severe ? 2 : 1;
    reasons.push(ctx.trafficAlerts[0].label);
  }

  // Destination opening hours vs arrival (only when hours are known).
  if (ctx.destination) {
    if (!ctx.destination.openAtArrival) {
      score += 3;
      reasons.push(`Closed when you arrive (~${ctx.destination.arrivalLabel})`);
    } else if (ctx.destination.closingSoon) {
      score += 1;
      reasons.push(`Closes soon after you arrive (~${ctx.destination.arrivalLabel})`);
    }
  }

  const walkMin = Math.round(
    it.legs
      .filter((l) => l.type === "walk")
      .reduce((a, l) => a + l.duration, 0) / 60,
  );
  if (ctx.wet) {
    if (walkMin >= 18) {
      score += 2;
      reasons.push(`Rain with ~${walkMin} min walking`);
    } else if (walkMin >= 8) {
      score += 1;
      reasons.push("Rain with some walking");
    } else {
      reasons.push("Light rain expected");
    }
  }

  const level = score >= 4 ? "high" : score >= 2 ? "moderate" : "low";
  return { level, score, reasons };
}
