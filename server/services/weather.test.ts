import { describe, it, expect } from "vitest";
import { weatherAdvisory } from "./weather.js";

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
