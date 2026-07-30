import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapGL,
  Marker,
  Source,
  Layer,
  NavigationControl,
  type MapRef,
} from "react-map-gl/maplibre";
import type { Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Route,
  Navigation,
  Activity,
  CloudLightning,
  LocateFixed,
  Loader2,
} from "lucide-react";
import type { Itinerary, LatLng, RouteSurfaceSpan } from "@shared/types.js";
import { TRANSIT_COLORS } from "@shared/types.js";
import { cn, haversineMeters } from "../lib/utils.js";
import { useTheme } from "../lib/theme.js";
import { trpc } from "../lib/trpc.js";
import { useAuth } from "../lib/auth.js";
import { usePrefs } from "../lib/prefs.js";
import { weightsFor } from "@shared/prefMatch.js";
import { pulseSummary } from "../lib/pulseSummary.js";
import { PulsePanel } from "./PulsePanel.js";
import {
  NETWORK_LINES_GEOJSON,
  NETWORK_STATIONS_GEOJSON,
  STATION_COORDS,
  STATION_NAMES,
} from "../lib/mrtNetwork.js";

const SG_CENTER = { lng: 103.8198, lat: 1.3521 };
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;
const FIT_MAX_ZOOM = 16; // don't over-zoom short routes when fitting bounds

// CARTO free vector basemaps (keyless): light = positron, dark = dark-matter.
// Vector tiles let us tilt/pitch and extrude buildings for a 3D walk view.
const STYLE = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;

/** Decode an encoded polyline (precision 5) into [lng, lat] pairs (GeoJSON order). */
function decodePolyline(str: string): [number, number][] {
  let index = 0,
    lat = 0,
    lng = 0;
  const coords: [number, number][] = [];
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
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function legColor(type: string) {
  if (type === "bus") return TRANSIT_COLORS.bus;
  if (type === "mrt") return TRANSIT_COLORS.mrt;
  if (type === "cycle") return TRANSIT_COLORS.cycle;
  return TRANSIT_COLORS.walk;
}

function PinMarker({
  point,
  color,
  label,
}: {
  point: LatLng;
  color: string;
  label: string;
}) {
  return (
    <Marker longitude={point.lng} latitude={point.lat} anchor="bottom">
      <div
        style={{
          background: color,
          width: 20,
          height: 20,
          borderRadius: "50% 50% 50% 0",
          transform: "rotate(-45deg)",
          border: "2px solid white",
          boxShadow: "0 1px 4px rgba(0,0,0,.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            transform: "rotate(45deg)",
            color: "white",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {label}
        </span>
      </div>
    </Marker>
  );
}

/**
 * Add a 3D building-extrusion layer to CARTO's vector basemap so buildings rise
 * when the map is pitched (used for the walk navigation view). Best-effort:
 * only runs if the "carto" source with a building layer is present.
 */
function add3dBuildings(map: MaplibreMap, dark: boolean) {
  try {
    if (map.getLayer("ripple-buildings-3d")) return;
    if (!map.getSource("carto")) return;
    // Insert beneath the first symbol (label) layer so labels stay on top.
    const layers = map.getStyle().layers ?? [];
    const firstSymbol = layers.find(
      (l) => l.type === "symbol" && (l.layout as { "text-field"?: unknown })?.["text-field"],
    )?.id;
    map.addLayer(
      {
        id: "ripple-buildings-3d",
        source: "carto",
        "source-layer": "building",
        type: "fill-extrusion",
        minzoom: 14,
        paint: {
          // Height-shaded massing: taller floors read lighter, giving buildings
          // real depth instead of the flat grey slab they were in daylight.
          // Warm paper tones in light mode; cool slate at night. The vertical
          // gradient still darkens each face for solidity.
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "render_height"], 8],
            0,
            dark ? "#2f3644" : "#e3e1da",
            120,
            dark ? "#4a5568" : "#f3f1ec",
          ],
          "fill-extrusion-opacity": dark ? 0.9 : 0.82,
          "fill-extrusion-vertical-gradient": true,
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            16,
            ["coalesce", ["get", "render_height"], 8],
          ],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        },
      },
      firstSymbol,
    );
  } catch {
    /* basemap schema differs — skip 3D buildings */
  }
}

