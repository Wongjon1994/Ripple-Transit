import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { Itinerary, LatLng } from "@shared/types.js";
import { TRANSIT_COLORS } from "@shared/types.js";
import { useTheme } from "../lib/theme.js";

const SG_CENTER: [number, number] = [1.3521, 103.8198];

// Zoom tuned for Singapore transit planning: 12 shows a useful neighbourhood
// span; 10 fits the whole island; 19 reaches building level.
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;
const FIT_MAX_ZOOM = 16; // don't over-zoom short routes when fitting bounds

// Modern OSM-based basemaps. Light = OpenStreetMap standard (colourful);
// dark = CARTO dark_all (free, no key). Routing still uses OneMap.
const TILES = {
  light: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Routing by OneMap',
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · Routing by OneMap',
  },
} as const;

/** Decode an encoded polyline (precision 5) into lat/lng pairs. */
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
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

function pinIcon(color: string, label: string) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);color:white;font-size:10px;font-weight:700;">${label}</span></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 20],
  });
}

function FitBounds({
  points,
}: {
  points: [number, number][];
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [60, 60],
        maxZoom: FIT_MAX_ZOOM,
      });
    } else if (points.length === 1) {
      map.setView(points[0], 15);
    }
  }, [map, points]);
  return null;
}

function legColor(type: string) {
  if (type === "bus") return TRANSIT_COLORS.bus;
  if (type === "mrt") return TRANSIT_COLORS.mrt;
  return TRANSIT_COLORS.walk;
}

export function MapView({
  origin,
  destination,
  itinerary,
}: {
  origin: LatLng | null;
  destination: LatLng | null;
  itinerary: Itinerary | null;
}) {
  const legLines =
    itinerary?.legs
      .map((leg) => ({
        type: leg.type,
        coords: leg.polyline
          ? decodePolyline(leg.polyline)
          : ([
              [leg.startPoint.lat, leg.startPoint.lng],
              [leg.endPoint.lat, leg.endPoint.lng],
            ] as [number, number][]),
      }))
      .filter((l) => l.coords.length > 0) ?? [];

  const allPoints: [number, number][] = [
    ...(origin ? ([[origin.lat, origin.lng]] as [number, number][]) : []),
    ...(destination
      ? ([[destination.lat, destination.lng]] as [number, number][])
      : []),
    ...legLines.flatMap((l) => l.coords),
  ];

  const { theme } = useTheme();
  const tiles = theme === "dark" ? TILES.dark : TILES.light;

  return (
    <MapContainer
      center={SG_CENTER}
      zoom={DEFAULT_ZOOM}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      className="h-full w-full"
      zoomControl
    >
      <TileLayer
        key={theme}
        url={tiles.url}
        subdomains={tiles.subdomains}
        attribution={tiles.attribution}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
      />
      {legLines.map((l, i) => (
        <Polyline
          key={i}
          positions={l.coords}
          pathOptions={{
            color: legColor(l.type),
            weight: l.type === "walk" ? 4 : 5,
            opacity: 0.85,
            dashArray: l.type === "walk" ? "6 8" : undefined,
          }}
        />
      ))}
      {origin && (
        <Marker
          position={[origin.lat, origin.lng]}
          icon={pinIcon(TRANSIT_COLORS.bus, "A")}
        />
      )}
      {destination && (
        <Marker
          position={[destination.lat, destination.lng]}
          icon={pinIcon(TRANSIT_COLORS.mrt, "B")}
        />
      )}
      <FitBounds points={allPoints} />
    </MapContainer>
  );
}
