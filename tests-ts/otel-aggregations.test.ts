import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  allowedTimeseriesGrains,
  defaultTimeseriesGrain,
  exportCsv,
  models,
  resolveTimeseriesGrain,
  sessions,
  sessionDetail,
  summary,
  timeseries,
} from "../src/otel/aggregations.js";
import { type NormalizedCall } from "../src/otel/parser.js";

function call(partial: Partial<NormalizedCall>): NormalizedCall {
  return { dedup_key: partial.dedup_key ?? randomUUID(), session_id: Object.hasOwn(partial, "session_id") ? partial.session_id! : "s1", ts: partial.ts ?? "2026-05-13T12:00:00.000Z", model: partial.model ?? "m1", input_tokens: partial.input_tokens ?? 0, output_tokens: partial.output_tokens ?? 0, cache_read: partial.cache_read ?? 0, cache_creation: partial.cache_creation ?? 0, reasoning: partial.reasoning ?? 0, usd_cost: partial.usd_cost ?? 0, duration_ms: partial.duration_ms ?? 0, source: partial.source ?? "cli-span" };
}

describe("OTel aggregations", () => {
  it("resolves the supported timeseries grain for each range", () => {
    expect(defaultTimeseriesGrain("7d")).toBe("3h");
    expect(defaultTimeseriesGrain("30d")).toBe("day");
    expect(resolveTimeseriesGrain("30d", "6h")).toBe("6h");
    expect(resolveTimeseriesGrain("30d", "3h")).toBe("day");
    expect(resolveTimeseriesGrain("7d", "day")).toBe("day");
    expect(resolveTimeseriesGrain("7d", "6h")).toBe("3h");
    expect(allowedTimeseriesGrains("7d")).toEqual(["day", "3h"]);
    expect(allowedTimeseriesGrains("30d")).toEqual(["day", "6h", "12h"]);
    expect(allowedTimeseriesGrains("1d")).toEqual(["hour"]);
  });

  it("handles empty input", () => {
    expect(summary([], new Date("2026-05-13T12:00:00Z")).lifetime.usd_cost).toBe(0);
    expect(sessions([])).toEqual([]);
    expect(timeseries([], "all")).toEqual([]);
    expect(models([])).toEqual([]);
    expect(exportCsv([])).toContain("dedup_key,session_id,ts,model");
  });

  it("summarizes periods, sessions, timeseries, models, and CSV", () => {
    const calls = [
      call({ dedup_key: "a", session_id: "s1", ts: "2026-05-13T10:00:00.000Z", model: "m1", input_tokens: 10, output_tokens: 5, cache_read: 5, cache_creation: 1, usd_cost: 1, duration_ms: 100 }),
      call({ dedup_key: "b", session_id: "s1", ts: "2026-05-12T10:00:00.000Z", model: "m2", input_tokens: 20, output_tokens: 7, cache_read: 0, cache_creation: 3, usd_cost: 2, duration_ms: 200 }),
      call({ dedup_key: "c", session_id: "s2", ts: "2026-05-05T10:00:00.000Z", model: "m1", input_tokens: 30, output_tokens: 9, cache_read: 10, cache_creation: 0, usd_cost: 3, duration_ms: 300 }),
    ];

    const sum = summary(calls, new Date("2026-05-13T12:00:00Z"));
    expect(sum.lifetime).toEqual({ usd_cost: 6, input_tokens: 60, output_tokens: 21, cache_tokens: 19, premium_requests: 3 });
    expect(sum.today.usd_cost).toBe(1);
    expect(sum.week.usd_cost).toBe(3);
    expect(sum.month.usd_cost).toBe(6);
    expect(sum.quarter.usd_cost).toBe(6);
    expect(sum.session_count).toBe(2);

    const sessionRows = sessions(calls);
    expect(sessionRows).toHaveLength(2);
    expect(sessionRows.find((row) => row.id === "s1")).toMatchObject({ usd_cost: 3, total_input_tokens: 30, total_output_tokens: 12, total_cache_read_tokens: 5, total_cache_write_tokens: 4, premium_requests: 2, api_duration_ms: 300 });

    expect(sessionDetail(calls, "s1").llm_calls).toHaveLength(2);
    expect(timeseries(calls, "all")).toEqual([
      { day: "2026-05-05", model: "m1", usd_cost: 3, input_tokens: 30, output_tokens: 9, cache_read_tokens: 10, cache_write_tokens: 0, token_volume: 49 },
      { day: "2026-05-12", model: "m2", usd_cost: 2, input_tokens: 20, output_tokens: 7, cache_read_tokens: 0, cache_write_tokens: 3, token_volume: 30 },
      { day: "2026-05-13", model: "m1", usd_cost: 1, input_tokens: 10, output_tokens: 5, cache_read_tokens: 5, cache_write_tokens: 1, token_volume: 21 },
    ]);

    const modelRows = models(calls);
    expect(modelRows.find((row) => row.model === "m1")).toMatchObject({
      sessions: 2,
      usd_cost: 4,
      token_volume: 70,
      input_tokens: 40,
      output_tokens: 14,
      cache_read_tokens: 15,
      cache_write_tokens: 1,
    });
    expect(modelRows.find((row) => row.model === "m1")?.cache_hit_ratio).toBeCloseTo(15 / 56, 6);
    expect(exportCsv(calls)).toContain("a,s1,2026-05-13T10:00:00.000Z,m1");
  });

  it("scopes models to the same rolling range as timeseries", () => {
    vi.useFakeTimers({ now: new Date("2026-08-19T12:00:00.000Z") });
    try {
      const calls = [
        call({ dedup_key: "recent", session_id: "s1", ts: "2026-08-19T10:00:00.000Z", model: "m1", input_tokens: 10, output_tokens: 2, cache_read: 3, cache_creation: 1, usd_cost: 1 }),
        call({ dedup_key: "window-start", session_id: "s2", ts: "2026-08-13T10:00:00.000Z", model: "m2", input_tokens: 20, output_tokens: 4, cache_read: 5, cache_creation: 1, usd_cost: 2 }),
        call({ dedup_key: "old", session_id: "s3", ts: "2026-08-12T10:00:00.000Z", model: "m3", input_tokens: 40, output_tokens: 8, usd_cost: 4 }),
      ];

      expect(models(calls, "7d")).toMatchObject([
        { model: "m2", sessions: 1, usd_cost: 2, token_volume: 30, input_tokens: 20, output_tokens: 4, cache_read_tokens: 5, cache_write_tokens: 1 },
        { model: "m1", sessions: 1, usd_cost: 1, token_volume: 16, input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 1 },
      ]);
      expect(models(calls, "7d")).not.toEqual(expect.arrayContaining([expect.objectContaining({ model: "m3" })]));
      expect(models(calls)).toEqual(models(calls, "all"));
      expect(models(calls)).toEqual(expect.arrayContaining([
        expect.objectContaining({ model: "m3", usd_cost: 4 }),
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses hourly buckets for 1d, 3-hour buckets for 7d, and daily buckets for longer ranges", () => {
    vi.useFakeTimers({ now: new Date("2026-08-19T16:00:00.000Z") });
    try {
      const hourlyCalls = [
        call({ dedup_key: "hour-10", session_id: "s1", ts: "2026-08-19T10:15:00.000Z", model: "m1", input_tokens: 10, output_tokens: 2, cache_read: 3, cache_creation: 1, usd_cost: 1 }),
        call({ dedup_key: "hour-15", session_id: "s2", ts: "2026-08-19T15:45:00.000Z", model: "m1", input_tokens: 20, output_tokens: 4, cache_read: 5, cache_creation: 2, usd_cost: 2 }),
      ];

      expect(timeseries(hourlyCalls, "1d")).toEqual([
        { day: "2026-08-19T10", model: "m1", usd_cost: 1, input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 1, token_volume: 16 },
        { day: "2026-08-19T15", model: "m1", usd_cost: 2, input_tokens: 20, output_tokens: 4, cache_read_tokens: 5, cache_write_tokens: 2, token_volume: 31 },
      ]);
      expect(timeseries(hourlyCalls, "7d")).toEqual([
        { day: "2026-08-19T09", model: "m1", usd_cost: 1, input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 1, token_volume: 16 },
        { day: "2026-08-19T15", model: "m1", usd_cost: 2, input_tokens: 20, output_tokens: 4, cache_read_tokens: 5, cache_write_tokens: 2, token_volume: 31 },
      ]);

      const modelCalls = [
        ...hourlyCalls,
        call({ dedup_key: "yesterday", session_id: "s3", ts: "2026-08-18T23:00:00.000Z", model: "yesterday-model", usd_cost: 4 }),
      ];
      expect(models(modelCalls, "1d")).toEqual(expect.arrayContaining([
        expect.objectContaining({ model: "m1", usd_cost: 3, token_volume: 47 }),
      ]));
      expect(models(modelCalls, "1d")).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ model: "yesterday-model" }),
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("buckets 1d hours and cutoffs in the requested IANA timezone", () => {
    // 2026-08-19T16:00Z = 2026-08-20 02:00 in Australia/Sydney (AEST, UTC+10).
    vi.useFakeTimers({ now: new Date("2026-08-19T16:00:00.000Z") });
    try {
      const tz = "Australia/Sydney";
      const hourlyCalls = [
        // 20:15 previous local day — outside "today"
        call({ dedup_key: "prev-local", session_id: "s1", ts: "2026-08-19T10:15:00.000Z", model: "m1", input_tokens: 10, output_tokens: 2, cache_read: 3, cache_creation: 1, usd_cost: 1 }),
        // 01:45 local today
        call({ dedup_key: "today-local", session_id: "s2", ts: "2026-08-19T15:45:00.000Z", model: "m1", input_tokens: 20, output_tokens: 4, cache_read: 5, cache_creation: 2, usd_cost: 2 }),
      ];

      expect(timeseries(hourlyCalls, "1d", tz)).toEqual([
        { day: "2026-08-20T01", model: "m1", usd_cost: 2, input_tokens: 20, output_tokens: 4, cache_read_tokens: 5, cache_write_tokens: 2, token_volume: 31 },
      ]);
      expect(timeseries(hourlyCalls, "7d", tz)).toEqual([
        { day: "2026-08-19T18", model: "m1", usd_cost: 1, input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 1, token_volume: 16 },
        { day: "2026-08-20T00", model: "m1", usd_cost: 2, input_tokens: 20, output_tokens: 4, cache_read_tokens: 5, cache_write_tokens: 2, token_volume: 31 },
      ]);

      expect(models(hourlyCalls, "1d", tz)).toEqual([
        expect.objectContaining({ model: "m1", usd_cost: 2, token_volume: 31 }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges calls in the same 3-hour local bucket", () => {
    vi.useFakeTimers({ now: new Date("2026-08-19T16:00:00.000Z") });
    try {
      const calls = [
        call({ dedup_key: "bucket-10", ts: "2026-08-19T10:00:00.000Z", input_tokens: 10, output_tokens: 2, cache_read: 3, cache_creation: 1, usd_cost: 1 }),
        call({ dedup_key: "bucket-11", ts: "2026-08-19T11:59:00.000Z", input_tokens: 20, output_tokens: 4, cache_read: 5, cache_creation: 2, usd_cost: 2 }),
      ];

      expect(timeseries(calls, "7d")).toEqual([
        { day: "2026-08-19T09", model: "m1", usd_cost: 3, input_tokens: 30, output_tokens: 6, cache_read_tokens: 8, cache_write_tokens: 3, token_volume: 47 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps 30d timeseries buckets at calendar-day grain", () => {
    vi.useFakeTimers({ now: new Date("2026-08-19T16:00:00.000Z") });
    try {
      const calls = [
        call({ dedup_key: "day-10", ts: "2026-08-19T10:00:00.000Z", usd_cost: 1 }),
        call({ dedup_key: "day-15", ts: "2026-08-19T15:00:00.000Z", usd_cost: 2 }),
      ];

      expect(timeseries(calls, "30d")).toEqual([
        { day: "2026-08-19", model: "m1", usd_cost: 3, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_volume: 0 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses an explicit grain for 30d timeseries buckets", () => {
    const calls = [
      call({ dedup_key: "grain-10", ts: "2026-08-19T10:00:00.000Z", usd_cost: 1 }),
      call({ dedup_key: "grain-15", ts: "2026-08-19T15:00:00.000Z", usd_cost: 2 }),
    ];

    expect(timeseries(calls, "30d", "UTC", "day")).toEqual([
      { day: "2026-08-19", model: "m1", usd_cost: 3, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_volume: 0 },
    ]);
    expect(timeseries(calls, "30d", "UTC", "6h")).toEqual([
      { day: "2026-08-19T06", model: "m1", usd_cost: 1, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_volume: 0 },
      { day: "2026-08-19T12", model: "m1", usd_cost: 2, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_volume: 0 },
    ]);
    expect(timeseries(calls, "30d", "UTC", "12h")).toEqual([
      { day: "2026-08-19T00", model: "m1", usd_cost: 1, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_volume: 0 },
      { day: "2026-08-19T12", model: "m1", usd_cost: 2, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_volume: 0 },
    ]);
  });

  it("computes week as a rolling 7-day window rather than ISO-week-to-date", () => {
    // "now" is a Thursday, so ISO-week-to-date would only start from the preceding
    // Monday (3 days back). A call from 5 days ago falls before that Monday but is
    // still within the last 7 days, so it must be included in `week`.
    const calls = [
      call({ dedup_key: "recent", ts: "2026-08-05T10:00:00.000Z", usd_cost: 1 }),
      call({ dedup_key: "before-iso-monday", ts: "2026-08-01T10:00:00.000Z", usd_cost: 2 }),
      call({ dedup_key: "too-old", ts: "2026-07-29T10:00:00.000Z", usd_cost: 4 }),
    ];

    const sum = summary(calls, new Date("2026-08-06T12:00:00Z"));
    expect(sum.week.usd_cost).toBe(3);
  });

  it("computes month as a rolling 30-day window rather than calendar-month-to-date", () => {
    // "now" is early in August, so calendar-month-to-date would only span a few days
    // and wrongly match the 7-day total. A call from late July is >7 days old but
    // still within the last 30 days, so it must be included in `month` but not `week`.
    const calls = [
      call({ dedup_key: "recent", ts: "2026-08-05T10:00:00.000Z", usd_cost: 1 }),
      call({ dedup_key: "last-month", ts: "2026-07-20T10:00:00.000Z", usd_cost: 2 }),
      call({ dedup_key: "too-old", ts: "2026-06-01T10:00:00.000Z", usd_cost: 4 }),
    ];

    const sum = summary(calls, new Date("2026-08-06T12:00:00Z"));
    expect(sum.week.usd_cost).toBe(1);
    expect(sum.month.usd_cost).toBe(3);
  });

  it("computes quarter as a rolling 90-day window", () => {
    const calls = [
      call({ dedup_key: "recent", ts: "2026-08-05T10:00:00.000Z", usd_cost: 1 }),
      call({ dedup_key: "two-months-ago", ts: "2026-06-20T10:00:00.000Z", usd_cost: 2 }),
      call({ dedup_key: "too-old", ts: "2026-04-01T10:00:00.000Z", usd_cost: 4 }),
    ];

    const sum = summary(calls, new Date("2026-08-06T12:00:00Z"));
    expect(sum.month.usd_cost).toBe(1);
    expect(sum.quarter.usd_cost).toBe(3);
    expect(sum.lifetime.usd_cost).toBe(7);
  });

  it("handles a single unknown-session call", () => {
    const rows = sessions([call({ session_id: null, usd_cost: 0.5 })]);
    expect(rows[0]?.id).toBe("unknown");
  });
});
