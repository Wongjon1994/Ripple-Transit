import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../trpc.js";
import {
  oneMapSearch,
  oneMapRoute,
  walkRouteSteps,
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
  nearbyStops,
} from "../services/lta.js";
import { classify } from "../services/feasibility.js";
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
import { matchScores, type PrefWeights } from "../../shared/prefMatch.js";
import { getAllLineStatuses } from "../db/helpers.js";
import type {
  Itinerary,
  RouteLeg,
  LatLng,
  WeatherContext,
  CarbonBaseline,
  BusAlternative,
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
  /** When true, date/time is the target ARRIVAL; we solve for the departure. */
  arriveBy: z.boolean().optional(),
  /** Result ordering preference (Preferences → Route priority). Superseded by
   *  `prefWeights` when the user has moved the Flux sliders. */
  transitPriority: z
    .enum(["fastest", "fewest_transfers", "least_walking", "greenest"])
    .optional(),
  /** Flux slider weights (0–1 per dimension) — preference-weighted ordering. */
  prefWeights: z
    .object({
      time: z.number().min(0).max(1).optional(),
      transfers: z.number().min(0).max(1).optional(),
      walking: z.number().min(0).max(1).optional(),
      crowds: z.number().min(0).max(1).optional(),
      cost: z.number().min(0).max(1).optional(),
      carbon: z.number().min(0).max(1).optional(),
    })
    .optional(),
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

// Peak windows (SG, weekdays): buses run slower in traffic. A live incident on
// the leg's road adds further delay on top.
const PEAK_FACTOR = 1.2;
const INCIDENT_FACTOR = 1.25;

/** Epoch ms for an SG-local depart date/time (UTC+8, no DST). */
function sgDepartMs(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h - 8, mi);
}

/** Inverse of sgDepartMs: an epoch → SG-local { date, time } route params. */
function msToSgParts(ms: number): { date: string; time: string } {
  const sg = new Date(ms + 8 * 60 * 60 * 1000);
  const date = sg.toISOString().slice(0, 10);
  const time = sg.toISOString().slice(11, 16);
  return { date, time };
}

/** Peak-window congestion multiplier for a bus ride departing at `boardMs`. */
function peakFactor(boardMs: number): number {
  const sg = new Date(boardMs + 8 * 60 * 60 * 1000);
  const day = sg.getUTCDay(); // 0 Sun … 6 Sat
  const hour = sg.getUTCHours() + sg.getUTCMinutes() / 60;
  const weekday = day >= 1 && day <= 5;
  const peak =
    weekday && ((hour >= 7.5 && hour <= 9.5) || (hour >= 17.5 && hour <= 20));
  return peak ? PEAK_FACTOR : 1;
}

/** Interchangeable live buses for a leg's boarding stop, soonest first. */
async function liveCandidatesFor(
  leg: RouteLeg,
): Promise<{ serviceNo: string; etaMs: number }[]> {
  const board = leg.busStopCode;
  const alight = leg.endBusStopCode;
  if (!board) return [];
  try {
    const { services } = await busArrivals(board);
    const out: { serviceNo: string; etaMs: number }[] = [];
    await Promise.all(
      services.map(async (s) => {
        let reaches = s.serviceNo === leg.busNo;
        if (!reaches && alight) {
          reaches = await serviceConnects(s.serviceNo, board, alight).catch(
            () => false,
          );
        }
        if (!reaches) return;
        for (const nb of [s.nextBus, s.nextBus2, s.nextBus3]) {
          if (nb?.estimatedArrival)
            out.push({
              serviceNo: s.serviceNo,
              etaMs: new Date(nb.estimatedArrival).getTime(),
            });
        }
      }),
    );
    return out.sort((a, b) => a.etaMs - b.etaMs);
  } catch {
    return [];
  }
}

/**
 * Walk the legs from the departure time and compute the REALIZED schedule: each
 * bus/train boards at the next service at-or-after your chained arrival at that
 * stop (live within the horizon, otherwise the OTP timetable, never before you
 * can physically reach it), adding the real wait. Ride times get a peak/incident
 * congestion factor. Sets each leg's realized start/end, per-bus feasibility
 * (buffer = the gap you have to the bus you catch — a tight one means an upstream
 * delay would make you miss it), and the itinerary's total = arrival − depart
 * (so all waits are included).
 */
