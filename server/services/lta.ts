import { env } from "../env.js";

const BASE = "https://datamall2.mytransport.sg/ltaodataservice";

function headers() {
  return {
    AccountKey: env.LTA_ACCOUNT_KEY ?? "",
    Accept: "application/json",
  };
}

export interface BusStop {
  BusStopCode: string;
  RoadName: string;
  Description: string;
  Latitude: number;
  Longitude: number;
}

export interface NearbyBusStop extends BusStop {
  distance: number; // meters
}

export type BusLoad = "SEA" | "SDA" | "LDA" | "";

export interface BusArrivalService {
  serviceNo: string;
  nextBus: BusEta | null;
  nextBus2: BusEta | null;
  nextBus3: BusEta | null;
}

export interface BusEta {
  estimatedArrival: string; // ISO
  load: BusLoad;
  type: string;
  feature: string;
}

// ── Bus arrivals ──────────────────────────────────────────────
interface LtaArrivalResponse {
  BusStopCode: string;
  Services: Array<{
    ServiceNo: string;
    NextBus: LtaNextBus;
    NextBus2: LtaNextBus;
    NextBus3: LtaNextBus;
  }>;
}
interface LtaNextBus {
  EstimatedArrival: string;
  Load: BusLoad;
  Type: string;
  Feature: string;
}

function mapNextBus(b: LtaNextBus | undefined): BusEta | null {
  if (!b || !b.EstimatedArrival) return null;
  return {
    estimatedArrival: b.EstimatedArrival,
    load: b.Load,
    type: b.Type,
    feature: b.Feature,
  };
}

export async function busArrivals(
  busStopCode: string,
  serviceNo?: string,
): Promise<{ busStopCode: string; services: BusArrivalService[] }> {
  const url = new URL(`${BASE}/v3/BusArrival`);
  url.searchParams.set("BusStopCode", busStopCode);
  if (serviceNo) url.searchParams.set("ServiceNo", serviceNo);

  const res = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`LTA bus arrival failed: ${res.status}`);
  const data = (await res.json()) as LtaArrivalResponse;

  return {
    busStopCode,
    services: (data.Services ?? []).map((s) => ({
      serviceNo: s.ServiceNo,
      nextBus: mapNextBus(s.NextBus),
      nextBus2: mapNextBus(s.NextBus2),
      nextBus3: mapNextBus(s.NextBus3),
    })),
  };
}

// ── MRT platform crowd density (PCDRealTime, cached 10 min) ───
export type CrowdLevel = "l" | "m" | "h";

// LTA line codes for PCDRealTime differ from our 2-letter lineCode.
const PCD_LINES: Record<string, string> = {
  NS: "NSL",
  EW: "EWL",
  CG: "CGL",
  NE: "NEL",
  CC: "CCL",
  CE: "CEL",
  DT: "DTL",
  TE: "TEL",
  BP: "BPL",
  SW: "SLRT",
  SE: "SLRT",
  PW: "PLRT",
  PE: "PLRT",
};

interface PcdResponse {
  value?: Array<{ Station: string; CrowdLevel: CrowdLevel }>;
}

let crowdCache: { at: number; map: Map<string, CrowdLevel> } | null = null;
const CROWD_TTL_MS = 10 * 60 * 1000; // PCDRealTime refreshes every 10 min

