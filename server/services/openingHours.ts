/**
 * OpenStreetMap `opening_hours` for places of interest.
 *
 * OSM's opening_hours grammar is large; we deliberately parse only the common,
 * unambiguous forms and return `null` for anything else — so we never surface a
 * guessed schedule. Data comes from Overpass (one cached area query per search),
 * matched to a POI by name + proximity. Evaluation is done in Singapore local
 * time (UTC+8, no DST).
 */
import { haversineMeters } from "./lta.js";
import type { LatLng } from "../../shared/types.js";

// ── Types ─────────────────────────────────────────────────────
/** Per-day opening intervals, index 0 = Monday … 6 = Sunday. Minutes from
 *  midnight; an interval may extend past 1440 to encode an overnight close. */
type DayIntervals = Array<{ start: number; end: number }>;
export type WeekTable = [
  DayIntervals,
  DayIntervals,
  DayIntervals,
  DayIntervals,
  DayIntervals,
  DayIntervals,
  DayIntervals,
];

export interface OpeningInfo {
  raw: string;
  /** undefined when today's schedule is indeterminate. */
  openNow?: boolean;
  /** Short status, e.g. "Open · closes 10:00 pm" / "Closed · opens Mon 9:00 am". */
  status: string;
  /** Always-open establishments. */
  alwaysOpen: boolean;
  /** Today's ranges as a label, e.g. "9:00 am – 10:00 pm" or "Closed". */
  todayLabel: string;
  /** Seven-day breakdown for the expanded view. */
  week: { day: string; label: string }[];
}

const DAY_ABBR = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_INDEX: Record<string, number> = Object.fromEntries(
  DAY_ABBR.map((d, i) => [d, i]),
);

// ── Parsing ───────────────────────────────────────────────────
/** "HH:MM" → minutes from midnight, or null. Accepts 24:00 as end-of-day. */
function parseTime(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** Parse a day selector like "Mo-Fr", "Mo,We,Fr", "Sa" → day indices, or null. */
function parseDays(sel: string): number[] | null {
  const out: number[] = [];
  for (const part of sel.split(",")) {
    const range = part.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/);
    if (range) {
      let i = DAY_INDEX[range[1]];
      const end = DAY_INDEX[range[2]];
      // Wrap-around ranges (e.g. Fr-Mo) are valid in OSM.
      for (let n = 0; n < 7; n++) {
        out.push(i);
        if (i === end) break;
        i = (i + 1) % 7;
      }
    } else if (part in DAY_INDEX) {
      out.push(DAY_INDEX[part]);
    } else {
      return null; // unknown day token (PH, SH, week nums, …) → give up
    }
  }
  return out;
}

/**
 * Parse an OSM opening_hours string into a weekly table, or null if any part
 * is outside our supported subset (so callers surface nothing rather than a
 * guess). Supported: `24/7`; `;`-separated rules; each rule an optional day
 * selector + comma-separated `HH:MM-HH:MM` ranges, or `off`/`closed`.
 */
export function parseOpeningHours(raw: string): WeekTable | null {
  const s = raw.trim();
  if (!s) return null;
  const week: WeekTable = [[], [], [], [], [], [], []];

  if (/^24\s*\/\s*7$/.test(s)) {
    for (let d = 0; d < 7; d++) week[d] = [{ start: 0, end: 1440 }];
    return week;
  }

  // Reject constructs we don't model rather than misinterpret them.
  if (/sunrise|sunset|dawn|dusk|week\s|month|easter|:\s*"|\[|\d{4}/i.test(s)) {
    return null;
  }

  for (const ruleRaw of s.split(";")) {
    const rule = ruleRaw.trim();
    if (!rule) continue;

    // Split the leading day selector (if any) from the time part.
    const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|,|-)+)\s+(.+)$/);
    let days: number[];
    let timePart: string;
    if (m) {
      const parsed = parseDays(m[1]);
      if (!parsed) return null;
      days = parsed;
      timePart = m[2].trim();
    } else if (/^(Mo|Tu|We|Th|Fr|Sa|Su)/.test(rule)) {
      // Starts like a day token but didn't match the selector shape → unsupported.
      return null;
    } else {
      days = [0, 1, 2, 3, 4, 5, 6]; // time-only rule applies every day
      timePart = rule;
    }

    if (/^(off|closed)$/i.test(timePart)) {
      for (const d of days) week[d] = [];
      continue;
    }

    const intervals: Array<{ start: number; end: number }> = [];
    for (const rangeRaw of timePart.split(",")) {
      const range = rangeRaw.trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (!range) return null;
      const start = parseTime(range[1]);
      let end = parseTime(range[2]);
      if (start == null || end == null) return null;
      if (end === 0) end = 1440; // "…-00:00" = midnight close
      if (end <= start) end += 1440; // overnight
      intervals.push({ start, end });
    }
    for (const d of days) week[d] = intervals;
  }

  const hasAny = week.some((d) => d.length > 0);
  return hasAny ? week : null;
}

