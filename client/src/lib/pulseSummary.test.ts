import { describe, it, expect } from "vitest";
import {
  pulseSummary,
  regionOf,
  type PulseSummaryInput,
  type PulseCongestion,
} from "./pulseSummary.js";

const HOME = { label: "Home", lat: 1.3, lng: 103.8 };
// ~2.5km east of Home — outside every proximity radius, and in the Central region.
const FAR = { lat: 1.3, lng: 103.823 };
const EAST = { lat: 1.35, lng: 103.95 };

function input(p: Partial<PulseSummaryInput> = {}): PulseSummaryInput {
  return {
    congestion: [],
    crowd: [],
    incidents: [],
    rain: [],
    mrtDisruptions: [],
    mrtPlanned: [],
    weights: null,
    places: [],
    ...p,
  };
}

// Distinct road names in the Central region, so the tally counts n roads.
function reds(n: number, at = FAR): PulseCongestion[] {
  return Array.from({ length: n }, (_, i) => ({
    level: "red" as const,
    road: `RED ROAD ${i}`,
    ...at,
  }));
}
function ambers(n: number): PulseCongestion[] {
  return Array.from({ length: n }, (_, i) => ({
    level: "amber" as const,
    road: `AMBER ROAD ${i}`,
    ...FAR,
  }));
}

describe("regionOf", () => {
  it("assigns points to the nearest URA region", () => {
    expect(regionOf(1.3, 103.82)).toBe("Central");
    expect(regionOf(1.35, 103.95)).toBe("East");
    expect(regionOf(1.43, 103.8)).toBe("North");
    expect(regionOf(1.34, 103.72)).toBe("West");
    expect(regionOf(1.39, 103.89)).toBe("North-East");
  });
});

describe("pulseSummary — area-based traffic + tallies", () => {
  it("summarises heavy traffic by area and keeps crowd/alert tallies", () => {
    const s = pulseSummary(
      input({
        congestion: [...reds(3), ...ambers(5)],
        crowd: [
          { name: "Newton", level: "h", ...FAR },
          { name: "Bishan", level: "m", ...FAR },
        ],
        incidents: [{ ...FAR, severe: false, label: "Roadwork on PIE" }],
        rain: [{ ...FAR }],
      }),
    );
    const traffic = s.rows.find((r) => r.kind === "traffic")!;
    expect(traffic.text).toBe("Central"); // all heavy roads are Central
    expect(traffic.items).toBeUndefined(); // area-based, not a tally
    const crowd = s.rows.find((r) => r.kind === "crowd")!;
    expect(crowd.items!.map((i) => i.count)).toEqual([1, 1]);
    const alerts = s.rows.find((r) => r.kind === "alerts")!;
    expect(alerts.items!.map((i) => i.label)).toEqual(["incident", "rain area"]);
  });

  it("ranks heavy areas busiest-first and caps with +N", () => {
    const s = pulseSummary(
      input({
        congestion: [
          ...reds(3, FAR), // Central ×3
          ...reds(1, EAST).map((c, i) => ({ ...c, road: `E ${i}` })), // East ×1
          { level: "red" as const, road: "W1", lat: 1.34, lng: 103.72 }, // West ×1
        ],
      }),
    );
    const traffic = s.rows.find((r) => r.kind === "traffic")!;
    // Central (3) leads; East & West tie at 1 → one shown, one folded into +1.
    expect(traffic.text).toMatch(/^Central, (East|West) \+1$/);
  });

  it("omits the traffic row entirely when there's only slow traffic", () => {
    // Panel is heavy-only; slow stays on the map, not in the tally.
    const s = pulseSummary(input({ congestion: ambers(4) }));
    expect(s.rows.find((r) => r.kind === "traffic")).toBeUndefined();
  });

  it("reports all-clear with no rows", () => {
    const s = pulseSummary(input());
    expect(s.allClear).toBe(true);
    expect(s.rows).toEqual([]);
    expect(s.headline).toEqual({ tone: "muted", text: "Network flowing — all clear" });
  });
});

describe("pulseSummary — preference-weighted ordering", () => {
  const data = {
    congestion: reds(3),
    crowd: [{ name: "Newton", level: "h" as const, ...FAR }],
    incidents: [{ ...FAR, severe: false, label: "Roadwork on AYE" }],
  };

  it("defaults to traffic, crowd, alerts", () => {
    expect(pulseSummary(input(data)).rows.map((r) => r.kind)).toEqual([
      "traffic",
      "crowd",
      "alerts",
    ]);
  });

  it("leads with crowd when the user prioritises avoiding crowds", () => {
    const s = pulseSummary(input({ ...data, weights: { crowds: 1, time: 0.2 } }));
    expect(s.rows[0].kind).toBe("crowd");
  });

  it("leads with traffic when the user prioritises travel time", () => {
    const s = pulseSummary(input({ ...data, weights: { time: 1, crowds: 0.2 } }));
    expect(s.rows[0].kind).toBe("traffic");
  });
});

