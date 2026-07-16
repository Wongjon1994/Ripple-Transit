import { useEffect, useMemo, useRef } from "react";
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
import type { Itinerary, LatLng } from "@shared/types.js";
import { TRANSIT_COLORS } from "@shared/types.js";
import { useTheme } from "../lib/theme.js";

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
function add3dBuildings(map: MaplibreMap) {
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
          "fill-extrusion-color": "#9ca3af",
          "fill-extrusion-opacity": 0.55,
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
  itinerary,
  livePosition,
  pitch = 0,
  bearing = 0,
  follow,
  followZoom = 18,
}: {
  origin: LatLng | null;
  destination: LatLng | null;
  itinerary: Itinerary | null;
  livePosition?: LatLng | null;
  /** Tilt (deg) — non-zero drives the 3D walk view. */
  pitch?: number;
  /** Map bearing (deg) — heading to follow during navigation. */
  bearing?: number;
  /** When set, keep this point centered (navigation) instead of fitting bounds. */
  follow?: LatLng | null;
  followZoom?: number;
}) {
  const { theme } = useTheme();
  const mapRef = useRef<MapRef | null>(null);

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
      ...legLines.flatMap((l) => l.coords),
    ],
    [origin, destination, legLines],
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

    if (allPoints.length >= 2) {
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      for (const [lng, lat] of allPoints) {
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
    } else if (allPoints.length === 1) {
      map.easeTo({
        center: allPoints[0],
        zoom: Math.min(map.getZoom(), 15),
        duration: 600,
      });
    }
  }, [allPoints, follow, followZoom, pitch, bearing]);

  const handleLoad = (e: { target: MaplibreMap }) => add3dBuildings(e.target);
  const handleStyleData = (e: { target: MaplibreMap }) =>
    add3dBuildings(e.target);

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
      <NavigationControl position="top-left" showCompass visualizePitch />

      {legLines.length > 0 && (
        <Source id="route" type="geojson" data={routeGeoJSON}>
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
