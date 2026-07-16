import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { weatherAt } from "../services/weather.js";
import { drivingCo2Grams } from "../services/sustainability.js";
import { haversineMeters } from "../services/lta.js";
import {
  getActiveNetwork,
  getShelterNetwork,
} from "../services/activeNetwork.js";
import { buildActiveMode } from "../services/activeVariants.js";
import type {
  ActiveRoutesResult,
  ActiveAdvisory,
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

export const activeRouter = router({
  /**
   * Walk & cycle options for a journey (origin + up to 5 stops in order).
   * Walk: fastest / most sheltered / PCN scenic; cycle: fastest / PCN scenic.
   * Variants are real alternate paths (via-point detours onto the PCN or OSM
   * covered-walkway network), kept only when they beat the direct route.
   */
  routes: publicProcedure
    .input(
      z.object({
        points: z
          .array(z.object({ lat: z.number(), lng: z.number() }))
          .min(2)
          .max(6),
      }),
    )
    .query(async ({ input }): Promise<ActiveRoutesResult> => {
      const pts = input.points;
      const [pcnGrid, shelterGrid, weather] = await Promise.all([
        getActiveNetwork().catch(() => null),
        getShelterNetwork(),
        weatherAt(pts[0].lat, pts[0].lng).catch(() => null),
      ]);

      const [walk, cycle] = await Promise.all([
        buildActiveMode("walk", pts, pcnGrid, shelterGrid),
        buildActiveMode("cycle", pts, pcnGrid, null),
      ]);

      // Emissions avoided vs driving the same stop sequence.
      let driveKm = 0;
      for (let i = 1; i < pts.length; i++)
        driveKm += (haversineMeters(pts[i - 1], pts[i]) / 1000) * 1.35;

      return {
        walk,
        cycle,
        weather,
        advisory: activeAdvisory(weather),
        co2SavedGrams: Math.round(drivingCo2Grams(driveKm).carGrams),
      };
    }),
});
