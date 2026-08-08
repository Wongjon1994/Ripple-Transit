import { describe, it, expect } from "vitest";
import { parseFloodRows, type PubFloodRow } from "./floods.js";

const NOW = Date.parse("2026-05-22T10:00:00+08:00");

const active: PubFloodRow = {
  dateTime: "2026-05-22T09:55:00+08:00",
  msgType: "Alert",
  severity: "Minor",
  expires: "2026-05-22T14:19:37+08:00",
  areaDesc: "Jalan Mastuli, Singapore",
  description: "Flash flood at Jalan Mastuli. Please avoid the area.",
  circle: "1.35479,103.88611 0.05",
};

describe("parseFloodRows", () => {
  it("maps an active alert (circle → point, areaDesc → location)", () => {
    expect(parseFloodRows([active], NOW)).toEqual([
      {
        location: "Jalan Mastuli, Singapore",
        lat: 1.35479,
        lng: 103.88611,
        postedAtISO: "2026-05-22T09:55:00+08:00",
      },
    ]);
  });

  it("drops cancelled and expired alerts", () => {
    const cancelled = { ...active, msgType: "Cancel" };
    const expired = { ...active, expires: "2026-05-22T09:00:00+08:00" };
    expect(parseFloodRows([cancelled, expired], NOW)).toEqual([]);
  });

  it("falls back to description, then skips rows without a circle", () => {
    const noArea = { ...active, areaDesc: undefined };
    expect(parseFloodRows([noArea], NOW)[0].location).toBe(
      "Flash flood at Jalan Mastuli. Please avoid the area.",
    );
    expect(parseFloodRows([{ ...active, circle: undefined }], NOW)).toEqual([]);
  });
});
