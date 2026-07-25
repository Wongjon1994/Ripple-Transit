import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { stationCrowd } from "../services/lta.js";
import {
  getTrafficIncidents,
  getTrafficCongestion,
  incidentLabel,
  incidentsOnPath,
  type CongestionSegment,
} from "../services/traffic.js";
import { rainAreas, pulseWeather, type PulseWeather } from "../services/weather.js";
import {
  getTrainAlerts,
  type TrainDisruption,
  type TrainPlanned,
} from "../services/trainAlerts.js";

export interface PulseOverlay {
  /** Live platform crowd, keyed by station code (joined to the map network).
   *  Only busy stations (medium/high) — low crowd isn't a problem to surface. */
  crowd: { code: string; level: "m" | "h" }[];
  /** Live road incidents to render on the street geometry. */
  traffic: { lat: number; lng: number; severe: boolean; label: string }[];
  /** Live congested road segments (red/amber lines) from LTA speed bands. */
  congestion: CongestionSegment[];
  /** Approximate wet areas (soft blobs) from the 2h nowcast. */
  rain: { lat: number; lng: number; intensity: "light" | "heavy" }[];
  /** Live MRT/LRT disruptions (fade the line + ring affected stations). */
  mrtDisruptions: TrainDisruption[];
  /** Planned service adjustments (informational footer). */
  mrtPlanned: TrainPlanned[];
  /** City-wide current + forecast weather for the Pulse header. */
  weather: PulseWeather | null;
}

/**
 * "Pulse" map layer (Phase 16): live MRT crowding + road traffic + an
 * approximate rain overlay, in one call. All three reuse signals already
 * integrated elsewhere (crowd risk, traffic risk, weather callouts).
 */
export const pulseRouter = router({
  overlay: publicProcedure.query(async (): Promise<PulseOverlay> => {
    const [crowdMap, incidents, congestion, rain, trains, weather] =
      await Promise.all([
        stationCrowd().catch(() => new Map<string, "l" | "m" | "h">()),
        getTrafficIncidents().catch(() => []),
        getTrafficCongestion().catch(() => []),
        rainAreas().catch(() => []),
        getTrainAlerts().catch(() => ({
          disrupted: false,
          disruptions: [],
          planned: [],
        })),
        pulseWeather().catch(() => null),
      ]);
    return {
      // Drop low-crowd stations — Pulse surfaces problems, not the calm.
      crowd: [...crowdMap]
        .filter(([, level]) => level === "m" || level === "h")
        .map(([code, level]) => ({ code, level: level as "m" | "h" })),
      congestion,
      traffic: incidents.map((i) => ({
        lat: i.lat,
        lng: i.lng,
        severe: i.severe,
        label: incidentLabel(i),
      })),
      rain: rain.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        intensity: r.intensity,
      })),
      mrtDisruptions: trains.disruptions,
      mrtPlanned: trains.planned,
      weather,
    };
  }),

  /**
   * Live road incidents on ONE leg's path — the live journey polls this for the
   * bus it's riding, so a jam that appeared after the route was planned still
   * gets flagged amber/red while you're on board.
   */
  legTraffic: publicProcedure
    .input(
      z.object({
        polyline: z.string().optional(),
        start: z.object({ lat: z.number(), lng: z.number() }),
        end: z.object({ lat: z.number(), lng: z.number() }),
      }),
    )
    .query(async ({ input }) => {
      const incidents = await getTrafficIncidents().catch(() => []);
      return incidentsOnPath(input, incidents).map((i) => ({
        severe: i.severe,
        label: incidentLabel(i),
      }));
    }),
});