/** Live platform crowd by station code (e.g. "EW14" → "h"), all lines. */
export async function stationCrowd(): Promise<Map<string, CrowdLevel>> {
  if (crowdCache && Date.now() - crowdCache.at < CROWD_TTL_MS) {
    return crowdCache.map;
  }
  const lines = [...new Set(Object.values(PCD_LINES))];
  const map = new Map<string, CrowdLevel>();
  await Promise.all(
    lines.map(async (line) => {
      try {
        const url = new URL(`${BASE}/PCDRealTime`);
        url.searchParams.set("TrainLine", line);
        const res = await fetch(url, {
          headers: headers(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return;
        const data = (await res.json()) as PcdResponse;
        for (const s of data.value ?? []) {
          if (s.Station && s.CrowdLevel) map.set(s.Station, s.CrowdLevel);
        }
      } catch {
        /* one line failing shouldn't blank the rest */
      }
    }),
  );
  // Keep a stale map on total failure rather than nothing.
  if (map.size > 0) crowdCache = { at: Date.now(), map };
  return crowdCache?.map ?? map;
}

// ── Bus stops (paginated, cached 24h) ─────────────────────────
let stopsCache: { at: number; stops: BusStop[] } | null = null;
const STOPS_TTL_MS = 24 * 60 * 60 * 1000;

export async function getAllBusStops(): Promise<BusStop[]> {
  if (stopsCache && Date.now() - stopsCache.at < STOPS_TTL_MS) {
    return stopsCache.stops;
  }
  const stops: BusStop[] = [];
  for (let skip = 0; skip < 10_000; skip += 500) {
    const url = new URL(`${BASE}/BusStops`);
    url.searchParams.set("$skip", String(skip));
    const res = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`LTA bus stops failed: ${res.status}`);
    const data = (await res.json()) as { value: BusStop[] };
    if (!data.value?.length) break;
    stops.push(...data.value);
    if (data.value.length < 500) break;
  }
  stopsCache = { at: Date.now(), stops };
  return stops;
}

// ── Nearby stops ──────────────────────────────────────────────
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function nearbyStops(
  lat: number,
  lng: number,
  radius = 400,
): Promise<NearbyBusStop[]> {
  const stops = await getAllBusStops();
  const origin = { lat, lng };
  return stops
    .map((s) => ({
      ...s,
      distance: haversineMeters(origin, {
        lat: s.Latitude,
        lng: s.Longitude,
      }),
    }))
    .filter((s) => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

// ── Bus routes (service → ordered stops), cached 24h ──────────
// Used to decide whether a bus service connects a boarding stop to an alighting
// stop (so we only offer alternatives that reach the same destination).
interface BusRouteRow {
  ServiceNo: string;
  Direction: number;
  StopSequence: number;
  BusStopCode: string;
}

// index: serviceNo -> array of directions -> Map<stopCode, stopSequence>
type RouteIndex = Map<string, Array<Map<string, number>>>;

let routeIndexCache: { at: number; index: RouteIndex } | null = null;

async function buildRouteIndex(): Promise<RouteIndex> {
  const index: RouteIndex = new Map();
  for (let skip = 0; skip < 60_000; skip += 500) {
    const url = new URL(`${BASE}/BusRoutes`);
    url.searchParams.set("$skip", String(skip));
    const res = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`LTA bus routes failed: ${res.status}`);
    const data = (await res.json()) as { value: BusRouteRow[] };
    if (!data.value?.length) break;
    for (const r of data.value) {
      let dirs = index.get(r.ServiceNo);
      if (!dirs) {
        dirs = [];
        index.set(r.ServiceNo, dirs);
      }
      // Direction is 1 or 2.
      const di = r.Direction - 1;
      if (!dirs[di]) dirs[di] = new Map();
      dirs[di].set(r.BusStopCode, r.StopSequence);
    }
    if (data.value.length < 500) break;
  }
  return index;
}

export async function getBusRouteIndex(): Promise<RouteIndex> {
  if (routeIndexCache && Date.now() - routeIndexCache.at < STOPS_TTL_MS) {
    return routeIndexCache.index;
  }
  const index = await buildRouteIndex();
  routeIndexCache = { at: Date.now(), index };
  return index;
}

/** Warm the route index in the background (e.g. at server startup). */
export function warmBusRouteIndex(): void {
  getBusRouteIndex().catch((err) =>
    console.warn("Bus route index warm-up failed:", err?.message ?? err),
  );
}

/**
 * Does `serviceNo` travel from `boardCode` to `alightCode` (boarding before
 * alighting) in at least one direction? i.e. can you take this bus from the
 * boarding stop and reach the same alighting stop.
 */
export async function serviceConnects(
  serviceNo: string,
  boardCode: string,
  alightCode: string,
): Promise<boolean> {
  const index = await getBusRouteIndex();
  const dirs = index.get(serviceNo);
  if (!dirs) return false;
  for (const stops of dirs) {
    if (!stops) continue;
    const b = stops.get(boardCode);
    const a = stops.get(alightCode);
    if (b !== undefined && a !== undefined && b < a) return true;
  }
  return false;
}
