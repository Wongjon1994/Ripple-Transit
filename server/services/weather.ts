import { haversineMeters } from "./lta.js";
import type { WeatherContext, WeatherAdvisory } from "../../shared/types.js";

const ENV = "https://api.data.gov.sg/v1/environment";
const WET = /(rain|shower|thundery|thunder)/i;
const TTL_MS = 10 * 60 * 1000; // forecasts refresh ~every 30 min; cache 10

interface ForecastResponse {
  area_metadata?: Array<{
    name: string;
    label_location: { latitude: number; longitude: number };
  }>;
  items?: Array<{
    valid_period?: { start: string; end: string };
    forecasts: Array<{ area: string; forecast: string }>;
  }>;
}

interface Forecast24Response {
  items?: Array<{
    periods?: Array<{
      time: { start: string; end: string };
      regions: Record<string, string>; // west/east/central/south/north
    }>;
  }>;
}

interface ReadingResponse {
  metadata?: {
    stations?: Array<{
      id: string;
      location: { latitude: number; longitude: number };
    }>;
  };
  items?: Array<{ readings: Array<{ station_id: string; value: number }> }>;
}

const cache = new Map<string, { at: number; data: unknown }>();

async function cachedFetch<T>(path: string): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  try {
    const res = await fetch(`${ENV}/${path}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return (hit?.data as T) ?? null;
    const data = (await res.json()) as T;
    cache.set(path, { at: Date.now(), data });
    return data;
  } catch {
    return (hit?.data as T) ?? null;
  }
}

/** Nearest weather station's reading for a realtime dataset. */
async function nearestReading(
  dataset: "air-temperature" | "relative-humidity" | "wind-speed",
  lat: number,
  lng: number,
): Promise<number | null> {
  const data = await cachedFetch<ReadingResponse>(dataset);
  const stations = data?.metadata?.stations ?? [];
  const readings = data?.items?.[0]?.readings ?? [];
  if (!stations.length || !readings.length) return null;

  const readingBy = new Map(readings.map((r) => [r.station_id, r.value]));
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    if (!readingBy.has(s.id)) continue;
    const d = haversineMeters(
      { lat, lng },
      { lat: s.location.latitude, lng: s.location.longitude },
    );
    if (d < bestDist) {
      bestDist = d;
      best = readingBy.get(s.id)!;
    }
  }
  return best;
}

/**
 * Advisory from conditions: rain → shelter, or hot+humid → shade.
 * Pure function so it's unit-testable.
 */
export function weatherAdvisory(
  wet: boolean,
  temperature: number | null,
  humidity: number | null,
): WeatherAdvisory | null {
  if (wet) {
    return {
      level: "warning",
      message: "Rain expected — favour covered walkways or the MRT.",
    };
  }
  if (temperature !== null && temperature >= 32 && (humidity ?? 0) >= 70) {
    return {
      level: "info",
      message: `Hot & humid (${Math.round(temperature)}°C) — shaded, covered routes recommended.`,
    };
  }
  return null;
}

// ── Phase 15 addendum §12: exposure callouts + cycling rain window ────

/** Region key for the NEA 24h forecast, from a rough island quadrant. */
export function regionFor(lat: number, lng: number): string {
  if (lng < 103.75) return "west";
  if (lng > 103.9) return "east";
  if (lat > 1.38) return "north";
  if (lat < 1.28) return "south";
  return "central";
}

/** Day-part phrasing for a period start hour — NEA's own granularity. */
export function describePeriod(startHour: number): string {
  if (startHour < 6) return "the early hours";
  if (startHour < 12) return "this morning";
  if (startHour < 18) return "this afternoon";
  return "this evening";
}

export interface RainArea {
  lat: number;
  lng: number;
  area: string;
  /** "heavy" for thundery/heavy showers, else "light" — drives blob opacity. */
  intensity: "light" | "heavy";
}

/**
 * Areas the 2-hour nowcast currently flags as wet — an APPROXIMATION for the
 * Pulse rain overlay: NEA publishes point-area forecasts (name + label
 * location), not rain-cell polygons, so we render soft blobs at those points.
 */
export async function rainAreas(): Promise<RainArea[]> {
  const fc = await cachedFetch<ForecastResponse>("2-hour-weather-forecast");
  const meta = fc?.area_metadata ?? [];
  const forecasts = fc?.items?.[0]?.forecasts ?? [];
  const byArea = new Map(forecasts.map((f) => [f.area, f.forecast]));
  const out: RainArea[] = [];
  for (const a of meta) {
    const f = byArea.get(a.name) ?? "";
    if (!WET.test(f)) continue;
    out.push({
      lat: a.label_location.latitude,
      lng: a.label_location.longitude,
      area: a.name,
      intensity: /thund|heavy/i.test(f) ? "heavy" : "light",
    });
  }
  return out;
}

export interface RainWindow {
  rainingNow: boolean;
  /** End of the 2h nowcast window — the only exact time NEA supports. */
  untilISO?: string;
  /** Day-part phrasing when rain continues beyond the nowcast horizon. */
  outlook?: string;
}

/**
 * Rain across the departure window: the 2h nowcast gives an honest
 * "until ~time"; the 24h forecast's day-parts extend it in period language.
 * Never fabricates an exact time the forecast can't support.
 */
export async function rainWindow(
  lat: number,
  lng: number,
): Promise<RainWindow> {
  const fc = await cachedFetch<ForecastResponse>("2-hour-weather-forecast");
  const areas = fc?.area_metadata ?? [];
  const item = fc?.items?.[0];
  const forecasts = item?.forecasts ?? [];
  let nearest = areas[0];
  let best = Infinity;
  for (const a of areas) {
    const d = haversineMeters(
      { lat, lng },
      { lat: a.label_location.latitude, lng: a.label_location.longitude },
    );
    if (d < best) {
      best = d;
      nearest = a;
    }
  }
  const now = forecasts.find((f) => f.area === nearest?.name)?.forecast ?? "";
  const rainingNow = WET.test(now);
  if (!rainingNow) return { rainingNow: false };

  const untilISO = item?.valid_period?.end;
  // Does the 24h forecast say rain continues past the nowcast window?
  let outlook: string | undefined;
  const fc24 = await cachedFetch<Forecast24Response>(
    "24-hour-weather-forecast",
  );
  const region = regionFor(lat, lng);
  const horizon = untilISO ? new Date(untilISO).getTime() : Date.now();
  for (const p of fc24?.items?.[0]?.periods ?? []) {
    const start = new Date(p.time.start).getTime();
    const end = new Date(p.time.end).getTime();
    if (end <= horizon) continue; // already covered by the nowcast
    if (WET.test(p.regions[region] ?? "")) {
      outlook = describePeriod(new Date(Math.max(start, horizon)).getHours());
      break;
    }
    break; // the next period is dry — nowcast end stands
  }
  return { rainingNow: true, untilISO, outlook };
}

/**
 * Exposure-based walking callout (§12a): keyed off the route's REAL
 * sheltered-walkway coverage, never the destination. No shelter data ⇒ no
 * exposure claim ⇒ no callout. Pure and unit-tested.
 */
export function walkExposureCallout(input: {
  wet: boolean;
  temperature: number | null;
  humidity: number | null;
  shelterPct: number | undefined;
}): WeatherAdvisory | null {
  if (input.shelterPct === undefined) return null;
  const exposure = Math.max(0, Math.min(100, 100 - input.shelterPct));
  if (input.wet && exposure >= 30) {
    return {
      level: "warning",
      message: `Bring an umbrella — ${exposure}% of this walk is uncovered.`,
    };
  }
  if (
    !input.wet &&
    (input.temperature ?? 0) >= 33 &&
    (input.humidity ?? 0) >= 70 &&
    exposure >= 40
  ) {
    return {
      level: "info",
      message: `${Math.round(input.temperature!)}° and humid — sunscreen and water; ${exposure}% of the walk is exposed.`,
    };
  }
  return null;
}

/** Cycling rain-avoidance copy (§12b) — soft advisory, honest time bounds. */
export function cycleRainCallout(
  win: RainWindow,
  area: string,
): WeatherAdvisory | null {
  if (!win.rainingNow) return null;
  if (win.outlook) {
    return {
      level: "warning",
      message: `Rain likely through ${win.outlook} near ${area} — consider transit or waiting it out.`,
    };
  }
  if (win.untilISO) {
    const t = new Date(win.untilISO).toLocaleTimeString("en-SG", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return {
      level: "warning",
      message: `Rain near ${area} until ~${t} — you might want to wait.`,
    };
  }
  return {
    level: "warning",
    message: `Rain near ${area} — consider transit, or wait for a break.`,
  };
}

/** Nearest-area 2-hour forecast + realtime temp/humidity/wind for a point. */
export async function weatherAt(
  lat: number,
  lng: number,
): Promise<WeatherContext | null> {
  const fc = await cachedFetch<ForecastResponse>("2-hour-weather-forecast");
  const areas = fc?.area_metadata ?? [];
  const forecasts = fc?.items?.[0]?.forecasts ?? [];
  if (!areas.length || !forecasts.length) return null;

  let nearest = areas[0];
  let best = Infinity;
  for (const a of areas) {
    const d = haversineMeters(
      { lat, lng },
      { lat: a.label_location.latitude, lng: a.label_location.longitude },
    );
    if (d < best) {
      best = d;
      nearest = a;
    }
  }
  const forecast =
    forecasts.find((f) => f.area === nearest.name)?.forecast ?? "Unknown";
  const wet = WET.test(forecast);

  const [temperature, humidity, windKnots] = await Promise.all([
    nearestReading("air-temperature", lat, lng),
    nearestReading("relative-humidity", lat, lng),
    nearestReading("wind-speed", lat, lng),
  ]);

  return {
    area: nearest.name,
    forecast,
    wet,
    temperature: temperature ?? undefined,
    humidity: humidity ?? undefined,
    // data.gov.sg reports wind in knots → km/h.
    windSpeed:
      windKnots !== null ? Math.round(windKnots * 1.852) : undefined,
    advisory: weatherAdvisory(wet, temperature, humidity),
  };
}
