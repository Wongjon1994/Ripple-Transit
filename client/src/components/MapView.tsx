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
import { Route, Navigation, Activity } from "lucide-react";
import type { Itinerary, LatLng } from "@shared/types.js";
import { TRANSIT_COLORS } from "@shared/types.js";
import { cn } from "../lib/utils.js";
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
          // Solid, legible massing (vertical gradient shades the sides for depth).
          "fill-extrusion-color": dark ? "#3a4250" : "#d5d8dd",
          "fill-extrusion-opacity": 0.92,
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
}) {
  const { theme } = useTheme();
  const mapRef = useRef<MapRef | null>(null);
  // Tap-friendly 3D toggle: MapLibre's compass only pitches via mouse-drag,
  // which touch devices can't do — so we offer an explicit 2D/3D button.
  const [is3d, setIs3d] = useState(false);
  // "Pulse" layer — the repurposed map toggle (Phase 16): the MRT/LRT network
  // plus live crowding, road traffic, and an approximate rain overlay. On by
  // default, off in the tilted walk navigation view where it would clutter.
  const [showNetwork, setShowNetwork] = useState(true);
  // Legend folds to a single "Pulse" chip so it never blocks the map.
  const [legendOpen, setLegendOpen] = useState(true);

  const pulse = trpc.pulse.overlay.useQuery(undefined, {
    enabled: showNetwork && !follow,
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
    if (!pulse.data) return null;
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
    return pulseSummary({
      congestion,
      crowd,
      incidents: pulse.data.traffic,
      rain: pulse.data.rain,
      weights: weightsFor(prefs),
      places,
    });
  }, [pulse.data, savedPlaces.data, prefs]);

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
      features: (pulse.data?.traffic ?? []).map((t) => ({
        type: "Feature" as const,
        properties: { color: t.severe ? "#ef4444" : "#f59e0b" },
        geometry: {
          type: "Point" as const,
          coordinates: [t.lng, t.lat] as [number, number],
        },
      })),
    }),
    [pulse.data?.traffic],
  );

  const rainGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (pulse.data?.rain ?? []).map((r) => ({
        type: "Feature" as const,
        properties: { heavy: r.intensity === "heavy" ? 1 : 0 },
        geometry: {
          type: "Point" as const,
          coordinates: [r.lng, r.lat] as [number, number],
        },
      })),
    }),
    [pulse.data?.rain],
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

  const routeGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: legLines.map((l) => ({
        type: "Feature" as const,
        properties: { legType: l.type, color: legColor(l.type) },
        geometry: { type: "LineString" as const, coordinates: l.coords },
      })),
    }),
    [legLines],
  );

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
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 60, maxZoom: FIT_MAX_ZOOM, duration: 600 },
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
      {!follow && showNetwork && (
        <>
          <Source id="mrt-network" type="geojson" data={NETWORK_LINES_GEOJSON}>
            <Layer
              id="mrt-network-lines"
              type="line"
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
                "text-font": ["Metropolis Regular", "Noto Sans Regular"],
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

          {/* Pulse: live road congestion (LTA speed bands). A wide blurred copy
              under a crisp line gives the faded heatmap glow along the road. */}
          <Source id="pulse-congestion" type="geojson" data={congestionGeoJSON}>
            <Layer
              id="pulse-congestion-glow"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ["get", "color"],
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
                "line-opacity": ["case", ["get", "red"], 0.3, 0.22],
              }}
            />
            <Layer
              id="pulse-congestion-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ["get", "color"],
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
                "line-opacity": ["case", ["get", "red"], 0.9, 0.75],
              }}
            />
          </Source>

          {/* Pulse: approximate rain areas — soft blurred blobs (NEA gives
              point-area forecasts, not polygons). */}
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
                  30,
                  13,
                  70,
                  16,
                  140,
                ],
                "circle-color": "#8fa3ad",
                "circle-blur": 1,
                "circle-opacity": ["case", ["get", "heavy"], 0.28, 0.16],
              }}
            />
          </Source>

          {/* Pulse: live station crowding — amber (busy) / red (packed); low
              crowd is filtered out server-side. A soft glow under the crisp dot
              gives the same faded heatmap feel as the road congestion. */}
          <Source id="pulse-crowd" type="geojson" data={crowdGeoJSON}>
            <Layer
              id="pulse-crowd-glow"
              type="circle"
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  ["case", ["get", "high"], 16, 12],
                  14,
                  ["case", ["get", "high"], 30, 22],
                ],
                "circle-color": ["get", "color"],
                "circle-blur": 1,
                "circle-opacity": ["case", ["get", "high"], 0.3, 0.2],
              }}
            />
            <Layer
              id="pulse-crowd-dots"
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
                "circle-color": ["get", "color"],
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
                "circle-stroke-color": ["get", "color"],
                "circle-stroke-width": 2.5,
              }}
            />
          </Source>
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
            {/* A "live" heartbeat: the ping ring signals the layer is active and
                streaming, drawing the eye the way the reference Pulse badge does. */}
            {showNetwork && (
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-lg bg-[#ef4444] opacity-40"
                style={{ animationDuration: "1.8s" }}
              />
            )}
            <Activity size={16} strokeWidth={2.5} className="relative" />
          </button>
        </>
      )}

      {/* Dynamic Pulse panel — live tallies + a "worst right now" headline +
          personalised proximity callouts. Replaces the old static legend so the
          key doubles as a real-time read of the city. Collapses to a chip. */}
      {!follow && showNetwork && summary && (
        <PulsePanel
          summary={summary}
          open={legendOpen}
          onToggle={() => setLegendOpen((v) => !v)}
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
