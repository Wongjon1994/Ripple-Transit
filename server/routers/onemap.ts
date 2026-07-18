import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../trpc.js";
import {
  oneMapSearch,
  oneMapRoute,
  getOneMapTokenInfo,
  forceRefreshOneMap,
  mrtStationExits,
  reverseGeocode,
  resolveStationCode,
} from "../services/onemap.js";
import { hereAutosuggest } from "../services/here.js";
import {
  busArrivals,
  serviceConnects,
  haversineMeters,
  stationCrowd,
} from "../services/lta.js";
import {
  computeBusFeasibility,
  applyLiveWaiting,
  type BusCandidate,
} from "../services/feasibility.js";
import { weatherAt } from "../services/weather.js";
import { computeRouteRisk, type RiskContext } from "../services/risk.js";
import {
  itineraryCo2Grams,
  drivingCo2Grams,
} from "../services/sustainability.js";
import {
  getTrafficIncidents,
  incidentsOnPath,
  incidentLabel,
} from "../services/traffic.js";
import { rawHoursFor, readOpeningHours } from "../services/openingHours.js";
import { getAllLineStatuses } from "../db/helpers.js";
import type {
  Itinerary,
  RouteLeg,
  LatLng,
  WeatherContext,
  CarbonBaseline,
} from "../../shared/types.js";

