import { describe, expect, it } from "vitest";
import {
  compareIsoWeeks,
  isoWeekEndDate,
  isoWeekFromDate,
  isoWeekOrdinal,
  parseIsoWeek,
  precedingWeeks,
  weeksInIsoYear,
} from "@/lib/planning/isoWeek";

describe("ISO weeks", () => {
  it("parses valid weeks and rejects malformed ones", () => {
    expect(parseIsoWeek("2026-W42")).toEqual({ year: 2026, week: 42 });
    for (const bad of ["2026-42", "2026-W4", "2026-W00", "2026-W54", "W42-2026", "", "2025-W53"]) {
      expect(parseIsoWeek(bad)).toBeNull();
    }
    // 2026 starts on a Thursday → 53 ISO weeks
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(parseIsoWeek("2026-W53")).toEqual({ year: 2026, week: 53 });
    expect(weeksInIsoYear(2025)).toBe(52);
  });

  it("sorts across year boundaries numerically, not as strings", () => {
    const weeks = ["2027-W01", "2026-W53", "2026-W09", "2026-W10"].map((w) => parseIsoWeek(w)!);
    const sorted = [...weeks].sort(compareIsoWeeks).map((w) => `${w.year}-W${String(w.week).padStart(2, "0")}`);
    expect(sorted).toEqual(["2026-W09", "2026-W10", "2026-W53", "2027-W01"]);
    expect(isoWeekOrdinal(parseIsoWeek("2027-W01")!) - isoWeekOrdinal(parseIsoWeek("2026-W53")!)).toBe(1);
  });

  it("computes week end dates and preceding windows", () => {
    expect(isoWeekEndDate(parseIsoWeek("2026-W42")!)).toBe("2026-10-18");
    expect(isoWeekFromDate(new Date("2026-10-19T00:00:00Z"))).toBe("2026-W43");
    expect(isoWeekFromDate(new Date("2021-01-01T00:00:00Z"))).toBe("2020-W53");
    expect(precedingWeeks(parseIsoWeek("2027-W02")!, 4)).toEqual(["2026-W52", "2026-W53", "2027-W01", "2027-W02"]);
    expect(precedingWeeks(parseIsoWeek("2026-W42")!, 12)[0]).toBe("2026-W31");
  });
});
