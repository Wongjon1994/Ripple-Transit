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
import { TrainFront, Route, Navigation } from "lucide-react";
import type { Itinerary, LatLng } from "@shared/types.js";
import { TRANSIT_COLORS } from "@shared/types.js";
import { useTheme } from "../lib/theme.js";
import {
  NETWORK_LINES_GEOJSON,
  NETWORK_STATIONS_GEOJSON,
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
  // Ambient MRT/LRT network overlay — on by default, off in the tilted walk
  // navigation view (follow) where it would clutter the street.
  const [showNetwork, setShowNetwork] = useState(true);

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
            aria-label={showNetwork ? "Hide MRT network" : "Show MRT network"}
            aria-pressed={showNetwork}
            title={showNetwork ? "Hide MRT network" : "Show MRT network"}
            className="absolute left-[10px] top-[112px] z-[1] flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
            style={{ color: showNetwork ? "var(--brand)" : "var(--fg)" }}
          >
            <TrainFront size={16} />
          </button>
        </>
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
