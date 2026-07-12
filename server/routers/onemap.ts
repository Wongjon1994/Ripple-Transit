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
} from "../services/onemap.js";
import { hereAutosuggest } from "../services/here.js";
import { busArrivals, serviceConnects, haversineMeters } from "../services/lta.js";
import {
  computeBusFeasibility,
  type BusCandidate,
} from "../services/feasibility.js";
import { weatherAt } from "../services/weather.js";
import { computeRouteRisk } from "../services/risk.js";
import {
  getTrafficIncidents,
  incidentsOnPath,
  incidentLabel,
} from "../services/traffic.js";
import { getAllLineStatuses } from "../db/helpers.js";
import type {
  Itinerary,
  RouteLeg,
  WeatherContext,
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
});

function todayParts() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

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
  const prev = it.legs[idx - 1];
  const walkSeconds = prev?.type === "walk" ? prev.duration : 0;
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
    let best = exits[0];
    let bestD = Infinity;
    for (const e of exits) {
      const d = haversineMeters(aim, { lat: e.lat, lng: e.lng });
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    leg.exitName = best.name;
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

/** Attach live feasibility (bus) and exit guidance (MRT) to every leg. */
async function enrichItineraries(itineraries: Itinerary[]): Promise<void> {
  const now = Date.now();
  await Promise.all(
    itineraries.flatMap((it) =>
      it.legs.map(async (leg, idx) => {
        if (leg.type === "bus" && leg.busStopCode) {
          await enrichBusLeg(it, leg, idx, now);
        } else if (leg.type === "mrt") {
          await enrichMrtExit(it, leg, idx);
        }
      }),
    ),
  );
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
    let itineraries: Itinerary[];
    try {
      itineraries = await oneMapRoute({
        start: input.start,
        end: input.end,
        mode: input.mode,
        date: input.date ?? d,
        time: input.time ?? t,
      });
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error ? err.message : "Failed to calculate route.",
      });
    }

    let weather: WeatherContext | null = null;
    if (input.mode === "TRANSIT") {
      itineraries = dedupeItineraries(itineraries);
      await enrichItineraries(itineraries);

      // Context for per-option risk: weather, MRT disruptions, live traffic.
      const [wx, lineStatuses, incidents] = await Promise.all([
        weatherAt(input.start.lat, input.start.lng).catch(() => null),
        getAllLineStatuses().catch(() => []),
        getTrafficIncidents().catch(() => []),
      ]);
      weather = wx;
      const disruptedLines = new Set(
        lineStatuses
          .filter((l) => l.status !== "operational")
          .map((l) => l.lineCode),
      );

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
        });
      }
    }

    return { plan: { itineraries }, weather };
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
