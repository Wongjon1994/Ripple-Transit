// The full operational Singapore rail network as ready-to-render GeoJSON, for
// the faded ambient overlay on the map. Data is generated offline from OneMap
// (see scripts/build-mrt-network.mjs) into mrtNetwork.json — station coords +
// line orderings. Lines are drawn by connecting each line's stations in
// station-code order (NS1→NS2→…), which traces the network without needing the
// real track geometry.
import network from "../data/mrtNetwork.json";

interface Station {
  code: string;
  name: string;
  lat: number;
  lng: number;
}
type Lines = Record<string, Station[]>;

const LINES = (network as { lines: Lines }).lines;

// Official line colours, keyed by the 2-letter station-code prefix. LRT lines
// (BP / Sengkang SE·SW / Punggol PE·PW) share one muted grey.
const PREFIX_COLOR: Record<string, string> = {
  NS: "#d42e12", // North-South
  EW: "#009645", // East-West
  CG: "#009645", // Changi branch (East-West green)
  NE: "#9900aa", // North East
  CC: "#fa9e0d", // Circle
  CE: "#fa9e0d", // Circle extension
  DT: "#005ec4", // Downtown
  TE: "#9d5b25", // Thomson-East Coast
  BP: "#748477", // Bukit Panjang LRT
  SE: "#748477", // Sengkang LRT (east loop)
  SW: "#748477", // Sengkang LRT (west loop)
  PE: "#748477", // Punggol LRT (east loop)
  PW: "#748477", // Punggol LRT (west loop)
};

function prefixColor(prefix: string): string {
  return PREFIX_COLOR[prefix] ?? "#748477";
}

export const NETWORK_LINES_GEOJSON = {
  type: "FeatureCollection" as const,
  features: Object.entries(LINES)
    .filter(([, stations]) => stations.length >= 2)
    .map(([prefix, stations]) => ({
      type: "Feature" as const,
      properties: { prefix, color: prefixColor(prefix) },
      geometry: {
        type: "LineString" as const,
        coordinates: stations.map((s) => [s.lng, s.lat] as [number, number]),
      },
    })),
};

// One point per physical station. Interchanges share coordinates across codes;
// we de-dupe by rounded lng/lat so the dot is drawn once.
const seen = new Set<string>();
export const NETWORK_STATIONS_GEOJSON = {
  type: "FeatureCollection" as const,
  features: Object.entries(LINES).flatMap(([prefix, stations]) =>
    stations.flatMap((s) => {
      const key = `${s.lng.toFixed(4)},${s.lat.toFixed(4)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          type: "Feature" as const,
          properties: { code: s.code, name: s.name, color: prefixColor(prefix) },
          geometry: {
            type: "Point" as const,
            coordinates: [s.lng, s.lat] as [number, number],
          },
        },
      ];
    }),
  ),
};

export const NETWORK_STATION_COUNT = NETWORK_STATIONS_GEOJSON.features.length;
