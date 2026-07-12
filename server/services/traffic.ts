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
