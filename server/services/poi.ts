/**
 * "Nearest ___" POI layer (Phase 15).
 *
 * Static categories load from data.gov.sg GeoJSON (24h single-flight cache);
 * ATM comes from HERE Discover with a per-cell hourly cache to protect the
 * monthly budget. Geometry helpers are shared with the active-mobility layer.
 */
import {
  fetchDataset,
  dailyCache,
  type GeoJsonFeature,
  type GeoJsonGeometry,
} from "./datagov.js";
import { hereDiscover } from "./here.js";
import {
  planarMeters,
  pointToSegmentMeters,
  type Pt,
} from "./activeNetwork.js";

export type PoiCategoryId =
  | "dining"
  | "clinic"
  | "supermarket"
  | "park"
  | "library"
  | "sports"
  | "atm"
  | "attraction";

export interface Poi {
  id: string;
  name: string;
  address?: string;
  point: Pt;
  /** Result type tag, e.g. "Hawker centre" / "Restaurant" (dining tiers). */
  tag?: string;
}

interface CategoryDef {
  id: PoiCategoryId;
  label: string;
  source:
    | { kind: "datagov"; datasetId: string }
    | { kind: "here"; query: string }
    | { kind: "dining" }; // merged: hawker GeoJSON (Tier A) + HERE outlets (Tier B)
  /** Honest-estimate caveat surfaced with every result of this category. */
  disclaimer?: string;
  /** Property / Description-table keys to try for the display name. */
  nameKeys: string[];
  addressKeys?: string[];
}

export const POI_CATEGORIES: Record<PoiCategoryId, CategoryDef> = {
  dining: {
    id: "dining",
    label: "Dining",
    source: { kind: "dining" },
    disclaimer:
      "Hygiene grades shown where NEA records match — hours not tracked.",
    nameKeys: [],
  },
  clinic: {
    id: "clinic",
    label: "Clinic",
    source: { kind: "datagov", datasetId: "d_548c33ea2d99e29ec63a7cc9edcccedc" },
    disclaimer:
      "Hours unverified — call ahead before heading down; we never claim “open now”.",
    nameKeys: ["HCI_NAME", "NAME"],
    addressKeys: ["ADDRESS", "BLK_HSE_NO", "STREET_NAME"],
  },
  supermarket: {
    // No open GeoJSON with coordinates exists (the NEA licence list is
    // address-only) — HERE Discover covers it and carries brand names, which
    // the Preferences brand filter needs anyway.
    id: "supermarket",
    label: "Supermarket",
    source: { kind: "here", query: "supermarket" },
    nameKeys: [],
  },
  park: {
    id: "park",
    label: "Park",
    source: { kind: "datagov", datasetId: "d_0542d48f0991541706b58059381a6eca" },
    nameKeys: ["NAME"],
  },
  library: {
    id: "library",
    label: "Library",
    source: { kind: "datagov", datasetId: "d_27b8dae65d9ca1539e14d09578b17cbf" },
    nameKeys: ["NAME", "BUILDINGNAME"],
    addressKeys: ["ADDRESS", "ADDRESSSTREETNAME"],
  },
  sports: {
    id: "sports",
    label: "Public sports facility",
    source: { kind: "datagov", datasetId: "d_9b87bab59d036a60fad2a91530e10773" },
    disclaimer: "Public (SportSG) facilities only — commercial gyms not covered.",
    nameKeys: ["VENUE", "NAME", "FACILITY_NAME"],
    addressKeys: ["ADDRESSSTREETNAME", "ADDRESS"],
  },
  atm: {
    id: "atm",
    label: "ATM",
    source: { kind: "here", query: "atm" },
    nameKeys: [],
  },
  attraction: {
    id: "attraction",
    label: "Attraction",
    source: { kind: "datagov", datasetId: "d_0f2f47515425404e6c9d2a040dd87354" },
    nameKeys: ["PAGETITLE", "NAME", "Name"],
    addressKeys: ["ADDRESS", "ADDRESSSTREETNAME"],
  },
};

