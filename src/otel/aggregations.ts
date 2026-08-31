import { type NormalizedCall } from "./parser.js";
import { bucketKey, resolveTimeZone, rollingZonedWindowStartMs } from "../util/timezone.js";

export interface PeriodTotals { usd_cost: number; input_tokens: number; output_tokens: number; cache_tokens: number; premium_requests: number }
export interface Summary {
  lifetime: PeriodTotals;
  today: PeriodTotals;
  /** Rolling 7-day window ending today, not ISO-week-to-date. */
  week: PeriodTotals;
  /** Rolling 30-day window ending today, not calendar-month-to-date. */
  month: PeriodTotals;
  /** Rolling 90-day window ending today. */
  quarter: PeriodTotals;
  session_count: number;
  range: { from: string; to: string };
}
export interface SessionRow { id: string; cwd: string | null; first_model: string | null; started_at: string; last_seen_at: string; session_name: string | null; model: string | null; usd_cost: number; total_input_tokens: number; total_output_tokens: number; total_cache_read_tokens: number; total_cache_write_tokens: number; premium_requests: number; api_duration_ms: number }
export interface SessionDetail { session_id: string; llm_calls: NormalizedCall[] }
export interface TimeseriesPoint {
  day: string;
  model: string;
  usd_cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** Fresh input + output + cache read + cache write — matches models().token_volume. */
  token_volume: number;
}
export interface ModelLeaderboardRow {
  model: string;
  sessions: number;
  usd_cost: number;
  /** Fresh input + output + cache read + cache write. */
  token_volume: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_hit_ratio: number;
}

export type TimeseriesGrain = "day" | "hour" | "3h" | "6h" | "12h";

export function allowedTimeseriesGrains(rangeName: string): TimeseriesGrain[] {
  if (rangeName === "1d") return ["hour"];
  if (rangeName === "7d") return ["day", "3h"];
  if (rangeName === "30d") return ["day", "6h", "12h"];
  return ["day"];
}

export function defaultTimeseriesGrain(rangeName: string): TimeseriesGrain {
  if (rangeName === "1d") return "hour";
  if (rangeName === "7d") return "3h";
  return "day";
}

export function resolveTimeseriesGrain(rangeName: string, requested?: string | null): TimeseriesGrain {
  const allowed = allowedTimeseriesGrains(rangeName);
  if (requested && (allowed as string[]).includes(requested)) return requested as TimeseriesGrain;
  return defaultTimeseriesGrain(rangeName);
}

type Totals = PeriodTotals;

function zero(): Totals {
  return { usd_cost: 0, input_tokens: 0, output_tokens: 0, cache_tokens: 0, premium_requests: 0 };
}

function add(total: Totals, call: NormalizedCall): void {
  total.usd_cost += call.usd_cost;
  total.input_tokens += call.input_tokens;
  total.output_tokens += call.output_tokens;
  total.cache_tokens += call.cache_read + call.cache_creation;
  // OTel has no premium-request counter; use one distinct normalized call as the proxy.
  total.premium_requests += 1;
}

function utcStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Rolling N-day window ending today (inclusive), matching the "7-day"/"30-day" UI
// labels rather than ISO-calendar-week-to-date or calendar-month-to-date.
function rollingWindowStart(date: Date, days: number): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (days - 1));
}

function rangeDayCount(rangeName: string): number | null {
  return rangeName === "1d" ? 1 : rangeName === "7d" ? 7 : rangeName === "30d" ? 30 : rangeName === "90d" ? 90 : null;
}

/** Inclusive rolling window start; uses IANA `timeZone` (default UTC). */
export function rangeCutoff(rangeName: string, now = new Date(), timeZone = "UTC"): number | null {
  const days = rangeDayCount(rangeName);
  if (days === null) return null;
  const tz = resolveTimeZone(timeZone);
  if (tz === "UTC") return rollingWindowStart(now, days);
  return rollingZonedWindowStartMs(now, days, tz);
}

