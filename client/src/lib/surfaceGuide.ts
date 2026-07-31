import type { LatLng, RouteSurfaceClass, RouteSurfaceSpan } from "@shared/types.js";
import { haversineMeters } from "./utils.js";

/**
 * Live surface awareness for a walk/cycle leg. The route's `surface` spans
 * (consecutive pcn / shelter / plain runs from classifyRoute) are turned into a
 * distance timeline; given the current GPS position we say which surface you're
 * on and how far to the next change — the raw material for the rain-gated
 * "covered for the next 180 m" walk card and the "joining the connector in
 * 100 m" cycle card. Pure + unit-tested (the live view can't be seen in the
 * sandbox), so the geometry is verified even though the map isn't.
 */

/** Decode an encoded polyline (precision 5) into points. */
function decode(str: string): LatLng[] {
  let i = 0,
    lat = 0,
    lng = 0;
  const pts: LatLng[] = [];
  while (i < str.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

export interface SurfaceTimeline {
  pts: LatLng[]; // the whole route, in order (spans concatenated)
  cum: number[]; // cumulative metres at each point (len = pts.length)
  segClass: RouteSurfaceClass[]; // surface of segment i→i+1 (len = pts.length-1)
  total: number; // route length, metres
}

/**
 * Concatenate the surface spans into one distance-tagged route. Spans share
 * their boundary point with the next run (classifyRoute keeps the drawn line
 * continuous), so joins produce a harmless zero-length segment.
 */
export function buildSurfaceTimeline(
  spans: RouteSurfaceSpan[] | undefined,
): SurfaceTimeline | null {
  if (!spans || spans.length === 0) return null;
  const pts: LatLng[] = [];
  const segClass: RouteSurfaceClass[] = [];
  for (const span of spans) {
    const sp = decode(span.polyline);
    for (let i = 0; i < sp.length; i++) {
      if (pts.length > 0) segClass.push(span.surfaceClass);
      pts.push(sp[i]);
    }
  }
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(pts[i - 1], pts[i]));
  }
  return { pts, cum, segClass, total: cum[cum.length - 1] };
}

/** Project `position` onto the timeline: nearest segment, arc-length `s`, and
 *  how far off the line you are (equirectangular — fine at street scale). */
function project(
  position: LatLng,
  tl: SurfaceTimeline,
): { seg: number; s: number; offM: number } {
  const R = 6371000;
  const rad = Math.PI / 180;
  const latRef = position.lat * rad;
  const xy = (p: LatLng): [number, number] => [
    (p.lng - position.lng) * rad * Math.cos(latRef) * R,
    (p.lat - position.lat) * rad * R,
  ];
  let best = { d: Infinity, seg: 0, t: 0 };
  for (let i = 1; i < tl.pts.length; i++) {
    const [ax, ay] = xy(tl.pts[i - 1]);
    const [bx, by] = xy(tl.pts[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, seg: i - 1, t };
  }
  const segLen = tl.cum[best.seg + 1] - tl.cum[best.seg];
  return { seg: best.seg, s: tl.cum[best.seg] + best.t * segLen, offM: best.d };
}

export interface SurfaceGuide {
  currentClass: RouteSurfaceClass;
  /** True when the projection is far from the route (guidance is unreliable). */
  offRoute: boolean;
  /** Metres of the CURRENT surface run still ahead of you. */
  currentRunAheadM: number;
  /** Whether that current run continues to the end of the route. */
  currentRunToEnd: boolean;
  /** Distance to the start of the next sheltered run (m), or null when you're
   *  already sheltered or there is no more cover ahead. */
  toShelterM: number | null;
  /** The next surface change ahead of you (what you'll be on, and how far). */
  nextChange: {
    fromClass: RouteSurfaceClass;
    toClass: RouteSurfaceClass;
    distanceM: number;
  } | null;
}

const OFF_ROUTE_M = 40; // beyond this the projection isn't trustworthy

/** Where am I on the surface timeline, and what's ahead. `null` when there's no
 *  usable timeline. Set `offRoute` (not null) when the fix is far off the line
 *  so callers can suppress guidance without losing the current class. */
export function surfaceGuide(
  position: LatLng,
  spans: RouteSurfaceSpan[] | undefined,
): SurfaceGuide | null {
  const tl = buildSurfaceTimeline(spans);
  if (!tl) return null;
  const { seg, s, offM } = project(position, tl);
  const currentClass = tl.segClass[Math.min(seg, tl.segClass.length - 1)];

  // Walk forward from the current segment to the first class change.
  let changeAt: number | null = null;
  let toClass: RouteSurfaceClass | null = null;
  for (let i = seg + 1; i < tl.segClass.length; i++) {
    if (tl.segClass[i] !== currentClass) {
      changeAt = tl.cum[i]; // boundary is the start point of segment i
      toClass = tl.segClass[i];
      break;
    }
  }
  const currentRunAheadM =
    changeAt != null ? Math.max(0, changeAt - s) : Math.max(0, tl.total - s);

  // Distance to the next sheltered run (only meaningful when not already one).
  let toShelterM: number | null = null;
  if (currentClass !== "shelter") {
    for (let i = seg; i < tl.segClass.length; i++) {
      if (tl.segClass[i] === "shelter") {
        toShelterM = Math.max(0, tl.cum[i] - s);
        break;
      }
    }
  }

  return {
    currentClass,
    offRoute: offM > OFF_ROUTE_M,
    currentRunAheadM,
    currentRunToEnd: changeAt == null,
    toShelterM,
    nextChange:
      changeAt != null && toClass != null
        ? { fromClass: currentClass, toClass, distanceM: Math.max(0, changeAt - s) }
        : null,
  };
}
