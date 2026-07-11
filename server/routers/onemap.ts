import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../trpc.js";
import {
  oneMapSearch,
  oneMapRoute,
  getOneMapTokenInfo,
  forceRefreshOneMap,
} from "../services/onemap.js";
import { hereAutosuggest } from "../services/here.js";
import { busArrivals } from "../services/lta.js";
import {
  computeBusFeasibility,
  type BusCandidate,
} from "../services/feasibility.js";
import type { Itinerary, RouteLeg } from "../../shared/types.js";

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

/** Attach live bus-feasibility to each bus leg (best-effort, per-leg). */
async function enrichFeasibility(itineraries: Itinerary[]): Promise<void> {
  const now = Date.now();
  await Promise.all(
    itineraries.flatMap((it) =>
      it.legs.map(async (leg, idx) => {
        if (leg.type !== "bus" || !leg.busStopCode) return;
        // Walk time to the boarding stop = the immediately preceding walk leg.
        const prev = it.legs[idx - 1];
        const walkSeconds = prev?.type === "walk" ? prev.duration : 0;
        try {
          const { services } = await busArrivals(leg.busStopCode);
          const candidates: BusCandidate[] = [];
          for (const s of services) {
            for (const nb of [s.nextBus, s.nextBus2, s.nextBus3]) {
              if (nb) candidates.push({ serviceNo: s.serviceNo, eta: nb.estimatedArrival });
            }
          }
          (leg as RouteLeg).busLegFeasibility = computeBusFeasibility(
            walkSeconds,
            candidates,
            leg.busNo,
            now,
          );
        } catch {
          (leg as RouteLeg).busLegFeasibility = {
            status: "unknown",
            buffer: 0,
            eta: null,
            walkMinutes: Math.round((walkSeconds / 60) * 10) / 10,
            alternatives: [],
          };
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

    if (input.mode === "TRANSIT") {
      await enrichFeasibility(itineraries);
    }

    return { plan: { itineraries } };
  }),

  forceRefreshToken: adminProcedure
    .input(z.object({ email: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      return forceRefreshOneMap(input.email, input.password);
    }),
});