function realizeSchedule(
  it: Itinerary,
  departAtMs: number,
  now: number,
  liveByLeg: Map<RouteLeg, { serviceNo: string; etaMs: number }[]>,
): void {
  let cursor = departAtMs;
  let totalWaitMs = 0;
  const iso = (ms: number) => new Date(ms).toISOString();

  it.legs.forEach((leg, idx) => {
    if (leg.type === "walk" || leg.type === "cycle") {
      leg.startTimeMs = cursor;
      cursor += leg.duration * 1000;
      leg.endTimeMs = cursor;
      return;
    }

    const reach = cursor; // when you arrive at this boarding stop/station
    const schedRide =
      leg.startTimeMs != null && leg.endTimeMs != null && leg.endTimeMs > leg.startTimeMs
        ? leg.endTimeMs - leg.startTimeMs
        : leg.duration * 1000;
    const walkMinutes = Math.round(
      (it.legs[idx - 1]?.type === "walk" ? it.legs[idx - 1].duration : 0) / 60,
    );
    const enRoute = it.legs.slice(0, idx).some((l) => l.type !== "walk");

    if (leg.type === "bus") {
      const cands = liveByLeg.get(leg) ?? [];
      const withinLive = reach - now <= LIVE_HORIZON_MS;
      // Catchable buses = those arriving at/after you reach the stop (30s grace).
      const catchable = withinLive
        ? cands.filter((c) => c.etaMs >= reach - 30_000)
        : [];

      let board: number;
      let scheduled = false;
      let svc = leg.busNo;
      let alternatives: BusAlternative[] = [];

      if (catchable.length) {
        board = catchable[0].etaMs;
        svc = catchable[0].serviceNo;
        alternatives = catchable.slice(1, 5).map((c) => ({
          serviceNo: c.serviceNo,
          eta: iso(c.etaMs),
          buffer: Math.round((c.etaMs - reach) / 60000),
          feasibility: classify(Math.round((c.etaMs - reach) / 60000)),
          reroute: c.serviceNo !== svc,
        }));
      } else {
        // Beyond live coverage (or no catchable live bus): fall back to the OTP
        // timetable, but never board before you can reach the stop.
        board = Math.max(leg.startTimeMs ?? reach, reach);
        scheduled = true;
      }

      const wait = Math.max(0, board - reach);
      totalWaitMs += wait;
      // Ride time inflates with peak congestion and, on top, a live road
      // incident on this leg's path. Both are already in the route total; here
      // we also fold them into the leg's own displayed duration and surface the
      // incident-attributable delay as a per-leg figure ("+N min · roadwork").
      const peakF = peakFactor(board);
      const incidentF = leg.trafficAlert ? INCIDENT_FACTOR : 1;
      const ride = schedRide * peakF * incidentF;
      const arrive = board + ride;
      const bufferMin = Math.round((board - reach) / 60000);
      const incidentDelayMs = schedRide * peakF * (incidentF - 1);

      leg.busNo = svc;
      leg.startTimeMs = board;
      leg.endTimeMs = arrive;
      leg.duration = Math.round(ride / 1000);
      // Only set when there's a real delay — leaving the field absent otherwise
      // keeps it out of every bus leg's superjson meta.
      if (leg.trafficAlert && incidentDelayMs >= 60_000) {
        leg.delayMinutes = Math.round(incidentDelayMs / 60_000);
      }
      leg.busLegFeasibility = {
        status: scheduled ? "ok" : classify(bufferMin),
        scheduled: scheduled || undefined,
        buffer: bufferMin,
        eta: iso(board),
        serviceNo: svc,
        walkMinutes,
        alternatives,
        enRoute: enRoute || undefined,
        arriveAtStopMs: reach,
      };
      cursor = arrive;
    } else {
      // MRT: board the next scheduled train at-or-after you reach the platform.
      const board = Math.max(leg.startTimeMs ?? reach, reach);
      totalWaitMs += Math.max(0, board - reach);
      leg.startTimeMs = board;
      leg.endTimeMs = board + schedRide;
      cursor = board + schedRide;
    }
  });

  it.startTimeMs = departAtMs;
  it.duration = Math.round((cursor - departAtMs) / 1000);
  it.waitSeconds = Math.round(totalWaitMs / 1000);
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

/** Distance of an itinerary's access walk (0 when it opens on a transit leg). */
function firstWalkM(it: Itinerary): number {
  return it.legs[0]?.type === "walk" ? it.legs[0].distance : 0;
}

// Access-walk estimate used when OneMap's pedestrian graph can't be trusted:
// real footpaths wander, so straight-line × 1.3 at 80 m/min.
const ACCESS_DETOUR = 1.3;
const WALK_M_PER_MIN = 80;

/**
 * OneMap's pedestrian graph occasionally traps a geocoded address in a pocket
 * that only reconnects to the street network via a long detour, so EVERY
 * itinerary opens with an absurd access walk. The Hillside is the reference
 * case: blk 341 (588195) walks 258 m to board, while blk 343 (588196) — 120 m
 * further along the same condo — is routed 1.0 km to Blk 267, even though
 * "Aft Old Jurong Rd" is 334 m away straight-line. The walk router agrees
 * (1.8 km / 23 min), so this is graph topology, not a real detour, and no
 * maxWalkDistance cap can fix it: the short path simply isn't in the graph.
 *
 * Detection is free — we compare the access walk we got against the
 * straight-line distance to a stop we know is close. When it's out of all
 * proportion, we re-plan the transit portion from the nearest stops instead
 * and prepend an ESTIMATED access walk (marked `walkEstimated`), so the
 * genuinely nearest boarding stop is always on offer.
 */
export function originIsGraphTrapped(
  itineraries: Itinerary[],
  nearestD: number,
  hasNearbyStop: boolean,
): boolean {
  if (!hasNearbyStop || !itineraries.length) return false;
  // Only meaningful when a stop really is within easy walking distance.
  if (nearestD > 700) return false;
  const best = Math.min(...itineraries.map(firstWalkM));
  return best > Math.max(nearestD * 2.5, nearestD + 400);
}

/** Re-plan from `stop`, prepending the origin→stop access walk we estimated. */
function prependAccessWalk(
  it: Itinerary,
  origin: LatLng,
  stop: LatLng,
  stopName: string,
  walkM: number,
  walkS: number,
): Itinerary {
  const access: RouteLeg = {
    type: "walk",
    startPoint: origin,
    endPoint: stop,
    distance: walkM,
    duration: walkS,
    toName: stopName,
    walkEstimated: true,
  };
  // OTP opens with its own short walk from the stop coordinate onto the stop
  // node; absorb it rather than showing two walks back to back.
  const rest =
    it.legs[0]?.type === "walk" ? it.legs.slice(1) : it.legs;
  return { ...it, legs: [access, ...rest] };
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

/**
 * Enrich MRT legs (exit + crowd), fetch live bus candidates per bus leg, then
 * chain the realized schedule for each itinerary. Traffic alerts must already be
 * attached to bus legs (they feed the congestion factor). When `live` is false
 * (later multi-stop segments), the chain uses the OTP timetable only.
 */
async function realizeItineraries(
  itineraries: Itinerary[],
  departAtMs: number,
  now: number,
  live: boolean,
): Promise<void> {
  const crowd = live
    ? await stationCrowd().catch(() => new Map<string, "l" | "m" | "h">())
    : new Map<string, "l" | "m" | "h">();

  await Promise.all(
    itineraries.map(async (it) => {
      // MRT exit + crowd guidance.
      await Promise.all(
        it.legs.map(async (leg, idx) => {
          if (leg.type !== "mrt") return;
          await Promise.all([
            enrichMrtExit(it, leg, idx),
            live ? enrichMrtCrowd(leg, crowd) : Promise.resolve(),
          ]);
        }),
      );

      // Live bus candidates per bus leg (skipped for non-live segments).
      const liveByLeg = new Map<
        RouteLeg,
        { serviceNo: string; etaMs: number }[]
      >();
      if (live) {
        await Promise.all(
          it.legs
            .filter((l) => l.type === "bus" && l.busStopCode)
            .map(async (leg) => {
              liveByLeg.set(leg, await liveCandidatesFor(leg));
            }),
        );
      }

      realizeSchedule(it, departAtMs, now, liveByLeg);
    }),
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
  /** Result ordering preference (default: fastest). */
  transitPriority:
    | "fastest"
    | "fewest_transfers"
    | "least_walking"
    | "greenest" = "fastest",
  /** Flux slider weights — when set, they order the results instead. */
  prefWeights?: PrefWeights,
): Promise<{
  itineraries: Itinerary[];
  weather: WeatherContext | null;
  carbon: CarbonBaseline;
}> {
  // Optimise the first leg's walk to the nearest bus stop. OneMap's OTP can send
  // you well past a stop on your doorstep to board a marginally faster bus. A
  // near-boarding pass (tight access-walk cap, sized to the closest stop) forces
  // short walks so the nearest-stop option is always surfaced, then a relative
  // filter drops options whose first walk is disproportionately longer than the
  // shortest available.
  const near = await nearbyStops(start.lat, start.lng, 1200).catch(() => []);
  const nearestD = near.length ? Math.round(near[0].distance) : 800;
  const nearCap = Math.min(900, Math.max(500, nearestD + 300));

  const [base, nearPass] = await Promise.all([
    oneMapRoute({ start, end, mode: "TRANSIT", date, time }),
    oneMapRoute({
      start,
      end,
      mode: "TRANSIT",
      date,
      time,
      maxWalkDistance: nearCap,
    }).catch(() => [] as Itinerary[]),
  ]);
  let itineraries = dedupeItineraries([...nearPass, ...base]);

  // Rescue a graph-trapped origin: when every option's access walk dwarfs the
  // straight-line distance to a stop on the doorstep, plan from the two nearest
  // stops instead and estimate the walk to them.
  if (originIsGraphTrapped(itineraries, nearestD, near.length > 0)) {
    const anchored = await Promise.all(
      near.slice(0, 2).map(async (s) => {
        const stop = { lat: s.Latitude, lng: s.Longitude };
        const walkM = Math.round(haversineMeters(start, stop) * ACCESS_DETOUR);
        const walkS = Math.round((walkM / WALK_M_PER_MIN) * 60);
        // Board on the timetable you can actually reach, not the one at `time`.
        const at = advanceClock(date, time, walkS);
        const its = await oneMapRoute({
          start: stop,
          end,
          mode: "TRANSIT",
          date: at.date,
          time: at.time,
        }).catch(() => [] as Itinerary[]);
        return its.map((it) =>
          prependAccessWalk(it, start, stop, s.Description, walkM, walkS),
        );
      }),
    );
    // Merge rather than replace — the relative first-walk filter below then
    // drops the trapped originals, and keeps them if the rescue found nothing.
    itineraries = dedupeItineraries([...anchored.flat(), ...itineraries]);
  }

  // Drop options whose first walk is much longer than the shortest one — so a
  // 20/33-min access walk never shows when a closer boarding exists (relative to
  // the actual pedestrian network, not straight-line distance). Widened from
  // +500m so moderately-farther boardings survive as "See more" alternatives;
  // the sort keeps the best options up top, these tail off behind the fold.
  if (itineraries.length > 1) {
    const minWalk = Math.min(...itineraries.map(firstWalkM));
    itineraries = itineraries.filter((it) => firstWalkM(it) <= minWalk + 900);
  }

  const now = Date.now();
  const departAtMs = sgDepartMs(date, time);

  // Context for per-option risk: weather, MRT disruptions, live traffic.
  const [wx, lineStatuses, incidents] = await Promise.all([
    weatherAt(start.lat, start.lng).catch(() => null),
    getAllLineStatuses().catch(() => []),
    live ? getTrafficIncidents().catch(() => []) : Promise.resolve([]),
  ]);
  const disruptedLines = new Set(
    lineStatuses
      .filter((l) => l.status !== "operational")
      .map((l) => l.lineCode),
  );

  // Attach live traffic incidents to affected bus legs BEFORE realizing the
  // schedule — they feed the congestion factor as well as the risk score.
  const alertsByIt = new Map<Itinerary, { severe: boolean; label: string }[]>();
  for (const it of itineraries) {
    const alerts: { severe: boolean; label: string }[] = [];
    for (const leg of it.legs) {
      if (leg.type !== "bus") continue;
      const hits = incidentsOnPath(
        { polyline: leg.polyline, start: leg.startPoint, end: leg.endPoint },
        incidents,
      );
      if (hits.length) {
        leg.trafficAlert = incidentLabel(hits[0]);
        for (const h of hits)
          alerts.push({ severe: h.severe, label: incidentLabel(h) });
      }
    }
    alertsByIt.set(it, alerts);
  }

  // Chain the realized schedule (waits + peak/incident congestion; downstream
  // buses board only after you reach the stop) → sets per-leg times, bus
  // feasibility, and the wait-inclusive total.
  await realizeItineraries(itineraries, departAtMs, now, live);

  // Destination opening hours (only when the To is a named establishment).
  const destRaw = destName
    ? await rawHoursFor({ name: destName, point: end }).catch(() => null)
    : null;

  // Driving baseline (~1.35× straight-line road factor) for CO₂ comparison.
  const driveKm = (haversineMeters(start, end) / 1000) * 1.35;
  const carbon: CarbonBaseline = { driveKm, ...drivingCo2Grams(driveKm) };

  for (const it of itineraries) {
    it.risk = computeRouteRisk(it, {
      wet: wx?.wet ?? false,
      disruptedLines,
      trafficAlerts: alertsByIt.get(it),
      destination: destinationArrivalRisk(it, destRaw),
    });
    it.co2Grams = itineraryCo2Grams(it.legs);
    // Emissions avoided vs driving the same trip — the figure the Impact
    // dashboard banks. Without it, every logged transit trip saved 0 g.
    it.co2SavedGrams = Math.max(0, carbon.carGrams - it.co2Grams);
  }

  // Rank, then show up to 5 options. With Flux sliders set we order by the very
  // same preference-match engine that scores the badge, so the list order and
  // the "% match" can never tell the user two different stories. Without them
  // we fall back to the single-key priority pick. Duration always tie-breaks.
  const usingWeights =
    prefWeights != null && Object.values(prefWeights).some((w) => (w ?? 0) > 0);
  if (usingWeights) {
    const scores = matchScores(itineraries, { prefWeights });
    const scoreOf = new Map(
      itineraries.map((it, i) => [it, scores[i]?.score ?? 0]),
    );
    itineraries.sort(
      (a, b) => scoreOf.get(b)! - scoreOf.get(a)! || a.duration - b.duration,
    );
  } else {
    const walkSecs = (it: Itinerary) =>
      it.legs
        .filter((l) => l.type === "walk")
        .reduce((s, l) => s + l.duration, 0);
    const primary: Record<typeof transitPriority, (it: Itinerary) => number> = {
      fastest: (it) => it.duration,
      fewest_transfers: (it) => it.transfers,
      least_walking: (it) => walkSecs(it),
      greenest: (it) => it.co2Grams ?? Infinity,
    };
    const key = primary[transitPriority];
    itineraries.sort((a, b) => key(a) - key(b) || a.duration - b.duration);
  }
  // Drop non-contenders: an option more than 2× the fastest is padding, not a
  // real alternative (e.g. a 1h51m bus when the MRT is 36m). Google shows the
  // sensible ways there, not everything — so neither do we. Only trims when a
  // genuinely fast option exists; if every option is slow, none are dropped.
  if (itineraries.length > 1) {
    const fastest = Math.min(...itineraries.map((it) => it.duration));
    itineraries = itineraries.filter((it) => it.duration <= fastest * 2);
  }

  // Return up to 8 (was 5) so the client can offer "See more" for
  // comprehensiveness — the top few lead, the rest sit behind the fold.
  itineraries = itineraries.slice(0, 8);

  return { itineraries, weather: wx, carbon };
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

  /** Turn-by-turn steps for one walk/cycle leg (live-journey guidance). */
  walkSteps: publicProcedure
    .input(
      z.object({
        start: z.object({ lat: z.number(), lng: z.number() }),
        end: z.object({ lat: z.number(), lng: z.number() }),
        mode: z.enum(["walk", "cycle"]).default("walk"),
      }),
    )
    .query(({ input }) =>
      walkRouteSteps(input.start, input.end, input.mode).catch(() => []),
    ),

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
        if (input.arriveBy) {
          // Solve for the departure that lands you by the target arrival: one
          // timetable pass to estimate the trip length, then a live plan from
          // the implied departure. `leaveByMs` is when to leave the origin.
          const targetMs = sgDepartMs(date, time);
          const est = await planTransit(
            input.start,
            input.end,
            date,
            time,
            false,
            input.destName,
          );
          const estDur = est.itineraries[0]?.duration ?? 0;
          const depParts = msToSgParts(targetMs - estDur * 1000);
          const { itineraries, weather, carbon } = await planTransit(
            input.start,
            input.end,
            depParts.date,
            depParts.time,
            true,
            input.destName,
            input.transitPriority,
            input.prefWeights,
          );
          const leaveByMs = itineraries[0]?.startTimeMs ?? targetMs - estDur * 1000;
          return {
            plan: { itineraries },
            weather,
            carbon,
            leaveByMs,
            targetArrivalMs: targetMs,
          };
        }
        const { itineraries, weather, carbon } = await planTransit(
          input.start,
          input.end,
          date,
          time,
          true,
          input.destName,
          input.transitPriority,
          input.prefWeights,
        );
        return {
          plan: { itineraries },
          weather,
          carbon,
          leaveByMs: null,
          targetArrivalMs: null,
        };
      }
      const itineraries = await oneMapRoute({
        start: input.start,
        end: input.end,
        mode: input.mode,
        date,
        time,
      });
      return {
        plan: { itineraries },
        weather: null,
        carbon: null,
        leaveByMs: null,
        targetArrivalMs: null,
      };
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
        co2SavedGrams: segments.reduce(
          (s, it) => s + (it.co2SavedGrams ?? 0),
          0,
        ),
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
