import { describe, expect, it } from "vitest";
import { startOfTodayRange, zonedDate, zonedMidnightToUtc } from "../../app/lib/timezone";

describe("time zone helpers", () => {
  it("computes local midnight in UTC", () => {
    expect(zonedMidnightToUtc("2026-10-09", "Europe/Berlin").toISOString()).toBe("2026-10-08T22:00:00.000Z");
    expect(zonedMidnightToUtc("2026-01-15", "Europe/Berlin").toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(zonedMidnightToUtc("2026-10-09", "UTC").toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  it("uses the shop's calendar day for 'today'", () => {
    // 23:30 UTC on 9 Oct is already 10 Oct in Berlin.
    const now = new Date("2026-10-09T23:30:00Z");
    expect(zonedDate(now, "Europe/Berlin")).toBe("2026-10-10");
    const { start, end } = startOfTodayRange("Europe/Berlin", now);
    expect(start.toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-10T22:00:00.000Z");
  });

  it("handles month ends and DST changes", () => {
    // Clocks go back on 25 Oct 2026 in Berlin: that day has 25 hours.
    const { start, end } = startOfTodayRange("Europe/Berlin", new Date("2026-10-25T12:00:00Z"));
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
    const m = startOfTodayRange("UTC", new Date("2026-01-31T10:00:00Z"));
    expect(m.end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});