// ── Evaluation ────────────────────────────────────────────────
/** Singapore wall-clock parts for an instant (UTC+8, no DST). */
function sgParts(now: Date): { dayIdx: number; minutes: number } {
  const sg = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const jsDay = sg.getUTCDay(); // 0 = Sun
  const dayIdx = (jsDay + 6) % 7; // → 0 = Mon
  return { dayIdx, minutes: sg.getUTCHours() * 60 + sg.getUTCMinutes() };
}

function fmtTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "am" : "pm";
  h = h % 12;
  if (h === 0) h = 12;
  return min === 0 ? `${h} ${ampm}` : `${h}:${String(min).padStart(2, "0")} ${ampm}`;
}

function dayLabel(intervals: DayIntervals): string {
  if (intervals.length === 0) return "Closed";
  if (intervals.length === 1 && intervals[0].start === 0 && intervals[0].end >= 1440) {
    return "24 hours";
  }
  return intervals
    .map((iv) => `${fmtTime(iv.start)} – ${fmtTime(iv.end)}`)
    .join(", ");
}

/** True when the whole week is one continuous 24h open. */
function isAlwaysOpen(week: WeekTable): boolean {
  return week.every(
    (d) => d.length === 1 && d[0].start === 0 && d[0].end >= 1440,
  );
}

/** Evaluate a parsed table at `now` (default: current time) → OpeningInfo. */
export function evaluateOpeningHours(
  raw: string,
  week: WeekTable,
  now: Date = new Date(),
): OpeningInfo {
  const { dayIdx, minutes } = sgParts(now);
  const alwaysOpen = isAlwaysOpen(week);

  // Weekly breakdown, ordered from today onward.
  const weekOut = Array.from({ length: 7 }, (_, i) => {
    const d = (dayIdx + i) % 7;
    return { day: DAY_LABEL[d], label: dayLabel(week[d]) };
  });

  const todayLabel = dayLabel(week[dayIdx]);

  if (alwaysOpen) {
    return {
      raw,
      openNow: true,
      status: "Open 24 hours",
      alwaysOpen: true,
      todayLabel: "24 hours",
      week: weekOut,
    };
  }

  // Open now? Check today's intervals, plus yesterday's overnight spillover.
  let closesAt: number | null = null;
  for (const iv of week[dayIdx]) {
    if (minutes >= iv.start && minutes < iv.end) {
      closesAt = iv.end;
      break;
    }
  }
  if (closesAt == null) {
    const prev = week[(dayIdx + 6) % 7];
    for (const iv of prev) {
      if (iv.end > 1440 && minutes < iv.end - 1440) {
        closesAt = iv.end - 1440;
        break;
      }
    }
  }

  if (closesAt != null) {
    return {
      raw,
      openNow: true,
      status: `Open · closes ${fmtTime(closesAt)}`,
      alwaysOpen: false,
      todayLabel,
      week: weekOut,
    };
  }

  // Closed now — find the next opening within a week.
  for (let ahead = 0; ahead < 8; ahead++) {
    const d = (dayIdx + ahead) % 7;
    for (const iv of week[d]) {
      if (ahead === 0 && iv.start <= minutes) continue;
      const when =
        ahead === 0
          ? `opens ${fmtTime(iv.start)}`
          : ahead === 1
            ? `opens tomorrow ${fmtTime(iv.start)}`
            : `opens ${DAY_LABEL[d]} ${fmtTime(iv.start)}`;
      return {
        raw,
        openNow: false,
        status: `Closed · ${when}`,
        alwaysOpen: false,
        todayLabel,
        week: weekOut,
      };
    }
  }

  return {
    raw,
    openNow: false,
    status: "Closed",
    alwaysOpen: false,
    todayLabel,
    week: weekOut,
  };
}

