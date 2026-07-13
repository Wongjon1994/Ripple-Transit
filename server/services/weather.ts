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
  items?: Array<{ forecasts: Array<{ area: string; forecast: string }> }>;
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
