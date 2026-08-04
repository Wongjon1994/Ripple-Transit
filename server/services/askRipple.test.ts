import { describe, it, expect } from "vitest";
import { normalizeIntent } from "./askRipple.js";
import type { AskIntent } from "../../shared/types.js";

const base: AskIntent = {
  from: null,
  to: null,
  mode: null,
  timeMode: null,
  time: null,
  preferences: [],
  understood: "",
};

describe("normalizeIntent", () => {
  it("trims strings and empties blanks to null", () => {
    const out = normalizeIntent({
      ...base,
      from: "  current location ",
      to: "  Orchard MRT ",
      understood: "  To Orchard MRT ",
    });
    expect(out.from).toBe("current location");
    expect(out.to).toBe("Orchard MRT");
    expect(out.understood).toBe("To Orchard MRT");
  });

  it("keeps a valid HH:MM time and defaults timeMode to leave", () => {
    const out = normalizeIntent({ ...base, time: "18:00" });
    expect(out.time).toBe("18:00");
    expect(out.timeMode).toBe("leave");
  });

  it("preserves an explicit arrive timeMode", () => {
    const out = normalizeIntent({ ...base, time: "18:00", timeMode: "arrive" });
    expect(out.timeMode).toBe("arrive");
  });

  it("drops a malformed time (and its timeMode)", () => {
    const out = normalizeIntent({ ...base, time: "6pm", timeMode: "arrive" });
    expect(out.time).toBeNull();
    expect(out.timeMode).toBe("arrive"); // sense is kept even without a clock
  });

  it("drops time entirely when none was given", () => {
    const out = normalizeIntent({ ...base, time: null, timeMode: null });
    expect(out.time).toBeNull();
    expect(out.timeMode).toBeNull();
  });

  it("de-dupes preferences", () => {
    const out = normalizeIntent({
      ...base,
      preferences: ["walking", "walking", "carbon"],
    });
    expect(out.preferences).toEqual(["walking", "carbon"]);
  });
});