/** Parse + evaluate in one step. Returns null when the string is unsupported. */
export function readOpeningHours(
  raw: string | undefined | null,
  now?: Date,
): OpeningInfo | null {
  if (!raw) return null;
  const week = parseOpeningHours(raw);
  if (!week) return null;
  return evaluateOpeningHours(raw, week, now);
}

// ── Name matching ─────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the", "pte", "ltd", "llp", "co", "and", "of", "at", "singapore",
  "mrt", "station", "mall", "centre", "center", "shopping",
]);

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

/** Confident name match: containment or ≥50% token overlap of the smaller set. */
export function nameMatches(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

// ── Overpass area index ───────────────────────────────────────
export interface OsmPlace {
  name: string;
  lat: number;
  lng: number;
  openingHours: string;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CELL = 0.02; // ~2.2 km grid cell
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const cellCache = new Map<string, { at: number; places: OsmPlace[] }>();
const inFlight = new Map<string, Promise<OsmPlace[]>>();

const cellKey = (p: LatLng) =>
  `${Math.floor(p.lat / CELL)}:${Math.floor(p.lng / CELL)}`;

async function fetchCell(p: LatLng): Promise<OsmPlace[]> {
  const latC = Math.floor(p.lat / CELL) * CELL;
  const lngC = Math.floor(p.lng / CELL) * CELL;
  const bbox = `${latC.toFixed(3)},${lngC.toFixed(3)},${(latC + CELL).toFixed(3)},${(lngC + CELL).toFixed(3)}`;
  // Named nodes/ways carrying opening_hours that are shops/eateries/amenities.
  const q = `[out:json][timeout:25];(nwr["opening_hours"]["name"]["shop"](${bbox});nwr["opening_hours"]["name"]["amenity"](${bbox});nwr["opening_hours"]["name"]["leisure"](${bbox});nwr["opening_hours"]["name"]["tourism"](${bbox}););out center tags;`;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "RippleTransit/1.0 (github.com/Wongjon1994/Ripple-Transit)",
    },
    body: "data=" + encodeURIComponent(q),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Overpass opening_hours failed: ${res.status}`);
  const data = (await res.json()) as {
    elements?: Array<{
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };
  const places: OsmPlace[] = [];
  for (const el of data.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    const oh = el.tags?.opening_hours;
    if (lat == null || lng == null || !name || !oh) continue;
    places.push({ name, lat, lng, openingHours: oh });
  }
  return places;
}

/** OSM places-with-hours for the cell around a point (cached, degrade to []). */
export async function osmPlacesNear(p: LatLng): Promise<OsmPlace[]> {
  const key = cellKey(p);
  const hit = cellCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.places;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchCell(p)
      .then((places) => {
        cellCache.set(key, { at: Date.now(), places });
        return places;
      })
      .catch(() => cellCache.get(key)?.places ?? [])
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** Nearest name-matching OSM place within `maxDistM`, or null. */
export function matchPlace(
  poi: { name: string; point: LatLng },
  places: OsmPlace[],
  maxDistM = 120,
): OsmPlace | null {
  let best: { place: OsmPlace; dist: number } | null = null;
  for (const pl of places) {
    if (!nameMatches(poi.name, pl.name)) continue;
    const dist = haversineMeters(poi.point, { lat: pl.lat, lng: pl.lng });
    if (dist > maxDistM) continue;
    if (!best || dist < best.dist) best = { place: pl, dist };
  }
  return best?.place ?? null;
}

/**
 * Find the opening hours for a named POI: nearest OSM place within `maxDistM`
 * whose name matches, parsed + evaluated. Null when no confident match.
 */
export function matchOpeningHours(
  poi: { name: string; point: LatLng },
  places: OsmPlace[],
  now?: Date,
  maxDistM = 120,
): OpeningInfo | null {
  const place = matchPlace(poi, places, maxDistM);
  return place ? readOpeningHours(place.openingHours, now) : null;
}

/** Convenience: fetch the area index and match one POI. */
export async function openingHoursFor(
  poi: { name: string; point: LatLng },
  now?: Date,
): Promise<OpeningInfo | null> {
  const places = await osmPlacesNear(poi.point).catch(() => []);
  return matchOpeningHours(poi, places, now);
}

/** The raw OSM opening_hours string for a POI (to evaluate at other times,
 *  e.g. a future arrival), or null when no confident match. */
export async function rawHoursFor(
  poi: { name: string; point: LatLng },
): Promise<string | null> {
  const places = await osmPlacesNear(poi.point).catch(() => []);
  return matchPlace(poi, places)?.openingHours ?? null;
}
