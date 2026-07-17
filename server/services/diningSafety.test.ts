import { describe, it, expect } from "vitest";
import {
  extractPostal,
  parseNeaDate,
  isSuspended,
  nameMatch,
  nameTokens,
} from "./diningSafety.js";
import { parseCsv } from "./datagov.js";

describe("extractPostal", () => {
  it("pulls the 6-digit code from NEA-style addresses", () => {
    expect(
      extractPostal("30 SENG POH ROAD TIONG BAHRU MARKET SINGAPORE 168898"),
    ).toBe("168898");
    expect(extractPostal("392 HAVELOCK ROAD (LEVEL 2) SINGAPORE 169663")).toBe(
      "169663",
    );
  });

  it("also accepts trailing bare codes and rejects garbage", () => {
    expect(extractPostal("1 Marina Boulevard, 018989")).toBe("018989");
    expect(extractPostal("no postal here")).toBeNull();
    expect(extractPostal(undefined)).toBeNull();
  });
});

describe("parseNeaDate / isSuspended", () => {
  it('treats "na" as no suspension', () => {
    expect(parseNeaDate("na")).toBeUndefined();
    expect(isSuspended({ name: "X" })).toBe(false);
  });

  it("flags an active suspension window (DD/MM/YYYY)", () => {
    const rec = {
      name: "X",
      suspendedFrom: parseNeaDate("01/07/2026"),
      suspendedTo: parseNeaDate("31/07/2026"),
    };
    expect(isSuspended(rec, new Date(2026, 6, 17))).toBe(true);
    expect(isSuspended(rec, new Date(2026, 7, 2))).toBe(false);
    expect(isSuspended(rec, new Date(2026, 5, 20))).toBe(false);
  });

  it("open-ended suspensions stay active", () => {
    const rec = { name: "X", suspendedFrom: parseNeaDate("2026-07-01") };
    expect(isSuspended(rec, new Date(2026, 11, 1))).toBe(true);
  });
});

describe("nameMatch (confidence gate)", () => {
  it("matches storefront vs licensee when tokens genuinely overlap", () => {
    expect(nameMatch("Tiong Bahru Bakery", "TIONG BAHRU BAKERY PTE. LTD.")).toBe(
      true,
    );
    expect(nameMatch("Ya Kun Kaya Toast", "YA KUN (S) PTE LTD KAYA TOAST")).toBe(
      true,
    );
  });

  it("refuses to claim a match across unrelated outlets in one building", () => {
    expect(
      nameMatch("Starbucks Coffee", "REPUBLIC HOTELS & RESORTS LIMITED"),
    ).toBe(false);
  });

  it("strips corporate noise before comparing", () => {
    expect([...nameTokens("THE COFFEE COMPANY PTE LTD")]).toEqual(["coffee"]);
  });
});

describe("parseCsv", () => {
  it("handles quoted fields with embedded commas and quotes", () => {
    const rows = parseCsv(
      'a,b,c\n"x, y",z,"say ""hi"""\r\nplain,row,3\n',
    );
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", "z", 'say "hi"'],
      ["plain", "row", "3"],
    ]);
  });
});
