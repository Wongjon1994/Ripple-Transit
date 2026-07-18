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

export type LegType = "walk" | "mrt" | "bus" | "cycle";

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
  stationCode?: string; // e.g. "EW14" — boarding station code (MRT)
  crowd?: "l" | "m" | "h"; // live boarding-platform crowd (PCDRealTime)

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
  co2SavedGrams?: number; // walk/cycle journeys: emissions avoided vs driving
  startTimeMs?: number; // scheduled journey start (epoch ms, from OTP)
  waitSeconds?: number; // live waiting time at the first bus stop, if known
}

// ── Active mobility (Phase 14) ────────────────────────────────
export type ActiveMode = "walk" | "cycle";

/** Route-option flavours. Walk offers all three; cycle skips "sheltered". */
export type ActiveVariantKind = "fastest" | "sheltered" | "pcn";

/** One stop-to-stop portion of an active route (multi-stop journeys). */
export interface ActiveSegment {
  polyline: string; // encoded, precision 5
  distanceM: number;
  durationS: number;
}

export interface ActiveVariant {
  kind: ActiveVariantKind;
  /** When another flavour's best path is this same route (e.g. the fastest
   *  walk is already the most sheltered), those kinds merge here as badges. */
  also?: ActiveVariantKind[];
  durationS: number;
  distanceM: number;
  kcal: number; // honest estimate
  /** % within ~30m of a park connector / cycling path. */
  pcnPct: number;
  /** % within ~30m of an OSM covered walkway — walk only, when data loads. */
  shelterPct?: number;
  comfort: { label: string; tone: "ok" | "neutral" | "warning" };
  segments: ActiveSegment[]; // one per consecutive stop pair
  /** Exposure-based weather callout (umbrella / sunscreen), when actionable. */
  callout?: WeatherAdvisory;
}

export interface ActiveModeRoutes {
  /** Ordered for display: walk = fastest, sheltered, pcn; cycle = fastest, pcn. */
  variants: ActiveVariant[];
}

export interface ActiveAdvisory {
  level: "good" | "info" | "warning";
  message: string;
}

export interface ActiveRoutesResult {
  walk: ActiveModeRoutes | null;
  cycle: ActiveModeRoutes | null;
  weather: WeatherContext | null;
  advisory: ActiveAdvisory;
  /** Rain-window advisory specific to cycling ("until ~3:40 pm" phrasing). */
  cycleAdvisory?: ActiveAdvisory;
  co2SavedGrams: number; // vs driving the same stops
}

// ── "Nearest ___" (Phase 15) ──────────────────────────────────
export type NearestCategoryId =
  | "dining" // broadened from "hawker" (addendum §2a)
  | "clinic"
  | "supermarket"
  | "park"
  | "library"
  | "sports"
  | "atm"
  | "attraction";

export type NearestAnchor = "you" | "destination" | "route";

/** OpenStreetMap opening hours, parsed + evaluated (SG time). Present only on
 *  a confident name+proximity match to an OSM record — never guessed. */
export interface OpeningHours {
  raw: string; // original OSM opening_hours string (transparency)
  openNow?: boolean; // undefined when today's schedule is indeterminate
  status: string; // "Open · closes 10 pm" / "Closed · opens 9 am" / "Open 24 hours"
  alwaysOpen: boolean;
  todayLabel: string; // e.g. "9 am – 10 pm" or "Closed"
  week: { day: string; label: string }[]; // 7 entries, from today
}

export interface NearestResult {
  id: string;
  name: string;
  address?: string;
  point: LatLng;
  /** Winning real mode for this candidate (multi-modal ranking). */
  mode: "walk" | "cycle" | "transit";
  durationS: number;
  fare: number; // 0 for walk/cycle
  steps: number; // transit legs (0 for walk/cycle)
  /** Along-the-way only: added time vs the direct route. */
  detourS?: number;
  disclaimer?: string;
  /** Dining: result type (Hawker centre / Restaurant / Café / Food court). */
  tag?: string;
  /** Dining: NEA hygiene grade, only on a confident record match. */
  grade?: string;
  /** OSM opening hours, when a confident match exists. */
  hours?: OpeningHours;
}

export interface NearestMrtStation {
  name: string;
  point: LatLng;
  walkMinutes: number;
  walkMeters: number;
  lines: string[]; // e.g. ["EW", "TE"]
  /** Non-operational lines serving this station — never listed unqualified. */
  disrupted: { lineCode: string; status: string }[];
}

export interface NearestBusStop {
  code: string;
  name: string;
  roadName?: string;
  point: LatLng;
  walkMinutes: number;
  /** Soonest arrival per service, soonest-first (top 3). */
  services: { no: string; mins: number }[];
  /** Live feed returned nothing — flagged, never listed as normal. */
  noLiveData: boolean;
  /** First arrival is unusually far out (> 15 min). */
  longGap: boolean;
}

/** Client-tunable knobs the nearest ranking honours (Preferences MVP). */
export interface NearestPrefs {
  maxWalkMin?: number; // walk-wins gate, default 15
  supermarketBrands?: string[];
  atmBanks?: string[];
}

/** Persisted user preferences (server for accounts, localStorage for guests). */
export interface UserPrefs extends NearestPrefs {
  /** The 4 always-visible Nearest chips, in order; the rest go to "More". */
  defaultChips?: NearestCategoryId[];
  maxWalkMin?: 10 | 15 | 20;
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
  /** Live traffic incident on the driving path, e.g. "Accident on AYE". */
  trafficAlert?: string;
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
  cycle: "#0ea5e9",
} as const;

export const FEASIBILITY_COLORS: Record<FeasibilityStatus, string> = {
  ok: "#10b981",
  tight: "#f59e0b",
  miss: "#dc2626",
  unknown: "#6b7280",
};
