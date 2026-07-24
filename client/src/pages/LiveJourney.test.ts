import { describe, it, expect } from "vitest";
import { remainingMinutes } from "./LiveJourney.js";
import type { RouteLeg } from "@shared/types.js";

const NOW = 1_760_000_000_000;

function leg(
  type: RouteLeg["type"],
  minutes: number,
  metres: number,
): RouteLeg {
  return {
    type,
    startPoint: { lat: 0, lng: 0 },
    endPoint: { lat: 0, lng: 0 },
    duration: minutes * 60,
    distance: metres,
  };
}

// The reported case: Bus 111 for 11 min, then a 3 min walk.
const LEGS = [leg("bus", 11, 5000), leg("walk", 3, 240)];

describe("remainingMinutes", () => {
  it("counts down as you travel the current leg", () => {
    const halfway = remainingMinutes({
      legs: LEGS,
      currentLeg: 0,
      remainingM: 2500,
      gpsFixedAt: NOW - 5_000,
      legStartedAt: NOW - 6 * 60_000,
      nowMs: NOW,
    });
    // 5.5 min of bus left + 3 min walk — not the full 14 it used to report.
    expect(halfway).toBe(9);
  });

  it("reports the full plan at the very start of a leg", () => {
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 0,
        remainingM: 5000,
        gpsFixedAt: NOW,
        legStartedAt: NOW,
        nowMs: NOW,
      }),
    ).toBe(14);
  });

  it("drops to the following legs as the current one ends", () => {
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 0,
        remainingM: 0,
        gpsFixedAt: NOW,
        legStartedAt: NOW - 11 * 60_000,
        nowMs: NOW,
      }),
    ).toBe(3);
  });

  it("falls back to the clock when there is no GPS fix", () => {
    // 4 minutes into the bus ride, no fix at all: 7 min bus + 3 min walk.
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 0,
        remainingM: 5000,
        gpsFixedAt: null,
        legStartedAt: NOW - 4 * 60_000,
        nowMs: NOW,
      }),
    ).toBe(10);
  });

  it("falls back to the clock when the fix has gone stale underground", () => {
    // A fix from 5 minutes ago still says "5 km to go"; the clock knows better.
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 0,
        remainingM: 5000,
        gpsFixedAt: NOW - 5 * 60_000,
        legStartedAt: NOW - 8 * 60_000,
        nowMs: NOW,
      }),
    ).toBe(6);
  });

  it("never goes negative when a leg overruns its plan", () => {
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 0,
        remainingM: 5000,
        gpsFixedAt: null,
        legStartedAt: NOW - 40 * 60_000,
        nowMs: NOW,
      }),
    ).toBe(3);
  });

  it("handles the last leg", () => {
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 1,
        remainingM: 120,
        gpsFixedAt: NOW,
        legStartedAt: NOW,
        nowMs: NOW,
      }),
    ).toBe(2);
  });

  it("counts the scheduled wait before a later leg", () => {
    // Walk 5 min, then a train that doesn't depart for another 7 min.
    const withWait: RouteLeg[] = [
      { ...leg("walk", 5, 400), startTimeMs: NOW, endTimeMs: NOW + 5 * 60_000 },
      {
        ...leg("mrt", 13, 7900),
        startTimeMs: NOW + 12 * 60_000,
        endTimeMs: NOW + 25 * 60_000,
      },
    ];
    expect(
      remainingMinutes({
        legs: withWait,
        currentLeg: 0,
        remainingM: 400,
        gpsFixedAt: NOW,
        legStartedAt: NOW,
        nowMs: NOW,
      }),
    ).toBe(25); // 5 walk + 7 wait + 13 ride, not the 18 it used to report
  });

  it("ignores a negative gap when a leg overlaps the one before it", () => {
    const overlapping: RouteLeg[] = [
      { ...leg("walk", 5, 400), startTimeMs: NOW, endTimeMs: NOW + 5 * 60_000 },
      {
        ...leg("mrt", 13, 7900),
        startTimeMs: NOW + 2 * 60_000,
        endTimeMs: NOW + 15 * 60_000,
      },
    ];
    expect(
      remainingMinutes({
        legs: overlapping,
        currentLeg: 0,
        remainingM: 400,
        gpsFixedAt: NOW,
        legStartedAt: NOW,
        nowMs: NOW,
      }),
    ).toBe(18);
  });

  it("returns 0 past the end of the journey", () => {
    expect(
      remainingMinutes({
        legs: LEGS,
        currentLeg: 2,
        remainingM: 0,
        gpsFixedAt: NOW,
        legStartedAt: NOW,
        nowMs: NOW,
      }),
    ).toBe(0);
  });
});
