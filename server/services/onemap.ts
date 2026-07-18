import { env } from "../env.js";
import { getCachedToken, upsertCachedToken } from "../db/helpers.js";
import type {
  SearchResult,
  Itinerary,
  RouteLeg,
  LegType,
  LatLng,
} from "../../shared/types.js";

const BASE = "https://www.onemap.gov.sg";
const REFRESH_MARGIN_SEC = 6 * 60 * 60; // refresh 6h before expiry

/** Decode a JWT's `exp` claim (Unix seconds) without verifying the signature. */
function jwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

async function refreshFromCredentials(): Promise<{
  token: string;
  expiresAt: number;
} | null> {
  if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) return null;
  const res = await fetch(`${BASE}/api/auth/post/getToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.ONEMAP_EMAIL,
      password: env.ONEMAP_PASSWORD,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    expiry_timestamp?: string;
  };
  if (!data.access_token) return null;
  const expiresAt =
    Number(data.expiry_timestamp) ||
    jwtExp(data.access_token) ||
    Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  return { token: data.access_token, expiresAt };
}

/**
 * Return a valid OneMap token, refreshing when near expiry.
 * Order of preference: fresh cached token → refresh via credentials →
 * seed from ONEMAP_TOKEN env var.
 */
export async function getOneMapToken(
  forceRefresh = false,
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const cached = await getCachedToken("onemap");

  if (!forceRefresh && cached && cached.expiresAt - now > REFRESH_MARGIN_SEC) {
    return cached.token;
  }

  const refreshed = await refreshFromCredentials();
  if (refreshed) {
    await upsertCachedToken("onemap", refreshed.token, refreshed.expiresAt);
    return refreshed.token;
  }

  // No credentials to refresh; fall back to the seeded env token (unless we're
  // force-refreshing because it just got rejected).
  if (!forceRefresh && env.ONEMAP_TOKEN) {
    const expiresAt = jwtExp(env.ONEMAP_TOKEN) ?? now + 3 * 24 * 60 * 60;
    if (!cached || cached.token !== env.ONEMAP_TOKEN) {
      await upsertCachedToken("onemap", env.ONEMAP_TOKEN, expiresAt);
    }
    return env.ONEMAP_TOKEN;
  }

  // Last resort: return whatever we have, even if stale.
  return cached?.token ?? env.ONEMAP_TOKEN ?? null;
}

export async function getOneMapTokenInfo(): Promise<{
  expiresAt: number;
  issuedAt: number;
} | null> {
  const token = await getOneMapToken();
  if (!token) return null;
  const parts = token.split(".");
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return {
      expiresAt: payload.exp ?? 0,
      issuedAt: payload.iat ?? 0,
    };
  } catch {
    return null;
  }
}

export async function forceRefreshOneMap(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/post/getToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`OneMap auth failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    expiry_timestamp: string;
  };
  const expiresAt =
    Number(data.expiry_timestamp) || jwtExp(data.access_token) || 0;
  await upsertCachedToken("onemap", data.access_token, expiresAt);
  return { token: data.access_token, expiresAt };
}

// ── Search ────────────────────────────────────────────────────
interface OneMapSearchResponse {
  found: number;
  results: Array<{
    SEARCHVAL: string;
    ADDRESS: string;
    LATITUDE: string;
    LONGITUDE: string;
  }>;
}

/** Reverse-geocode a coordinate to a human label (for "use my location"). */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const token = await getOneMapToken();
  if (!token) return null;
  const url = new URL(`${BASE}/api/public/revgeocode`);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("buffer", "60");
  url.searchParams.set("addressType", "All");
  const res = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    GeocodeInfo?: Array<{
      BUILDINGNAME?: string;
      BLOCK?: string;
      ROAD?: string;
      POSTALCODE?: string;
    }>;
  };
  const g = data.GeocodeInfo?.[0];
  if (!g) return null;
  const named =
    g.BUILDINGNAME && g.BUILDINGNAME !== "null" ? g.BUILDINGNAME : null;
  const road = [g.BLOCK, g.ROAD].filter((x) => x && x !== "null").join(" ");
  return named ?? (road || null);
}

