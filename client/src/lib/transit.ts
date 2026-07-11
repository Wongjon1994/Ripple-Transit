// Official Singapore MRT/LRT line colours + names, keyed by line code.
const LINES: Record<string, { color: string; name: string }> = {
  NS: { color: "#d42e12", name: "North-South Line" },
  EW: { color: "#009645", name: "East-West Line" },
  CG: { color: "#009645", name: "Changi Airport Branch" },
  NE: { color: "#9900aa", name: "North East Line" },
  CC: { color: "#fa9e0d", name: "Circle Line" },
  CE: { color: "#fa9e0d", name: "Circle Line Extension" },
  DT: { color: "#005ec4", name: "Downtown Line" },
  TE: { color: "#9d5b25", name: "Thomson-East Coast Line" },
  BP: { color: "#748477", name: "Bukit Panjang LRT" },
  SK: { color: "#748477", name: "Sengkang LRT" },
  PG: { color: "#748477", name: "Punggol LRT" },
};

export function lineColor(code?: string): string {
  if (!code) return "#6b7280";
  return LINES[code.toUpperCase()]?.color ?? "#6b7280";
}

export function lineName(code?: string): string {
  if (!code) return "MRT";
  return LINES[code.toUpperCase()]?.name ?? `${code} Line`;
}
