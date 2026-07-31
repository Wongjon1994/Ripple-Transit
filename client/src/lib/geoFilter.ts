import type { LatLng } from "@shared/types.js";
import { haversineMeters } from "./utils.js";

/** One raw device fix fed through the filter. */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number; // metres (68% confidence radius from the Geolocation API)
  t: number; // epoch ms
}

/** Carried between fixes — the last accepted raw fix + the smoothed output. */
export interface GeoFilterState {
  smoothed: LatLng | null;
  last: GeoFix | null;
}

export const EMPTY_GEO_FILTER: GeoFilterState = { smoothed: null, last: null };

// Fixes fuzzier than this are dropped once we already have a lock (urban GPS
// multipath produces the odd 100 m+ fix that would teleport the dot).
const MAX_ACCURACY_M = 65;
// At or under this radius we fully trust the fix (snap the smoother to it).
const GOOD_ACCURACY_M = 12;
// Faster than this between two fixes implies a bad fix, not real motion
// (~108 km/h — well above any walk/cycle/bus nav we drive the dot for).
const MAX_SPEED_MPS = 30;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Feed one raw fix through the filter and get back the position to SHOW.
 *
 * Three defences against the jumpy dot: (1) an accuracy gate drops very fuzzy
 * fixes once we have a lock; (2) outlier rejection drops a fix that implies an
 * impossible speed (multipath in a street canyon); (3) accuracy-weighted
 * exponential smoothing eases the dot toward each fix — snapping to precise
 * ones, barely nudging for fuzzy ones — so it glides instead of jittering.
 *
 * Pure: returns the next state + the position to render (the previous smoothed
 * position when a fix is rejected, so the dot holds rather than lurches).
 */
export function stepGeoFilter(
  state: GeoFilterState,
  fix: GeoFix,
): { state: GeoFilterState; position: LatLng } {
  // First fix: accept as-is (nothing to smooth against yet).
  if (!state.last || !state.smoothed) {
    const smoothed = { lat: fix.lat, lng: fix.lng };
    return { state: { smoothed, last: fix }, position: smoothed };
  }

  const from = { lat: fix.lat, lng: fix.lng };

  // (1) Accuracy gate — ignore a fuzzy fix that isn't sharper than what we hold.
  if (fix.accuracy > MAX_ACCURACY_M && fix.accuracy >= state.last.accuracy) {
    return { state, position: state.smoothed };
  }

  // (2) Outlier rejection — an implausible jump on a non-precise fix is noise.
  const dist = haversineMeters(state.last, from);
  const dt = Math.max(0.001, (fix.t - state.last.t) / 1000);
  if (dist / dt > MAX_SPEED_MPS && fix.accuracy > GOOD_ACCURACY_M) {
    return { state, position: state.smoothed };
  }

  // (3) Accuracy-weighted smoothing — precise fix ⇒ alpha→1 (snap); fuzzy ⇒
  // small alpha (ease). Floored so the dot never fully stalls on live movement.
  const alpha = Math.min(
    1,
    Math.max(0.35, GOOD_ACCURACY_M / Math.max(fix.accuracy, GOOD_ACCURACY_M)),
  );
  const smoothed = {
    lat: lerp(state.smoothed.lat, from.lat, alpha),
    lng: lerp(state.smoothed.lng, from.lng, alpha),
  };
  return { state: { smoothed, last: fix }, position: smoothed };
}
