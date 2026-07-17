/**
 * Active-mobility comfort network (Phase 14).
 *
 * Loads Singapore's Park Connector Loop (NParks) and Cycling Path Network (LTA)
 * from data.gov.sg, indexes the segments on a coarse grid, and scores how much
 * of a walk/cycle route runs on that network — the basis for the
 * "mostly park connectors" comfort label (vs crowded roadside paths).
 */

import { fetchDataset, type GeoJsonGeometry } from "./datagov.js";

// data.gov.sg public datasets (GeoJSON, WGS84)
const DATASETS = {
  pcn: "d_a69ef89737379f231d2ae93fd1c5707f", // NParks Park Connector Loop
  cyclingPaths: "d_8f468b25193f64be8a16fa7d8f60f553", // LTA Cycling Path Network
} as const;

/** ~0.002° ≈ 220 m cells; segments are registered in every cell they touch. */
const CELL_DEG = 0.002;
/** A route sample counts as "on network" within this distance of a segment. */
const NEAR_METERS = 30;
/** Route sampling interval along the path. */
const SAMPLE_METERS = 30;

const M_PER_DEG_LAT = 111_320;
/** Metres per degree of longitude at Singapore's latitude (~1.35°N). */
const M_PER_DEG_LNG = 111_320 * Math.cos((1.35 * Math.PI) / 180);

export type Pt = { lat: number; lng: number };
type Segment = [Pt, Pt];

// ── Geometry (pure, unit-tested) ──────────────────────────────