// ── Description-HTML table parsing ────────────────────────────
// Many data.gov.sg GeoJSONs bury real attributes in a `Description` property
// holding an HTML table: <th>NAME</th> <td>Tiong Bahru Market</td> …

export function parseDescriptionTable(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<th[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out[m[1].toUpperCase()] = decodeEntities(m[2]);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function titleCase(s: string): string {
  // Dataset names are often ALL CAPS; make them readable (keep acronyms).
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase())
    .replace(/\bMrt\b/g, "MRT")
    .replace(/\bLrt\b/g, "LRT")
    .replace(/\bCc\b/g, "CC");
}

function pickKey(
  props: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = props[k.toUpperCase()];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** Representative point for any geometry (Point, or centroid of a ring). */
export function geometryPoint(geom: GeoJsonGeometry | undefined): Pt | null {
  if (!geom) return null;
  const asPt = (c: unknown): Pt | null =>
    Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number"
      ? { lng: c[0] as number, lat: c[1] as number }
      : null;
  const ringCentroid = (ring: unknown): Pt | null => {
    if (!Array.isArray(ring) || ring.length === 0) return null;
    let lat = 0,
      lng = 0,
      n = 0;
    for (const c of ring) {
      const p = asPt(c);
      if (p) {
        lat += p.lat;
        lng += p.lng;
        n++;
      }
    }
    return n ? { lat: lat / n, lng: lng / n } : null;
  };
  switch (geom.type) {
    case "Point":
      return asPt(geom.coordinates);
    case "MultiPoint":
    case "LineString":
      return ringCentroid(geom.coordinates);
    case "Polygon":
    case "MultiLineString":
      return ringCentroid((geom.coordinates as unknown[])?.[0]);
    case "MultiPolygon":
      return ringCentroid(((geom.coordinates as unknown[][])?.[0] ?? [])[0]);
    case "GeometryCollection":
      for (const g of geom.geometries ?? []) {
        const p = geometryPoint(g);
        if (p) return p;
      }
      return null;
    default:
      return null;
  }
}

export function featureToPoi(
  f: GeoJsonFeature,
  idx: number,
  def: Pick<CategoryDef, "id" | "nameKeys" | "addressKeys">,
): Poi | null {
  const point = geometryPoint(f.geometry);
  if (!point) return null;
  // Merge direct properties with the Description-table attributes.
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.properties ?? {})) {
    if (typeof v === "string" || typeof v === "number") {
      props[k.toUpperCase()] = String(v);
    }
  }
  const desc = props["DESCRIPTION"];
  if (desc && desc.includes("<th")) {
    Object.assign(props, parseDescriptionTable(desc));
  }
  const rawName = pickKey(props, def.nameKeys) ?? pickKey(props, ["NAME"]);
  if (!rawName) return null;
  const address = def.addressKeys ? pickKey(props, def.addressKeys) : undefined;
  return {
    id: `${def.id}-${idx}`,
    name: titleCase(rawName),
    address: address ? titleCase(address) : undefined,
    point,
  };
}

// ── Dining (merged Tier A hawker venues + Tier B HERE outlets) ─

const HAWKER_DEF = {
  id: "dining" as const,
  nameKeys: ["NAME"],
  addressKeys: ["ADDRESS", "ADDRESS_MYENV", "ADDRESSSTREETNAME"],
};

const loadHawkerVenues = dailyCache(async (): Promise<Poi[]> => {
  const gj = await fetchDataset("d_4a086da0a5553be1d89383cd90d07ecd"); // NEA Hawker Centres
  const pois = (gj.features ?? [])
    .map((f, i) => featureToPoi(f, i, HAWKER_DEF))
    .filter((p): p is Poi => p !== null)
    .map((p) => ({ ...p, id: `hawker-${p.id}`, tag: "Hawker centre" }));
  if (pois.length === 0) throw new Error("hawker dataset parsed to 0 POIs");
  return pois;
});

