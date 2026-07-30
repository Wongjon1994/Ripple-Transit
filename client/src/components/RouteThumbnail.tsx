import { useMemo } from "react";
import { Footprints, Bike } from "lucide-react";
import type { ActiveVariant, ActiveMode, ActiveVariantKind } from "@shared/types.js";

/** Decode an encoded polyline (precision 5) into [lat, lng] pairs. */
function decode(str: string): [number, number][] {
  let i = 0,
    lat = 0,
    lng = 0;
  const pts: [number, number][] = [];
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
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

// Match the KindTag palette so the thumbnail reads as the same flavour.
const KIND_COLOR: Record<ActiveVariantKind, string> = {
  fastest: "var(--gold)",
  sheltered: "var(--brand)",
  pcn: "#10b981",
};

const W = 84;
const H = 48;
const PAD = 7;

/**
 * A tiny SVG sparkline of the route's actual shape — gives a sense of the path
 * before committing, coloured by variant flavour. Pure client render (no map
 * tiles), aspect-preserved so the shape isn't distorted.
 */
export function RouteThumbnail({
  variant,
  mode,
}: {
  variant: ActiveVariant;
  mode: ActiveMode;
}) {
  const geom = useMemo(() => {
    const pts: [number, number][] = [];
    for (const s of variant.segments) pts.push(...decode(s.polyline));
    if (pts.length < 2) return null;

    // Thin to ~24 points for a light render, always keeping the endpoints.
    const step = Math.max(1, Math.floor(pts.length / 24));
    const sampled = pts.filter((_, i) => i % step === 0);
    if (sampled[sampled.length - 1] !== pts[pts.length - 1])
      sampled.push(pts[pts.length - 1]);

    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const [la, lo] of sampled) {
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
      minLng = Math.min(minLng, lo);
      maxLng = Math.max(maxLng, lo);
    }
    const spanLat = maxLat - minLat || 1e-6;
    const spanLng = maxLng - minLng || 1e-6;
    const scale = Math.min((W - 2 * PAD) / spanLng, (H - 2 * PAD) / spanLat);
    const offX = (W - spanLng * scale) / 2;
    const offY = (H - spanLat * scale) / 2;
    const project = ([la, lo]: [number, number]): [number, number] => [
      offX + (lo - minLng) * scale,
      H - (offY + (la - minLat) * scale), // flip Y so north is up
    ];
    const proj = sampled.map(project);
    const d = proj
      .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");
    return { d, start: proj[0], end: proj[proj.length - 1] };
  }, [variant.segments]);

  if (!geom) return null;
  const color = KIND_COLOR[variant.kind];
  const ModeIcon = mode === "walk" ? Footprints : Bike;

  return (
    <div className="relative shrink-0" aria-hidden>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="rounded-md border border-[var(--border)] bg-ripple-muted/5"
      >
        <path
          d={geom.d}
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.9}
        />
        <circle cx={geom.start[0]} cy={geom.start[1]} r={3} fill={color} />
        <circle
          cx={geom.end[0]}
          cy={geom.end[1]}
          r={3}
          fill="var(--surface)"
          stroke={color}
          strokeWidth={2}
        />
      </svg>
      <span
        className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm"
        style={{ background: mode === "walk" ? "#22c55e" : "#0ea5e9" }}
      >
        <ModeIcon size={11} />
      </span>
    </div>
  );
}
