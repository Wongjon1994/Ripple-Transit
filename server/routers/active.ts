import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { oneMapActiveRoute } from "../services/onemap.js";
import { weatherAt } from "../services/weather.js";
import { drivingCo2Grams } from "../services/sustainability.js";
import { haversineMeters } from "../services/lta.js";
import {
  getActiveNetwork,
  routeCoverage,
  comfortLabel,
  decodePolyline5,
  activeKcal,
} from "../services/activeNetwork.js";
import type {
  ActiveRoute,
  ActiveRoutesResult,
  ActiveAdvisory,
  ActiveCoverage,
  ActiveMode,
  LatLng,
  WeatherContext,
} from "../../shared/types.js";

/** Weather call-out for walking/cycling right now. */
function activeAdvisory(wx: WeatherContext | null): ActiveAdvisory {
  if (wx?.wet)
    return {
      level: "warning",
      message: `Rain risk near ${wx.area} — consider transit, or pack a poncho.`,
    };
  if (wx?.temperature != null && wx.temperature >= 32)
    return {
      level: "info",
      message: `${Math.round(wx.temperature)}° and ${wx.forecast.toLowerCase()} — go easy and hydrate.`,
    };
  return { level: "good", message: "Good conditions right now." };
}

async function coverageFor(polyline: string): Promise<ActiveCoverage> {
  try {
    const grid = await getActiveNetwork();
    const { pct } = routeCoverage(decodePolyline5(polyline), grid);
    return { pct, ...comfortLabel(pct) };
  } catch {
    // Datasets unreachable — don't block the route over the comfort metric.
    return { pct: 0, label: "Path coverage unavailable", tone: "neutral" };
  }
}

async function buildRoute(
  mode: ActiveMode,
  start: LatLng,
  end: LatLng,
): Promise<ActiveRoute | null> {
  const r = await oneMapActiveRoute(start, end, mode).catch(() => null);
  if (!r) return null;
  const driveKm = (haversineMeters(start, end) / 1000) * 1.35;
  return {
    mode,
    distanceM: r.distanceM,
    durationS: r.durationS,
    polyline: r.polyline,
    coverage: await coverageFor(r.polyline),
    kcal: activeKcal(mode, r.distanceM),
    co2SavedGrams: Math.round(drivingCo2Grams(driveKm).carGrams),
  };
}

export const activeRouter = router({
  routes: publicProcedure
    .input(
      z.object({
        start: z.object({ lat: z.number(), lng: z.number() }),
        end: z.object({ lat: z.number(), lng: z.number() }),
      }),
    )
    .query(async ({ input }): Promise<ActiveRoutesResult> => {
      const [walk, cycle, weather] = await Promise.all([
        buildRoute("walk", input.start, input.end),
        buildRoute("cycle", input.start, input.end),
        weatherAt(input.start.lat, input.start.lng).catch(() => null),
      ]);
      return { walk, cycle, weather, advisory: activeAdvisory(weather) };
    }),
});