function day(ts: string, timeZone = "UTC"): string {
  return bucketKey(ts, timeZone, "day");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function summary(calls: NormalizedCall[], now = new Date()): Summary {
  const lifetime = zero();
  const today = zero();
  const week = zero();
  const month = zero();
  const quarter = zero();
  const todayStart = utcStart(now).getTime();
  const weekStart = rollingWindowStart(now, 7);
  const monthStart = rollingWindowStart(now, 30);
  const quarterStart = rollingWindowStart(now, 90);
  const sessionsSeen = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;

  for (const call of calls) {
    add(lifetime, call);
    if (call.session_id) sessionsSeen.add(call.session_id);
    if (!from || call.ts < from) from = call.ts;
    if (!to || call.ts > to) to = call.ts;
    const t = Date.parse(call.ts);
    if (t >= todayStart) add(today, call);
    if (t >= weekStart) add(week, call);
    if (t >= monthStart) add(month, call);
    if (t >= quarterStart) add(quarter, call);
  }

  return { lifetime, today, week, month, quarter, session_count: sessionsSeen.size, range: { from: from ?? "", to: to ?? "" } };
}

export function sessions(calls: NormalizedCall[]): SessionRow[] {
  const bySession = new Map<string, SessionRow>();
  for (const call of calls) {
    const id = call.session_id ?? "unknown";
    let row = bySession.get(id);
    if (!row) {
      row = { id, cwd: call.cwd ?? null, first_model: call.model, started_at: call.ts, last_seen_at: call.ts, session_name: call.session_name ?? null, model: call.model, usd_cost: 0, total_input_tokens: 0, total_output_tokens: 0, total_cache_read_tokens: 0, total_cache_write_tokens: 0, premium_requests: 0, api_duration_ms: 0 };
      bySession.set(id, row);
    }
    if (call.ts < row.started_at) {
      row.started_at = call.ts;
      row.first_model = call.model;
    }
    if (call.ts >= row.last_seen_at) {
      row.last_seen_at = call.ts;
      row.model = call.model;
    }
    row.usd_cost += call.usd_cost;
    row.total_input_tokens += call.input_tokens;
    row.total_output_tokens += call.output_tokens;
    row.total_cache_read_tokens += call.cache_read;
    row.total_cache_write_tokens += call.cache_creation;
    row.premium_requests += 1;
    row.api_duration_ms += call.duration_ms;
  }
  return [...bySession.values()].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
}

export function sessionDetail(calls: NormalizedCall[], sessionId: string): SessionDetail {
  const scoped = calls.filter((call) => (call.session_id ?? "unknown") === sessionId);
  return {
    session_id: sessionId,
    llm_calls: scoped,
  };
}

export function timeseries(
  calls: NormalizedCall[],
  rangeName: string,
  timeZone = "UTC",
  grain?: string | null,
): TimeseriesPoint[] {
  const tz = resolveTimeZone(timeZone);
  const cutoff = rangeCutoff(rangeName, new Date(), tz);
  const resolved = resolveTimeseriesGrain(rangeName, grain);
  const rows = new Map<string, TimeseriesPoint>();
  for (const call of calls) {
    if (cutoff !== null && Date.parse(call.ts) < cutoff) continue;
    // Stores the zone wall-clock bucket key (YYYY-MM-DD or YYYY-MM-DDTHH).
    const bucket = bucketKey(call.ts, tz, resolved);
    const key = `${bucket}\u0000${call.model}`;
    const row = rows.get(key) ?? {
      day: bucket,
      model: call.model,
      usd_cost: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      token_volume: 0,
    };
    row.usd_cost += call.usd_cost;
    row.input_tokens += call.input_tokens;
    row.output_tokens += call.output_tokens;
    row.cache_read_tokens += call.cache_read;
    row.cache_write_tokens += call.cache_creation;
    row.token_volume += call.input_tokens + call.output_tokens + call.cache_read + call.cache_creation;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model));
}

export function models(calls: NormalizedCall[], rangeName = "all", timeZone = "UTC"): ModelLeaderboardRow[] {
  const tz = resolveTimeZone(timeZone);
  const cutoff = rangeCutoff(rangeName, new Date(), tz);
  const stats = new Map<string, {
    sessions: Set<string>;
    usd_cost: number;
    token_volume: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  }>();
  for (const call of calls) {
    if (cutoff !== null && Date.parse(call.ts) < cutoff) continue;
    const row = stats.get(call.model) ?? {
      sessions: new Set<string>(),
      usd_cost: 0,
      token_volume: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };
    if (call.session_id) row.sessions.add(call.session_id);
    row.usd_cost += call.usd_cost;
    row.input_tokens += call.input_tokens;
    row.output_tokens += call.output_tokens;
    row.cache_read_tokens += call.cache_read;
    row.cache_write_tokens += call.cache_creation;
    row.token_volume += call.input_tokens + call.output_tokens + call.cache_read + call.cache_creation;
    stats.set(call.model, row);
  }
  return [...stats.entries()].map(([model, row]) => {
    const denom = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens || 1;
    return {
      model,
      sessions: row.sessions.size,
      usd_cost: row.usd_cost,
      token_volume: row.token_volume,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_write_tokens: row.cache_write_tokens,
      cache_hit_ratio: clamp01(row.cache_read_tokens / denom),
    };
  }).sort((a, b) => b.usd_cost - a.usd_cost || a.model.localeCompare(b.model));
}

function csvValue(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function exportCsv(calls: NormalizedCall[]): string {
  const columns: { header: string; get: (call: NormalizedCall) => unknown }[] = [
    { header: "dedup_key", get: (call) => call.dedup_key },
    { header: "session_id", get: (call) => call.session_id },
    { header: "ts", get: (call) => call.ts },
    { header: "model", get: (call) => call.model },
    { header: "input_tokens", get: (call) => call.input_tokens },
    { header: "output_tokens", get: (call) => call.output_tokens },
    { header: "cache_read", get: (call) => call.cache_read },
    { header: "cache_creation", get: (call) => call.cache_creation },
    { header: "reasoning", get: (call) => call.reasoning },
    { header: "usd_cost", get: (call) => call.usd_cost },
    { header: "duration_ms", get: (call) => call.duration_ms },
    { header: "source", get: (call) => call.source },
  ];
  const lines = [columns.map((column) => column.header).join(",")];
  for (const call of calls) lines.push(columns.map((column) => csvValue(column.get(call))).join(","));
  return `${lines.join("\n")}\n`;
}
