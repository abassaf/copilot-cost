import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { FxRate } from "./types.js";

export const CACHE_DIR = path.join(homedir(), ".copilot", "cost-cache");
export const CACHE_FX = path.join(CACHE_DIR, "fx-usd-aud.json");
export const CACHE_FX_LAST_ATTEMPT = `${CACHE_FX}.last-attempt`;

type CacheEntry = { mtimeMs: number; size: number; value: FxRate };
const fxCache = new Map<string, CacheEntry>();

export function getFxCachePath(): string {
  return process.env.COPILOT_COST_FX_CACHE || CACHE_FX;
}

export function getFxRetryMarkerPath(cachePath = getFxCachePath()): string {
  return `${cachePath}.last-attempt`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateFxRate(value: unknown): FxRate {
  if (!isObject(value) || value.schema_version !== 1 || value.base !== "USD" || value.quote !== "AUD") {
    throw new Error("invalid FX cache schema");
  }
  if (typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate <= 0) {
    throw new Error("invalid USD/AUD FX rate");
  }
  if (typeof value.fetched_at !== "string" || !value.fetched_at) throw new Error("invalid FX fetched_at");
  if (value.provider_date !== undefined && typeof value.provider_date !== "string") {
    throw new Error("invalid FX provider_date");
  }
  if (value.source !== "frankfurter" && value.source !== "fawaz-jsdelivr" && value.source !== "fawaz-cloudflare") {
    throw new Error("invalid FX source");
  }
  if (typeof value.source_url !== "string" || !value.source_url) throw new Error("invalid FX source_url");
  if (typeof value.ttl_seconds !== "number" || !Number.isFinite(value.ttl_seconds) || value.ttl_seconds < 0) {
    throw new Error("invalid FX ttl_seconds");
  }
  return value as unknown as FxRate;
}

export function clearFxCache(): void {
  fxCache.clear();
}

export function loadFx(fxPath = getFxCachePath()): FxRate {
  const resolved = path.resolve(fxPath);
  if (!existsSync(resolved)) throw new Error(`FX cache not found: ${fxPath}`);
  const { mtimeMs, size } = statSync(resolved);
  const cached = fxCache.get(resolved);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value;
  const value = validateFxRate(JSON.parse(readFileSync(resolved, "utf-8")) as unknown);
  fxCache.set(resolved, { mtimeMs, size, value });
  return value;
}

export const loadFxRate = loadFx;
