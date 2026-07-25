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

// Distinct road names (heavy/red), so the tally counts n roads.
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
const severe = (label: string, at = FAR) => ({ ...at, severe: true, label });
const minor = (label: string, at = FAR) => ({ ...at, severe: false, label });

describe("regionOf", () => {
  it("assigns points to the nearest URA region", () => {
    expect(regionOf(1.3, 103.82)).toBe("Central");
    expect(regionOf(1.35, 103.95)).toBe("East");
    expect(regionOf(1.43, 103.8)).toBe("North");
    expect(regionOf(1.34, 103.72)).toBe("West");
    expect(regionOf(1.39, 103.89)).toBe("North-East");
  });
});

describe("pulseSummary — reds + rain only", () => {
  it("area-based heavy traffic, packed-only crowd, severe-only alerts", () => {
    const s = pulseSummary(
      input({
        congestion: [...reds(3), ...ambers(5)], // amber ignored
        crowd: [
          { name: "Newton", level: "h", ...FAR },
          { name: "Bishan", level: "m", ...FAR }, // busy ignored
        ],
        incidents: [severe("Accident on PIE"), minor("Roadwork on AYE")],
        rain: [{ ...FAR }],
      }),
    );
    const traffic = s.rows.find((r) => r.kind === "traffic")!;
    expect(traffic.text).toBe("Central");
    const crowd = s.rows.find((r) => r.kind === "crowd")!;
    expect(crowd.items).toEqual([{ tone: "red", count: 1, label: "packed" }]);
    const alerts = s.rows.find((r) => r.kind === "alerts")!;
    // Only the ONE severe incident counts; the roadwork is dropped.
    expect(alerts.items).toEqual([
      { tone: "red", count: 1, label: "incident" },
      { tone: "rain", count: 1, label: "rain area" },
    ]);
  });

  it("treats amber-only conditions as all-clear (nothing red, no rain)", () => {
    const s = pulseSummary(
      input({
        congestion: ambers(4),
        crowd: [{ name: "X", level: "m", ...FAR }],
        incidents: [minor("Roadwork")],
      }),
    );
    expect(s.allClear).toBe(true);
    expect(s.rows).toEqual([]);
  });

  it("ranks heavy areas busiest-first and caps with +N", () => {
    const s = pulseSummary(
      input({
        congestion: [
          ...reds(3, FAR), // Central ×3
          { level: "red" as const, road: "E1", ...EAST }, // East ×1
          { level: "red" as const, road: "W1", lat: 1.34, lng: 103.72 }, // West ×1
        ],
      }),
    );
    expect(s.rows.find((r) => r.kind === "traffic")!.text).toMatch(
      /^Central, (East|West) \+1$/,
    );
  });
});

describe("pulseSummary — preference-weighted ordering", () => {
  const data = {
    congestion: reds(3),
    crowd: [{ name: "Newton", level: "h" as const, ...FAR }],
    incidents: [severe("Accident on AYE")],
  };
  it("defaults to traffic, crowd, alerts", () => {
    expect(pulseSummary(input(data)).rows.map((r) => r.kind)).toEqual([
      "traffic",
      "crowd",
      "alerts",
    ]);
  });
  it("leads with crowd when the user prioritises avoiding crowds", () => {
    expect(
      pulseSummary(input({ ...data, weights: { crowds: 1, time: 0.2 } }))
        .rows[0].kind,
    ).toBe("crowd");
  });
});

describe("pulseSummary — headline (worst citywide) + focus", () => {
  it("MRT disruption tops everything and focuses its station points", () => {
    const s = pulseSummary(
      input({
        incidents: [severe("Accident on CTE")],
        mrtDisruptions: [
          {
            lines: ["NE"],
            stations: ["NE1", "NE3"],
            message: "",
            stationPoints: [{ lat: 1.26, lng: 103.82 }],
          },
        ],
      }),
    );
    expect(s.headline?.tone).toBe("mrt");
    expect(s.headline?.text).toBe("NE line disrupted · 2 stations");
    expect(s.headline?.focus).toEqual([{ lat: 1.26, lng: 103.82 }]);
  });

  it("severe incident headline focuses on the incident", () => {
    const s = pulseSummary(input({ incidents: [severe("Accident on CTE")] }));
    expect(s.headline).toMatchObject({
      tone: "red",
      text: "Accident on CTE",
      focus: [{ lat: FAR.lat, lng: FAR.lng }],
    });
  });

  it("ignores a MINOR incident for the headline", () => {
    const s = pulseSummary(input({ incidents: [minor("Roadwork on AYE")] }));
    // Nothing red, no rain → all clear.
    expect(s.allClear).toBe(true);
  });

  it("packed station headline, then heavy-by-area, then rain", () => {
    expect(
      pulseSummary(input({ crowd: [{ name: "Orchard", level: "h", ...FAR }] }))
        .headline?.text,
    ).toBe("Orchard packed — busiest now");
    expect(
      pulseSummary(input({ congestion: reds(2) })).headline,
    ).toMatchObject({ tone: "red", text: "Heavy traffic · Central" });
    expect(
      pulseSummary(input({ rain: [{ ...FAR }, { ...FAR }] })).headline,
    ).toMatchObject({ tone: "rain", text: "Showers in 2 areas" });
  });
});

describe("pulseSummary — planned + weather passthrough", () => {
  it("passes planned labels and weather through", () => {
    const s = pulseSummary(
      input({
        mrtPlanned: [{ label: "DTL ends early Friday nights" }],
        weather: { temperature: 29, condition: "Cloudy", outlook: "Showers later" },
      }),
    );
    expect(s.planned).toEqual(["DTL ends early Friday nights"]);
    expect(s.weather).toEqual({
      temperature: 29,
      condition: "Cloudy",
      outlook: "Showers later",
    });
  });
});

describe("pulseSummary — personalised proximity (reds + rain only)", () => {
  const near = (d: Partial<{ lat: number; lng: number }> = {}) => ({
    lat: 1.3009,
    lng: 103.8,
    ...d,
  }); // ~100m north of Home

  it("flags a severe incident near a saved place", () => {
    const s = pulseSummary(
      input({
        places: [HOME],
        incidents: [severe("Accident on PIE", near())],
      }),
    );
    expect(s.personal).toEqual([
      { tone: "red", text: "Accident on PIE · near Home" },
    ]);
  });

  it("does NOT flag a minor incident near a saved place", () => {
    const s = pulseSummary(
      input({ places: [HOME], incidents: [minor("Roadwork", near())] }),
    );
    expect(s.personal).toEqual([]);
  });

  it("flags rain near a saved place when nothing red is close", () => {
    const s = pulseSummary(input({ places: [HOME], rain: [near()] }));
    expect(s.personal).toEqual([{ tone: "rain", text: "Rain near Home" }]);
  });
});
