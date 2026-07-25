import { describe, it, expect } from "vitest";
import { congestionLevel } from "./traffic.js";

describe("congestionLevel", () => {
  it("treats any slowness on an expressway as a jam", () => {
    // Cat A free-flows ~1% of the time — band ≤3 is genuinely abnormal.
    expect(congestionLevel("A", 1)).toBe("red");
    expect(congestionLevel("A", 2)).toBe("red");
    expect(congestionLevel("A", 3)).toBe("amber");
    expect(congestionLevel("A", 4)).toBeNull();
  });

  it("flags major/arterial roads only when genuinely crawling", () => {
    // Band 3 (20-29 km/h) is normal for these, so it's ignored.
    for (const cat of ["B", "C"]) {
      expect(congestionLevel(cat, 1)).toBe("red");
      expect(congestionLevel(cat, 2)).toBe("amber");
      expect(congestionLevel(cat, 3)).toBeNull();
    }
  });

  it("never draws minor roads — they are slow all day (noise, not signal)", () => {
    for (const cat of ["D", "E", "F"]) {
      for (const band of [1, 2, 3]) {
        expect(congestionLevel(cat, band)).toBeNull();
      }
    }
  });

  it("ignores a missing reading (band 0) and free-flowing roads", () => {
    expect(congestionLevel("A", 0)).toBeNull();
    expect(congestionLevel("B", 0)).toBeNull();
    expect(congestionLevel("A", 8)).toBeNull();
  });
});
