import { describe, it, expect } from "vitest";
import { matchScores, weightsFor, walkSeconds } from "./prefMatch.js";
import type { Itinerary, RouteLeg, UserPrefs } from "./types.js";

const P = { lat: 1.3, lng: 103.8 };

function leg(type: RouteLeg["type"], duration: number, extra: Partial<RouteLeg> = {}): RouteLeg {
  return { type, startPoint: P, endPoint: P, duration, distance: duration * 1.3, ...extra };
}

function it_(o: Partial<Itinerary> & { duration: number }): Itinerary {
  return {
    fare: 1.5,
    transfers: 0,
    legs: [leg("walk", 300), leg("bus", o.duration - 300)],
    ...o,
  };
}

describe("weightsFor", () => {
  it("returns null when the user has stated nothing", () => {
    expect(weightsFor({})).toBeNull();
    expect(weightsFor({ maxWalkMin: 15 })).toBeNull();
  });

  it("derives weights from the transit route priority", () => {
    expect(weightsFor({ routePriority: { transit: "least_walking" } })).toEqual({
      walking: 1,
      time: 0.4,
    });
  });

  it("prefers explicit slider weights over the priority pick", () => {
    const prefs: UserPrefs = {
      routePriority: { transit: "fastest" },
      prefWeights: { cost: 1 },
    };
    expect(weightsFor(prefs)).toEqual({ cost: 1 });
  });

  it("ignores an all-zero slider set and falls back to the priority", () => {
    const prefs: UserPrefs = {
      routePriority: { transit: "fastest" },
      prefWeights: { cost: 0, time: 0 },
    };
    expect(weightsFor(prefs)).toEqual({ time: 1 });
  });
});

describe("matchScores", () => {
  const three = [
    it_({ duration: 1800, fare: 2.2, transfers: 1, co2Grams: 400 }),
    it_({ duration: 2400, fare: 1.4, transfers: 0, co2Grams: 300 }),
    it_({ duration: 3000, fare: 3.0, transfers: 2, co2Grams: 900 }),
  ];

  it("scores nothing without a stated preference", () => {
    expect(matchScores(three, {})).toEqual([null, null, null]);
  });

  it("scores nothing for a single option — there is no relative claim to make", () => {
    const prefs: UserPrefs = { routePriority: { transit: "fastest" } };
    expect(matchScores([three[0]], prefs)).toEqual([null]);
  });

  it("ranks the fastest option highest under a 'fastest' preference", () => {
    const s = matchScores(three, { routePriority: { transit: "fastest" } });
    const scores = s.map((m) => m!.score);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
    expect(scores[0]).toBeLessThanOrEqual(100);
    expect(s[0]!.reasons).toContain("quickest of these options");
    expect(s[2]!.caveats).toContain("slowest of these options");
  });

  it("ranks the direct option highest under a 'fewest transfers' preference", () => {
    const s = matchScores(three, {
      routePriority: { transit: "fewest_transfers" },
    });
    const best = s.map((m) => m!.score).indexOf(Math.max(...s.map((m) => m!.score)));
    expect(best).toBe(1);
    expect(s[1]!.reasons).toContain("no transfers");
  });

  it("ranks the lowest-CO₂ option highest under 'greenest'", () => {
    const s = matchScores(three, { routePriority: { transit: "greenest" } });
    const best = s.map((m) => m!.score).indexOf(Math.max(...s.map((m) => m!.score)));
    expect(best).toBe(1);
    expect(s[1]!.reasons).toContain("lowest CO₂");
  });

  it("drops a dimension the data can't support rather than guessing", () => {
    const noCarbon = three.map(({ co2Grams: _drop, ...rest }) => rest as Itinerary);
    const s = matchScores(noCarbon, { routePriority: { transit: "greenest" } });
    expect(s[0]!.scored).not.toContain("carbon");
    // Walking still carries the greenest preference, so a score survives.
    expect(s[0]!.score).toBeGreaterThanOrEqual(0);
  });

  it("scores crowding only when the live feed covered the rail legs", () => {
    const withCrowd = [
      it_({ duration: 1800, legs: [leg("mrt", 1800, { crowd: "h" })] }),
      it_({ duration: 1900, legs: [leg("mrt", 1900, { crowd: "l" })] }),
    ];
    const prefs: UserPrefs = { prefWeights: { crowds: 1 } };
    const s = matchScores(withCrowd, prefs);
    expect(s[1]!.score).toBeGreaterThan(s[0]!.score);
    expect(s[1]!.reasons).toContain("quieter platforms right now");

    const noCrowd = [
      it_({ duration: 1800, legs: [leg("mrt", 1800)] }),
      it_({ duration: 1900, legs: [leg("mrt", 1900)] }),
    ];
    expect(matchScores(noCrowd, prefs)[0]!.scored).not.toContain("crowds");
  });

  it("gives every option full marks on a dimension they all tie on", () => {
    const tied = [it_({ duration: 1800 }), it_({ duration: 1800 })];
    const s = matchScores(tied, { routePriority: { transit: "fastest" } });
    expect(s[0]!.score).toBe(100);
    expect(s[1]!.score).toBe(100);
    // A tie is not an achievement — it earns no reason line.
    expect(s[0]!.reasons).toEqual([]);
  });

  it("counts only walk legs toward walking time", () => {
    const mixed = it_({
      duration: 2000,
      legs: [leg("walk", 300), leg("cycle", 600), leg("walk", 120)],
    });
    expect(walkSeconds(mixed)).toBe(420);
  });
});
