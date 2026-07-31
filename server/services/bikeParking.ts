import { haversineMeters } from "./lta.js";
import type { LatLng } from "../../shared/types.js";

/**
 * Bicycle parking near a point, from OpenStreetMap (`amenity=bicycle_parking`)
 * via Overpass. No public LTA bike-parking GeoJSON exists, but SG bike racks
 * are well mapped in OSM. Queried per destination with an `around` search (a
 * small, fast query) and cached 24 h per rounded point — the live cycle journey
 * asks once, as you approach your stop.
 */

export interface BikeStand {
  lat: number;
  lng: number;
  /** Distance from the queried point (the destination), metres. */
  distanceM: number;
  /** covered=yes → sheltered rack (rain cover). */
  covered: boolean;
  /** OSM `capacity`, when tagged. */
  capacity: number | null;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; stands: BikeStand[] }>();
const inFlight = new Map<string, Promise<BikeStand[]>>();

interface OverpassEl {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Turn Overpass elements into distance-sorted stands (pure — unit-tested). A
 *  rack can be a node or a way/area; `out center` gives ways a point. */
export function parseBikeStands(
  elements: OverpassEl[],
  point: LatLng,
): BikeStand[] {
  const stands: BikeStand[] = [];
  for (const el of elements) {
    const p =
      el.type === "node"
        ? { lat: el.lat, lng: el.lon }
        : el.center
          ? { lat: el.center.lat, lng: el.center.lon }
          : null;
    if (p?.lat == null || p.lng == null) continue;
    const cap = Number(el.tags?.capacity);
    stands.push({
      lat: p.lat,
      lng: p.lng,
      distanceM: Math.round(haversineMeters(point, { lat: p.lat, lng: p.lng })),
      covered: el.tags?.covered === "yes",
      capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
    });
  }
  return stands.sort((a, b) => a.distanceM - b.distanceM);
}

async function fetchStands(
  point: LatLng,
  radiusM: number,
): Promise<BikeStand[]> {
  const { lat, lng } = point;
  const query = `[out:json][timeout:25];(node(around:${radiusM},${lat},${lng})["amenity"="bicycle_parking"];way(around:${radiusM},${lat},${lng})["amenity"="bicycle_parking"];);out center tags;`;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass returns 406 without an identifying User-Agent (usage policy).
      "User-Agent": "RippleTransit/1.0 (github.com/Wongjon1994/Ripple-Transit)",
    },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Overpass failed: ${res.status}`);
  const data = (await res.json()) as { elements?: OverpassEl[] };
  return parseBikeStands(data.elements ?? [], point);
}

/**
 * Nearest bike stands to `point` (usually the destination), within `radiusM`.
 * Cached 24 h per rounded point; returns [] on any Overpass failure so the
 * caller degrades quietly (the card just doesn't appear).
 */
export async function bikeStandsNear(
  point: LatLng,
  radiusM = 250,
): Promise<BikeStand[]> {
  const key = `${point.lat.toFixed(3)},${point.lng.toFixed(3)},${radiusM}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.stands;

  let job = inFlight.get(key);
  if (!job) {
    job = fetchStands(point, radiusM)
      .then((stands) => {
        cache.set(key, { at: Date.now(), stands });
        return stands;
      })
      .catch(() => [] as BikeStand[])
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  return job;
}
