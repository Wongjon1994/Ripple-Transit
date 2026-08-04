import { describe, it, expect } from "vitest";
import {
  estimateTaxiFare,
  classifyAvailability,
  taxiSurcharges,
} from "./taxi.js";

// A town pickup (not near Changi) and a Changi T1 pickup.
const TOWN = { lat: 1.29, lng: 103.85 };
const CHANGI_T1 = { lat: 1.3644, lng: 103.9915 };
// SG time = UTC + 8h; build instants by their SG wall-clock.
const sgTime = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(y, m, d, h, min) - 8 * 3_600_000);

describe("taxiSurcharges", () => {
  it("adds +25% peak in the evening (daily 6pm–midnight)", () => {
    const s = taxiSurcharges(20, TOWN, sgTime(2026, 7, 5, 20)); // Wed 20:00
    expect(s).toEqual([{ label: "Peak-hour (+25%)", amount: 5 }]);
  });

  it("adds +50% late-night (midnight–6am)", () => {
    const s = taxiSurcharges(20, TOWN, sgTime(2026, 7, 5, 2)); // 02:00
    expect(s).toEqual([{ label: "Late-night (+50%)", amount: 10 }]);
  });

  it("adds +25% on a weekday morning peak (6:00–9:29)", () => {
    const s = taxiSurcharges(20, TOWN, sgTime(2026, 7, 3, 7, 30)); // Mon 07:30
    expect(s).toEqual([{ label: "Peak-hour (+25%)", amount: 5 }]);
  });

  it("has no time surcharge at a weekday midday", () => {
    const s = taxiSurcharges(20, TOWN, sgTime(2026, 7, 5, 14)); // Wed 14:00
    expect(s).toEqual([]);
  });

  it("adds the flat Changi Airport surcharge from the airport", () => {
    // Wed midday: $6 base airport rate, no peak.
    expect(taxiSurcharges(20, CHANGI_T1, sgTime(2026, 7, 5, 14))).toEqual([
      { label: "Changi Airport", amount: 6 },
    ]);
    // Fri evening: higher $8 airport rate, stacked with evening peak.
    expect(taxiSurcharges(20, CHANGI_T1, sgTime(2026, 7, 7, 19))).toEqual([
      { label: "Peak-hour (+25%)", amount: 5 },
      { label: "Changi Airport", amount: 8 },
    ]);
  });
});

describe("estimateTaxiFare", () => {
  it("is the flag-down for a near-zero distance", () => {
    expect(estimateTaxiFare(0)).toBeCloseTo(4.4, 2);
  });

  it("adds metered distance and increases monotonically", () => {
    const f5 = estimateTaxiFare(5000);
    const f10 = estimateTaxiFare(10000);
    const f15 = estimateTaxiFare(15000);
    expect(f5).toBeGreaterThan(4.4);
    expect(f10).toBeGreaterThan(f5);
    expect(f15).toBeGreaterThan(f10);
  });

  it("charges a finer rate beyond 10 km", () => {
    // per-metre rate after 10km (per 350m) is higher than before (per 400m)
    const before = estimateTaxiFare(10000) - estimateTaxiFare(9000); // 1km @ 400m
    const after = estimateTaxiFare(15000) - estimateTaxiFare(14000); // 1km @ 350m
    expect(after).toBeGreaterThan(before);
  });
});

describe("classifyAvailability", () => {
  it("maps counts to levels", () => {
    expect(classifyAvailability(10).availability).toBe("available");
    expect(classifyAvailability(4).availability).toBe("limited");
    expect(classifyAvailability(0).availability).toBe("unavailable");
  });
  it("gives shorter waits when more taxis are near", () => {
    expect(classifyAvailability(12).waitMin).toBeLessThan(
      classifyAvailability(1).waitMin,
    );
  });
});
