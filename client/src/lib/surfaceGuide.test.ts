import { describe, it, expect } from "vitest";
import type { LatLng, RouteSurfaceSpan } from "@shared/types.js";
import { haversineMeters } from "./utils.js";
import { buildSurfaceTimeline, surfaceGuide } from "./surfaceGuide.js";

/** Minimal precision-5 polyline encoder for building test fixtures. */
function encode(pts: LatLng[]): string {
  let lastLat = 0,
    lastLng = 0,
    out = "";
  const enc = (curr: number, last: number) => {
    let v = Math.round(curr * 1e5) - last;
    let s = "";
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    s += String.fromCharCode(x + 63);
    return s;
  };
  for (const p of pts) {
    out += enc(p.lat, lastLat) + enc(p.lng, lastLng);
    lastLat = Math.round(p.lat * 1e5);
    lastLng = Math.round(p.lng * 1e5);
  }
  return out;
}

// A due-east route at constant latitude, split plain → shelter → plain. Runs
// share their boundary point (as classifyRoute emits them).
const P = (i: number): LatLng => ({ lat: 1.3, lng: 103.8 + i * 0.0006 });
const P0 = P(0),
  P1 = P(1),
  P2 = P(2),
  P3 = P(3),
  P4 = P(4),
  P5 = P(5),
  P6 = P(6);

const spans: RouteSurfaceSpan[] = [
  { surfaceClass: "plain", polyline: encode([P0, P1, P2]) },
  { surfaceClass: "shelter", polyline: encode([P2, P3, P4]) },
  { surfaceClass: "plain", polyline: encode([P4, P5, P6]) },
];

// Plain → named park connector, for the cycle "Joining …" card.
const pcnSpans: RouteSurfaceSpan[] = [
  { surfaceClass: "plain", polyline: encode([P0, P1, P2]) },
  { surfaceClass: "pcn", polyline: encode([P2, P3, P4]), name: "Ulu Pandan Park Connector" },
];

describe("buildSurfaceTimeline", () => {
  it("returns null for empty / missing spans", () => {
    expect(buildSurfaceTimeline(undefined)).toBeNull();
    expect(buildSurfaceTimeline([])).toBeNull();
  });

  it("concatenates spans into a length-tagged route", () => {
    const tl = buildSurfaceTimeline(spans)!;
    expect(tl).not.toBeNull();
    // total length ~= P0..P6 straight (boundary duplicates are zero-length)
    expect(tl.total).toBeCloseTo(haversineMeters(P0, P6), 0);
    // classes present in order
    expect(tl.segClass).toContain("shelter");
    expect(tl.segClass[0]).toBe("plain");
    expect(tl.segClass[tl.segClass.length - 1]).toBe("plain");
  });
});

describe("surfaceGuide", () => {
  it("on a plain stretch, points to the next shelter run", () => {
    const g = surfaceGuide(P1, spans)!;
    expect(g.currentClass).toBe("plain");
    expect(g.offRoute).toBe(false);
    expect(g.toShelterM).toBeCloseTo(haversineMeters(P1, P2), 0);
    expect(g.nextChange?.toClass).toBe("shelter");
    expect(g.currentRunToEnd).toBe(false);
  });

  it("while sheltered, reports cover ahead and the exit to plain", () => {
    const g = surfaceGuide(P3, spans)!;
    expect(g.currentClass).toBe("shelter");
    expect(g.toShelterM).toBeNull(); // already covered
    expect(g.currentRunAheadM).toBeCloseTo(haversineMeters(P3, P4), 0);
    expect(g.nextChange?.toClass).toBe("plain");
  });

  it("on the final plain run, no shelter ahead and run goes to the end", () => {
    const g = surfaceGuide(P5, spans)!;
    expect(g.currentClass).toBe("plain");
    expect(g.toShelterM).toBeNull();
    expect(g.nextChange).toBeNull();
    expect(g.currentRunToEnd).toBe(true);
  });

  it("names the park connector you're about to join", () => {
    const g = surfaceGuide(P1, pcnSpans)!;
    expect(g.nextChange?.toClass).toBe("pcn");
    expect(g.nextChange?.toName).toBe("Ulu Pandan Park Connector");
  });

  it("flags a fix that is far off the route", () => {
    const off = { lat: 1.31, lng: 103.8012 }; // ~1.1 km north of the line
    const g = surfaceGuide(off, spans)!;
    expect(g.offRoute).toBe(true);
  });
});
