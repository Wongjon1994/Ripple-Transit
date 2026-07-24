import { describe, it, expect } from "vitest";
import { originIsGraphTrapped } from "./onemap.js";
import type { Itinerary, RouteLeg } from "../../shared/types.js";

/** An itinerary that opens with a walk of `m` metres. */
function withAccessWalk(m: number): Itinerary {
  const walk: RouteLeg = {
    type: "walk",
    startPoint: { lat: 0, lng: 0 },
    endPoint: { lat: 0, lng: 0 },
    duration: Math.round((m / 80) * 60),
    distance: m,
  };
  return { duration: 1800, fare: 1.5, transfers: 0, legs: [walk] };
}

describe("originIsGraphTrapped", () => {
  it("flags The Hillside blk 343: 1014 m access walk to a stop 334 m away", () => {
    expect(originIsGraphTrapped([withAccessWalk(1014)], 334, true)).toBe(true);
  });

  it("leaves blk 341 next door alone (258 m walk, 211 m stop)", () => {
    expect(originIsGraphTrapped([withAccessWalk(258)], 211, true)).toBe(false);
  });

  it("judges by the shortest option, not the worst", () => {
    const its = [withAccessWalk(1400), withAccessWalk(400)];
    expect(originIsGraphTrapped(its, 334, true)).toBe(false);
  });

  it("stays quiet when the nearest stop is genuinely far", () => {
    // A 2 km walk from an origin whose closest stop is 900 m away is a real
    // detour decision, not a graph artifact — we have nothing better to offer.
    expect(originIsGraphTrapped([withAccessWalk(2000)], 900, true)).toBe(false);
  });

  it("stays quiet when there is no nearby stop at all (Sentosa Cove)", () => {
    expect(originIsGraphTrapped([withAccessWalk(2992)], 0, false)).toBe(false);
  });

  it("tolerates a modest overshoot on a very close stop", () => {
    // 40 m stop, 300 m walk: 2.5× would fire, but the +400 m floor stops it —
    // walking round one building is normal.
    expect(originIsGraphTrapped([withAccessWalk(300)], 40, true)).toBe(false);
  });

  it("returns false with no itineraries to judge", () => {
    expect(originIsGraphTrapped([], 200, true)).toBe(false);
  });

  it("ignores itineraries that open on a transit leg", () => {
    const boardsImmediately: Itinerary = {
      duration: 1200,
      fare: 1.5,
      transfers: 0,
      legs: [
        {
          type: "bus",
          startPoint: { lat: 0, lng: 0 },
          endPoint: { lat: 0, lng: 0 },
          duration: 600,
          distance: 4000,
        },
      ],
    };
    expect(originIsGraphTrapped([boardsImmediately], 40, true)).toBe(false);
  });
});