/** Decode an encoded polyline (precision 5) into lat/lng points. */
export function decodePolyline5(str: string): Pt[] {
  let index = 0,
    lat = 0,
    lng = 0;
  const out: Pt[] = [];
  while (index < str.length) {
    let result = 0,
      shift = 0,
      b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Encode lat/lng points as a polyline (precision 5) — inverse of decode. */
export function encodePolyline5(pts: Pt[]): string {
  let out = "";
  let prevLat = 0,
    prevLng = 0;
  const enc = (delta: number) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/** Fast local-planar distance (m) — accurate to well under 1% at SG scale. */
export function planarMeters(a: Pt, b: Pt): number {
  const dx = (b.lng - a.lng) * M_PER_DEG_LNG;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** The point on segment [a, b] closest to p. */
export function closestPointOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const ax = a.lng * M_PER_DEG_LNG,
    ay = a.lat * M_PER_DEG_LAT;
  const bx = b.lng * M_PER_DEG_LNG,
    by = b.lat * M_PER_DEG_LAT;
  const px = p.lng * M_PER_DEG_LNG,
    py = p.lat * M_PER_DEG_LAT;
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

/** Distance (m) from point p to the segment [a, b]. */
export function pointToSegmentMeters(p: Pt, a: Pt, b: Pt): number {
  const ax = a.lng * M_PER_DEG_LNG,
    ay = a.lat * M_PER_DEG_LAT;
  const bx = b.lng * M_PER_DEG_LNG,
    by = b.lat * M_PER_DEG_LAT;
  const px = p.lng * M_PER_DEG_LNG,
    py = p.lat * M_PER_DEG_LAT;
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Resample a path so consecutive points are at most `stepM` apart. */
export function samplePath(coords: Pt[], stepM = SAMPLE_METERS): Pt[] {
  if (coords.length <= 1) return [...coords];
  const out: Pt[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = planarMeters(a, b);
    const n = Math.floor(d / stepM);
    for (let k = 1; k <= n; k++) {
      const t = (k * stepM) / d;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
    out.push(b);
  }
  return out;
}

// ── Grid index over network segments ──────────────────────────

export class SegmentGrid {
  private cells = new Map<string, number[]>();
  private segments: Segment[] = [];

  private key(lat: number, lng: number): string {
    return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
  }

  addLine(coords: Pt[]): void {
    for (let i = 1; i < coords.length; i++) {
      const seg: Segment = [coords[i - 1], coords[i]];
      const id = this.segments.push(seg) - 1;
      // Register in every cell of the segment's bounding box (segments in
      // these datasets are short, so this stays tight).
      const minLat = Math.min(seg[0].lat, seg[1].lat);
      const maxLat = Math.max(seg[0].lat, seg[1].lat);
      const minLng = Math.min(seg[0].lng, seg[1].lng);
      const maxLng = Math.max(seg[0].lng, seg[1].lng);
      for (
        let la = Math.floor(minLat / CELL_DEG);
        la <= Math.floor(maxLat / CELL_DEG);
        la++
      ) {
        for (
          let lo = Math.floor(minLng / CELL_DEG);
          lo <= Math.floor(maxLng / CELL_DEG);
          lo++
        ) {
          const k = `${la}:${lo}`;
          const arr = this.cells.get(k);
          if (arr) arr.push(id);
          else this.cells.set(k, [id]);
        }
      }
    }
  }

  get size(): number {
    return this.segments.length;
  }

  /**
   * The nearest point on the network to `p`, within `maxM` — used to pick a
   * via-point that pulls a route onto the PCN / sheltered corridors. Searches
   * expanding cell rings so close hits return without scanning the island.
   */
  nearestPoint(p: Pt, maxM = 1500): Pt | null {
    const la = Math.floor(p.lat / CELL_DEG);
    const lo = Math.floor(p.lng / CELL_DEG);
    const maxRing = Math.ceil(maxM / (CELL_DEG * M_PER_DEG_LAT)) + 1;
    let best: Pt | null = null;
    let bestD = maxM;
    for (let ring = 0; ring <= maxRing; ring++) {
      // Once we have a hit, one extra ring guards against cell-boundary edge
      // cases; beyond that, farther rings can't beat it.
      if (best && ring > Math.ceil(bestD / (CELL_DEG * M_PER_DEG_LAT)) + 1)
        break;
      for (let i = -ring; i <= ring; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue; // ring shell only
          const ids = this.cells.get(`${la + i}:${lo + j}`);
          if (!ids) continue;
          for (const id of ids) {
            const [a, b] = this.segments[id];
            const d = pointToSegmentMeters(p, a, b);
            if (d < bestD) {
              bestD = d;
              best = closestPointOnSegment(p, a, b);
            }
          }
        }
      }
    }
    return best;
  }

  /** Is `p` within `nearM` of any indexed segment? (checks 3×3 cell block) */
  isNear(p: Pt, nearM = NEAR_METERS): boolean {
    const la = Math.floor(p.lat / CELL_DEG);
    const lo = Math.floor(p.lng / CELL_DEG);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const ids = this.cells.get(`${la + i}:${lo + j}`);
        if (!ids) continue;
        for (const id of ids) {
          const [a, b] = this.segments[id];
          if (pointToSegmentMeters(p, a, b) <= nearM) return true;
        }
      }
    }
    return false;
  }
}

// ── Coverage scoring ──────────────────────────────────────────

export interface Coverage {
  pct: number; // 0–100
  onMeters: number;
  totalMeters: number;
}

export function routeCoverage(coords: Pt[], grid: SegmentGrid): Coverage {
  const samples = samplePath(coords);
  if (samples.length === 0) return { pct: 0, onMeters: 0, totalMeters: 0 };
  let on = 0;
  for (const s of samples) if (grid.isNear(s)) on++;
  let total = 0;
  for (let i = 1; i < coords.length; i++)
    total += planarMeters(coords[i - 1], coords[i]);
  const pct = Math.round((on / samples.length) * 100);
  return {
    pct,
    onMeters: Math.round((total * on) / samples.length),
    totalMeters: Math.round(total),
  };
}

export function comfortLabel(
  pct: number,
  mode: "walk" | "cycle" = "cycle",
): {
  label: string;
  tone: "ok" | "neutral" | "warning";
} {
  if (pct >= 60)
    return { label: "Mostly park connectors & cycling paths", tone: "ok" };
  if (pct >= 30)
    return { label: "Mixed — some roadside stretches", tone: "neutral" };
  return {
    label:
      mode === "walk"
        ? "Mostly roadside — expect traffic alongside"
        : "Mostly roadside — ride with care",
    tone: "warning",
  };
}

// ── Honest-estimate helpers ───────────────────────────────────

/** kcal burned: brisk walk ≈ 55 kcal/km, easy cycling ≈ 28 kcal/km (~65 kg). */
export function activeKcal(mode: "walk" | "cycle", distanceM: number): number {
  const perKm = mode === "walk" ? 55 : 28;
  return Math.round((distanceM / 1000) * perKm);
}

// ── Network loading (data.gov.sg, cached 24 h) ────────────────

function addGeometry(
  grid: SegmentGrid,
  geom: GeoJsonGeometry | undefined,
): void {
  if (!geom) return;
  const toPts = (line: unknown): Pt[] =>
    Array.isArray(line)
      ? (line as [number, number][])
          .filter((c) => Array.isArray(c) && c.length >= 2)
          .map(([lng, lat]) => ({ lat, lng }))
      : [];
  switch (geom.type) {
    case "LineString":
      grid.addLine(toPts(geom.coordinates));
      break;
    case "MultiLineString":
    case "Polygon": // treat rings as lines (some datasets ship loops as polygons)
      for (const line of (geom.coordinates as unknown[]) ?? [])
        grid.addLine(toPts(line));
      break;
    case "MultiPolygon":
      for (const poly of (geom.coordinates as unknown[][]) ?? [])
        for (const ring of poly) grid.addLine(toPts(ring));
      break;
    case "GeometryCollection":
      for (const g of (geom.geometries as { type: string }[]) ?? [])
        addGeometry(grid, g);
      break;
  }
}

let gridCache: { at: number; grid: SegmentGrid } | null = null;
let inFlight: Promise<SegmentGrid> | null = null;
const GRID_TTL_MS = 24 * 60 * 60 * 1000;

async function buildNetwork(): Promise<SegmentGrid> {
  const grid = new SegmentGrid();
  const results = await Promise.allSettled([
    fetchDataset(DATASETS.pcn),
    fetchDataset(DATASETS.cyclingPaths),
  ]);
  let loaded = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const f of r.value.features ?? []) addGeometry(grid, f.geometry);
    loaded++;
  }
  if (loaded === 0 || grid.size === 0) {
    throw new Error("active network datasets unavailable");
  }
  gridCache = { at: Date.now(), grid };
  return grid;
}

export async function getActiveNetwork(): Promise<SegmentGrid> {
  if (gridCache && Date.now() - gridCache.at < GRID_TTL_MS) {
    return gridCache.grid;
  }
  // Single-flight: concurrent callers (walk + cycle scored in parallel) share
  // one download instead of racing duplicate multi-MB fetches.
  inFlight ??= buildNetwork().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ── Sheltered walkways (OSM via Overpass, cached 24 h) ────────
// No public covered-linkway dataset exists, but Singapore's sheltered
// walkways are well mapped in OSM (covered=yes ways + building passages).

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SG_BBOX = "1.20,103.59,1.48,104.10"; // south,west,north,east

let shelterCache: { at: number; grid: SegmentGrid } | null = null;
let shelterInFlight: Promise<SegmentGrid> | null = null;

async function buildShelterNetwork(): Promise<SegmentGrid> {
  const query = `[out:json][timeout:90];(way["covered"~"^(yes|arcade|colonnade)$"]["highway"](${SG_BBOX});way["tunnel"="building_passage"](${SG_BBOX}););out geom;`;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass returns 406 without an identifying User-Agent (usage policy).
      "User-Agent": "RippleTransit/1.0 (github.com/Wongjon1994/Ripple-Transit)",
    },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Overpass failed: ${res.status}`);
  const data = (await res.json()) as {
    elements?: Array<{
      type: string;
      geometry?: Array<{ lat: number; lon: number }>;
    }>;
  };
  const grid = new SegmentGrid();
  for (const el of data.elements ?? []) {
    if (el.type !== "way" || !el.geometry?.length) continue;
    grid.addLine(el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
  }
  if (grid.size === 0) throw new Error("no shelter ways returned");
  shelterCache = { at: Date.now(), grid };
  return grid;
}

/** Sheltered-walkway grid; null when Overpass is unavailable (degrade, don't block). */
export async function getShelterNetwork(): Promise<SegmentGrid | null> {
  if (shelterCache && Date.now() - shelterCache.at < GRID_TTL_MS) {
    return shelterCache.grid;
  }
  shelterInFlight ??= buildShelterNetwork().finally(() => {
    shelterInFlight = null;
  });
  return shelterInFlight.catch(() => null);
}
