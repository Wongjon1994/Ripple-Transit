import { env } from "../env.js";
import { getApiUsageCount, incrementApiUsage } from "../db/helpers.js";
import type { SearchResult, LatLng } from "../../shared/types.js";

const AUTOSUGGEST = "https://autosuggest.search.hereapi.com/v1/autosuggest";
const DISCOVER = "https://discover.search.hereapi.com/v1/discover";
const SG_CENTER = "1.3521,103.8198";
const SERVICE = "here";

export interface HereUsageStats {
  used: number;
  cap: number;
  remaining: number;
  available: boolean;
}

export async function hereUsageStats(): Promise<HereUsageStats> {
  const used = await getApiUsageCount(SERVICE);
  const cap = env.HERE_MONTHLY_CAP;
  const remaining = Math.max(0, cap - used);
  return {
    used,
    cap,
    remaining,
    available: Boolean(env.HERE_API_KEY) && remaining > 0,
  };
}

interface HereAutosuggestResponse {
  items?: Array<{
    id: string;
    title: string;
    resultType?: string;
    address?: { label?: string; postalCode?: string };
    position?: { lat: number; lng: number };
  }>;
}

export interface HerePlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * HERE Discover — category/keyword place search around a point (used for POI
 * categories with no open dataset, e.g. ATM). Same cap discipline as
 * autosuggest: no key or cap reached → [] without spending a call.
 */
export async function hereDiscover(
  q: string,
  at: LatLng,
  limit = 10,
): Promise<HerePlace[]> {
  const stats = await hereUsageStats();
  if (!stats.available) return [];

  const url = new URL(DISCOVER);
  url.searchParams.set("q", q);
  url.searchParams.set("at", `${at.lat},${at.lng}`);
  url.searchParams.set("in", "countryCode:SGP");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("apiKey", env.HERE_API_KEY!);

  await incrementApiUsage(SERVICE);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as HereAutosuggestResponse;
  return (data.items ?? [])
    .filter((it) => it.position)
    .map((it) => ({
      id: `here-${it.id}`,
      name: it.title,
      address: it.address?.label ?? it.title,
      lat: it.position!.lat,
      lng: it.position!.lng,
    }));
}

/**
 * HERE autosuggest fallback. Respects the monthly cap: if we're at the cap
 * (or have no key) it returns [] without spending a call.
 */
export async function hereAutosuggest(
  q: string,
  at: LatLng | null = null,
): Promise<SearchResult[]> {
  const stats = await hereUsageStats();
  if (!stats.available) return [];

  const url = new URL(AUTOSUGGEST);
  url.searchParams.set("q", q);
  url.searchParams.set("at", at ? `${at.lat},${at.lng}` : SG_CENTER);
  url.searchParams.set("in", "countryCode:SGP");
  url.searchParams.set("limit", "5");
  url.searchParams.set("apiKey", env.HERE_API_KEY!);

  // Count the call before making it (cap is enforced conservatively).
  await incrementApiUsage(SERVICE);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as HereAutosuggestResponse;

  return (data.items ?? [])
    .filter((it) => it.position)
    .map((it) => ({
      id: `here-${it.id}`,
      title: it.title,
      address: it.address?.label ?? it.title,
      lat: it.position!.lat,
      lng: it.position!.lng,
      source: "here" as const,
    }));
}
