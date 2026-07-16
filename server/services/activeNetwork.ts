/**
 * Active-mobility comfort network (Phase 14).
 *
 * Loads Singapore's Park Connector Loop (NParks) and Cycling Path Network (LTA)
 * from data.gov.sg, indexes the segments on a coarse grid, and scores how much
 * of a walk/cycle route runs on that network — the basis for the
 * "mostly park connectors" comfort label (vs crowded roadside paths).
 */

// data.gov.sg public datasets (GeoJSON, WGS84)
const DATASETS = {
  pcn: "d_a69ef89737379f231d2ae93fd1c5707f", // NParks Park Connector Loop
  cyclingPaths: "d_8f468b25193f64be8a16fa7d8f60f553", // LTA Cycling Path Network
} as const;

const POLL_URL = (id: string) =>
  `https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`;

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

/** Fast local-planar distance (m) — accurate to well under 1% at SG scale. */
export function planarMeters(a: Pt, b: Pt): number {
  const dx = (b.lng - a.lng) * M_PER_DEG_LNG;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
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

export function comfortLabel(pct: number): {
  label: string;
  tone: "ok" | "neutral" | "warning";
} {
  if (pct >= 60)
    return { label: "Mostly park connectors & cycling paths", tone: "ok" };
  if (pct >= 30)
    return { label: "Mixed — some roadside stretches", tone: "neutral" };
  return { label: "Mostly roadside — ride with care", tone: "warning" };
}

// ── Honest-estimate helpers ───────────────────────────────────

/** kcal burned: brisk walk ≈ 55 kcal/km, easy cycling ≈ 28 kcal/km (~65 kg). */
export function activeKcal(mode: "walk" | "cycle", distanceM: number): number {
  const perKm = mode === "walk" ? 55 : 28;
  return Math.round((distanceM / 1000) * perKm);
}

// ── Network loading (data.gov.sg, cached 24 h) ────────────────

interface GeoJson {
  type: string;
  features?: Array<{
    geometry?: {
      type: string;
      coordinates?: unknown;
      geometries?: Array<{ type: string; coordinates?: unknown }>;
    };
  }>;
}

function addGeometry(
  grid: SegmentGrid,
  geom: { type: string; coordinates?: unknown; geometries?: unknown } | undefined,
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

async function fetchDataset(id: string): Promise<GeoJson> {
  // poll-download returns a signed URL for the dataset file.
  const poll = await fetch(POLL_URL(id), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!poll.ok) throw new Error(`data.gov.sg poll failed: ${poll.status}`);
  const meta = (await poll.json()) as { data?: { url?: string } };
  const url = meta.data?.url;
  if (!url) throw new Error("data.gov.sg: no download url");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`dataset download failed: ${res.status}`);
  return (await res.json()) as GeoJson;
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
