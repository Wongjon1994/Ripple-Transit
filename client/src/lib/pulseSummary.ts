/**
 * Turns the raw Pulse overlay into the compact, dynamic summary panel model:
 * a "worst right now" headline, live per-category tallies ordered by what the
 * user cares about, and personalised proximity callouts for their saved places.
 *
 * Pure + deterministic so it can be unit-tested; the MapView just renders it.
 */
import type { PrefWeights, PrefDimension } from "@shared/prefMatch.js";

export interface PulseCrowd {
  name: string;
  level: "m" | "h";
  lat: number;
  lng: number;
}
export interface PulseCongestion {
  level: "red" | "amber";
  lat: number;
  lng: number;
  /** Road name — the tally counts distinct roads, not raw ~150m segments. */
  road: string;
}
export interface PulseIncident {
  lat: number;
  lng: number;
  severe: boolean;
  label: string;
}
export interface PulseRain {
  lat: number;
  lng: number;
}
export interface PulsePlace {
  label: string;
  lat: number;
  lng: number;
}

export interface PulseMrtDisruption {
  lines: string[];
  stations: string[];
  message: string;
  /** Affected station coordinates (resolved by the caller from codes), so the
   *  headline can frame the outage on tap. */
  stationPoints?: { lat: number; lng: number }[];
}
export interface PulseMrtPlanned {
  line?: string;
  label: string;
}

/** Live + forward-looking weather for the Pulse header. */
export interface PulseWeather {
  temperature?: number;
  /** Current condition, e.g. "Partly Cloudy", "Light Rain". */
  condition: string;
  /** A short forward look, e.g. "Showers later this afternoon" — when known. */
  outlook?: string;
}

export interface PulseFlood {
  location: string;
  lat: number;
  lng: number;
}

export interface PulseSummaryInput {
  congestion: PulseCongestion[];
  crowd: PulseCrowd[];
  incidents: PulseIncident[];
  rain: PulseRain[];
  /** PUB flash-flood alerts — the highest-priority Pulse signal. */
  floods: PulseFlood[];
  /** Live MRT/LRT disruptions — the highest-priority Pulse signal. */
  mrtDisruptions: PulseMrtDisruption[];
  /** Planned rail adjustments — informational footer. */
  mrtPlanned: PulseMrtPlanned[];
  /** Current + forecast weather (optional; shown as a header line). */
  weather?: PulseWeather | null;
  /** Flux weights (or null) — order the tallies by what the user prioritises. */
  weights: PrefWeights | null;
  /** Saved Home/Work etc. — drives the "for you" proximity callouts. */
  places: PulsePlace[];
}

export interface PulsePoint {
  lat: number;
  lng: number;
}

export type PulseTone = "red" | "amber" | "rain" | "flood";
export interface PulseTallyItem {
  tone: PulseTone;
  count: number;
  label: string;
  /** One focus target per instance (e.g. each incident), nearest-first at click
   *  time — tapping the item cycles through them on the map. */
  focus?: PulsePoint[][];
}
export interface PulseRow {
  kind: "traffic" | "crowd" | "alerts";
  /** Tally items (crowd, alerts). Traffic uses `text` instead (area-based). */
  items?: PulseTallyItem[];
  /** Area-based summary line, e.g. "Central, East +1" (traffic row). */
  text?: string;
  /** Traffic row: one focus target per affected region (tap to cycle). */
  focus?: PulsePoint[][];
}
export interface PulseCallout {
  tone: PulseTone | "mrt" | "muted";
  text: string;
  /** Map points the headline refers to — tapping it frames these. */
  focus?: PulsePoint[];
}
export interface PulseSummary {
  /** The single top headline (headlines[0]) — kept for convenience. */
  headline: PulseCallout | null;
  /** Ranked headlines the panel rotates through, worst first. */
  headlines: PulseCallout[];
  rows: PulseRow[];
  personal: PulseCallout[];
  /** Planned rail adjustments — a muted informational footer. */
  planned: string[];
  /** Current + forecast weather for the header line, when available. */
  weather?: PulseWeather | null;
  allClear: boolean;
}

/**
 * Singapore's five URA planning regions by centroid — a point is assigned to
 * the nearest. Cheap and dependency-free; precise enough to say "heavy traffic
 * in Central & East" without a boundary dataset.
 */
const REGIONS: { name: string; lat: number; lng: number }[] = [
  { name: "Central", lat: 1.30, lng: 103.83 },
  { name: "East", lat: 1.34, lng: 103.94 },
  { name: "North-East", lat: 1.38, lng: 103.88 },
  { name: "North", lat: 1.43, lng: 103.80 },
  { name: "West", lat: 1.34, lng: 103.72 },
];

