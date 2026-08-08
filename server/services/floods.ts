import { env } from "../env.js";
import type { FloodAlert } from "../../shared/types.js";

/**
 * PUB flash-flood alerts via LTA DataMall's Flood Alerts API (launched Nov 2025,
 * sourced from PUB). Replaces the old @PUBFloodAlerts Telegram scrape: this is
 * the official feed, already geocoded (a `circle` "lat,lng radiusKm"), so no web
 * scraping or geocoding. Degrades silently if unavailable.
 */
const URL = "https://datamall2.mytransport.sg/ltaodataservice/PubFloodAlerts";
const TTL_MS = 3 * 60 * 1000; // the API's own update frequency

/** One PubFloodAlerts row (CAP-style; only the fields we use). */
export interface PubFloodRow {
  dateTime?: string;
  msgType?: string; // "Alert" | "Cancel"
  severity?: string;
  expires?: string;
  areaDesc?: string;
  description?: string;
  circle?: string; // "lat,lng radiusKm", e.g. "1.35479,103.88611 0.05"
}

let cache: { at: number; data: FloodAlert[] } | null = null;

/** Parse the `circle` field ("lat,lng radiusKm") into a point. */
function parseCircle(circle?: string): { lat: number; lng: number } | null {
  if (!circle) return null;
  const coords = circle.trim().split(/\s+/)[0] ?? "";
  const [lat, lng] = coords.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Map the API rows to active flood alerts: drop cancelled ("Cancel") and expired
 * ones, require a usable location. Pure — unit-tested.
 */
export function parseFloodRows(
  rows: PubFloodRow[],
  now = Date.now(),
): FloodAlert[] {
  const out: FloodAlert[] = [];
  for (const r of rows) {
    if (r.msgType && r.msgType.toLowerCase() === "cancel") continue;
    if (r.expires && Number.isFinite(Date.parse(r.expires)) && Date.parse(r.expires) < now)
      continue;
    const pt = parseCircle(r.circle);
    if (!pt) continue;
    out.push({
      location: (r.areaDesc || r.description || "Flood").trim(),
      lat: pt.lat,
      lng: pt.lng,
      postedAtISO: r.dateTime || new Date(now).toISOString(),
    });
  }
  return out;
}

export async function getFloodAlerts(): Promise<FloodAlert[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(URL, {
      headers: {
        AccountKey: env.LTA_ACCOUNT_KEY ?? "",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return cache?.data ?? [];
    const json = (await res.json()) as { value?: PubFloodRow[] };
    const data = parseFloodRows(json.value ?? []);
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? [];
  }
}
