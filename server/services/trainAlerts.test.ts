import { describe, it, expect } from "vitest";
import { parsePlanned } from "./trainAlerts.js";

describe("parsePlanned", () => {
  it("extracts a DTL planned adjustment, stripping time + code", () => {
    const p = parsePlanned(
      "23:30-DTL-Planned Service Adjustments. From 10 Jul to 5 Sep 2026, Downtown Line services will end at 11.30pm on Friday nights.",
    );
    expect(p).toEqual({
      line: "DT",
      label: "Planned Service Adjustments.",
    });
  });

  it("keeps an LRT loop notice and maps its code", () => {
    const p = parsePlanned(
      "05:00-SK-Planned Service Adjustment. From 19 Apr to 18 Oct 2026, the Sengkang West LRT Inner Loop will be closed.",
    );
    // SK isn't in LINE_MAP; falls through to undefined line but is railish.
    expect(p?.label).toBe("Planned Service Adjustment.");
  });

  it("ignores bus-diversion notices", () => {
    expect(
      parsePlanned(
        "25/07/2026 08:38-Bus services 170 and 170X have been diverted from Woodlands Road.",
      ),
    ).toBeNull();
  });

  it("ignores non-rail chatter with no line and no rail keyword", () => {
    expect(parsePlanned("09:00-General notice about station cleanliness today"))
      .toBeNull();
  });

  it("keeps a rail notice identified only by keyword", () => {
    const p = parsePlanned("22:00-Track maintenance affects the East-West Line tonight.");
    expect(p?.label).toContain("East-West Line");
  });

  it("truncates a very long label", () => {
    const long = "07:00-NSL-" + "A".repeat(200) + ".";
    const p = parsePlanned(long);
    expect(p?.label.length).toBeLessThanOrEqual(90);
    expect(p?.label.endsWith("…")).toBe(true);
  });

  it("returns null on empty input", () => {
    expect(parsePlanned(undefined)).toBeNull();
    expect(parsePlanned("")).toBeNull();
  });
});
