import process from "node:process";
import { cacheIsFresh, fxTtlSeconds, refreshFxDetailed } from "./fetcher.js";
import { getFxCachePath, loadFx } from "./loader.js";
import type { FxRate, FxStatus } from "./types.js";

export type { FxRate, FxStatus } from "./types.js";

function statusFromRate(rate: FxRate, stale: boolean, error?: string): FxStatus {
  return {
    available: true,
    base: "USD",
    quote: "AUD",
    rate: rate.rate,
    fetched_at: rate.fetched_at,
    ...(rate.provider_date ? { provider_date: rate.provider_date } : {}),
    source: rate.source,
    ttl_seconds: rate.ttl_seconds,
    stale,
    ...(error ? { error } : {}),
  };
}

function isFresh(cachePath: string): boolean {
  try {
    return cacheIsFresh(cachePath);
  } catch {
    return false;
  }
}

export async function getFxStatus(opts: { force?: boolean } = {}): Promise<FxStatus> {
  const cachePath = getFxCachePath();
  let cached: FxRate | null = null;
  try {
    cached = loadFx(cachePath);
  } catch {
    cached = null;
  }
  const fresh = cached !== null && isFresh(cachePath);
  if (cached && fresh && !opts.force) return statusFromRate(cached, false);

  const autoRefreshDisabled = process.env.COPILOT_COST_AUTO_REFRESH === "0";
  let refreshError: string | undefined;
  if (opts.force || !autoRefreshDisabled) {
    const result = await refreshFxDetailed({ force: opts.force, dest: cachePath });
    refreshError = result.error;
    try {
      cached = loadFx(cachePath);
    } catch {
      // Keep the previously loaded value, if any, as a stale fallback.
    }
  }

  if (cached) return statusFromRate(cached, !isFresh(cachePath), refreshError);
  return {
    available: false,
    base: "USD",
    quote: "AUD",
    rate: null,
    ttl_seconds: fxTtlSeconds(),
    stale: false,
    ...(refreshError ? { error: refreshError } : {}),
  };
}
