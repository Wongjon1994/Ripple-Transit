import { describe, it, expect } from "vitest";
import { parseBikeStands } from "./bikeParking.js";

const dest = { lat: 1.3329, lng: 103.7436 };

describe("parseBikeStands", () => {
  it("reads nodes and ways, covered + capacity, sorted by distance", () => {
    const stands = parseBikeStands(
      [
        // a far node
        { type: "node", lat: 1.3343971, lon: 103.7434477, tags: {} },
        // a nearer covered node with capacity
        {
          type: "node",
          lat: 1.3334207,
          lon: 103.7424876,
          tags: { covered: "yes", capacity: "6" },
        },
        // a way with a computed centre
        {
          type: "way",
          center: { lat: 1.33432, lon: 103.7435384 },
          tags: { covered: "no" },
        },
      ],
      dest,
    );
    expect(stands.length).toBe(3);
    // nearest first
    expect(stands[0].distanceM).toBeLessThanOrEqual(stands[1].distanceM);
    expect(stands[0].covered).toBe(true);
    expect(stands[0].capacity).toBe(6);
    // way resolved via its centre
    expect(stands.some((s) => s.lat === 1.33432)).toBe(true);
  });

  it("skips elements without a resolvable point and junk capacity", () => {
    const stands = parseBikeStands(
      [
        { type: "way", tags: { amenity: "bicycle_parking" } }, // no center → skip
        { type: "node", lat: 1.333, lon: 103.744, tags: { capacity: "yes" } },
      ],
      dest,
    );
    expect(stands.length).toBe(1);
    expect(stands[0].capacity).toBeNull(); // "yes" isn't a number
  });

  it("returns [] for no elements", () => {
    expect(parseBikeStands([], dest)).toEqual([]);
  });
});
