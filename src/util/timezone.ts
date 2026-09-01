/** IANA time-zone helpers for dashboard range bucketing (browser-local via ?tz=). */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const UTC = "UTC";

export function resolveTimeZone(timeZone?: string | null): string {
  const candidate = String(timeZone ?? "").trim() || UTC;
  try {
    // Throws RangeError for invalid IANA names in modern Node/V8.
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return UTC;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const tz = resolveTimeZone(timeZone);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset (ms) to add to UTC instant to get wall-clock-as-UTC for this zone at `date`. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Convert a wall-clock civil time in `timeZone` to a UTC epoch ms. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const tz = resolveTimeZone(timeZone);
  // Initial guess treats wall time as UTC, then corrects by zone offset (repeat for DST edges).
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i += 1) {
    const offset = timeZoneOffsetMs(new Date(utc), tz);
    utc = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
  }
  return utc;
}

export function startOfZonedDayMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

/** Rolling N zoned-calendar days ending today (inclusive), like UTC rollingWindowStart. */
export function rollingZonedWindowStartMs(date: Date, days: number, timeZone: string): number {
  const startToday = startOfZonedDayMs(date, timeZone);
  if (days <= 1) return startToday;
  // Step back (days-1) local midnights — DST-safe via repeated local-day walk.
  let cursor = startToday;
  for (let i = 0; i < days - 1; i += 1) {
    const prev = new Date(cursor - 12 * 3600_000); // land in previous local day
    cursor = startOfZonedDayMs(prev, timeZone);
  }
  return cursor;
}

export type BucketGrain = "day" | "hour" | "3h" | "6h" | "12h";

export function bucketKey(ts: string | number | Date, timeZone: string, grain: BucketGrain): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  const parts = zonedParts(date, timeZone);
  const y = String(parts.year).padStart(4, "0");
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  if (grain === "hour") {
    const hh = String(parts.hour).padStart(2, "0");
    return `${y}-${m}-${d}T${hh}`;
  }
  const stepMatch = /^(\d+)h$/.exec(grain);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    const h = step * Math.floor(parts.hour / step);
    const hh = String(h).padStart(2, "0");
    return `${y}-${m}-${d}T${hh}`;
  }
  return `${y}-${m}-${d}`;
}
