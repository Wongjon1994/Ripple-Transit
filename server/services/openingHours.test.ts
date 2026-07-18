import { describe, it, expect } from "vitest";
import {
  parseOpeningHours,
  readOpeningHours,
  nameMatches,
  matchOpeningHours,
  type OsmPlace,
} from "./openingHours.js";

// A fixed instant: 2026-07-20 (Monday) 14:30 SGT = 06:30 UTC.
const MON_1430 = new Date("2026-07-20T06:30:00Z");
// 2026-07-20 (Monday) 23:30 SGT = 15:30 UTC.
const MON_2330 = new Date("2026-07-20T15:30:00Z");
// 2026-07-19 (Sunday) 10:00 SGT = 02:00 UTC.
const SUN_1000 = new Date("2026-07-19T02:00:00Z");

describe("parseOpeningHours", () => {
  it("handles 24/7", () => {
    const w = parseOpeningHours("24/7");
    expect(w).not.toBeNull();
    expect(w![0]).toEqual([{ start: 0, end: 1440 }]);
  });

  it("parses weekday ranges + a Saturday rule", () => {
    const w = parseOpeningHours("Mo-Fr 09:00-18:00; Sa 09:00-13:00; Su off");
    expect(w![0]).toEqual([{ start: 540, end: 1080 }]); // Mon
    expect(w![5]).toEqual([{ start: 540, end: 780 }]); // Sat
    expect(w![6]).toEqual([]); // Sun off
  });

  it("parses multiple ranges (lunch break) and overnight", () => {
    const w = parseOpeningHours("Mo 08:00-12:00,13:00-17:00");
    expect(w![0]).toEqual([
      { start: 480, end: 720 },
      { start: 780, end: 1020 },
    ]);
    const overnight = parseOpeningHours("Mo-Su 22:00-02:00");
    expect(overnight![0]).toEqual([{ start: 1320, end: 1560 }]);
  });

  it("returns null on unsupported constructs (never guesses)", () => {
    expect(parseOpeningHours("sunrise-sunset")).toBeNull();
    expect(parseOpeningHours("Mo-Fr 09:00+")).toBeNull();
    expect(parseOpeningHours('Mo-Fr 09:00-17:00 "by appointment"')).toBeNull();
    expect(parseOpeningHours("Jan-Mar 09:00-17:00")).toBeNull();
    expect(parseOpeningHours("")).toBeNull();
  });
});

describe("evaluate", () => {
  it("reports open + closing time inside hours", () => {
    const info = readOpeningHours("Mo-Fr 09:00-18:00", MON_1430)!;
    expect(info.openNow).toBe(true);
    expect(info.status).toBe("Open · closes 6 pm");
  });

  it("reports closed + next open when after hours", () => {
    const info = readOpeningHours("Mo-Fr 09:00-18:00", MON_2330)!;
    expect(info.openNow).toBe(false);
    expect(info.status).toBe("Closed · opens tomorrow 9 am");
  });

  it("reports closed today, opens later in the week", () => {
    const info = readOpeningHours("Mo-Fr 09:00-18:00", SUN_1000)!;
    expect(info.openNow).toBe(false);
    // Sunday → next opening is Monday (tomorrow).
    expect(info.status).toBe("Closed · opens tomorrow 9 am");
  });

  it("flags 24/7 as always open", () => {
    const info = readOpeningHours("24/7", MON_2330)!;
    expect(info.alwaysOpen).toBe(true);
    expect(info.openNow).toBe(true);
    expect(info.status).toBe("Open 24 hours");
  });

  it("handles overnight spillover from the previous day", () => {
    // Open 22:00–02:00 daily; at Mon 00:30 the shop opened Sunday night.
    const monLate = new Date("2026-07-19T16:30:00Z"); // Mon 00:30 SGT
    const info = readOpeningHours("Mo-Su 22:00-02:00", monLate)!;
    expect(info.openNow).toBe(true);
    expect(info.status).toBe("Open · closes 2 am");
  });

  it("orders the weekly breakdown from today", () => {
    const info = readOpeningHours("Mo-Fr 09:00-18:00", MON_1430)!;
    expect(info.week[0].day).toBe("Mon");
    expect(info.week[0].label).toBe("9 am – 6 pm");
    expect(info.week[6].day).toBe("Sun");
    expect(info.week[6].label).toBe("Closed");
  });
});

describe("nameMatches", () => {
  it("matches on containment and token overlap", () => {
    expect(nameMatches("FairPrice Finest", "NTUC FairPrice Finest")).toBe(true);
    expect(nameMatches("Cold Storage", "Cold Storage Jelita")).toBe(true);
    expect(nameMatches("Guardian", "Watsons")).toBe(false);
  });
});

describe("matchOpeningHours", () => {
  const places: OsmPlace[] = [
    { name: "FairPrice Finest", lat: 1.3, lng: 103.8, openingHours: "Mo-Su 08:00-22:00" },
    { name: "Watsons", lat: 1.3005, lng: 103.8005, openingHours: "Mo-Su 10:00-22:00" },
  ];

  it("matches by name within distance", () => {
    const info = matchOpeningHours(
      { name: "NTUC FairPrice Finest", point: { lat: 1.3001, lng: 103.8001 } },
      places,
      MON_1430,
    );
    expect(info?.openNow).toBe(true);
    expect(info?.status).toBe("Open · closes 10 pm");
  });

  it("returns null when nothing matches nearby", () => {
    const info = matchOpeningHours(
      { name: "Sheng Siong", point: { lat: 1.3001, lng: 103.8001 } },
      places,
      MON_1430,
    );
    expect(info).toBeNull();
  });

  it("returns null when the match is too far away", () => {
    const info = matchOpeningHours(
      { name: "FairPrice Finest", point: { lat: 1.35, lng: 103.85 } },
      places,
      MON_1430,
    );
    expect(info).toBeNull();
  });
});