export function regionOf(lat: number, lng: number): string {
  let best = REGIONS[0];
  let bestD = Infinity;
  for (const r of REGIONS) {
    const d = (r.lat - lat) ** 2 + (r.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best.name;
}

/** Metres between two lat/lng points (equirectangular — plenty for <2km). */
function metres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(lat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

const BASE_RELEVANCE = 0.2;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Nearest item of a list to a point, with its distance, or null. */
function nearest<T extends { lat: number; lng: number }>(
  place: PulsePlace,
  items: T[],
): { item: T; d: number } | null {
  let best: { item: T; d: number } | null = null;
  for (const item of items) {
    const d = metres(place, item);
    if (!best || d < best.d) best = { item, d };
  }
  return best;
}

/** The single most relevant live event near one saved place, or null. */
function calloutForPlace(
  place: PulsePlace,
  input: PulseSummaryInput,
): PulseCallout | null {
  const flood = nearest(place, input.floods);
  if (flood && flood.d <= 1500)
    return { tone: "flood", text: `Flash flood near ${place.label}` };

  const severeInc = nearest(
    place,
    input.incidents.filter((i) => i.severe),
  );
  if (severeInc && severeInc.d <= 1200)
    return { tone: "red", text: `${severeInc.item.label} · near ${place.label}` };

  const heavy = nearest(
    place,
    input.congestion.filter((c) => c.level === "red"),
  );
  if (heavy && heavy.d <= 800)
    return { tone: "red", text: `Heavy traffic near ${place.label}` };

  const packed = nearest(
    place,
    input.crowd.filter((c) => c.level === "h"),
  );
  if (packed && packed.d <= 700)
    return { tone: "red", text: `${packed.item.name} packed · near ${place.label}` };

  // Amber signals (slow traffic, busy platforms, minor incidents) are
  // intentionally NOT surfaced — Pulse flags reds + rain only.
  const rain = nearest(place, input.rain);
  if (rain && rain.d <= 1500)
    return { tone: "rain", text: `Rain near ${place.label}` };

  return null;
}

const TONE_RANK: Record<PulseCallout["tone"], number> = {
  flood: 0, // flash floods are the most urgent — rank above everything
  mrt: 1,
  red: 2,
  amber: 3,
  rain: 4,
  muted: 5,
};

/** Distinct road names among congestion of one level — so "12 heavy" means 12
 *  ROADS, not the ~40 links LTA splits each of them into. */
function distinctRoads(
  congestion: PulseCongestion[],
  level: "red" | "amber",
): number {
  const roads = new Set<string>();
  for (const c of congestion) if (c.level === level && c.road) roads.add(c.road);
  return roads.size;
}

/**
 * Heavy (red) traffic grouped by URA region, busiest first: the display text
 * ("Central, East +1") and the heavy points per region (for the tap-to-focus).
 */
function heavyRegions(congestion: PulseCongestion[]): {
  text: string | null;
  points: PulsePoint[];
  /** Heavy points per region, busiest region first (for tap-to-cycle). */
  groups: PulsePoint[][];
} {
  const roadsByRegion = new Map<string, Set<string>>();
  const pointsByRegion = new Map<string, PulsePoint[]>();
  for (const c of congestion) {
    if (c.level !== "red" || !c.road) continue;
    const region = regionOf(c.lat, c.lng);
    if (!roadsByRegion.has(region)) {
      roadsByRegion.set(region, new Set());
      pointsByRegion.set(region, []);
    }
    roadsByRegion.get(region)!.add(c.road);
    pointsByRegion.get(region)!.push({ lat: c.lat, lng: c.lng });
  }
  if (roadsByRegion.size === 0) return { text: null, points: [], groups: [] };
  const ranked = [...roadsByRegion.entries()]
    .map(([name, roads]) => ({ name, n: roads.size }))
    .sort((a, b) => b.n - a.n);
  const top = ranked.slice(0, 2).map((r) => r.name);
  const extra = ranked.length - top.length;
  const text = extra > 0 ? `${top.join(", ")} +${extra}` : top.join(", ");
  const groups = ranked.map((r) => pointsByRegion.get(r.name) ?? []);
  return { text, points: groups[0] ?? [], groups };
}

/** Short label for an MRT disruption headline/callout ("NE line disrupted"). */
function mrtDisruptionLabel(d: PulseMrtDisruption): string {
  const lines = d.lines.join("/");
  const where =
    d.stations.length > 0
      ? ` · ${d.stations.length} station${d.stations.length > 1 ? "s" : ""}`
      : "";
  return `${lines} line disrupted${where}`;
}

export function pulseSummary(input: PulseSummaryInput): PulseSummary {
  // Pulse surfaces reds + rain only — amber (slow traffic, busy platforms,
  // minor incidents) is intentionally omitted from both panel and map.
  const heavy = distinctRoads(input.congestion, "red");
  const packed = input.crowd.filter((c) => c.level === "h");
  const severeIncidents = input.incidents.filter((i) => i.severe);
  const rain = input.rain.length;
  const floods = input.floods;
  const disruptions = input.mrtDisruptions;
  const planned = input.mrtPlanned.map((p) => p.label);
  const weather = input.weather ?? null;

  const allClear =
    heavy + packed.length + severeIncidents.length + rain + floods.length === 0 &&
    disruptions.length === 0;

  if (allClear) {
    const only = { tone: "muted" as const, text: "Network flowing — all clear" };
    return {
      headline: only,
      headlines: [only],
      rows: [],
      personal: [],
      planned,
      weather,
      allClear: true,
    };
  }

  // Traffic is area-based and heavy-only (the panel shows trends; road-level
  // detail stays on the map). Crowd = packed only; alerts = severe + rain.
  // Each item carries per-instance focus targets so tapping cycles the map.
  const heavyAreas = heavyRegions(input.congestion);
  const crowdItems: PulseTallyItem[] = [
    {
      tone: "red" as const,
      count: packed.length,
      label: packed.length === 1 ? "Packed MRT station" : "Packed MRT stations",
      focus: packed.map((p) => [{ lat: p.lat, lng: p.lng }]),
    },
  ].filter((i) => i.count > 0);
  const alertItems: PulseTallyItem[] = [
    {
      tone: "flood" as const,
      count: floods.length,
      label: floods.length === 1 ? "Flash flood" : "Flash floods",
      focus: floods.map((f) => [{ lat: f.lat, lng: f.lng }]),
    },
    {
      tone: "red" as const,
      count: severeIncidents.length,
      label: severeIncidents.length === 1 ? "Traffic incident" : "Traffic incidents",
      focus: severeIncidents.map((i) => [{ lat: i.lat, lng: i.lng }]),
    },
    {
      tone: "rain" as const,
      count: rain,
      label: rain === 1 ? "rain area" : "rain areas",
      focus: input.rain.map((r) => [{ lat: r.lat, lng: r.lng }]),
    },
  ].filter((i) => i.count > 0);

  const w = input.weights;
  const rel = {
    traffic: w?.time ?? BASE_RELEVANCE,
    crowd: w?.crowds ?? BASE_RELEVANCE,
    // incidents bite travel time; rain matters most on foot.
    alerts: Math.max(w?.time ?? BASE_RELEVANCE, w?.walking ?? BASE_RELEVANCE),
  };
  const candidates: (PulseRow & { r: number; keep: boolean })[] = [
    {
      kind: "traffic",
      text: heavyAreas.text ?? undefined,
      focus: heavyAreas.groups,
      r: rel.traffic,
      keep: heavyAreas.text != null,
    },
    { kind: "crowd", items: crowdItems, r: rel.crowd, keep: crowdItems.length > 0 },
    { kind: "alerts", items: alertItems, r: rel.alerts, keep: alertItems.length > 0 },
  ];
  const rows: PulseRow[] = candidates
    .filter((row) => row.keep)
    .sort((a, b) => b.r - a.r)
    .map(({ kind, items, text, focus }) => ({ kind, items, text, focus }));

  // Ranked headlines the panel rotates through (worst first), each with the map
  // points it refers to. Flash floods top everything (life-safety), then MRT
  // disruption, severe incidents, packed stations, heavy traffic, rain.
  const headlines: PulseCallout[] = [];
  for (const f of floods.slice(0, 3))
    headlines.push({
      tone: "flood",
      text: `Flash flood risk · ${f.location}`,
      focus: [{ lat: f.lat, lng: f.lng }],
    });
  for (const d of disruptions)
    headlines.push({
      tone: "mrt",
      text: mrtDisruptionLabel(d),
      focus: d.stationPoints ?? [],
    });
  for (const i of severeIncidents.slice(0, 3))
    headlines.push({ tone: "red", text: i.label, focus: [{ lat: i.lat, lng: i.lng }] });
  for (const p of packed.slice(0, 3))
    headlines.push({
      tone: "red",
      text: `${p.name} packed`,
      focus: [{ lat: p.lat, lng: p.lng }],
    });
  if (heavyAreas.text)
    headlines.push({
      tone: "red",
      text: `Heavy traffic · ${heavyAreas.text}`,
      focus: heavyAreas.points,
    });
  if (rain)
    headlines.push({
      tone: "rain",
      text: `Showers in ${plural(rain, "area")}`,
      focus: input.rain.map((r) => ({ lat: r.lat, lng: r.lng })),
    });
  const headline = headlines[0] ?? null;

  // Personalised proximity callouts — worst 2, deduped.
  const personal: PulseCallout[] = [];
  const seen = new Set<string>();
  for (const place of input.places) {
    const c = calloutForPlace(place, input);
    if (c && !seen.has(c.text)) {
      seen.add(c.text);
      personal.push(c);
    }
  }
  personal.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  return {
    headline,
    headlines,
    rows,
    personal: personal.slice(0, 2),
    planned,
    weather,
    allClear: false,
  };
}
