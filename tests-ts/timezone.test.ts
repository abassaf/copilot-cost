import { describe, expect, it } from "vitest";
import {
  bucketKey,
  resolveTimeZone,
  startOfZonedDayMs,
  zonedParts,
  zonedTimeToUtc,
} from "../src/util/timezone.js";

describe("timezone helpers", () => {
  it("falls back to UTC for invalid IANA names", () => {
    expect(resolveTimeZone("Australia/Sydney")).toBe("Australia/Sydney");
    expect(resolveTimeZone("Not/A/Zone")).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone(null)).toBe("UTC");
  });

  it("converts Sydney wall midnight to the correct UTC instant (AEST)", () => {
    // August is standard time in Sydney: UTC+10.
    const utc = zonedTimeToUtc(2026, 8, 20, 0, 0, 0, "Australia/Sydney");
    expect(new Date(utc).toISOString()).toBe("2026-08-19T14:00:00.000Z");
  });

  it("reports zoned parts and bucket keys for Sydney", () => {
    const instant = new Date("2026-08-19T15:45:00.000Z"); // 01:45 next local day
    expect(zonedParts(instant, "Australia/Sydney")).toMatchObject({
      year: 2026,
      month: 8,
      day: 20,
      hour: 1,
      minute: 45,
    });
    expect(bucketKey(instant, "Australia/Sydney", "hour")).toBe("2026-08-20T01");
    expect(bucketKey(instant, "Australia/Sydney", "3h")).toBe("2026-08-20T00");
    expect(bucketKey(instant, "Australia/Sydney", "6h")).toBe("2026-08-20T00");
    expect(bucketKey(instant, "Australia/Sydney", "12h")).toBe("2026-08-20T00");
    expect(bucketKey(instant, "Australia/Sydney", "day")).toBe("2026-08-20");
    expect(bucketKey(instant, "UTC", "hour")).toBe("2026-08-19T15");
    expect(bucketKey(new Date("2026-08-19T11:59:00.000Z"), "UTC", "3h")).toBe("2026-08-19T09");
    expect(bucketKey(new Date("2026-08-19T11:59:00.000Z"), "UTC", "6h")).toBe("2026-08-19T06");
    expect(bucketKey(new Date("2026-08-19T23:59:00.000Z"), "UTC", "12h")).toBe("2026-08-19T12");
  });

  it("startOfZonedDayMs aligns with local midnight", () => {
    const now = new Date("2026-08-19T16:00:00.000Z");
    expect(new Date(startOfZonedDayMs(now, "Australia/Sydney")).toISOString()).toBe(
      "2026-08-19T14:00:00.000Z",
    );
    expect(new Date(startOfZonedDayMs(now, "UTC")).toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });
});