/** HERE category name → the addendum's dining type tags. */
export function diningTag(category: string | undefined): string {
  if (!category) return "Eatery";
  if (/food court|hawker|canteen/i.test(category)) return "Food court";
  if (/coffee|café|cafe|tea/i.test(category)) return "Café";
  if (/restaurant/i.test(category)) return "Restaurant";
  if (/bakery|snack|takeaway|take out|fast food/i.test(category))
    return "Eatery";
  return "Eatery";
}

async function diningCandidatePool(point: Pt): Promise<Poi[]> {
  const [hawkers, outlets] = await Promise.all([
    loadHawkerVenues().catch(() => [] as Poi[]),
    hereDiningOutlets(point),
  ]);
  return [...hawkers, ...outlets];
}

async function hereDiningOutlets(point: Pt): Promise<Poi[]> {
  const key = `dining:${Math.floor(point.lat / HERE_CELL_DEG)}:${Math.floor(point.lng / HERE_CELL_DEG)}`;
  const hit = hereCellCache.get(key);
  if (hit && Date.now() - hit.at < HERE_TTL_MS) return hit.pois;
  const places = await hereDiscover("food", point, 15).catch(() => []);
  const pois = places.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    point: { lat: p.lat, lng: p.lng },
    tag: diningTag(p.category),
  }));
  hereCellCache.set(key, { at: Date.now(), pois });
  return pois;
}

// ── Category loading ──────────────────────────────────────────

const loaders = new Map<PoiCategoryId, () => Promise<Poi[]>>();

function loaderFor(cat: PoiCategoryId): () => Promise<Poi[]> {
  let l = loaders.get(cat);
  if (!l) {
    const def = POI_CATEGORIES[cat];
    if (def.source.kind !== "datagov") {
      throw new Error(`${cat} is not a static dataset category`);
    }
    const datasetId = def.source.datasetId;
    l = dailyCache(async () => {
      const gj = await fetchDataset(datasetId);
      const pois = (gj.features ?? [])
        .map((f, i) => featureToPoi(f, i, def))
        .filter((p): p is Poi => p !== null);
      if (pois.length === 0) throw new Error(`${cat}: dataset parsed to 0 POIs`);
      return pois;
    });
    loaders.set(cat, l);
  }
  return l;
}

/** All POIs for a static category (rejects for HERE-backed categories). */
export async function loadCategory(cat: PoiCategoryId): Promise<Poi[]> {
  return loaderFor(cat)();
}

// ── Lookups ───────────────────────────────────────────────────

/** ~550 m cells for the HERE per-cell budget cache. */
const HERE_CELL_DEG = 0.005;
const HERE_TTL_MS = 60 * 60 * 1000;
const hereCellCache = new Map<string, { at: number; pois: Poi[] }>();

async function hereCandidates(cat: PoiCategoryId, point: Pt): Promise<Poi[]> {
  const def = POI_CATEGORIES[cat];
  if (def.source.kind !== "here") return [];
  const key = `${cat}:${Math.floor(point.lat / HERE_CELL_DEG)}:${Math.floor(point.lng / HERE_CELL_DEG)}`;
  const hit = hereCellCache.get(key);
  if (hit && Date.now() - hit.at < HERE_TTL_MS) return hit.pois;
  const places = await hereDiscover(def.source.query, point, 10);
  const pois = places.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    point: { lat: p.lat, lng: p.lng },
  }));
  hereCellCache.set(key, { at: Date.now(), pois });
  return pois;
}

/** The full candidate pool for a category, anchored near a point. */
async function poolFor(cat: PoiCategoryId, near: Pt): Promise<Poi[]> {
  const src = POI_CATEGORIES[cat].source;
  if (src.kind === "dining") return diningCandidatePool(near);
  if (src.kind === "here") return hereCandidates(cat, near);
  return loadCategory(cat);
}

