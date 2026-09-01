import { closeSync, openSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { resolveOtelFiles } from "./paths.js";
import { type NormalizedCall, normalizeSpan } from "./parser.js";
import { metaFilePath, readSessionMeta, type SessionMetaEntry } from "../util/session-meta.js";

export interface ReadOptions { since?: Date; until?: Date }

interface CacheEntry {
  ino: number;
  mtimeMs: number;
  size: number;
  tail: Buffer;
  calls: NormalizedCall[];
  seen: Set<string>;
}

const cache = new Map<string, CacheEntry>();
let enrichedCache: { fingerprint: string; calls: NormalizedCall[] } | null = null;
const READ_CHUNK_BYTES = 1024 * 1024;
const TAIL_CHECK_BYTES = 4096;

// Clears both the per-file parse cache and the derived enriched/sorted cache so tests
// and callers can reset all reader state with one function.
export function clearCache(): void {
  cache.clear();
  enrichedCache = null;
}

function fileFingerprint(file: string): string {
  try {
    const st = statSync(file);
    return `${file}:${st.mtimeMs}:${st.size}`;
  } catch {
    return `${file}:0:0`;
  }
}

function enrichedFingerprint(files: string[]): string {
  return [...files, metaFilePath()].map(fileFingerprint).join("|");
}

function parseLine(line: string, calls: NormalizedCall[], seen: Set<string>): void {
  if (!line.trim()) return;
  try {
    const call = normalizeSpan(JSON.parse(line) as unknown);
    if (call && !seen.has(call.dedup_key)) {
      seen.add(call.dedup_key);
      calls.push(call);
    }
  } catch {
    // Ignore malformed exporter lines; future reads will retry if file metadata changes.
  }
}

function parseRange(file: string, start: number, end: number, calls: NormalizedCall[], seen: Set<string>): void {
  const fd = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  const decoder = new StringDecoder("utf-8");
  let pending = "";
  let position = start;

  try {
    while (position < end) {
      const requested = Math.min(buffer.length, end - position);
      const bytesRead = readSync(fd, buffer, 0, requested, position);
      if (bytesRead === 0) break;
      position += bytesRead;

      const text = pending + decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newline = text.indexOf("\n", lineStart);
      while (newline !== -1) {
        const lineEnd = newline > lineStart && text[newline - 1] === "\r" ? newline - 1 : newline;
        parseLine(text.slice(lineStart, lineEnd), calls, seen);
        lineStart = newline + 1;
        newline = text.indexOf("\n", lineStart);
      }
      pending = text.slice(lineStart);
    }
    pending += decoder.end();
    parseLine(pending, calls, seen);
  } finally {
    closeSync(fd);
  }
}

function readTail(file: string, size: number): Buffer {
  const length = Math.min(size, TAIL_CHECK_BYTES);
  if (length === 0) return Buffer.alloc(0);
  const tail = Buffer.allocUnsafe(length);
  const fd = openSync(file, "r");
  try {
    const bytesRead = readSync(fd, tail, 0, length, size - length);
    return bytesRead === length ? tail : tail.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function parseFile(file: string): NormalizedCall[] {
  const st = statSync(file);
  const cached = cache.get(file);
  if (cached && cached.ino === st.ino && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.calls;
  }

  const previousTail = cached && st.size > cached.size ? readTail(file, cached.size) : null;
  const canAppend = cached
    && cached.ino === st.ino
    && st.size > cached.size
    && previousTail?.equals(cached.tail);
  const calls = canAppend ? [...cached.calls] : [];
  const seen = canAppend ? new Set(cached.seen) : new Set<string>();
  const start = canAppend ? cached.size : 0;

  if (st.size > start) parseRange(file, start, st.size, calls, seen);

  cache.set(file, { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size, tail: readTail(file, st.size), calls, seen });
  return calls;
}

// Render is invoked by the statusline both at chat open and after each turn,
// so a sidecar entry may sit just before or after a chat span. Use a generous
// symmetric window to tolerate either ordering and clock skew.
const META_WINDOW_MS = 30 * 60 * 1000;

function lowerBoundMeta(meta: SessionMetaEntry[], minTime: number): number {
  let lo = 0;
  let hi = meta.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = Date.parse(meta[mid]?.ts ?? "");
    if (!Number.isFinite(t) || t < minTime) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function findMeta(meta: SessionMetaEntry[], call: NormalizedCall): SessionMetaEntry | null {
  if (!meta.length) return null;
  const callTime = Date.parse(call.ts);
  if (!Number.isFinite(callTime)) return null;

  const minTime = callTime - META_WINDOW_MS;
  const maxTime = callTime + META_WINDOW_MS;
  const start = lowerBoundMeta(meta, minTime);
  let best: SessionMetaEntry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = start; i < meta.length; i += 1) {
    const entry = meta[i];
    if (!entry) continue;
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) continue;
    if (t > maxTime) break;
    const delta = Math.abs(t - callTime);
    if (entry.model && entry.model !== call.model) continue;
    if (delta < bestDelta) { bestDelta = delta; best = entry; }
  }
  if (best) return best;

  for (let i = start; i < meta.length; i += 1) {
    const entry = meta[i];
    if (!entry) continue;
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) continue;
    if (t > maxTime) break;
    const delta = Math.abs(t - callTime);
    if (delta < bestDelta) { bestDelta = delta; best = entry; }
  }
  return best;
}

function enrich(calls: NormalizedCall[]): NormalizedCall[] {
  const meta = readSessionMeta();
  return calls.map((call) => {
    const match = meta.length ? findMeta(meta, call) : null;
    const sessionId = call.session_id ?? match?.session_id ?? call.conversation_id ?? null;
    const sessionName = call.session_name ?? match?.session_name ?? null;
    const cwd = call.cwd ?? match?.cwd ?? null;
    if (sessionId === call.session_id && sessionName === (call.session_name ?? null) && cwd === (call.cwd ?? null)) return call;
    return { ...call, session_id: sessionId, session_name: sessionName, cwd };
  });
}

function filterByTime(calls: NormalizedCall[], opts: ReadOptions): NormalizedCall[] {
  const since = opts.since?.getTime();
  const until = opts.until?.getTime();
  if (since === undefined && until === undefined) return calls;
  return calls.filter((call) => {
    const t = Date.parse(call.ts);
    if (since !== undefined && t < since) return false;
    if (until !== undefined && t > until) return false;
    return true;
  });
}

export function readAllCalls(opts: ReadOptions = {}): NormalizedCall[] {
  const files = resolveOtelFiles();
  const fingerprint = enrichedFingerprint(files);
  if (enrichedCache?.fingerprint === fingerprint) return filterByTime(enrichedCache.calls, opts);

  const seen = new Set<string>();
  const out: NormalizedCall[] = [];
  for (const file of files) {
    for (const call of parseFile(file)) {
      if (seen.has(call.dedup_key)) continue;
      seen.add(call.dedup_key);
      out.push(call);
    }
  }

  const calls = enrich(out).sort((a, b) => a.ts.localeCompare(b.ts));
  enrichedCache = { fingerprint, calls };
  return filterByTime(calls, opts);
}
