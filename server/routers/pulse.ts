import { router, publicProcedure } from "../trpc.js";
import { stationCrowd } from "../services/lta.js";
import { getTrafficIncidents, incidentLabel } from "../services/traffic.js";
import { rainAreas } from "../services/weather.js";

export interface PulseOverlay {
  /** Live platform crowd, keyed by station code (joined to the map network). */
  crowd: { code: string; level: "l" | "m" | "h" }[];
  /** Live road incidents to render on the street geometry. */
  traffic: { lat: number; lng: number; severe: boolean; label: string }[];
  /** Approximate wet areas (soft blobs) from the 2h nowcast. */
  rain: { lat: number; lng: number; intensity: "light" | "heavy" }[];
}

/**
 * "Pulse" map layer (Phase 16): live MRT crowding + road traffic + an
 * approximate rain overlay, in one call. All three reuse signals already
 * integrated elsewhere (crowd risk, traffic risk, weather callouts).
 */
export const pulseRouter = router({
  overlay: publicProcedure.query(async (): Promise<PulseOverlay> => {
    const [crowdMap, incidents, rain] = await Promise.all([
      stationCrowd().catch(() => new Map<string, "l" | "m" | "h">()),
      getTrafficIncidents().catch(() => []),
      rainAreas().catch(() => []),
    ]);
    return {
      crowd: [...crowdMap].map(([code, level]) => ({ code, level })),
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
    };
  }),
});