/** Crow-flies shortlist around a point (real routing happens on top of this). */
export async function nearestCandidates(
  cat: PoiCategoryId,
  point: Pt,
  n: number,
): Promise<Array<Poi & { crowMeters: number }>> {
  const pois = await poolFor(cat, point);
  return pois
    .map((p) => ({ ...p, crowMeters: Math.round(planarMeters(point, p.point)) }))
    .sort((a, b) => a.crowMeters - b.crowMeters)
    .slice(0, n);
}

/**
 * Candidates within `bufferM` of a route's real leg geometry ("Along the
 * way"): bbox prefilter, then exact min point-to-segment distance.
 */
export async function candidatesNearPath(
  cat: PoiCategoryId,
  path: Pt[],
  bufferM: number,
  max: number,
): Promise<Array<Poi & { lineMeters: number }>> {
  if (path.length < 2) return [];
  const pois = await poolFor(cat, path[Math.floor(path.length / 2)]);

  // Bounding box of the path, padded by the buffer.
  const padLat = bufferM / 111_320;
  const padLng = padLat / Math.cos((1.35 * Math.PI) / 180);
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of path) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const out: Array<Poi & { lineMeters: number }> = [];
  for (const poi of pois) {
    const { lat, lng } = poi.point;
    if (
      lat < minLat - padLat ||
      lat > maxLat + padLat ||
      lng < minLng - padLng ||
      lng > maxLng + padLng
    )
      continue;
    let best = Infinity;
    for (let i = 1; i < path.length && best > bufferM * 0.1; i++) {
      const d = pointToSegmentMeters(poi.point, path[i - 1], path[i]);
      if (d < best) best = d;
    }
    if (best <= bufferM) out.push({ ...poi, lineMeters: Math.round(best) });
  }
  return out.sort((a, b) => a.lineMeters - b.lineMeters).slice(0, max);
}

/** Case-insensitive name-contains brand filter (Preferences). Empty = any. */
export function brandFilter<T extends { name: string }>(
  pois: T[],
  brands: string[] | undefined,
): T[] {
  if (!brands || brands.length === 0) return pois;
  const needles = brands.map((b) => b.toLowerCase()).filter(Boolean);
  if (needles.length === 0) return pois;
  const hits = pois.filter((p) =>
    needles.some((b) => p.name.toLowerCase().includes(b)),
  );
  // If the filter empties the list entirely, fall back to unfiltered rather
  // than a dead end (Decision 5's "coherent fallback").
  return hits.length > 0 ? hits : pois;
}

// ── MRT stations (for the Nearest-MRT utility) ────────────────

export interface MrtStationPoi {
  name: string; // e.g. "Tiong Bahru MRT Station"
  exits: Pt[];
}

const loadMrtStations = dailyCache(async (): Promise<MrtStationPoi[]> => {
  const gj = await fetchDataset("d_b39d3a0871985372d7e1637193335da5"); // LTA MRT Station Exit
  const byStation = new Map<string, Pt[]>();
  (gj.features ?? []).forEach((f, i) => {
    const poi = featureToPoi(f, i, {
      id: "attraction", // unused for id purposes here
      nameKeys: ["STATION_NA", "STATION_NAME", "NAME"],
    });
    if (!poi) return;
    const key = poi.name;
    const arr = byStation.get(key);
    if (arr) arr.push(poi.point);
    else byStation.set(key, [poi.point]);
  });
  if (byStation.size === 0) throw new Error("MRT exits parsed to 0 stations");
  return [...byStation.entries()].map(([name, exits]) => ({ name, exits }));
});

/** Nearest stations by crow-flies to their closest exit. */
export async function nearestMrtStations(
  point: Pt,
  n: number,
): Promise<Array<{ name: string; nearestExit: Pt; crowMeters: number }>> {
  const stations = await loadMrtStations();
  return stations
    .map((s) => {
      let best = s.exits[0];
      let bestD = Infinity;
      for (const e of s.exits) {
        const d = planarMeters(point, e);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return { name: s.name, nearestExit: best, crowMeters: Math.round(bestD) };
    })
    .sort((a, b) => a.crowMeters - b.crowMeters)
    .slice(0, n);
}
