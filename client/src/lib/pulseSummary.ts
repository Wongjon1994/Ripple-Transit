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
}
export interface PulseMrtPlanned {
  line?: string;
  label: string;
}

export interface PulseSummaryInput {
  congestion: PulseCongestion[];
  crowd: PulseCrowd[];
  incidents: PulseIncident[];
  rain: PulseRain[];
  /** Live MRT/LRT disruptions — the highest-priority Pulse signal. */
  mrtDisruptions: PulseMrtDisruption[];
  /** Planned rail adjustments — informational footer. */
  mrtPlanned: PulseMrtPlanned[];
  /** Flux weights (or null) — order the tallies by what the user prioritises. */
  weights: PrefWeights | null;
  /** Saved Home/Work etc. — drives the "for you" proximity callouts. */
  places: PulsePlace[];
}

export type PulseTone = "red" | "amber" | "rain";
export interface PulseTallyItem {
  tone: PulseTone;
  count: number;
  label: string;
}
export interface PulseRow {
  kind: "traffic" | "crowd" | "alerts";
  /** Tally items (crowd, alerts). Traffic uses `text` instead (area-based). */
  items?: PulseTallyItem[];
  /** Area-based summary line, e.g. "Central, East +1" (traffic row). */
  text?: string;
}
export interface PulseCallout {
  tone: PulseTone | "mrt" | "muted";
  text: string;
}
export interface PulseSummary {
  headline: PulseCallout | null;
  rows: PulseRow[];
  personal: PulseCallout[];
  /** Planned rail adjustments — a muted informational footer. */
  planned: string[];
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

  const anyInc = nearest(place, input.incidents);
  if (anyInc && anyInc.d <= 1000)
    return { tone: "amber", text: `${anyInc.item.label} · near ${place.label}` };

  const slow = nearest(
    place,
    input.congestion.filter((c) => c.level === "amber"),
  );
  if (slow && slow.d <= 700)
    return { tone: "amber", text: `Slow traffic near ${place.label}` };

  const busy = nearest(
    place,
    input.crowd.filter((c) => c.level === "m"),
  );
  if (busy && busy.d <= 700)
    return { tone: "amber", text: `${busy.item.name} busy · near ${place.label}` };

  const rain = nearest(place, input.rain);
  if (rain && rain.d <= 1500)
    return { tone: "rain", text: `Rain near ${place.label}` };

  return null;
}

const TONE_RANK: Record<PulseCallout["tone"], number> = {
  mrt: 0,
  red: 1,
  amber: 2,
  rain: 3,
  muted: 4,
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

/** Region names with heavy traffic, busiest first, e.g. "Central, East +1". */
function heavyAreasText(congestion: PulseCongestion[]): string | null {
  // Distinct roads per region (roads, not segments, so a big road isn't
  // double-counted across the region it dominates).
  const roadsByRegion = new Map<string, Set<string>>();
  for (const c of congestion) {
    if (c.level !== "red" || !c.road) continue;
    const region = regionOf(c.lat, c.lng);
    if (!roadsByRegion.has(region)) roadsByRegion.set(region, new Set());
    roadsByRegion.get(region)!.add(c.road);
  }
  if (roadsByRegion.size === 0) return null;
  const ranked = [...roadsByRegion.entries()]
    .map(([name, roads]) => ({ name, n: roads.size }))
    .sort((a, b) => b.n - a.n);
  const top = ranked.slice(0, 2).map((r) => r.name);
  const extra = ranked.length - top.length;
  return extra > 0 ? `${top.join(", ")} +${extra}` : top.join(", ");
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
  const heavy = distinctRoads(input.congestion, "red");
  const slow = distinctRoads(input.congestion, "amber");
  const packed = input.crowd.filter((c) => c.level === "h");
  const busy = input.crowd.filter((c) => c.level === "m");
  const incidents = input.incidents.length;
  const rain = input.rain.length;
  const disruptions = input.mrtDisruptions;
  const planned = input.mrtPlanned.map((p) => p.label);

  const allClear =
    heavy + slow + packed.length + busy.length + incidents + rain === 0 &&
    disruptions.length === 0;

  if (allClear) {
    return {
      headline: { tone: "muted", text: "Network flowing — all clear" },
      rows: [],
      personal: [],
      planned,
      allClear: true,
    };
  }

  // Traffic is area-based and heavy-only (the panel shows trends; road-level
  // red/amber stays on the map). Crowd + alerts keep their live tallies.
  const heavyAreas = heavyAreasText(input.congestion);
  const crowdItems: PulseTallyItem[] = [
    { tone: "red" as const, count: packed.length, label: "packed" },
    { tone: "amber" as const, count: busy.length, label: "busy" },
  ].filter((i) => i.count > 0);
  const alertItems: PulseTallyItem[] = [
    { tone: "red" as const, count: incidents, label: incidents === 1 ? "incident" : "incidents" },
    { tone: "rain" as const, count: rain, label: rain === 1 ? "rain area" : "rain areas" },
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
      text: heavyAreas ?? undefined,
      r: rel.traffic,
      keep: heavyAreas != null,
    },
    { kind: "crowd", items: crowdItems, r: rel.crowd, keep: crowdItems.length > 0 },
    { kind: "alerts", items: alertItems, r: rel.alerts, keep: alertItems.length > 0 },
  ];
  const rows: PulseRow[] = candidates
    .filter((row) => row.keep)
    .sort((a, b) => b.r - a.r)
    .map(({ kind, items, text }) => ({ kind, items, text }));

  // Headline: the single worst thing citywide. MRT disruption tops everything —
  // a downed line strands more people than any road jam.
  let headline: PulseCallout | null = null;
  const severe = input.incidents.find((i) => i.severe);
  if (disruptions.length)
    headline = { tone: "mrt", text: mrtDisruptionLabel(disruptions[0]) };
  else if (severe) headline = { tone: "red", text: severe.label };
  else if (packed.length)
    headline = { tone: "red", text: `${packed[0].name} packed — busiest now` };
  else if (heavyAreas)
    headline = { tone: "red", text: `Heavy traffic · ${heavyAreas}` };
  else if (incidents) headline = { tone: "amber", text: input.incidents[0].label };
  else if (busy.length)
    headline = { tone: "amber", text: `${busy[0].name} — busy platform` };
  else if (slow) headline = { tone: "amber", text: `${plural(slow, "road")} running slow` };

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
    rows,
    personal: personal.slice(0, 2),
    planned,
    allClear: false,
  };
}
