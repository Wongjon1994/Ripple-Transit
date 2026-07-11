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
