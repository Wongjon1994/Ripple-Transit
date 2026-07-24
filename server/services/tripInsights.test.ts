import { describe, it, expect } from "vitest";
import {
  tripInsights,
  streak,
  sgDayKey,
  type TripRecord,
} from "./tripInsights.js";

/** 2026-07-25 09:00 SG = 01:00 UTC. */
const NOW = new Date("2026-07-25T01:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function trip(p: Partial<TripRecord> = {}): TripRecord {
  return {
    origin: "Home",
    destination: "Office",
    mode: "transit",
    savedGrams: 300,
    distanceM: 8000,
    createdAt: NOW,
    ...p,
  };
}

describe("sgDayKey", () => {
  it("rolls the day over at SG midnight, not UTC midnight", () => {
    // 2026-07-24 16:30 UTC is already 2026-07-25 00:30 in Singapore.
    expect(sgDayKey(new Date("2026-07-24T16:30:00Z"))).toBe("2026-07-25");
    expect(sgDayKey(new Date("2026-07-24T15:30:00Z"))).toBe("2026-07-24");
  });
});

describe("streak", () => {
  it("counts consecutive days ending today", () => {
    const trips = [trip(), trip({ createdAt: daysAgo(1) }), trip({ createdAt: daysAgo(2) })];
    expect(streak(trips, NOW)).toBe(3);
  });

  it("survives a today with no trip yet (anchors on yesterday)", () => {
    const trips = [trip({ createdAt: daysAgo(1) }), trip({ createdAt: daysAgo(2) })];
    expect(streak(trips, NOW)).toBe(2);
  });

  it("breaks when the gap is two days", () => {
    const trips = [trip({ createdAt: daysAgo(2) }), trip({ createdAt: daysAgo(3) })];
    expect(streak(trips, NOW)).toBe(0);
  });

  it("counts several trips on one day once", () => {
    expect(streak([trip(), trip(), trip()], NOW)).toBe(1);
  });

  it("is 0 with no trips", () => {
    expect(streak([], NOW)).toBe(0);
  });
});

describe("tripInsights", () => {
  it("treats a corridor as direction-insensitive", () => {
    const trips = [
      trip({ origin: "Home", destination: "Office" }),
      trip({ origin: "Office", destination: "Home" }),
    ];
    const { corridors } = tripInsights(trips, [], NOW);
    expect(corridors).toHaveLength(1);
    expect(corridors[0].trips).toBe(2);
  });

  it("ignores a journey travelled only once — that is not a corridor", () => {
    const trips = [
      trip({ origin: "Home", destination: "Office" }),
      trip({ origin: "Home", destination: "Office" }),
      trip({ origin: "Home", destination: "Airport" }),
    ];
    const { corridors } = tripInsights(trips, [], NOW);
    expect(corridors.map((c) => c.destination)).toEqual(["Office"]);
  });

  it("ranks corridors by trip count and keeps at most three", () => {
    const mk = (dest: string, n: number) =>
      Array.from({ length: n }, () => trip({ destination: dest }));
    const trips = [
      ...mk("A", 2),
      ...mk("B", 5),
      ...mk("C", 3),
      ...mk("D", 4),
    ];
    const { corridors } = tripInsights(trips, [], NOW);
    expect(corridors.map((c) => c.destination)).toEqual(["B", "D", "C"]);
  });

  it("is case- and whitespace-insensitive when grouping", () => {
    const trips = [
      trip({ origin: " Home ", destination: "OFFICE" }),
      trip({ origin: "home", destination: "office" }),
    ];
    expect(tripInsights(trips, [], NOW).corridors).toHaveLength(1);
  });

  it("splits modes by share, biggest first", () => {
    const trips = [
      trip({ mode: "transit" }),
      trip({ mode: "transit" }),
      trip({ mode: "transit" }),
      trip({ mode: "walk" }),
    ];
    expect(tripInsights(trips, [], NOW).modes).toEqual([
      { mode: "transit", trips: 3, share: 75 },
      { mode: "walk", trips: 1, share: 25 },
    ]);
  });

  it("returns no trend without a prior period", () => {
    expect(tripInsights([trip()], [], NOW).trend).toBeNull();
  });

  it("computes the CO2 trend against the prior period", () => {
    const trend = tripInsights(
      [trip({ savedGrams: 600 }), trip({ savedGrams: 600 })],
      [trip({ savedGrams: 400 })],
      NOW,
    ).trend;
    expect(trend).toMatchObject({
      trips: 2,
      priorTrips: 1,
      savedGrams: 1200,
      priorSavedGrams: 400,
      savedPct: 200,
    });
  });

  it("reports a fall as a negative percentage", () => {
    const trend = tripInsights(
      [trip({ savedGrams: 250 })],
      [trip({ savedGrams: 500 })],
      NOW,
    ).trend;
    expect(trend?.savedPct).toBe(-50);
  });

  it("leaves savedPct null when the prior period saved nothing", () => {
    // Avoids a divide-by-zero dressed up as "+∞% better".
    const trend = tripInsights(
      [trip({ savedGrams: 500 })],
      [trip({ savedGrams: 0 })],
      NOW,
    ).trend;
    expect(trend?.savedPct).toBeNull();
    expect(trend?.priorTrips).toBe(1);
  });

  it("handles an empty log without dividing by zero", () => {
    const out = tripInsights([], [], NOW);
    expect(out).toEqual({
      corridors: [],
      modes: [],
      streakDays: 0,
      trend: null,
    });
  });
});
