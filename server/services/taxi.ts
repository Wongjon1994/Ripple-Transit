import { env } from "../env.js";
import { haversineMeters } from "./lta.js";
import { oneMapDrive } from "./onemap.js";
import {
  getTrafficIncidents,
  incidentsOnPath,
  incidentLabel,
} from "./traffic.js";
import type {
  LatLng,
  TaxiAvailability,
  TaxiEstimate,
  TaxiSurcharge,
} from "../../shared/types.js";

const BASE = "https://datamall2.mytransport.sg/ltaodataservice";

/**
 * Estimate a standard taxi fare from distance using LTA-regulated rates
 * (approx, standard non-peak, excludes surcharges): flag-down + metered
 * distance. This is a planning estimate, not a booking quote.
 */
export function estimateTaxiFare(distanceM: number): number {
  const flagDown = 4.4;
  const first10 = Math.min(distanceM, 10_000);
  const beyond = Math.max(0, distanceM - 10_000);
  // $0.26 per 400m up to 10km, then per 350m.
  const fare = flagDown + (first10 / 400) * 0.26 + (beyond / 350) * 0.26;
  return Math.round(fare * 100) / 100;
}

// Central Changi Airport point — the flat airport surcharge applies to trips
// starting within ~3.5 km (covers all terminals + Jewel).
const CHANGI = { lat: 1.3592, lng: 103.9894 };

/**
 * Estimated surcharges on top of the metered fare for the current SG time and
 * pickup location, each labelled. These are the common LTA-regulated ones
 * (approximate, and they do change) — peak-hour / late-night as a % of the
 * metered fare, plus the flat Changi Airport surcharge. Not included: ERP,
 * booking fees, CBD/event surcharges. Pure — unit-tested.
 */
export function taxiSurcharges(
  meteredFare: number,
  origin: LatLng,
  now: Date = new Date(),
): TaxiSurcharge[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // SG local time (the server may run in UTC on Render).
  const sg = new Date(now.getTime() + 8 * 3_600_000);
  const h = sg.getUTCHours();
  const min = sg.getUTCMinutes();
  const dow = sg.getUTCDay(); // 0 = Sun … 6 = Sat
  const out: TaxiSurcharge[] = [];

  // Time-of-day, as a % of the metered fare (mutually exclusive windows).
  if (h < 6) {
    out.push({ label: "Late-night (+50%)", amount: round2(meteredFare * 0.5) });
  } else {
    const eveningPeak = h >= 18; // daily 6 pm – midnight
    const morningPeak =
      dow >= 1 && dow <= 5 && ((h >= 6 && h < 9) || (h === 9 && min < 30)); // Mon–Fri 6:00–9:29
    if (eveningPeak || morningPeak) {
      out.push({ label: "Peak-hour (+25%)", amount: round2(meteredFare * 0.25) });
    }
  }

  // Flat Changi Airport surcharge on trips FROM the airport.
  if (haversineMeters(origin, CHANGI) <= 3500) {
    const higher = (dow === 5 || dow === 6 || dow === 0) && h >= 17; // Fri–Sun 5 pm–midnight
    out.push({ label: "Changi Airport", amount: higher ? 8 : 6 });
  }

  return out;
}

/** Bucket nearby-taxi count into an availability level + rough wait. */
export function classifyAvailability(count: number): {
  availability: TaxiAvailability;
  waitMin: number;
} {
  if (count >= 8) return { availability: "available", waitMin: 3 };
  if (count >= 2) return { availability: "limited", waitMin: 7 };
  return { availability: "unavailable", waitMin: 12 };
}

// ── Available taxi positions (cached 60s) ─────────────────────
let cache: { at: number; points: LatLng[] } | null = null;
const TTL_MS = 60 * 1000;

async function getAvailableTaxis(): Promise<LatLng[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.points;
  const points: LatLng[] = [];
  for (let skip = 0; skip < 5000; skip += 500) {
    const url = new URL(`${BASE}/Taxi-Availability`);
    url.searchParams.set("$skip", String(skip));
    const res = await fetch(url, {
      headers: { AccountKey: env.LTA_ACCOUNT_KEY ?? "", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      value: Array<{ Latitude: number; Longitude: number }>;
    };
    if (!data.value?.length) break;
    for (const t of data.value) points.push({ lat: t.Latitude, lng: t.Longitude });
    if (data.value.length < 500) break;
  }
  cache = { at: Date.now(), points };
  return points;
}

export async function taxiNearbyCount(
  origin: LatLng,
  radiusM = 1500,
): Promise<number> {
  const taxis = await getAvailableTaxis();
  return taxis.filter((t) => haversineMeters(origin, t) <= radiusM).length;
}

/** Full taxi estimate for an origin→destination. */
export async function taxiEstimate(
  origin: LatLng,
  dest: LatLng,
): Promise<TaxiEstimate | null> {
  const [drive, nearbyCount, incidents] = await Promise.all([
    oneMapDrive(origin, dest).catch(() => null),
    taxiNearbyCount(origin).catch(() => 0),
    getTrafficIncidents().catch(() => []),
  ]);
  if (!drive) return null;
  const { availability, waitMin } = classifyAvailability(nearbyCount);

  // Live congestion on the driving path (accident / heavy traffic / breakdown).
  const hits = incidentsOnPath(
    { polyline: drive.polyline, start: origin, end: dest },
    incidents,
  );
  const trafficAlert = hits.length ? incidentLabel(hits[0]) : undefined;

  const fare = estimateTaxiFare(drive.distanceM);
  const surcharges = taxiSurcharges(fare, origin);
  const total =
    Math.round(
      (fare + surcharges.reduce((s, x) => s + x.amount, 0)) * 100,
    ) / 100;

  return {
    fare,
    surcharges,
    total,
    durationMin: Math.max(1, Math.round(drive.durationS / 60)),
    distanceKm: Math.round((drive.distanceM / 1000) * 10) / 10,
    availability,
    nearbyCount,
    waitMin,
    trafficAlert,
  };
}