export function MapView({
  origin,
  destination,
  waypoints,
  pois,
  corridor = false,
  itinerary,
  livePosition,
  pitch = 0,
  bearing = 0,
  follow,
  followZoom = 18,
  fitPoints,
  viewToggle,
  liveJourney = false,
  bottomInset = 0,
  routeSurface,
}: {
  origin: LatLng | null;
  destination: LatLng | null;
  /** Intermediate multi-stop destinations, in visit order (numbered pins). */
  waypoints?: LatLng[];
  /** "Nearest ___" browse results (numbered brand-cyan pins). */
  pois?: { point: LatLng; name?: string }[];
  /** Highlight a corridor band around the route's real geometry. */
  corridor?: boolean;
  itinerary: Itinerary | null;
  livePosition?: LatLng | null;
  /** Tilt (deg) — non-zero drives the 3D walk view. */
  pitch?: number;
  /** Map bearing (deg) — heading to follow during navigation. */
  bearing?: number;
  /** When set, keep this point centered (navigation) instead of fitting bounds. */
  follow?: LatLng | null;
  followZoom?: number;
  /** Explicit bounds target — fit to these points instead of the default set
   *  (used by the live journey's current-leg / full-route camera). */
  fitPoints?: LatLng[] | null;
  /** Live-journey view toggle rendered in the control stack. */
  viewToggle?: { mode: "leg" | "route"; onChange: () => void };
  /** Focused live-navigation view: hide Pulse entirely and draw the route in a
   *  monochrome base so amber/red risk segments stand out. */
  liveJourney?: boolean;
  /** Height (px) obscured by the mobile bottom sheet, so the Pulse panel caps
   *  itself above it instead of being clipped. */
  bottomInset?: number;
  /** Walk/cycle route split into PCN / sheltered / plain runs — drawn as a
   *  colour-coded overlay so the map conveys surface quality (and the path
   *  shape, now that the card thumbnail is gone). */
  routeSurface?: RouteSurfaceSpan[] | null;
}) {
  const { theme } = useTheme();
  const mapRef = useRef<MapRef | null>(null);
  // Tap-friendly 3D toggle: MapLibre's compass only pitches via mouse-drag,
  // which touch devices can't do — so we offer an explicit 2D/3D button.
  const [is3d, setIs3d] = useState(false);
  // "You are here" on the home map (Google-style): a blue dot + a locate button.
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  // "Pulse" layer — the repurposed map toggle (Phase 16): the MRT/LRT network
  // plus live crowding, road traffic, and an approximate rain overlay. On by
  // default, off in the tilted walk navigation view where it would clutter.
  const [showNetwork, setShowNetwork] = useState(true);
  // Legend folds to a single "Pulse" chip so it never blocks the map.
  const [legendOpen, setLegendOpen] = useState(true);

  // Declutter (mobile): opening the planning sheet (bottomInset > 0) auto-folds
  // Pulse to its strip so the two panels don't fight for the small screen; the
  // layer stays live on the map and one tap re-expands it. Closing the sheet
  // restores the full panel. A manual toggle in between still wins until the
  // next open/close. Desktop (bottomInset === 0 — the sidebar sits beside the
  // map, no overlap) is unaffected. Keyed on the boolean so dragging the sheet
  // (which changes bottomInset numerically, not open/closed) never re-folds.
  const planningOpen = bottomInset > 0;
  const prevPlanningOpen = useRef(planningOpen);
  useEffect(() => {
    if (planningOpen !== prevPlanningOpen.current) {
      setLegendOpen(!planningOpen);
      prevPlanningOpen.current = planningOpen;
    }
  }, [planningOpen]);

  const pulse = trpc.pulse.overlay.useQuery(undefined, {
    // Off in the focused live-journey view — risks surface on the route path
    // and in the journey panel instead.
    enabled: showNetwork && !follow && !liveJourney,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Personalisation inputs for the dynamic Pulse panel: what the user cares
  // about (Flux weights) and where their saved places are (proximity callouts).
  const { user } = useAuth();
  const { prefs } = usePrefs();
  const savedPlaces = trpc.savedLocations.list.useQuery(undefined, {
    enabled: !!user && showNetwork && !follow,
    staleTime: 5 * 60_000,
  });

  // The dynamic summary — a "worst right now" headline, live tallies ordered by
  // preference, and proximity callouts. Recomputed only when live data moves.
  const summary = useMemo(() => {
    // The query is disabled in live navigation, but react-query still serves any
    // previously-cached overlay — so drop it explicitly, or the panel lingers.
    if (!pulse.data || liveJourney) return null;
    const congestion = pulse.data.congestion.map((c) => ({
      level: c.level,
      road: c.road,
      lat: (c.startLat + c.endLat) / 2,
      lng: (c.startLng + c.endLng) / 2,
    }));
    const crowd = pulse.data.crowd
      .filter((c) => STATION_COORDS[c.code])
      .map((c) => ({
        name: STATION_NAMES[c.code] ?? c.code,
        level: c.level,
        lng: STATION_COORDS[c.code][0],
        lat: STATION_COORDS[c.code][1],
      }));
    const places = (savedPlaces.data ?? [])
      .map((p) => ({ label: p.label, lat: Number(p.lat), lng: Number(p.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    // Resolve affected station codes → coords so the headline can frame them.
    const mrtDisruptions = pulse.data.mrtDisruptions.map((d) => ({
      ...d,
      stationPoints: d.stations
        .filter((code) => STATION_COORDS[code])
        .map((code) => ({
          lng: STATION_COORDS[code][0],
          lat: STATION_COORDS[code][1],
        })),
    }));
    return pulseSummary({
      congestion,
      crowd,
      incidents: pulse.data.traffic,
      rain: pulse.data.rain,
      floods: pulse.data.floods,
      mrtDisruptions,
      mrtPlanned: pulse.data.mrtPlanned,
      weather: pulse.data.weather,
      weights: weightsFor(prefs),
      places,
    });
  }, [pulse.data, savedPlaces.data, prefs, liveJourney]);

  // Tap the Pulse headline → frame the impacted points on the map.
  function focusPoints(points: { lat: number; lng: number }[]) {
    const map = mapRef.current?.getMap();
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.easeTo({
        center: [points[0].lng, points[0].lat],
        zoom: Math.max(map.getZoom(), 14),
        duration: 700,
      });
      return;
    }
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const p of points) {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, maxZoom: 15, duration: 700 },
    );
  }

  // Tapping a tally item cycles through its instances (a packed station, an
  // incident, a region of heavy traffic). Targets are sorted nearest-first from
  // the map centre once per fresh dataset, then a per-key cursor advances each
  // tap so successive clicks step through them.
  const cycleState = useRef(
    new Map<string, { at: number; order: LatLng[][]; cursor: number }>(),
  );
  function cycleFocus(key: string, targets: LatLng[][]) {
    const map = mapRef.current?.getMap();
    if (!map || targets.length === 0) return;
    const stamp = pulse.dataUpdatedAt;
    let st = cycleState.current.get(key);
    if (!st || st.at !== stamp) {
      const c = map.getCenter();
      const centroid = (t: LatLng[]) => ({
        lat: t.reduce((s, p) => s + p.lat, 0) / t.length,
        lng: t.reduce((s, p) => s + p.lng, 0) / t.length,
      });
      const order = [...targets].sort(
        (a, b) =>
          haversineMeters(c, centroid(a)) - haversineMeters(c, centroid(b)),
      );
      st = { at: stamp, order, cursor: 0 };
      cycleState.current.set(key, st);
    }
    const target = st.order[st.cursor % st.order.length];
    st.cursor += 1;
    focusPoints(target);
  }

  // Set of line prefixes with a live disruption — fade those lines and ring
  // their affected stations so the outage reads as distinct from crowd/traffic.
  const disruptedLines = useMemo(
    () => new Set((pulse.data?.mrtDisruptions ?? []).flatMap((d) => d.lines)),
    [pulse.data?.mrtDisruptions],
  );
  const affectedStationsGeoJSON = useMemo(() => {
    const codes = new Set(
      (pulse.data?.mrtDisruptions ?? []).flatMap((d) => d.stations),
    );
    return {
      type: "FeatureCollection" as const,
      features: [...codes]
        .filter((code) => STATION_COORDS[code])
        .map((code) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "Point" as const,
            coordinates: STATION_COORDS[code],
          },
        })),
    };
  }, [pulse.data?.mrtDisruptions]);

  // Rail lines with a `disrupted` flag, so a downed line can be greyed + faded
  // (it recedes — reads as "not running", not as faint colour).
  const networkLinesGeoJSON = useMemo(
    () => ({
      ...NETWORK_LINES_GEOJSON,
      features: NETWORK_LINES_GEOJSON.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          disrupted: disruptedLines.has(f.properties.prefix) ? 1 : 0,
        },
      })),
    }),
    [disruptedLines],
  );

  // Live crowd colours joined onto station coordinates. Only busy stations
  // arrive from the server now (low crowd is filtered out), so the palette is
  // amber/red only — Pulse shows problems, never the calm.
  const crowdGeoJSON = useMemo(() => {
    const CROWD: Record<string, string> = { m: "#f59e0b", h: "#ef4444" };
    return {
      type: "FeatureCollection" as const,
      features: (pulse.data?.crowd ?? [])
        .filter((c) => STATION_COORDS[c.code])
        .map((c) => ({
          type: "Feature" as const,
          properties: { color: CROWD[c.level], high: c.level === "h" ? 1 : 0 },
          geometry: {
            type: "Point" as const,
            coordinates: STATION_COORDS[c.code],
          },
        })),
    };
  }, [pulse.data?.crowd]);

  // Live road congestion as coloured lines (LTA speed bands). Each segment is a
  // short LineString; a blurred wide copy under a crisp line gives the faded
  // "heatmap" glow along the road.
  const congestionGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (pulse.data?.congestion ?? []).map((c) => ({
        type: "Feature" as const,
        properties: {
          color: c.level === "red" ? "#ef4444" : "#f59e0b",
          red: c.level === "red" ? 1 : 0,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [c.startLng, c.startLat],
            [c.endLng, c.endLat],
          ] as [number, number][],
        },
      })),
    }),
    [pulse.data?.congestion],
  );

  const trafficGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      // Severe incidents only — Pulse shows reds + rain, so minor (amber)
      // roadworks etc. are omitted from the map.
      features: (pulse.data?.traffic ?? [])
        .filter((t) => t.severe)
        .map((t) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "Point" as const,
            coordinates: [t.lng, t.lat] as [number, number],
          },
        })),
    }),
    [pulse.data?.traffic],
  );

  // Live rain (now) drawn solid; forecast rain (expected) drawn fainter, via a
  // `forecast` flag on each blob so the same layer renders both honestly.
  const rainGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: [
        ...(pulse.data?.rain ?? []).map((r) => ({
          type: "Feature" as const,
          properties: { heavy: r.intensity === "heavy" ? 1 : 0, forecast: 0 },
          geometry: {
            type: "Point" as const,
            coordinates: [r.lng, r.lat] as [number, number],
          },
        })),
        ...(pulse.data?.rainForecast ?? []).map((r) => ({
          type: "Feature" as const,
          properties: { heavy: r.intensity === "heavy" ? 1 : 0, forecast: 1 },
          geometry: {
            type: "Point" as const,
            coordinates: [r.lng, r.lat] as [number, number],
          },
        })),
      ],
    }),
    [pulse.data?.rain, pulse.data?.rainForecast],
  );

  function toggle3d() {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // Toggle off our own state (kept honest by the pitchend listener) rather
    // than the live pitch — mid-animation reads would double-toggle.
    const to3d = !is3d;
    map.easeTo({
      pitch: to3d ? 60 : 0,
      // Leaving 3D also squares the map back to north.
      bearing: to3d ? map.getBearing() : 0,
      duration: 500,
    });
    setIs3d(to3d);
  }

  const legLines = useMemo(
    () =>
      itinerary?.legs
        .map((leg) => ({
          type: leg.type,
          // A known live risk on this leg (traffic incident / MRT crowd) — used
          // to tint the segment amber in the focused live-journey view.
          risk: leg.trafficAlert ? "amber" : leg.crowd === "h" ? "amber" : null,
          coords: leg.polyline
            ? decodePolyline(leg.polyline)
            : ([
                [leg.startPoint.lng, leg.startPoint.lat],
                [leg.endPoint.lng, leg.endPoint.lat],
              ] as [number, number][]),
        }))
        .filter((l) => l.coords.length > 0) ?? [],
    [itinerary],
  );

  // Live navigation draws the whole route in one near-black (light) / near-white
  // (dark) base so amber/red risk segments read as meaningful; planning keeps
  // the per-mode colours.
  const routeBase = theme === "dark" ? "#e5e7eb" : "#1f2937";
  const routeGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: legLines.map((l) => ({
        type: "Feature" as const,
        properties: {
          legType: l.type,
          color: liveJourney
            ? (l.risk ?? routeBase)
            : legColor(l.type),
        },
        geometry: { type: "LineString" as const, coordinates: l.coords },
      })),
    }),
    [legLines, liveJourney, routeBase],
  );

  // Surface-coloured overlay for the active (walk/cycle) route: each PCN /
  // sheltered / plain run drawn in its own colour. Hidden in the monochrome
  // live-journey view.
  const surfaceGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (routeSurface ?? []).map((s) => ({
        type: "Feature" as const,
        properties: { surfaceClass: s.surfaceClass },
        geometry: {
          type: "LineString" as const,
          coordinates: decodePolyline(s.polyline),
        },
      })),
    }),
    [routeSurface],
  );
  const showSurface = !liveJourney && (routeSurface?.length ?? 0) > 0;

  const allPoints: [number, number][] = useMemo(
    () => [
      ...(origin ? ([[origin.lng, origin.lat]] as [number, number][]) : []),
      ...(destination
        ? ([[destination.lng, destination.lat]] as [number, number][])
        : []),
      ...(waypoints ?? []).map(
        (w) => [w.lng, w.lat] as [number, number],
      ),
      ...(pois ?? []).map((p) => [p.point.lng, p.point.lat] as [number, number]),
      ...legLines.flatMap((l) => l.coords),
    ],
    [origin, destination, waypoints, pois, legLines],
  );

  // Keep the latest sheet height for the fit padding without making the camera
  // refit every time the sheet is dragged — the effect reads this on a route
  // change, so a fresh route frames itself above the sheet (not behind it).
  const bottomInsetRef = useRef(bottomInset);
  bottomInsetRef.current = bottomInset;

  // Whether a route/pins are framed — checked async inside the geolocation
  // callback, so auto-locate only recenters on a blank map (never yanking the
  // camera off a route the user is looking at).
  const hasFramedRef = useRef(false);
  hasFramedRef.current = allPoints.length > 0;

  /** Get the device location: drop a "you are here" dot, and (only when the map
   *  isn't already framing a route) gently centre on it. `auto` skips the
   *  error toast — a silent no-op is right for the on-load attempt. */
  function locateMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLocation(p);
        setLocating(false);
        const map = mapRef.current?.getMap();
        if (map && !hasFramedRef.current) {
          map.easeTo({
            center: [p.lng, p.lat],
            zoom: Math.max(map.getZoom(), 15),
            duration: 700,
          });
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  // On load, centre on the user only if location is ALREADY granted — never
  // throw a permission prompt at a first-time visitor (the locate button is the
  // opt-in for that). The live-journey view runs its own GPS, so skip there.
  useEffect(() => {
    if (liveJourney) return;
    const perms = navigator.permissions;
    if (!perms || !navigator.geolocation) return;
    let cancelled = false;
    perms
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === "granted") locateMe();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJourney]);

  // Camera: follow a moving point during navigation; otherwise fit to the route.
  // A lone pin (e.g. "use my location" before a route) recenters gently — no
  // hard zoom-in (the old Leaflet behaviour that snapped to zoom 15).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (follow) {
      map.easeTo({
        center: [follow.lng, follow.lat],
        zoom: followZoom,
        pitch,
        bearing,
        duration: 700,
      });
      return;
    }

    map.easeTo({ pitch, bearing, duration: 400 });

    // An explicit fit target (journey current-leg / full-route camera) wins
    // over the default derived set.
    const fitSet: [number, number][] =
      fitPoints && fitPoints.length
        ? fitPoints.map((p) => [p.lng, p.lat] as [number, number])
        : allPoints;

    if (fitSet.length >= 2) {
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      for (const [lng, lat] of fitSet) {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
      // Pad the bottom by the sheet height so the whole route frames into the
      // VISIBLE map above the bottom sheet, not behind it. Capped so there's
      // always a usable band of map left to fit into.
      const containerH = map.getContainer().clientHeight;
      const bottomPad = Math.min(
        40 + bottomInsetRef.current,
        Math.max(40, containerH - 160),
      );
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 70, bottom: bottomPad, left: 40, right: 40 },
          maxZoom: FIT_MAX_ZOOM,
          duration: 600,
        },
      );
    } else if (fitSet.length === 1) {
      // A lone endpoint (populating From/To, or "use my location"): never zoom
      // in. Leave the map alone if the point is already on screen; otherwise
      // pan to it, capped at a neighbourhood zoom so it never snaps to street
      // level.
      const [lng, lat] = fitSet[0];
      if (!map.getBounds().contains([lng, lat])) {
        map.easeTo({
          center: [lng, lat],
          zoom: Math.min(map.getZoom(), 13),
          duration: 600,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPoints, fitPoints, follow, followZoom, pitch, bearing]);

  const isDark = theme === "dark";
  const handleLoad = (e: { target: MaplibreMap }) => {
    add3dBuildings(e.target, isDark);
    // Keep the 2D/3D button honest when pitch changes by gesture or camera
    // code (walk-follow tilts, two-finger drag on mobile, etc.).
    e.target.on("pitchend", () => setIs3d(e.target.getPitch() >= 20));
  };
  const handleStyleData = (e: { target: MaplibreMap }) =>
    add3dBuildings(e.target, isDark);

  return (
    <MapGL
      ref={mapRef}
      initialViewState={{
        longitude: SG_CENTER.lng,
        latitude: SG_CENTER.lat,
        zoom: DEFAULT_ZOOM,
      }}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      maxPitch={70}
      mapStyle={theme === "dark" ? STYLE.dark : STYLE.light}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      onLoad={handleLoad}
      onStyleData={handleStyleData}
    >
      <NavigationControl position="top-left" showCompass={false} />

      {/* Ambient rail-network overlay: every MRT/LRT line drawn faded beneath
          the live route, so the city's transit skeleton is always readable
          without overpowering the map. Hidden during walk navigation, and
          unmounted (not just visibility-toggled) when switched off so the
          toggle reliably clears it. */}
      {!follow && showNetwork && !liveJourney && (
        <>
          <Source id="mrt-network" type="geojson" data={networkLinesGeoJSON}>
            {/* Operational lines: solid, official colour. (line-dasharray can't
                be data-driven in MapLibre, so disrupted lines are a separate
                layer below rather than a case expression here.) */}
            <Layer
              id="mrt-network-lines"
              type="line"
              filter={["!=", ["get", "disrupted"], 1]}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ["get", "color"],
                "line-opacity": isDark ? 0.42 : 0.32,
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  1.4,
                  13,
                  2.6,
                  16,
                  4,
                ],
              }}
            />
            {/* Disrupted lines: colour drains to grey and the line goes dashed
                — reads as "not running" while staying traceable. */}
            <Layer
              id="mrt-network-lines-disrupted"
              type="line"
              filter={["==", ["get", "disrupted"], 1]}
              layout={{
                "line-cap": "butt",
                "line-join": "round",
              }}
              paint={{
                "line-color": isDark ? "#6b7684" : "#9aa5b1",
                "line-opacity": isDark ? 0.5 : 0.42,
                "line-dasharray": [2, 2],
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  1.4,
                  13,
                  2.6,
                  16,
                  4,
                ],
              }}
            />
          </Source>

          {/* Affected stations on a disrupted line — a hollow ring in the
              disruption tone, the same visual language as a road incident, so
              the outage's location reads at a glance. */}
          <Source
            id="pulse-mrt-affected"
            type="geojson"
            data={affectedStationsGeoJSON}
          >
            <Layer
              id="pulse-mrt-affected-glow"
              type="circle"
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  8,
                  14,
                  16,
                ],
                "circle-color": "#ef4444",
                "circle-blur": 1,
                "circle-opacity": 0.25,
              }}
            />
            <Layer
              id="pulse-mrt-affected-ring"
              type="circle"
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  4,
                  14,
                  7,
                ],
                "circle-color": isDark ? "#0b0f14" : "#ffffff",
                "circle-opacity": 0.9,
                "circle-stroke-color": "#ef4444",
                "circle-stroke-width": 2.5,
              }}
            />
          </Source>
          <Source
            id="mrt-network-stations"
            type="geojson"
            data={NETWORK_STATIONS_GEOJSON}
          >
            <Layer
              id="mrt-network-dots"
              type="circle"
              minzoom={11}
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  11,
                  1.6,
                  14,
                  3,
                  16,
                  4.5,
                ],
                "circle-color": isDark ? "#0b0f14" : "#ffffff",
                "circle-stroke-color": ["get", "color"],
                "circle-stroke-width": 1.4,
                "circle-opacity": isDark ? 0.7 : 0.85,
                "circle-stroke-opacity": isDark ? 0.55 : 0.45,
              }}
            />
            {/* Station names — only once zoomed in, so the dots become
                readable places instead of anonymous points. A halo keeps them
                legible over the congestion lines. */}
            <Layer
              id="mrt-network-labels"
              type="symbol"
              minzoom={13}
              layout={{
                "text-field": ["get", "name"],
                "text-size": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  13,
                  9,
                  16,
                  12,
                ],
                // Must be a font the CARTO glyph set actually ships, or the
                // composite glyph request 404s and labels silently vanish.
                "text-font": ["Open Sans Regular", "Noto Sans Regular"],
                "text-anchor": "top",
                "text-offset": [0, 0.6],
                "text-max-width": 8,
                "text-optional": true,
                "text-allow-overlap": false,
                "text-padding": 4,
              }}
              paint={{
                "text-color": isDark ? "#cdd6df" : "#3a444e",
                "text-halo-color": isDark ? "#0b0f14" : "#ffffff",
                "text-halo-width": 1.4,
                "text-opacity": isDark ? 0.9 : 0.95,
              }}
            />
          </Source>

          {/* Pulse: heavy road congestion only (LTA speed bands, red). A wide
              blurred copy under a crisp line gives the faded heatmap glow along
              the road. Amber (slow) is omitted — Pulse shows reds + rain. */}
          <Source id="pulse-congestion" type="geojson" data={congestionGeoJSON}>
            <Layer
              id="pulse-congestion-glow"
              type="line"
              filter={["==", ["get", "red"], 1]}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#ef4444",
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  11,
                  6,
                  14,
                  14,
                  17,
                  26,
                ],
                "line-blur": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  11,
                  4,
                  17,
                  16,
                ],
                "line-opacity": 0.3,
              }}
            />
            <Layer
              id="pulse-congestion-line"
              type="line"
              filter={["==", ["get", "red"], 1]}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#ef4444",
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  11,
                  1.5,
                  14,
                  3,
                  17,
                  5,
                ],
                "line-opacity": 0.9,
              }}
            />
          </Source>

          {/* Pulse: rain areas — soft blurred blobs (NEA gives point-area
              forecasts, not polygons). Live rain (now) is solid; forecast rain
              (expected) is larger + fainter so it reads as "coming, not here". */}
          <Source id="pulse-rain" type="geojson" data={rainGeoJSON}>
            <Layer
              id="pulse-rain-blobs"
              type="circle"
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  ["case", ["get", "forecast"], 50, 30],
                  13,
                  ["case", ["get", "forecast"], 110, 70],
                  16,
                  ["case", ["get", "forecast"], 200, 140],
                ],
                "circle-color": ["case", ["get", "forecast"], "#9fb2bd", "#8fa3ad"],
                "circle-blur": 1,
                "circle-opacity": [
                  "case",
                  ["get", "forecast"],
                  ["case", ["get", "heavy"], 0.14, 0.09],
                  ["case", ["get", "heavy"], 0.28, 0.16],
                ],
              }}
            />
          </Source>

          {/* Pulse: packed platforms only (red). Busy (amber) is omitted —
              Pulse shows reds + rain. A soft glow under the crisp dot gives the
              same faded heatmap feel as the road congestion. */}
          <Source id="pulse-crowd" type="geojson" data={crowdGeoJSON}>
            <Layer
              id="pulse-crowd-glow"
              type="circle"
              filter={["==", ["get", "high"], 1]}
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  16,
                  14,
                  30,
                ],
                "circle-color": "#ef4444",
                "circle-blur": 1,
                "circle-opacity": 0.3,
              }}
            />
            <Layer
              id="pulse-crowd-dots"
              type="circle"
              filter={["==", ["get", "high"], 1]}
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  4,
                  14,
                  7,
                ],
                "circle-color": "#ef4444",
                "circle-opacity": 0.9,
                "circle-stroke-color": isDark ? "#0b0f14" : "#ffffff",
                "circle-stroke-width": 1,
              }}
            />
          </Source>

          {/* Pulse: live road incidents (accident, breakdown…) — a hollow ring
              so a point event reads distinctly from the filled crowd dots and
              the congestion lines it sits on. */}
          <Source id="pulse-traffic" type="geojson" data={trafficGeoJSON}>
            <Layer
              id="pulse-traffic-dots"
              type="circle"
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  4,
                  14,
                  7,
                ],
                "circle-color": isDark ? "#0b0f14" : "#ffffff",
                "circle-opacity": 0.9,
                "circle-stroke-color": "#ef4444",
                "circle-stroke-width": 2.5,
              }}
            />
          </Source>

          {/* Pulse: PUB flash-flood alerts — a distinct storm badge (cloud +
              lightning), far more prominent than the soft rain blobs, since a
              flash flood is a road-closing, life-safety event. */}
          {(pulse.data?.floods ?? []).map((f, i) => (
            <Marker
              key={`flood-${i}`}
              longitude={f.lng}
              latitude={f.lat}
              anchor="center"
            >
              <span className="relative flex h-7 w-7 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4f46e5] opacity-40" />
                <span className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#4f46e5] text-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
                  <CloudLightning size={15} strokeWidth={2.4} />
                </span>
              </span>
            </Marker>
          ))}
        </>
      )}

      {/* Map control stack: 2D/3D + network toggle. Tap-friendly, unlike the
          drag-only compass control. */}
      {!follow && (
        <>
          <button
            type="button"
            onClick={toggle3d}
            aria-label={is3d ? "Switch to 2D view" : "Switch to 3D view"}
            aria-pressed={is3d}
            className="absolute left-[10px] top-[76px] z-[1] h-[30px] w-[30px] rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-[11px] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
            style={{ color: is3d ? "var(--brand)" : "var(--fg)" }}
          >
            {is3d ? "2D" : "3D"}
          </button>
          {/* Pulse toggle — hidden in the focused live-journey view. */}
          {!liveJourney && (
            <button
              type="button"
              onClick={() => setShowNetwork((v) => !v)}
              aria-label={showNetwork ? "Hide Pulse layer" : "Show Pulse layer"}
              aria-pressed={showNetwork}
              title={
                showNetwork
                  ? "Pulse: live crowd, traffic, rain"
                  : "Show Pulse (live crowd, traffic, rain)"
              }
              className={cn(
                "absolute left-[10px] top-[112px] z-[1] flex h-[30px] w-[30px] items-center justify-center rounded-lg border shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-colors",
                showNetwork
                  ? "border-transparent bg-[#ef4444] text-white"
                  : "border-[var(--border)] bg-[var(--surface)] text-[#ef4444]",
              )}
            >
              {/* A "live" heartbeat: the ping ring signals the layer is active
                  and streaming, like the reference Pulse badge. */}
              {showNetwork && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-lg bg-[#ef4444] opacity-40"
                  style={{ animationDuration: "1.8s" }}
                />
              )}
              <Activity size={16} strokeWidth={2.5} className="relative" />
            </button>
          )}
          {/* Locate me — centre on the device location (prompts on first tap).
              Home map only; the live journey follows GPS on its own. */}
          {!liveJourney && (
            <button
              type="button"
              onClick={locateMe}
              aria-label="Centre on my location"
              title="My location"
              className="absolute left-[10px] top-[148px] z-[1] flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
              style={{ color: myLocation ? "var(--brand)" : "var(--fg)" }}
            >
              {locating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <LocateFixed size={16} />
              )}
            </button>
          )}
        </>
      )}

      {/* Dynamic Pulse panel — live tallies + a "worst right now" headline +
          personalised proximity callouts. Replaces the old static legend so the
          key doubles as a real-time read of the city. Collapses to a chip. */}
      {!follow && showNetwork && !liveJourney && summary && (
        <PulsePanel
          summary={summary}
          open={legendOpen}
          onToggle={() => setLegendOpen((v) => !v)}
          onHeadlineFocus={focusPoints}
          onCycle={cycleFocus}
          maxHeight={
            // Mobile only (bottomInset > 0): the panel sits top-right at
            // top-10, under the 56px header — cap it above the planning sheet.
            bottomInset > 0
              ? `calc(100dvh - ${84 + bottomInset}px)`
              : undefined
          }
          timeLabel={
            pulse.dataUpdatedAt
              ? new Date(pulse.dataUpdatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""
          }
        />
      )}

      {/* Live-journey camera toggle: current leg (tight follow) ↔ full route
          (fit remaining journey). Always available, including during the walk
          follow view, where the other controls are hidden. */}
      {viewToggle && (
        <button
          type="button"
          onClick={viewToggle.onChange}
          aria-label={
            viewToggle.mode === "leg" ? "Show full route" : "Show current leg"
          }
          title={
            viewToggle.mode === "leg" ? "Show full route" : "Show current leg"
          }
          className="absolute left-[10px] z-[1] flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
          style={{
            top: follow ? "76px" : "148px",
            color: viewToggle.mode === "route" ? "var(--brand)" : "var(--fg)",
          }}
        >
          {viewToggle.mode === "leg" ? (
            <Route size={16} />
          ) : (
            <Navigation size={16} />
          )}
        </button>
      )}

      {legLines.length > 0 && (
        <Source id="route" type="geojson" data={routeGeoJSON}>
          {corridor && (
            // "Along the way" search corridor: a wide translucent band that
            // follows the route's real leg geometry (never a straight line).
            <Layer
              id="route-corridor"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#14b3c9",
                "line-width": 22,
                "line-opacity": 0.16,
              }}
            />
          )}
          <Layer
            id="route-transit"
            type="line"
            filter={["!=", ["get", "legType"], "walk"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": ["get", "color"],
              "line-width": 5,
              "line-opacity": 0.85,
            }}
          />
          <Layer
            id="route-walk"
            type="line"
            filter={["==", ["get", "legType"], "walk"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": ["get", "color"],
              "line-width": 4,
              "line-opacity": 0.85,
              "line-dasharray": [1, 1.6],
            }}
          />
        </Source>
      )}

      {/* Surface overlay (walk/cycle): recolours the route by PCN / sheltered /
          plain, on top of the base line. Plain is a separate dashed layer —
          line-dasharray can't be data-driven in MapLibre. */}
      {showSurface && (
        <Source id="route-surface" type="geojson" data={surfaceGeoJSON}>
          <Layer
            id="route-surface-plain"
            type="line"
            filter={["==", ["get", "surfaceClass"], "plain"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#9aa0a6",
              "line-width": 5,
              "line-opacity": 0.9,
              "line-dasharray": [1, 1.6],
            }}
          />
          <Layer
            id="route-surface-quality"
            type="line"
            filter={["!=", ["get", "surfaceClass"], "plain"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": [
                "match",
                ["get", "surfaceClass"],
                "shelter",
                "#378add",
                "pcn",
                "#1d9e75",
                "#9aa0a6",
              ],
              "line-width": 5,
              "line-opacity": 0.95,
            }}
          />
        </Source>
      )}

      {/* Surface legend — only the classes this route actually contains, so a
          cycle route (no shelter) or an all-PCN route reads honestly. Sits just
          above the bottom sheet on mobile. */}
      {showSurface &&
        !follow &&
        (() => {
          const present = new Set(
            (routeSurface ?? []).map((s) => s.surfaceClass),
          );
          const items = [
            { key: "pcn", c: "#1d9e75", label: "Park connector" },
            { key: "shelter", c: "#378add", label: "Sheltered" },
            { key: "plain", c: "#9aa0a6", label: "Roadside" },
          ].filter((it) => present.has(it.key as RouteSurfaceSpan["surfaceClass"]));
          if (items.length < 2) return null;
          return (
            <div
              className="absolute left-[10px] z-[1] flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 px-2.5 py-1.5 text-[10px] font-medium text-ripple-muted shadow-[0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-sm"
              style={{ bottom: bottomInset + 12 }}
            >
              {items.map((it) => (
                <span key={it.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-[3px] w-4 rounded-full"
                    style={{ background: it.c }}
                  />
                  {it.label}
                </span>
              ))}
            </div>
          );
        })()}

      {origin && (
        <PinMarker point={origin} color={TRANSIT_COLORS.bus} label="A" />
      )}
      {waypoints?.map((w, i) => (
        <PinMarker
          key={`wp-${i}`}
          point={w}
          color="#a97f2e"
          label={String(i + 1)}
        />
      ))}
      {pois?.map((p, i) => (
        <PinMarker
          key={`poi-${i}`}
          point={p.point}
          color="#0d8ea1"
          label={String(i + 1)}
        />
      ))}
      {destination && (
        <PinMarker point={destination} color={TRANSIT_COLORS.mrt} label="B" />
      )}
      {myLocation && !liveJourney && (
        <Marker
          longitude={myLocation.lng}
          latitude={myLocation.lat}
          anchor="center"
        >
          <div
            aria-label="Your location"
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#2563eb",
              border: "3px solid white",
              boxShadow: "0 0 0 4px rgba(37,99,235,.3),0 1px 4px rgba(0,0,0,.4)",
            }}
          />
        </Marker>
      )}
      {livePosition && (
        <Marker
          longitude={livePosition.lng}
          latitude={livePosition.lat}
          anchor="center"
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#2563eb",
              border: "3px solid white",
              boxShadow:
                "0 0 0 4px rgba(37,99,235,.3),0 1px 4px rgba(0,0,0,.4)",
            }}
          />
        </Marker>
      )}
    </MapGL>
  );
}
