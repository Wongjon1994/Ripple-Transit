import { describe, it, expect } from "vitest";
import {
  pulseSummary,
  type PulseSummaryInput,
  type PulseCongestion,
} from "./pulseSummary.js";

const HOME = { label: "Home", lat: 1.3, lng: 103.8 };
// ~2.5km east of Home — clearly outside every proximity radius.
const FAR = { lat: 1.3, lng: 103.823 };

function input(p: Partial<PulseSummaryInput> = {}): PulseSummaryInput {
  return {
    congestion: [],
    crowd: [],
    incidents: [],
    rain: [],
    weights: null,
    places: [],
    ...p,
  };
}

// Distinct road names, so the tally (which counts roads, not segments) sees n.
function reds(n: number): PulseCongestion[] {
  return Array.from({ length: n }, (_, i) => ({
    level: "red" as const,
    road: `RED ROAD ${i}`,
    ...FAR,
  }));
}
function ambers(n: number): PulseCongestion[] {
  return Array.from({ length: n }, (_, i) => ({
    level: "amber" as const,
    road: `AMBER ROAD ${i}`,
    ...FAR,
  }));
}

describe("pulseSummary — tallies", () => {
  it("counts each category and hides zero items", () => {
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
    expect(traffic.items).toEqual([
      { tone: "red", count: 3, label: "heavy" },
      { tone: "amber", count: 5, label: "slow" },
    ]);
    const crowd = s.rows.find((r) => r.kind === "crowd")!;
    expect(crowd.items.map((i) => i.count)).toEqual([1, 1]);
    const alerts = s.rows.find((r) => r.kind === "alerts")!;
    expect(alerts.items).toEqual([
      { tone: "red", count: 1, label: "incident" },
      { tone: "rain", count: 1, label: "rain area" },
    ]);
  });

  it("drops a category entirely when it has nothing", () => {
    const s = pulseSummary(input({ congestion: reds(2) }));
    expect(s.rows.map((r) => r.kind)).toEqual(["traffic"]);
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
  it("leads with a severe incident above everything else", () => {
    const s = pulseSummary(
      input({
        crowd: [{ name: "Orchard", level: "h", ...FAR }],
        incidents: [{ ...FAR, severe: true, label: "Accident on CTE" }],
      }),
    );
    expect(s.headline).toEqual({ tone: "red", text: "Accident on CTE" });
  });

  it("names the packed station when there's no severe incident", () => {
    const s = pulseSummary(
      input({ crowd: [{ name: "Orchard", level: "h", ...FAR }] }),
    );
    expect(s.headline?.text).toBe("Orchard packed — busiest now");
  });

  it("falls to a slow-roads summary when nothing acute", () => {
    const s = pulseSummary(input({ congestion: ambers(4) }));
    expect(s.headline).toEqual({ tone: "amber", text: "4 roads running slow" });
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