describe("pulseSummary — headline (worst citywide)", () => {
  it("puts an MRT disruption above everything, even a severe incident", () => {
    const s = pulseSummary(
      input({
        incidents: [{ ...FAR, severe: true, label: "Accident on CTE" }],
        crowd: [{ name: "Orchard", level: "h", ...FAR }],
        mrtDisruptions: [{ lines: ["NE"], stations: ["NE1", "NE3"], message: "" }],
      }),
    );
    expect(s.headline).toEqual({
      tone: "mrt",
      text: "NE line disrupted · 2 stations",
    });
  });

  it("leads with a severe incident when rail is fine", () => {
    const s = pulseSummary(
      input({
        crowd: [{ name: "Orchard", level: "h", ...FAR }],
        incidents: [{ ...FAR, severe: true, label: "Accident on CTE" }],
      }),
    );
    expect(s.headline).toEqual({ tone: "red", text: "Accident on CTE" });
  });

  it("names the packed station when nothing more severe", () => {
    const s = pulseSummary(
      input({ crowd: [{ name: "Orchard", level: "h", ...FAR }] }),
    );
    expect(s.headline?.text).toBe("Orchard packed — busiest now");
  });

  it("falls to heavy-by-area, then to a slow-roads summary", () => {
    expect(pulseSummary(input({ congestion: reds(2) })).headline).toEqual({
      tone: "red",
      text: "Heavy traffic · Central",
    });
    expect(pulseSummary(input({ congestion: ambers(4) })).headline).toEqual({
      tone: "amber",
      text: "4 roads running slow",
    });
  });
});

describe("pulseSummary — planned adjustments", () => {
  it("passes planned labels through as a footer", () => {
    const s = pulseSummary(
      input({
        mrtPlanned: [
          { line: "DT", label: "DTL ends early on Friday nights" },
          { label: "Sengkang West LRT inner loop closed" },
        ],
      }),
    );
    expect(s.planned).toEqual([
      "DTL ends early on Friday nights",
      "Sengkang West LRT inner loop closed",
    ]);
  });

  it("keeps planned notices even when the network is otherwise all-clear", () => {
    const s = pulseSummary(input({ mrtPlanned: [{ label: "Planned works" }] }));
    expect(s.allClear).toBe(true);
    expect(s.planned).toEqual(["Planned works"]);
  });
});

describe("pulseSummary — personalised proximity", () => {
  const near = (d: Partial<{ lat: number; lng: number }> = {}) => ({
    lat: 1.3009,
    lng: 103.8,
    ...d,
  }); // ~100m north of Home

  it("flags a severe incident near a saved place, worst first", () => {
    const s = pulseSummary(
      input({
        places: [HOME],
        incidents: [
          { ...near(), severe: true, label: "Accident on PIE" },
          { ...FAR, severe: true, label: "Accident on TPE" },
        ],
      }),
    );
    expect(s.personal).toEqual([
      { tone: "red", text: "Accident on PIE · near Home" },
    ]);
  });

  it("stays quiet when the user's places are all clear", () => {
    const s = pulseSummary(
      input({ places: [HOME], incidents: [{ ...FAR, severe: true, label: "Accident on TPE" }] }),
    );
    expect(s.personal).toEqual([]);
  });

  it("says nothing personal when the user has no saved places", () => {
    const s = pulseSummary(
      input({ incidents: [{ ...near(), severe: true, label: "Accident on PIE" }] }),
    );
    expect(s.personal).toEqual([]);
  });

  it("prefers a nearby jam over distant rain, and caps at two", () => {
    const WORK = { label: "Work", lat: 1.301, lng: 103.8 };
    const s = pulseSummary(
      input({
        places: [HOME, WORK],
        congestion: [{ level: "red", road: "PIE", ...near() }],
        crowd: [{ name: "Newton", level: "m", ...near({ lat: 1.3011 }) }],
      }),
    );
    expect(s.personal.length).toBeLessThanOrEqual(2);
    expect(s.personal[0].tone).toBe("red"); // the heavy jam ranks above the busy platform
  });
});
