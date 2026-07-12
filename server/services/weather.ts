import { haversineMeters } from "./lta.js";
import type { WeatherContext } from "../../shared/types.js";

const FORECAST_URL =
  "https://api.data.gov.sg/v1/environment/2-hour-weather-forecast";
const WET = /(rain|shower|thundery|thunder)/i;
const TTL_MS = 10 * 60 * 1000; // forecasts refresh ~every 30 min; cache 10

interface ForecastResponse {
  area_metadata?: Array<{
    name: string;
    label_location: { latitude: number; longitude: number };
  }>;
  items?: Array<{ forecasts: Array<{ area: string; forecast: string }> }>;
}

let cache: { at: number; data: ForecastResponse } | null = null;

async function getForecast(): Promise<ForecastResponse | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(FORECAST_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return cache?.data ?? null;
    const data = (await res.json()) as ForecastResponse;
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? null;
  }
}

/** Nearest-area 2-hour weather forecast for a point (best-effort). */
export async function weatherAt(
  lat: number,
  lng: number,
): Promise<WeatherContext | null> {
  const data = await getForecast();
  const areas = data?.area_metadata ?? [];
  const forecasts = data?.items?.[0]?.forecasts ?? [];
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
  return { area: nearest.name, forecast, wet: WET.test(forecast) };
}
