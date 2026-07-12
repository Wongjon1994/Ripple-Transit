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
  route?: string;
  routeShortName?: string;
  routeLongName?: string;
  agencyName?: string;
  numStops?: number;
  legGeometry?: { points?: string };
  from: { name: string; lat: number; lon: number; stopCode?: string };
  to: { name: string; lat: number; lon: number; stopCode?: string };
}

interface OtpItinerary {
  duration: number;
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
    url.searchParams.set("numItineraries", "3");
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

function toItinerary(it: OtpItinerary): Itinerary {
  const legs: RouteLeg[] = it.legs.map((leg) => {
    const type = mapMode(leg.mode);
    const base: RouteLeg = {
      type,
      startPoint: { lat: leg.from.lat, lng: leg.from.lon },
      endPoint: { lat: leg.to.lat, lng: leg.to.lon },
      duration: Math.round(leg.duration),
      distance: Math.round(leg.distance),
      fromName: leg.from.name,
      toName: leg.to.name,
      polyline: leg.legGeometry?.points,
    };
    if (type === "mrt") {
      base.lineName = leg.routeLongName || leg.route || leg.routeShortName;
      base.lineCode = lineCodeFromRoute(leg.route || leg.routeShortName);
      base.startStation = leg.from.name;
      base.endStation = leg.to.name;
      base.numStops = leg.numStops;
    } else if (type === "bus") {
      base.busNo = leg.routeShortName || leg.route;
      base.startBusStop = leg.from.name;
      base.endBusStop = leg.to.name;
      base.busStopCode = leg.from.stopCode;
      base.endBusStopCode = leg.to.stopCode;
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
  };
}
