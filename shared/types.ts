/**
 * Shared domain types used by both server and client.
 * Mirrors specifications/API_SPECIFICATION.md.
 */

export type LatLng = { lat: number; lng: number };

export type SearchSource = "onemap" | "here";

export interface SearchResult {
  id: string;
  title: string;
  address: string;
  lat: number;
  lng: number;
  source: SearchSource;
}

export type LegType = "walk" | "mrt" | "bus";

export type FeasibilityStatus = "ok" | "tight" | "miss" | "unknown";

export interface BusAlternative {
  serviceNo: string;
  eta: string; // ISO timestamp
  feasibility: Exclude<FeasibilityStatus, "unknown">;
  buffer: number; // minutes
  /** false = a later arrival of the same service; true = a different service
   *  that also reaches your alighting stop (a genuine re-route option). */
  reroute: boolean;
}

export interface BusLegFeasibility {
  status: FeasibilityStatus;
  buffer: number; // minutes (negative = you miss it)
  eta: string | null; // ISO timestamp of the targeted bus, if known
  walkMinutes: number;
  alternatives: BusAlternative[];
}

export interface RouteLeg {
  type: LegType;
  startPoint: LatLng;
  endPoint: LatLng;
  duration: number; // seconds
  distance: number; // meters

  // walk
  polyline?: string;

  // mrt
  lineCode?: string;
  lineName?: string;
  startStation?: string;
  endStation?: string;
  numStops?: number;
  exitName?: string; // e.g. "Exit B" — best exit for the onward journey

  // bus
  busNo?: string;
  startBusStop?: string;
  endBusStop?: string;
  busStopCode?: string; // boarding stop code
  endBusStopCode?: string; // alighting stop code

  // phase 12
  busLegFeasibility?: BusLegFeasibility;
}

export interface Itinerary {
  duration: number; // seconds
  fare: number; // SGD
  transfers: number;
  legs: RouteLeg[];
}

export interface RoutePlan {
  plan: { itineraries: Itinerary[] };
}

export const TRANSIT_COLORS = {
  bus: "#3b82f6",
  mrt: "#ef4444",
  walk: "#22c55e",
} as const;

export const FEASIBILITY_COLORS: Record<FeasibilityStatus, string> = {
  ok: "#10b981",
  tight: "#f59e0b",
  miss: "#dc2626",
  unknown: "#6b7280",
};
