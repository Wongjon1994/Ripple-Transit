import { describe, it, expect } from "vitest";
import { congestionLevel } from "./traffic.js";

// v4 RoadCategory codes: 1 Expressway, 2 Major Arterial, 3 Arterial,
// 4 Minor Arterial, 5 Small, 6 Slip, 8 Short Tunnel.
describe("congestionLevel", () => {
  it("treats any slowness on an expressway (cat 1) as a jam", () => {
    expect(congestionLevel(1, 1)).toBe("red");
    expect(congestionLevel(1, 2)).toBe("red");
    expect(congestionLevel(1, 3)).toBe("amber");
    expect(congestionLevel(1, 4)).toBeNull();
  });

  it("flags major/arterial roads (cat 2, 3) only when genuinely crawling", () => {
    // Band 3 (20-29 km/h) is normal for these, so it's ignored.
    for (const cat of [2, 3]) {
      expect(congestionLevel(cat, 1)).toBe("red");
      expect(congestionLevel(cat, 2)).toBe("amber");
      expect(congestionLevel(cat, 3)).toBeNull();
    }
  });

  it("never draws minor / slip / tunnel roads (slow all day = noise)", () => {
    for (const cat of [4, 5, 6, 8]) {
      for (const band of [1, 2, 3]) {
        expect(congestionLevel(cat, band)).toBeNull();
      }
    }
  });

  it("accepts the code as a string too (JSON may send either)", () => {
    expect(congestionLevel("1", 1)).toBe("red");
    expect(congestionLevel("2", 2)).toBe("amber");
  });

  it("ignores a missing reading (band 0)", () => {
    expect(congestionLevel(1, 0)).toBeNull();
    expect(congestionLevel(2, 0)).toBeNull();
    expect(congestionLevel(1, 8)).toBeNull();
  });
});