const routeInput = z.object({
  start: z.object({ lat: z.number(), lng: z.number() }),
  end: z.object({ lat: z.number(), lng: z.number() }),
  mode: z.enum(["WALK", "TRANSIT", "DRIVE", "CYCLE"]).default("TRANSIT"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  /** Destination establishment name — enables the opening-hours arrival risk. */
  destName: z.string().max(255).optional(),
});

function todayParts() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

// LTA's live BusArrival only returns the next ~3 buses; beyond this horizon a
// boarding can't be covered by live data, so we fall back to scheduled times.
const LIVE_HORIZON_MS = 45 * 60 * 1000;

/**
 * Bus-leg feasibility. The candidate set is every interchangeable bus for this
 * leg — services that board at the same stop and reach the same alighting stop.
 * The recommended bus becomes the soonest one you can catch (live timing); the
 * leg's displayed service is updated to match.
 */
async function enrichBusLeg(
  it: Itinerary,
  leg: RouteLeg,
  idx: number,
  now: number,
): Promise<void> {
  const board = leg.busStopCode!;
  const alight = leg.endBusStopCode;

  // Trips scheduled beyond LTA's live-arrival horizon: the next-3-buses feed
  // only covers the near term, so live ETAs from now are meaningless for a
  // boarding an hour out. Fall back to OTP's scheduled board time and flag it.
  if (leg.startTimeMs != null && leg.startTimeMs - now > LIVE_HORIZON_MS) {
    leg.busLegFeasibility = {
      status: "ok",
      scheduled: true,
      buffer: 0,
      eta: new Date(leg.startTimeMs).toISOString(),
      serviceNo: leg.busNo,
      walkMinutes: Math.round(
        (it.legs[idx - 1]?.type === "walk" ? it.legs[idx - 1].duration : 0) / 60,
      ),
      alternatives: [],
    };
    return;
  }

  // Time until you actually reach this boarding stop: for the first transit
  // leg that's just the walk; for buses boarded mid-journey it's everything
  // before it (walks + rides), so the buffer isn't scored as though you were
  // standing at the stop right now.
  const enRoute = it.legs.slice(0, idx).some((l) => l.type !== "walk");
  const leadSeconds = it.legs
    .slice(0, idx)
    .reduce((s, l) => s + l.duration, 0);
  const prev = it.legs[idx - 1];
  const walkSeconds = enRoute
    ? leadSeconds
    : prev?.type === "walk"
      ? prev.duration
      : 0;
  try {
    const { services } = await busArrivals(board);
    const candidates: BusCandidate[] = [];
    await Promise.all(
      services.map(async (s) => {
        // Keep the leg's own service, plus any service that also reaches the
        // alighting stop (interchangeable for this leg).
        let reaches = s.serviceNo === leg.busNo;
        if (!reaches && alight) {
          reaches = await serviceConnects(s.serviceNo, board, alight).catch(
            () => false,
          );
        }
        if (!reaches) return;
        for (const nb of [s.nextBus, s.nextBus2, s.nextBus3]) {
          if (nb)
            candidates.push({
              serviceNo: s.serviceNo,
              eta: nb.estimatedArrival,
            });
        }
      }),
    );
    const f = computeBusFeasibility(walkSeconds, candidates, now);
    if (enRoute) {
      // If none of LTA's next-3 buses arrive after you reach the stop, live
      // data simply doesn't cover that horizon — say nothing rather than
      // flashing a bogus MISS for a bus you were never trying to catch.
      if (f.status === "miss" || f.status === "unknown") return;
      f.enRoute = true;
      f.arriveAtStopMs = now + leadSeconds * 1000;
      // Restore the human walk time for display; the buffer already accounts
      // for the full lead time.
      f.walkMinutes = Math.round(
        (prev?.type === "walk" ? prev.duration : 0) / 60,
      );
    }
    leg.busLegFeasibility = f;
    // Recommend the soonest catchable interchangeable bus for this leg.
    if (f.serviceNo) leg.busNo = f.serviceNo;
  } catch {
    leg.busLegFeasibility = {
      status: "unknown",
      buffer: 0,
      eta: null,
      walkMinutes: Math.round(walkSeconds / 60),
      alternatives: [],
    };
  }
}

/** Pick the station exit closest to where you head next (best-effort). */
async function enrichMrtExit(
  it: Itinerary,
  leg: RouteLeg,
  idx: number,
): Promise<void> {
  if (!leg.endStation) return;
  // Aim at the next leg's destination, or the itinerary's final point.
  const next = it.legs[idx + 1];
  const aim = next ? next.endPoint : it.legs[it.legs.length - 1].endPoint;
  try {
    const exits = await mrtStationExits(leg.endStation);
    if (!exits.length) return;
    const ranked = exits
      .map((e) => ({
        name: e.name,
        distanceM: Math.round(haversineMeters(aim, { lat: e.lat, lng: e.lng })),
      }))
      .sort((a, b) => a.distanceM - b.distanceM);
    leg.exitName = ranked[0].name;
    leg.exitDistanceM = ranked[0].distanceM;
    // Offer up to two other exits that are within ~150m of the best.
    leg.exitAlternatives = ranked
      .slice(1)
      .filter((e) => e.distanceM - ranked[0].distanceM <= 150)
      .slice(0, 2);
  } catch {
    /* no exit info — leave undefined */
  }
}

/**
 * A path signature keyed by stops/lines, NOT bus number — so two itineraries
 * that differ only by which interchangeable bus they name collapse into one
 * option (e.g. 120 vs 64 vs 145, all boarding stop X → alighting stop Y).
 */
function pathKey(it: Itinerary): string {
  return it.legs
    .filter((l) => l.type !== "walk")
    .map((l) =>
      l.type === "bus"
        ? `B:${l.busStopCode ?? l.startBusStop}>${l.endBusStopCode ?? l.endBusStop}`
        : `M:${l.lineCode}:${l.startStation}>${l.endStation}`,
    )
    .join("|");
}

/** Keep one itinerary per distinct path (OneMap returns them fastest-first). */
function dedupeItineraries(itineraries: Itinerary[]): Itinerary[] {
  const seen = new Set<string>();
  const out: Itinerary[] = [];
  for (const it of itineraries) {
    const key = pathKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** Live boarding-platform crowd for an MRT leg (PCDRealTime). */
async function enrichMrtCrowd(
  leg: RouteLeg,
  crowd: Map<string, "l" | "m" | "h">,
): Promise<void> {
  if (!leg.startStation) return;
  const code = await resolveStationCode(leg.startStation, leg.lineCode);
  if (!code) return;
  leg.stationCode = code;
  const level = crowd.get(code);
  if (level) leg.crowd = level;
}

/** Attach live feasibility (bus) and exit + crowd guidance (MRT) to every leg. */
async function enrichItineraries(itineraries: Itinerary[]): Promise<void> {
  const now = Date.now();
  const crowd = await stationCrowd().catch(
    () => new Map<string, "l" | "m" | "h">(),
  );
  await Promise.all(
    itineraries.flatMap((it) =>
      it.legs.map(async (leg, idx) => {
        if (leg.type === "bus" && leg.busStopCode) {
          await enrichBusLeg(it, leg, idx, now);
        } else if (leg.type === "mrt") {
          await Promise.all([
            enrichMrtExit(it, leg, idx),
            enrichMrtCrowd(leg, crowd),
          ]);
        }
      }),
    ),
  );
}

/** SG wall-clock label ("7:15 pm") for an instant. */
function sgClockLabel(d: Date): string {
  const sg = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  let h = sg.getUTCHours();
  const m = sg.getUTCMinutes();
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

/**
 * Evaluate the destination's OSM hours against this itinerary's arrival time.
 * Returns undefined unless the open/closed state is definite — we never flag a
 * risk from indeterminate hours. "Closing soon" = open on arrival but shut 30
 * minutes later.
 */
function destinationArrivalRisk(
  it: Itinerary,
  destRaw: string | null,
): RiskContext["destination"] | undefined {
  if (!destRaw) return undefined;
  const lastLeg = it.legs[it.legs.length - 1];
  const arrivalMs =
    lastLeg?.endTimeMs ??
    (it.startTimeMs
      ? it.startTimeMs + it.duration * 1000
      : Date.now() + it.duration * 1000);
  const atArrival = readOpeningHours(destRaw, new Date(arrivalMs));
  if (!atArrival || typeof atArrival.openNow !== "boolean") return undefined;
  const soon = readOpeningHours(destRaw, new Date(arrivalMs + 30 * 60 * 1000));
  return {
    openAtArrival: atArrival.openNow,
    closingSoon:
      atArrival.openNow && !atArrival.alwaysOpen && soon?.openNow === false,
    arrivalLabel: sgClockLabel(new Date(arrivalMs)),
  };
}

/**
 * Full transit-planning pipeline for one origin→destination segment:
 * OneMap routing → dedupe → (optionally) live enrichment → risk/CO₂ →
 * (optionally) live-wait adjustment → fastest-first sort → carbon baseline.
 *
 * `live` should be false for segments the commuter won't start for a while
 * (multi-stop segments after the first): live bus ETAs are only meaningful
 * near departure, so those segments stay timetable-based and skip the
 * feasibility callouts entirely.
 */
export async function planTransit(
  start: LatLng,
  end: LatLng,
  date: string,
  time: string,
  live: boolean,
  /** Destination establishment name — enables the opening-hours arrival risk. */
  destName?: string,
): Promise<{
  itineraries: Itinerary[];
  weather: WeatherContext | null;
  carbon: CarbonBaseline;
}> {
  let itineraries = await oneMapRoute({
    start,
    end,
    mode: "TRANSIT",
    date,
    time,
  });
  itineraries = dedupeItineraries(itineraries);
  if (live) await enrichItineraries(itineraries);

  // Context for per-option risk: weather, MRT disruptions, live traffic.
  const [wx, lineStatuses, incidents] = await Promise.all([
    weatherAt(start.lat, start.lng).catch(() => null),
    getAllLineStatuses().catch(() => []),
    getTrafficIncidents().catch(() => []),
  ]);
  const disruptedLines = new Set(
    lineStatuses
      .filter((l) => l.status !== "operational")
      .map((l) => l.lineCode),
  );

  // Destination opening hours (only when the To is a named establishment).
  const destRaw = destName
    ? await rawHoursFor({ name: destName, point: end }).catch(() => null)
    : null;

  for (const it of itineraries) {
    // Flag bus legs whose road has a live traffic incident.
    const trafficAlerts: { severe: boolean; label: string }[] = [];
    for (const leg of it.legs) {
      if (leg.type !== "bus") continue;
      const hits = incidentsOnPath(
        { polyline: leg.polyline, start: leg.startPoint, end: leg.endPoint },
        incidents,
      );
      if (hits.length) {
        leg.trafficAlert = incidentLabel(hits[0]);
        for (const h of hits)
          trafficAlerts.push({ severe: h.severe, label: incidentLabel(h) });
      }
    }
    it.risk = computeRouteRisk(it, {
      wet: wx?.wet ?? false,
      disruptedLines,
      trafficAlerts,
      destination: destinationArrivalRisk(it, destRaw),
    });
    it.co2Grams = itineraryCo2Grams(it.legs);

    if (live) {
      // Fold live bus waiting into the total so timing + "fastest" ranking
      // reflect the wait you'll actually face, not just the timetable.
      const { duration, waitSeconds } = applyLiveWaiting(it.legs, it.duration);
      it.duration = duration;
      it.waitSeconds = waitSeconds;
    }
  }

  // Re-rank by (live-adjusted) total time, fastest first.
  itineraries.sort((a, b) => a.duration - b.duration);

  // Driving baseline (~1.35× straight-line road factor) for CO₂ comparison.
  const driveKm = (haversineMeters(start, end) / 1000) * 1.35;
  return {
    itineraries,
    weather: wx,
    carbon: { driveKm, ...drivingCo2Grams(driveKm) },
  };
}

/** Advance a naive local date/time pair by `seconds` (SG has no DST). */
export function advanceClock(
  date: string,
  time: string,
  seconds: number,
): { date: string; time: string } {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const t = new Date(y, mo - 1, d, h, mi);
  t.setSeconds(t.getSeconds() + seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
    time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
  };
}

export const onemapRouter = router({
  tokenInfo: publicProcedure.query(async () => {
    const info = await getOneMapTokenInfo();
    return info ?? { expiresAt: 0, issuedAt: 0 };
  }),

  search: publicProcedure
    .input(z.object({ q: z.string().min(1).max(255), page: z.number().optional() }))
    .query(async ({ input }) => {
      let results = await oneMapSearch(input.q, input.page ?? 1).catch(() => []);
      let hereFallback: Awaited<ReturnType<typeof hereAutosuggest>> = [];

      // Fall back to HERE only when OneMap finds nothing.
      if (results.length === 0) {
        hereFallback = await hereAutosuggest(input.q).catch(() => []);
        results = hereFallback;
      }

      return { results, hereFallback };
    }),

  route: publicProcedure.input(routeInput).query(async ({ input }) => {
    const { date: d, time: t } = todayParts();
    const date = input.date ?? d;
    const time = input.time ?? t;
    try {
      if (input.mode === "TRANSIT") {
        const { itineraries, weather, carbon } = await planTransit(
          input.start,
          input.end,
          date,
          time,
          true,
          input.destName,
        );
        return { plan: { itineraries }, weather, carbon };
      }
      const itineraries = await oneMapRoute({
        start: input.start,
        end: input.end,
        mode: input.mode,
        date,
        time,
      });
      return { plan: { itineraries }, weather: null, carbon: null };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error ? err.message : "Failed to calculate route.",
      });
    }
  }),

  /**
   * Multi-stop transit routing: origin + 2–5 destinations visited in order.
   * Each segment departs when the previous one arrives; the best (fastest,
   * live-wait-aware for the first segment) itinerary per segment is stitched
   * into one journey. Fare/CO₂/duration are summed; risk is the worst segment.
   */
  multiRoute: publicProcedure
    .input(
      z.object({
        points: z
          .array(z.object({ lat: z.number(), lng: z.number() }))
          .min(3) // origin + at least 2 stops (single-stop uses `route`)
          .max(6), // origin + up to 5 destinations
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
      }),
    )
    .query(async ({ input }) => {
      const { date: d, time: t } = todayParts();
      let clock = { date: input.date ?? d, time: input.time ?? t };

      const segments: Itinerary[] = [];
      let weather: WeatherContext | null = null;
      const carbon: CarbonBaseline = { driveKm: 0, taxiGrams: 0, carGrams: 0 };

      for (let i = 0; i < input.points.length - 1; i++) {
        let seg;
        try {
          // Live enrichment only for the segment you're about to start.
          seg = await planTransit(
            input.points[i],
            input.points[i + 1],
            clock.date,
            clock.time,
            i === 0,
          );
        } catch (err) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              err instanceof Error ? err.message : "Failed to calculate route.",
          });
        }
        const best = seg.itineraries[0];
        if (!best) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No transit route found for stop ${i + 1} → stop ${i + 2}.`,
          });
        }
        segments.push(best);
        weather ??= seg.weather;
        carbon.driveKm += seg.carbon.driveKm;
        carbon.taxiGrams += seg.carbon.taxiGrams;
        carbon.carGrams += seg.carbon.carGrams;
        clock = advanceClock(clock.date, clock.time, best.duration);
      }

      // Stitch the per-segment winners into one journey. The first leg of each
      // later segment is tagged with the stop it departs from, so the UI can
      // divide the stepper at each destination.
      const legs: RouteLeg[] = [];
      segments.forEach((seg, i) => {
        if (i > 0 && seg.legs[0]) seg.legs[0].viaStopIndex = i;
        legs.push(...seg.legs);
      });
      const worstRisk = segments
        .map((s) => s.risk)
        .filter((r) => r != null)
        .sort((a, b) => b!.score - a!.score)[0];

      const stitched: Itinerary = {
        duration: segments.reduce((s, it) => s + it.duration, 0),
        fare: segments.reduce((s, it) => s + it.fare, 0),
        transfers: segments.reduce((s, it) => s + it.transfers, 0),
        legs,
        risk: worstRisk
          ? {
              ...worstRisk,
              reasons: [
                ...new Set(segments.flatMap((s) => s.risk?.reasons ?? [])),
              ],
            }
          : undefined,
        co2Grams: segments.reduce((s, it) => s + (it.co2Grams ?? 0), 0),
        waitSeconds: segments[0]?.waitSeconds,
        startTimeMs: segments[0]?.startTimeMs,
      };

      return { plan: { itineraries: [stitched] }, weather, carbon };
    }),

  reverseGeocode: publicProcedure
    .input(z.object({ lat: z.number(), lng: z.number() }))
    .query(async ({ input }) => {
      const label = await reverseGeocode(input.lat, input.lng);
      return { label };
    }),

  forceRefreshToken: adminProcedure
    .input(z.object({ email: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      return forceRefreshOneMap(input.email, input.password);
    }),
});