// ── MRT station exits ─────────────────────────────────────────
export interface StationExit {
  name: string; // "Exit A"
  lat: number;
  lng: number;
}

const exitCache = new Map<string, StationExit[]>();

/** Look up the labelled exits of an MRT station via OneMap search (cached). */
export async function mrtStationExits(
  stationName: string,
): Promise<StationExit[]> {
  const key = stationName.toUpperCase().trim();
  const cached = exitCache.get(key);
  if (cached) return cached;

  const url = new URL(`${BASE}/api/common/elastic/search`);
  url.searchParams.set("searchVal", `${stationName} EXIT`);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "N");
  url.searchParams.set("pageNum", "1");

  let exits: StationExit[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{ SEARCHVAL: string; LATITUDE: string; LONGITUDE: string }>;
      };
      exits = (data.results ?? [])
        .map((r) => {
          const m = r.SEARCHVAL.match(/EXIT\s+([0-9A-Z]+)/i);
          if (!m) return null;
          return {
            name: `Exit ${m[1].toUpperCase()}`,
            lat: Number(r.LATITUDE),
            lng: Number(r.LONGITUDE),
          };
        })
        .filter((x): x is StationExit => x !== null);
    }
  } catch {
    exits = [];
  }
  exitCache.set(key, exits);
  return exits;
}

