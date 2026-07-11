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

// OneMap raster tiles. `Default` = detailed street map; `Night` = dark variant.
// https://www.onemap.gov.sg/docs/maps/ (raster basemaps, zoom 11–19).
const TILE_URL = (variant: "Default" | "Night") =>
  `https://www.onemap.gov.sg/maps/tiles/${variant}/{z}/{x}/{y}.png`;

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
      map.fitBounds(L.latLngBounds(points), { padding: [60, 60] });
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
  const variant = theme === "dark" ? "Night" : "Default";

  return (
    <MapContainer
      center={SG_CENTER}
      zoom={12}
      minZoom={11}
      maxZoom={19}
      className="h-full w-full"
      zoomControl
    >
      <TileLayer
        key={variant}
        url={TILE_URL(variant)}
        attribution='&copy; <a href="https://www.onemap.gov.sg/">OneMap</a> &copy; contributors'
        minZoom={11}
        maxZoom={19}
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
