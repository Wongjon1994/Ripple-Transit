/**
 * "Nearest ___" (Phase 15): one-tap nearest-N by REAL routing time, not
 * crow-flies, with three anchor modes. `query` serves Near-you and
 * Near-destination (the anchor is simply which point the client passes);
 * `alongTheWay` searches a corridor around the actual route geometry and
 * ranks by detour cost; `mrt` is the always-visible station utility.
 *
 * Ranking here is timetable-based (live=false): live arrivals enrich the full
 * search the user runs AFTER picking a result — paying the live-data cost per
 * candidate would make a one-tap feature feel like a form submission.
 */
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { planTransit, advanceClock } from "./onemap.js";
import { oneMapActiveRoute, oneMapSearch } from "../services/onemap.js";
import { decodePolyline5, type Pt } from "../services/activeNetwork.js";
import {
  POI_CATEGORIES,
  nearestCandidates,
  candidatesNearPath,
  brandFilter,
  nearestMrtStations,
  type Poi,
  type PoiCategoryId,
} from "../services/poi.js";
import { getAllLineStatuses } from "../db/helpers.js";
import { nearbyStops, busArrivals } from "../services/lta.js";
import type {
  Itinerary,
  LatLng,
  NearestResult,
  NearestMrtStation,
  NearestBusStop,
} from "../../shared/types.js";

const SHORTLIST = 6; // crow-flies candidates evaluated with real routing
const CORRIDOR_BUFFER_M = 300; // tune against real routes (build-spec note)
const CORRIDOR_SHORTLIST = 4;
const TIE_BREAK_WINDOW_S = 60;
const DEFAULT_MAX_WALK_MIN = 15;
const WALK_KMH = 4.7;

const pointSchema = z.object({ lat: z.number(), lng: z.number() });
const categorySchema = z.enum([
  "hawker",
  "clinic",
  "supermarket",
  "park",
  "library",
  "sports",
  "atm",
  "attraction",
]);
const prefsSchema = z
  .object({
    maxWalkMin: z.number().min(5).max(30).optional(),
    supermarketBrands: z.array(z.string().max(40)).max(10).optional(),
    atmBanks: z.array(z.string().max(40)).max(10).optional(),
  })
  .optional();

function todayParts() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

function transitSteps(it: Itinerary): number {
  return it.legs.filter((l) => l.type !== "walk" && l.type !== "cycle").length;
}

/** Duration-first ordering with the Decision-6 tie-break inside a 60s window. */
export function rankResults<T extends { durationS: number; steps: number; fare: number }>(
  results: T[],
): T[] {
  return [...results].sort((a, b) => {
    if (Math.abs(a.durationS - b.durationS) > TIE_BREAK_WINDOW_S) {
      return a.durationS - b.durationS;
    }
    if (a.steps !== b.steps) return a.steps - b.steps;
    if (a.fare !== b.fare) return a.fare - b.fare;
    return a.durationS - b.durationS;
  });
}

function applyBrandPrefs(
  cat: PoiCategoryId,
  pois: Array<Poi & { crowMeters?: number; lineMeters?: number }>,
  prefs: { supermarketBrands?: string[]; atmBanks?: string[] } | undefined,
) {
  if (cat === "supermarket") return brandFilter(pois, prefs?.supermarketBrands);
  if (cat === "atm") return brandFilter(pois, prefs?.atmBanks);
  return pois;
}

/** Best real mode for one candidate: walk wins short trips outright. */
async function evaluateCandidate(
  from: LatLng,
  poi: Poi,
  maxWalkMin: number,
  date: string,
  time: string,
): Promise<Omit<NearestResult, "disclaimer"> | null> {
  const walk = await oneMapActiveRoute(from, poi.point, "walk").catch(
    () => null,
  );
  const walkS = walk ? walk.durationS : Infinity;
  if (walkS <= maxWalkMin * 60) {
    return {
      id: poi.id,
      name: poi.name,
      address: poi.address,
      point: poi.point,
      mode: "walk",
      durationS: walkS,
      fare: 0,
      steps: 0,
    };
  }
  const [transitRes, cycle] = await Promise.all([
    planTransit(from, poi.point, date, time, false).catch(() => null),
    oneMapActiveRoute(from, poi.point, "cycle").catch(() => null),
  ]);
  const best = transitRes?.itineraries[0];
  const options: Array<Omit<NearestResult, "disclaimer">> = [];
  if (Number.isFinite(walkS)) {
    options.push({ id: poi.id, name: poi.name, address: poi.address, point: poi.point, mode: "walk", durationS: walkS, fare: 0, steps: 0 });
  }
  if (cycle) {
    options.push({ id: poi.id, name: poi.name, address: poi.address, point: poi.point, mode: "cycle", durationS: cycle.durationS, fare: 0, steps: 0 });
  }
  if (best) {
    options.push({ id: poi.id, name: poi.name, address: poi.address, point: poi.point, mode: "transit", durationS: best.duration, fare: best.fare, steps: transitSteps(best) });
  }
  if (options.length === 0) return null;
  options.sort((a, b) => a.durationS - b.durationS);
  return options[0];
}