export async function oneMapSearch(
  q: string,
  page = 1,
): Promise<SearchResult[]> {
  const url = new URL(`${BASE}/api/common/elastic/search`);
  url.searchParams.set("searchVal", q);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", String(page));

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OneMap search failed: ${res.status}`);
  const data = (await res.json()) as OneMapSearchResponse;

  return (data.results ?? []).map((r, i) => ({
    id: `onemap-${page}-${i}-${r.SEARCHVAL}`,
    title: r.SEARCHVAL,
    address: r.ADDRESS,
    lat: Number(r.LATITUDE),
    lng: Number(r.LONGITUDE),
    source: "onemap" as const,
  }));
}

// Station name (+ line prefix) → station code, e.g. ("Tiong Bahru","EW")→"EW17".
// OneMap titles carry codes like "TIONG BAHRU MRT STATION (EW17)".
const stationCodeCache = new Map<string, string | null>();

export async function resolveStationCode(
  name: string,
  linePrefix: string | undefined,
): Promise<string | null> {
  const key = `${name}|${linePrefix ?? ""}`;
  const hit = stationCodeCache.get(key);
  if (hit !== undefined) return hit;
  let code: string | null = null;
  try {
    const results = await oneMapSearch(`${name} MRT STATION`, 1);
    const codes: string[] = [];
    for (const r of results) {
      // Titles like "JURONG EAST MRT STATION (NS1 / EW24)" — grab every
      // station-code token inside the parentheses (any separators/spacing).
      const paren = r.title.match(/\(([^)]*\d[^)]*)\)/);
      if (!paren) continue;
      for (const m of paren[1].matchAll(/\b([A-Z]{2}\d+)\b/g)) codes.push(m[1]);
    }
    code =
      (linePrefix && codes.find((c) => c.startsWith(linePrefix))) ??
      codes[0] ??
      null;
  } catch {
    code = null;
  }
  stationCodeCache.set(key, code);
  return code;
}

// ── Routing ───────────────────────────────────────────────────
function mapMode(mode: string): LegType {
  const m = mode.toUpperCase();
  if (m === "WALK") return "walk";
  if (m === "BUS") return "bus";
  return "mrt"; // SUBWAY, RAIL, TRAIN, etc.
}

/** Best-effort MRT line-code extraction from an OTP route name. */
function lineCodeFromRoute(route?: string): string | undefined {
  if (!route) return undefined;
  const m = route.match(/\b(NS|EW|NE|CC|DT|TE|CG|BP|SW|SE|PW|PE|CE)\b/i);
  return m ? m[1].toUpperCase() : undefined;
}

interface OtpLeg {
  mode: string;
  duration: number;
  distance: number;
  startTime?: number; // epoch ms
  endTime?: number; // epoch ms
  route?: string;
  routeShortName?: string;
  routeLongName?: string;
  agencyName?: string;
  numStops?: number;
  intermediateStops?: unknown[];
  legGeometry?: { points?: string };
  from: { name: string; lat: number; lon: number; stopCode?: string };
  to: { name: string; lat: number; lon: number; stopCode?: string };
}

interface OtpItinerary {
  duration: number;
  startTime?: number; // epoch ms
  endTime?: number; // epoch ms
  walkTime?: number;
  transfers?: number;
  fare?: string | number;
  legs: OtpLeg[];
}

interface OtpResponse {
  plan?: { itineraries?: OtpItinerary[] };
  requestParameters?: unknown;
  error?: unknown;
}

export async function oneMapRoute(params: {
  start: LatLng;
  end: LatLng;
  mode: "WALK" | "TRANSIT" | "DRIVE" | "CYCLE";
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}): Promise<Itinerary[]> {
  const token = await getOneMapToken();
  if (!token) throw new Error("OneMap token unavailable");

  const routeTypeMap = {
    WALK: "walk",
    TRANSIT: "pt",
    DRIVE: "drive",
    CYCLE: "cycle",
  } as const;

  const url = new URL(`${BASE}/api/public/routingsvc/route`);
  url.searchParams.set("start", `${params.start.lat},${params.start.lng}`);
  url.searchParams.set("end", `${params.end.lat},${params.end.lng}`);
  url.searchParams.set("routeType", routeTypeMap[params.mode]);
  if (params.mode === "TRANSIT") {
    // OneMap wants date as MM-DD-YYYY and time as HH:MM:SS.
    const [y, m, d] = params.date.split("-");
    url.searchParams.set("mode", "TRANSIT");
    url.searchParams.set("date", `${m}-${d}-${y}`);
    url.searchParams.set("time", `${params.time}:00`);
    url.searchParams.set("maxWalkDistance", "1000");
    // Ask for more than we show so dedupe (by path, not bus number) still
    // leaves up to 5 genuinely distinct options.
    url.searchParams.set("numItineraries", "6");
  }

  let res = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(15_000),
  });

  // Token expired/rejected → force a refresh and retry once (self-heals when
  // ONEMAP_EMAIL/PASSWORD are configured).
  if (res.status === 401) {
    const fresh = await getOneMapToken(true);
    if (fresh && fresh !== token) {
      res = await fetch(url, {
        headers: { Authorization: fresh },
        signal: AbortSignal.timeout(15_000),
      });
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "OneMap token expired. Set ONEMAP_EMAIL/ONEMAP_PASSWORD to auto-refresh, or update ONEMAP_TOKEN.",
      );
    }
    throw new Error(`OneMap route failed: ${res.status}`);
  }
  const data = (await res.json()) as OtpResponse;

  const itineraries = data.plan?.itineraries ?? [];
  return itineraries.map((it) => toItinerary(it));
}

/**
 * Walk/cycle route via OneMap. Unlike TRANSIT (OTP itineraries), these return a
 * single path as `route_geometry` (encoded polyline) + `route_summary`.
 */
export async function oneMapActiveRoute(
  start: LatLng,
  end: LatLng,
  mode: "walk" | "cycle",
): Promise<{ polyline: string; distanceM: number; durationS: number } | null> {
  const token = await getOneMapToken();
  if (!token) return null;
  const url = new URL(`${BASE}/api/public/routingsvc/route`);
  url.searchParams.set("start", `${start.lat},${start.lng}`);
  url.searchParams.set("end", `${end.lat},${end.lng}`);
  url.searchParams.set("routeType", mode);

  let res = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 401) {
    const fresh = await getOneMapToken(true);
    if (fresh && fresh !== token) {
      res = await fetch(url, {
        headers: { Authorization: fresh },
        signal: AbortSignal.timeout(12_000),
      });
    }
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    route_geometry?: string;
    route_summary?: { total_time?: number; total_distance?: number };
  };
  if (!data.route_geometry || !data.route_summary?.total_distance) return null;
  const distanceM = data.route_summary.total_distance;
  // OneMap's total_time is walk-paced even for cycle routes (~10 km/h, vs
  // Google's ~16.5). Derive durations from distance at realistic speeds so
  // walk & cycle timings are consistent: walk 4.7 km/h, cycle 15.5 km/h.
  const kmh = mode === "walk" ? 4.7 : 15.5;
  return {
    polyline: data.route_geometry,
    distanceM,
    durationS: Math.round(distanceM / ((kmh * 1000) / 3600)),
  };
}

/** Driving distance (m) + time (s) between two points, via OneMap drive route. */
export async function oneMapDrive(
  start: LatLng,
  end: LatLng,
): Promise<{ distanceM: number; durationS: number; polyline?: string } | null> {
  const token = await getOneMapToken();
  if (!token) return null;
  const url = new URL(`${BASE}/api/public/routingsvc/route`);
  url.searchParams.set("start", `${start.lat},${start.lng}`);
  url.searchParams.set("end", `${end.lat},${end.lng}`);
  url.searchParams.set("routeType", "drive");

  let res = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 401) {
    const fresh = await getOneMapToken(true);
    if (fresh && fresh !== token) {
      res = await fetch(url, {
        headers: { Authorization: fresh },
        signal: AbortSignal.timeout(12_000),
      });
    }
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    route_summary?: { total_time?: number; total_distance?: number };
    route_geometry?: string;
  };
  const s = data.route_summary;
  if (!s?.total_distance) return null;
  return {
    distanceM: s.total_distance,
    durationS: s.total_time ?? 0,
    polyline: data.route_geometry,
  };
}

/**
 * Stops travelled on a transit leg. OneMap's OTP omits `numStops` but returns
 * the `intermediateStops` between board and alight — the ride passes those
 * plus the alighting stop.
 */
function legStops(leg: OtpLeg): number | undefined {
  if (typeof leg.numStops === "number" && leg.numStops > 0) return leg.numStops;
  if (Array.isArray(leg.intermediateStops)) {
    return leg.intermediateStops.length + 1;
  }
  return undefined;
}

function toItinerary(it: OtpItinerary): Itinerary {
  const legs: RouteLeg[] = it.legs.map((leg) => {
    const type = mapMode(leg.mode);
    const base: RouteLeg = {
      type,
      startPoint: { lat: leg.from.lat, lng: leg.from.lon },
      endPoint: { lat: leg.to.lat, lng: leg.to.lon },
      duration: Math.round(leg.duration),
      distance: Math.round(leg.distance),
      startTimeMs: leg.startTime,
      endTimeMs: leg.endTime,
      fromName: leg.from.name,
      toName: leg.to.name,
      polyline: leg.legGeometry?.points,
    };
    if (type === "mrt") {
      base.lineName = leg.routeLongName || leg.route || leg.routeShortName;
      base.lineCode = lineCodeFromRoute(leg.route || leg.routeShortName);
      base.startStation = leg.from.name;
      base.endStation = leg.to.name;
      base.numStops = legStops(leg);
    } else if (type === "bus") {
      base.busNo = leg.routeShortName || leg.route;
      base.startBusStop = leg.from.name;
      base.endBusStop = leg.to.name;
      base.busStopCode = leg.from.stopCode;
      base.endBusStopCode = leg.to.stopCode;
      base.numStops = legStops(leg);
    }
    return base;
  });

  const fare =
    typeof it.fare === "string" ? Number(it.fare) : (it.fare ?? 0);

  return {
    duration: Math.round(it.duration),
    fare: Number.isFinite(fare) ? fare : 0,
    transfers: it.transfers ?? 0,
    legs,
    startTimeMs: it.startTime,
  };
}
