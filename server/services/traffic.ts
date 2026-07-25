import { env } from "../env.js";
import { haversineMeters } from "./lta.js";
import type { LatLng } from "../../shared/types.js";

const BASE = "https://datamall2.mytransport.sg/ltaodataservice";
const TTL_MS = 2 * 60 * 1000; // incidents change often; cache 2 min

// Which incident types signal real congestion risk vs minor/long-term works.
const SEVERE = new Set([
  "Accident",
  "Heavy Traffic",
  "Road Block",
  "Vehicle breakdown",
  "Obstacle",
]);

export interface TrafficIncident {
  type: string;
  lat: number;
  lng: number;
  message: string;
  severe: boolean;
}

let cache: { at: number; data: TrafficIncident[] } | null = null;

export async function getTrafficIncidents(): Promise<TrafficIncident[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(`${BASE}/TrafficIncidents`, {
      headers: {
        AccountKey: env.LTA_ACCOUNT_KEY ?? "",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return cache?.data ?? [];
    const data = (await res.json()) as {
      value: Array<{ Type: string; Latitude: number; Longitude: number; Message: string }>;
    };
    const incidents: TrafficIncident[] = (data.value ?? []).map((x) => ({
      type: x.Type,
      lat: x.Latitude,
      lng: x.Longitude,
      message: x.Message,
      severe: SEVERE.has(x.Type),
    }));
    cache = { at: Date.now(), data: incidents };
    return incidents;
  } catch {
    return cache?.data ?? [];
  }
}

// ── Road congestion (TrafficSpeedBands) ───────────────────────
// LTA publishes a live speed band (1 = 0-9 km/h … 8 = >70 km/h) for every road
// LINK. We turn the congested ones into red/amber road lines. A low band on a
// SMALL road is normal (56-81% of minor roads sit at band ≤3 all day), so we
// only surface it on roads where slowness genuinely means a jam: expressways
// (cat A, ~1% ever slow) and major/arterial roads (B, C). Minor roads (D/E/F)
// are dropped — drawing them is noise, not signal.

export interface CongestionSegment {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  level: "red" | "amber";
  /** Road name — so the summary can count distinct affected ROADS (one jam is
   *  many ~150m links), not raw segments. */
  road: string;
}

interface SpeedBandRow {
  RoadName: string;
  RoadCategory: string;
  SpeedBand: number;
  StartLat: string;
  StartLon: string;
  EndLat: string;
  EndLon: string;
}

/**
 * Congestion severity for a road link, or null to skip it. Tuned per road
 * class so the map shows real jams, not naturally-slow side streets:
 *  - Expressway (A): any band ≤3 is abnormal → red ≤2, amber at 3.
 *  - Major/arterial (B, C): band 1 (crawling) red, band 2 amber; band 3
 *    (20-29 km/h) is normal for these, so ignored.
 */
export function congestionLevel(
  cat: string,
  band: number,
): "red" | "amber" | null {
  if (band < 1) return null; // 0 = no reading
  if (cat === "A") return band <= 2 ? "red" : band === 3 ? "amber" : null;
  if (cat === "B" || cat === "C")
    return band === 1 ? "red" : band === 2 ? "amber" : null;
  return null; // D/E/F minor roads: always slow, never drawn
}

const SPEED_TTL_MS = 90 * 1000;
const SPEED_BASE = `${BASE}/v3/TrafficSpeedBands`;
let speedCache: { at: number; data: CongestionSegment[] } | null = null;
let speedInflight: Promise<CongestionSegment[]> | null = null;

async function fetchSpeedPage(skip: number): Promise<SpeedBandRow[]> {
  const url = new URL(SPEED_BASE);
  url.searchParams.set("$skip", String(skip));
  const res = await fetch(url, {
    headers: { AccountKey: env.LTA_ACCOUNT_KEY ?? "", Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`speedbands ${res.status}`);
  const j = (await res.json()) as { value?: SpeedBandRow[] };
  return j.value ?? [];
}

/** Fetch + filter the whole feed. ~57k links over ~114 pages; fetched in
 *  parallel batches so a refresh takes a couple of seconds, not ~11. */
async function fetchCongestion(): Promise<CongestionSegment[]> {
  const PAGE = 500;
  const BATCH = 12; // parallel pages per round
  const out: CongestionSegment[] = [];
  let base = 0;
  let done = false;
  while (!done) {
    const skips = Array.from({ length: BATCH }, (_, i) => base + i * PAGE);
    const pages = await Promise.all(
      skips.map((s) => fetchSpeedPage(s).catch(() => [] as SpeedBandRow[])),
    );
    for (const rows of pages) {
      if (rows.length < PAGE) done = true; // a short page = end of feed
      for (const r of rows) {
        const level = congestionLevel(r.RoadCategory, r.SpeedBand);
        if (!level) continue;
        const startLat = Number(r.StartLat);
        const startLng = Number(r.StartLon);
        const endLat = Number(r.EndLat);
        const endLng = Number(r.EndLon);
        if (!startLat || !startLng || !endLat || !endLng) continue;
        out.push({
          startLat,
          startLng,
          endLat,
          endLng,
          level,
          road: r.RoadName,
        });
      }
    }
    base += BATCH * PAGE;
    if (base > 120_000) break; // hard safety cap
  }
  return out;
}

/**
 * Live congested road segments, cached 90s with stale-while-revalidate: a stale
 * cache is served immediately while a refresh runs in the background, so the
 * ~2s feed fetch never blocks the Pulse overlay after the first load.
 */
export async function getTrafficCongestion(): Promise<CongestionSegment[]> {
  const fresh = speedCache && Date.now() - speedCache.at < SPEED_TTL_MS;
  if (fresh) return speedCache!.data;

  if (!speedInflight) {
    speedInflight = fetchCongestion()
      .then((data) => {
        speedCache = { at: Date.now(), data };
        return data;
      })
      .catch(() => speedCache?.data ?? [])
      .finally(() => {
        speedInflight = null;
      });
  }
  // Serve stale immediately if we have anything; only the first-ever call waits.
  if (speedCache) return speedCache.data;
  return speedInflight;
}

/** Decode an encoded polyline (precision 5) into lat/lng points. */
export function decodePolyline(str: string): LatLng[] {
  let index = 0,
    lat = 0,
    lng = 0;
  const coords: LatLng[] = [];
  while (index < str.length) {
    let result = 0,
      shift = 0,
      b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return coords;
}

/**
 * Incidents within `radiusM` of a leg's path. Uses the encoded polyline when
 * present (sampled), otherwise the straight start→end segment endpoints.
 */
export function incidentsOnPath(
  path: { polyline?: string; start: LatLng; end: LatLng },
  incidents: TrafficIncident[],
  radiusM = 300,
): TrafficIncident[] {
  let points: LatLng[];
  if (path.polyline) {
    const decoded = decodePolyline(path.polyline);
    // Sample to keep the proximity check cheap on long routes.
    const step = Math.max(1, Math.floor(decoded.length / 40));
    points = decoded.filter((_, i) => i % step === 0);
    points.push(path.start, path.end);
  } else {
    points = [path.start, path.end];
  }
  return incidents.filter((inc) =>
    points.some(
      (p) => haversineMeters(p, { lat: inc.lat, lng: inc.lng }) <= radiusM,
    ),
  );
}

/** Short human label for an incident, e.g. "Accident on AYE". */
export function incidentLabel(inc: TrafficIncident): string {
  // Messages look like "(12/7)21:23 Vehicle Breakdown on AYE (towards MCE) …"
  const road = inc.message.match(/on ([A-Za-z0-9 ]+?)(?: \(|,| after| at| bef|$)/);
  return road ? `${inc.type} on ${road[1].trim()}` : inc.type;
}