// 60s ranking cache per (category, ~250m cell, prefs signature).
const rankCache = new Map<string, { at: number; results: NearestResult[] }>();
const RANK_TTL_MS = 60_000;
const cellOf = (p: LatLng) =>
  `${Math.floor(p.lat / 0.0025)}:${Math.floor(p.lng / 0.0025)}`;

export const nearestRouter = router({
  /** Near-you / Near-destination: nearest N by real (timetable) routing time. */
  query: publicProcedure
    .input(
      z.object({
        category: categorySchema,
        point: pointSchema,
        n: z.number().min(1).max(5).default(3),
        prefs: prefsSchema,
      }),
    )
    .query(async ({ input }): Promise<{ results: NearestResult[] }> => {
      const cat = input.category as PoiCategoryId;
      const def = POI_CATEGORIES[cat];
      const cacheKey = `${cat}:${cellOf(input.point)}:${input.n}:${JSON.stringify(input.prefs ?? {})}`;
      const hit = rankCache.get(cacheKey);
      if (hit && Date.now() - hit.at < RANK_TTL_MS) {
        return { results: hit.results };
      }

      const { date, time } = todayParts();
      const shortlist = applyBrandPrefs(
        cat,
        await nearestCandidates(cat, input.point, SHORTLIST),
        input.prefs,
      );
      const maxWalk = input.prefs?.maxWalkMin ?? DEFAULT_MAX_WALK_MIN;
      const evaluated = (
        await Promise.all(
          shortlist.map((poi) =>
            evaluateCandidate(input.point, poi, maxWalk, date, time),
          ),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null);

      const results = rankResults(evaluated)
        .slice(0, input.n)
        .map((r) => ({ ...r, disclaimer: def.disclaimer }));
      rankCache.set(cacheKey, { at: Date.now(), results });
      return { results };
    }),

  /**
   * Along the way: candidates inside a corridor around the fastest route's
   * REAL leg geometry, ranked by detour cost (added time vs going direct).
   */
  alongTheWay: publicProcedure
    .input(
      z.object({
        category: categorySchema,
        from: pointSchema,
        to: pointSchema,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        prefs: prefsSchema,
      }),
    )
    .query(async ({ input }): Promise<{ results: NearestResult[] }> => {
      const cat = input.category as PoiCategoryId;
      const def = POI_CATEGORIES[cat];
      const { date: d0, time: t0 } = todayParts();
      const date = input.date ?? d0;
      const time = input.time ?? t0;

      const direct = await planTransit(input.from, input.to, date, time, false)
        .then((r) => r.itineraries[0])
        .catch(() => undefined);
      if (!direct) return { results: [] };

      // The corridor follows the actual selected route's leg-by-leg polyline.
      const path: Pt[] = direct.legs.flatMap((l) =>
        l.polyline
          ? decodePolyline5(l.polyline)
          : [l.startPoint, l.endPoint],
      );
      const candidates = applyBrandPrefs(
        cat,
        await candidatesNearPath(cat, path, CORRIDOR_BUFFER_M, CORRIDOR_SHORTLIST),
        input.prefs,
      );
      if (candidates.length === 0) return { results: [] };

      const evaluated = (
        await Promise.all(
          candidates.map(async (poi): Promise<NearestResult | null> => {
            const seg1 = await planTransit(input.from, poi.point, date, time, false)
              .then((r) => r.itineraries[0])
              .catch(() => undefined);
            if (!seg1) return null;
            const clock = advanceClock(date, time, seg1.duration);
            const seg2 = await planTransit(poi.point, input.to, clock.date, clock.time, false)
              .then((r) => r.itineraries[0])
              .catch(() => undefined);
            if (!seg2) return null;
            const total = seg1.duration + seg2.duration;
            return {
              id: poi.id,
              name: poi.name,
              address: poi.address,
              point: poi.point,
              mode: "transit",
              durationS: total,
              fare: seg1.fare + seg2.fare,
              steps: transitSteps(seg1) + transitSteps(seg2),
              detourS: Math.max(0, total - direct.duration),
              disclaimer: def.disclaimer,
            };
          }),
        )
      ).filter((r): r is NearestResult => r !== null);

      // Detour cost first, then the standard tie-break.
      const results = [...evaluated]
        .sort((a, b) => {
          const da = a.detourS ?? 0;
          const db = b.detourS ?? 0;
          if (Math.abs(da - db) > TIE_BREAK_WINDOW_S) return da - db;
          if (a.steps !== b.steps) return a.steps - b.steps;
          if (a.fare !== b.fare) return a.fare - b.fare;
          return da - db;
        })
        .slice(0, 3);
      return { results };
    }),

  /**
   * Nearest bus stops with live arrival countdowns — the other half of the
   * "Nearest transit" utility. Pure composition of existing LTA feeds.
   * Honesty flags: a stop with no live feed, or an unusually long gap before
   * the next arrival, is flagged rather than listed as a normal option.
   */
  busStops: publicProcedure
    .input(z.object({ point: pointSchema }))
    .query(async ({ input }): Promise<{ stops: NearestBusStop[] }> => {
      const nearby = await nearbyStops(input.point.lat, input.point.lng, 600);
      const top = nearby.slice(0, 2);
      const now = Date.now();
      const stops = await Promise.all(
        top.map(async (s): Promise<NearestBusStop> => {
          const point = { lat: s.Latitude, lng: s.Longitude };
          const [walk, arrivals] = await Promise.all([
            oneMapActiveRoute(input.point, point, "walk").catch(() => null),
            busArrivals(s.BusStopCode).catch(() => null),
          ]);
          const walkMinutes = walk
            ? Math.max(1, Math.round(walk.durationS / 60))
            : Math.max(
                1,
                Math.round((s.distance * 1.3) / ((WALK_KMH * 1000) / 60)),
              );
          const services = (arrivals?.services ?? [])
            .flatMap((svc) =>
              svc.nextBus
                ? [
                    {
                      no: svc.serviceNo,
                      mins: Math.max(
                        0,
                        Math.round(
                          (new Date(svc.nextBus.estimatedArrival).getTime() -
                            now) /
                            60_000,
                        ),
                      ),
                    },
                  ]
                : [],
            )
            .sort((a, b) => a.mins - b.mins)
            .slice(0, 3);
          return {
            code: s.BusStopCode,
            name: s.Description,
            roadName: s.RoadName,
            point,
            walkMinutes,
            services,
            noLiveData: services.length === 0,
            longGap: services.length > 0 && services[0].mins > 15,
          };
        }),
      );
      return { stops };
    }),

  /** Nearest MRT stations — always-visible utility with disruption badges. */
  mrt: publicProcedure
    .input(z.object({ point: pointSchema }))
    .query(async ({ input }): Promise<{ stations: NearestMrtStation[] }> => {
      const [nearest, statuses] = await Promise.all([
        nearestMrtStations(input.point, 2),
        getAllLineStatuses().catch(() => []),
      ]);
      const stations = await Promise.all(
        nearest.map(async (s) => {
          const walk = await oneMapActiveRoute(
            input.point,
            s.nearestExit,
            "walk",
          ).catch(() => null);
          const walkMeters = walk?.distanceM ?? Math.round(s.crowMeters * 1.3);
          const walkMinutes = walk
            ? Math.max(1, Math.round(walk.durationS / 60))
            : Math.max(1, Math.round(walkMeters / ((WALK_KMH * 1000) / 60)));
          const lines = await stationLines(s.name);
          const disrupted = statuses
            .filter(
              (l) => lines.includes(l.lineCode) && l.status !== "operational",
            )
            .map((l) => ({ lineCode: l.lineCode, status: l.status }));
          return {
            name: s.name,
            point: s.nearestExit,
            walkMinutes,
            walkMeters,
            lines,
            disrupted,
          };
        }),
      );
      return { stations };
    }),
});

// Station → line codes, resolved once via OneMap search (titles carry codes
// like "TIONG BAHRU MRT STATION (EW17)"), cached for the process lifetime.
const lineCache = new Map<string, string[]>();

async function stationLines(stationName: string): Promise<string[]> {
  const hit = lineCache.get(stationName);
  if (hit) return hit;
  let lines: string[] = [];
  try {
    const results = await oneMapSearch(stationName.toUpperCase(), 1);
    const codes = new Set<string>();
    for (const r of results) {
      for (const m of r.title.matchAll(/\(([A-Z]{2}\d+(?:[^)]*)?)\)/g)) {
        for (const code of m[1].matchAll(/([A-Z]{2})\d+/g)) codes.add(code[1]);
      }
    }
    lines = [...codes];
  } catch {
    /* leave empty — badge simply can't assert anything */
  }
  lineCache.set(stationName, lines);
  return lines;
}
