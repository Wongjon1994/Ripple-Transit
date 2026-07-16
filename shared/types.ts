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
  eta: string | null; // ISO timestamp of the recommended bus, if known
  serviceNo?: string; // the soonest catchable interchangeable bus for this leg
  walkMinutes: number;
  alternatives: BusAlternative[];
  /** True for buses boarded mid-journey: buffer is measured against your
   *  projected arrival at the stop (after all earlier legs), not against now. */
  enRoute?: boolean;
  /** Projected arrival time at the boarding stop (epoch ms), when enRoute. */
  arriveAtStopMs?: number;
}

export interface RouteLeg {
  type: LegType;
  startPoint: LatLng;
  endPoint: LatLng;
  duration: number; // seconds
  distance: number; // meters
  startTimeMs?: number; // scheduled leg start (epoch ms, from OTP)
  endTimeMs?: number; // scheduled leg end (epoch ms, from OTP)

  // where this leg starts/ends (stop, station, or place name)
  fromName?: string;
  toName?: string;

  // walk
  polyline?: string;

  // mrt
  lineCode?: string;
  lineName?: string;
  startStation?: string;
  endStation?: string;
  numStops?: number;
  exitName?: string; // e.g. "Exit B" — best exit for the onward journey
  exitDistanceM?: number; // distance from that exit to the onward point/destination
  exitAlternatives?: { name: string; distanceM: number }[];

  // bus
  busNo?: string;
  startBusStop?: string;
  endBusStop?: string;
  busStopCode?: string; // boarding stop code
  endBusStopCode?: string; // alighting stop code
  trafficAlert?: string; // live traffic incident on this leg's road, if any

  // phase 12
  busLegFeasibility?: BusLegFeasibility;

  // multi-stop: set on the first leg of each later segment — the 1-based index
  // of the intermediate destination this leg departs from.
  viaStopIndex?: number;
}

export type RiskLevel = "low" | "moderate" | "high";

export interface RouteRisk {
  level: RiskLevel;
  score: number;
  reasons: string[];
}

export interface WeatherAdvisory {
  level: "info" | "warning";
  message: string;
}

export interface WeatherContext {
  area: string;
  forecast: string; // e.g. "Light Rain", "Cloudy"
  wet: boolean;
  temperature?: number; // °C
  humidity?: number; // %
  windSpeed?: number; // km/h
  advisory?: WeatherAdvisory | null;
}

export interface Itinerary {
  duration: number; // seconds — live-adjusted total (includes waiting for the first bus)
  fare: number; // SGD
  transfers: number;
  legs: RouteLeg[];
  risk?: RouteRisk;
  co2Grams?: number; // this route's carbon footprint
  startTimeMs?: number; // scheduled journey start (epoch ms, from OTP)
  waitSeconds?: number; // live waiting time at the first bus stop, if known
}

/** Driving-baseline carbon for the same origin→destination. */
export interface CarbonBaseline {
  driveKm: number;
  taxiGrams: number;
  carGrams: number;
}

export interface RoutePlan {
  plan: { itineraries: Itinerary[] };
  weather?: WeatherContext | null;
  carbon?: CarbonBaseline | null;
}

// ── Taxi ──────────────────────────────────────────────────────
export type TaxiAvailability = "available" | "limited" | "unavailable";

export interface TaxiEstimate {
  fare: number; // SGD (estimate)
  durationMin: number;
  distanceKm: number;
  availability: TaxiAvailability;
  nearbyCount: number;
  waitMin: number;
}

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#10b981",
  moderate: "#f59e0b",
  high: "#dc2626",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low risk",
  moderate: "Some risk",
  high: "Risky",
};

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
