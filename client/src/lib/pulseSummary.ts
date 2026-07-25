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

export interface PulseSummaryInput {
  congestion: PulseCongestion[];
  crowd: PulseCrowd[];
  incidents: PulseIncident[];
  rain: PulseRain[];
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
  items: PulseTallyItem[];
}
export interface PulseCallout {
  tone: PulseTone | "muted";
  text: string;
}
export interface PulseSummary {
  headline: PulseCallout | null;
  rows: PulseRow[];
  personal: PulseCallout[];
  allClear: boolean;
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
  red: 0,
  amber: 1,
  rain: 2,
  muted: 3,
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

export function pulseSummary(input: PulseSummaryInput): PulseSummary {
  const heavy = distinctRoads(input.congestion, "red");
  const slow = distinctRoads(input.congestion, "amber");
  const packed = input.crowd.filter((c) => c.level === "h");
  const busy = input.crowd.filter((c) => c.level === "m");
  const incidents = input.incidents.length;
  const rain = input.rain.length;

  const allClear =
    heavy + slow + packed.length + busy.length + incidents + rain === 0;

  if (allClear) {
    return {
      headline: { tone: "muted", text: "Network flowing — all clear" },
      rows: [],
      personal: [],
      allClear: true,
    };
  }

  // Tally rows — only items with a non-zero count survive.
  const trafficItems: PulseTallyItem[] = [
    { tone: "red" as const, count: heavy, label: "heavy" },
    { tone: "amber" as const, count: slow, label: "slow" },
  ].filter((i) => i.count > 0);
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
  const rows: PulseRow[] = (
    [
      { kind: "traffic" as const, items: trafficItems, r: rel.traffic },
      { kind: "crowd" as const, items: crowdItems, r: rel.crowd },
      { kind: "alerts" as const, items: alertItems, r: rel.alerts },
    ]
      .filter((row) => row.items.length > 0)
      // Descending relevance; stable so ties keep the natural order.
      .sort((a, b) => b.r - a.r)
      .map(({ kind, items }) => ({ kind, items }))
  );

  // Headline: the single worst thing citywide, most severe first.
  let headline: PulseCallout | null = null;
  const severe = input.incidents.find((i) => i.severe);
  if (severe) headline = { tone: "red", text: severe.label };
  else if (packed.length)
    headline = { tone: "red", text: `${packed[0].name} packed — busiest now` };
  else if (heavy >= 8)
    headline = { tone: "red", text: `Heavy traffic on ${plural(heavy, "road")}` };
  else if (incidents) headline = { tone: "amber", text: input.incidents[0].label };
  else if (busy.length)
    headline = { tone: "amber", text: `${busy[0].name} — busy platform` };
  else if (heavy || slow)
    headline = { tone: "amber", text: `${plural(heavy + slow, "road")} running slow` };

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

  return { headline, rows, personal: personal.slice(0, 2), allClear: false };
}
