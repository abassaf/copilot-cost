import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearFxCache, getFxCachePath, getFxRetryMarkerPath, loadFx } from "./loader.js";
import { fetchFxRate } from "./provider.js";
import type { FxRate } from "./types.js";

export function fxTtlSeconds(): number {
  const configuredDays = Number.parseFloat(process.env.COPILOT_COST_REFRESH_FX_DAYS ?? "1");
  const days = Number.isFinite(configuredDays) && configuredDays >= 0 ? configuredDays : 1;
  return days * 24 * 60 * 60;
}

export function cacheIsFresh(fxPath = getFxCachePath()): boolean {
  if (!existsSync(fxPath)) return false;
  const ageMs = Date.now() - statSync(fxPath).mtimeMs;
  return ageMs < fxTtlSeconds() * 1000;
}

function refreshAttemptIsRecent(dest: string): boolean {
  const marker = getFxRetryMarkerPath(dest);
  if (!existsSync(marker)) return false;
  const configuredMinutes = Number.parseFloat(process.env.COPILOT_COST_REFRESH_RETRY_MINUTES ?? "60");
  const minutes = Number.isFinite(configuredMinutes) && configuredMinutes >= 0 ? configuredMinutes : 60;
  return Date.now() - statSync(marker).mtimeMs < minutes * 60 * 1000;
}

function writeAtomically(dest: string, contents: string): void {
  const temporary = `${dest}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, "utf-8");
    renameSync(temporary, dest);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export interface RefreshFxResult {
  path: string;
  rate?: FxRate;
  error?: string;
  attempted: boolean;
}

export async function refreshFxDetailed(opts: { force?: boolean; dest?: string } = {}): Promise<RefreshFxResult> {
  const dest = opts.dest ?? getFxCachePath();
  try {
    mkdirSync(path.dirname(dest), { recursive: true });
    if (!opts.force && cacheIsFresh(dest)) return { path: dest, attempted: false };
    if (!opts.force && refreshAttemptIsRecent(dest)) return { path: dest, attempted: false };
    const marker = getFxRetryMarkerPath(dest);
    writeFileSync(marker, new Date().toISOString(), "utf-8");
    const rate = await fetchFxRate(fxTtlSeconds());
    writeAtomically(dest, JSON.stringify(rate, null, 2) + "\n");
    clearFxCache();
    return { path: dest, rate, attempted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path: dest, error: message, attempted: true };
  }
}

export async function refreshFx(opts: { force?: boolean; dest?: string } = {}): Promise<string> {
  const result = await refreshFxDetailed(opts);
  if (result.error) {
    console.error(
      `warning: FX refresh failed (${result.error}); using ${existsSync(result.path) ? "existing cache" : "unavailable"}`,
    );
  }
  return result.path;
}

export function cachedFxIsStale(fxPath = getFxCachePath()): boolean {
  return existsSync(fxPath) && !cacheIsFresh(fxPath);
}

export function loadCachedFx(fxPath = getFxCachePath()): FxRate | null {
  try {
    return loadFx(fxPath);
  } catch {
    return null;
  }
}
