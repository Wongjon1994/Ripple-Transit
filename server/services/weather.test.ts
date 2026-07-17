import { describe, it, expect } from "vitest";
import {
  weatherAdvisory,
  walkExposureCallout,
  cycleRainCallout,
  regionFor,
  describePeriod,
} from "./weather.js";

describe("weatherAdvisory", () => {
  it("warns to shelter when wet", () => {
    const a = weatherAdvisory(true, 28, 80);
    expect(a?.level).toBe("warning");
    expect(a?.message).toMatch(/covered|MRT/i);
  });

  it("advises shade when hot and humid (dry)", () => {
    const a = weatherAdvisory(false, 33, 75);
    expect(a?.level).toBe("info");
    expect(a?.message).toMatch(/shade|shaded|covered/i);
  });

  it("is null in mild, dry conditions", () => {
    expect(weatherAdvisory(false, 29, 65)).toBeNull();
  });

  it("does not flag heat when humidity is low", () => {
    expect(weatherAdvisory(false, 33, 50)).toBeNull();
  });

  it("prioritises rain over heat", () => {
    expect(weatherAdvisory(true, 33, 80)?.level).toBe("warning");
  });
});

describe("walkExposureCallout (addendum 12a)", () => {
  const base = { wet: false, temperature: 28, humidity: 60 };

  it("says nothing without shelter data — no exposure claim", () => {
    expect(
      walkExposureCallout({ ...base, wet: true, shelterPct: undefined }),
    ).toBeNull();
  });

  it("umbrella when raining and the exposed share is non-trivial", () => {
    const c = walkExposureCallout({ ...base, wet: true, shelterPct: 40 });
    expect(c?.level).toBe("warning");
    expect(c?.message).toMatch(/umbrella/i);
    expect(c?.message).toMatch(/60%/);
  });

  it("no umbrella for a 95%-covered route with a 5% sliver", () => {
    expect(
      walkExposureCallout({ ...base, wet: true, shelterPct: 95 }),
    ).toBeNull();
  });

  it("sunscreen only when hot, humid AND meaningfully exposed", () => {
    const c = walkExposureCallout({
      wet: false,
      temperature: 34,
      humidity: 75,
      shelterPct: 30,
    });
    expect(c?.level).toBe("info");
    expect(c?.message).toMatch(/sunscreen/i);
    expect(
      walkExposureCallout({
        wet: false,
        temperature: 34,
        humidity: 75,
        shelterPct: 80, // mostly covered — suppressed
      }),
    ).toBeNull();
  });
});

describe("cycleRainCallout (addendum 12b)", () => {
  it("is silent when dry", () => {
    expect(cycleRainCallout({ rainingNow: false }, "Bishan")).toBeNull();
  });

  it("gives a specific wait-until inside the nowcast horizon", () => {
    const c = cycleRainCallout(
      { rainingNow: true, untilISO: "2026-07-17T15:40:00+08:00" },
      "Bukit Merah",
    );
    expect(c?.message).toMatch(/until ~/);
    expect(c?.message).toMatch(/Bukit Merah/);
  });

  it("uses period language beyond the horizon — no fabricated times", () => {
    const c = cycleRainCallout(
      {
        rainingNow: true,
        untilISO: "2026-07-17T15:40:00+08:00",
        outlook: "this afternoon",
      },
      "Bishan",
    );
    expect(c?.message).toMatch(/through this afternoon/);
    expect(c?.message).not.toMatch(/until ~/);
  });
});

describe("regionFor / describePeriod", () => {
  it("maps quadrants to NEA regions", () => {
    expect(regionFor(1.35, 103.7)).toBe("west");
    expect(regionFor(1.35, 103.95)).toBe("east");
    expect(regionFor(1.42, 103.8)).toBe("north");
    expect(regionFor(1.25, 103.82)).toBe("south");
    expect(regionFor(1.33, 103.82)).toBe("central");
  });

  it("phrases day-parts", () => {
    expect(describePeriod(9)).toBe("this morning");
    expect(describePeriod(14)).toBe("this afternoon");
    expect(describePeriod(20)).toBe("this evening");
  });
});
