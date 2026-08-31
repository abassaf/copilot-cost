import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".test-work", "fx");
const cachePath = path.join(root, "fx-usd-aud.json");
const savedEnv = { ...process.env };

function frankfurterBody(rate = 1.5, date = "2026-08-18") {
  return { amount: 1.0, base: "USD", date, rates: { AUD: rate } };
}

function fawazBody(rate = 1.4, date = "2026-08-18") {
  return { date, usd: { aud: rate } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  process.env = {
    ...savedEnv,
    COPILOT_COST_FX_CACHE: cachePath,
    COPILOT_COST_REFRESH_FX_DAYS: "1",
    COPILOT_COST_REFRESH_RETRY_MINUTES: "60",
  };
  delete process.env.COPILOT_COST_AUTO_REFRESH;
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("FX provider parsers", () => {
  it("parses Frankfurter USD→AUD rate", async () => {
    const { parseFrankfurterResponse } = await import("../src/fx/provider.js");
    const rate = parseFrankfurterResponse(frankfurterBody(1.4062), "2026-08-19T00:00:00.000Z", 86_400);
    expect(rate).toMatchObject({
      schema_version: 1,
      base: "USD",
      quote: "AUD",
      rate: 1.4062,
      provider_date: "2026-08-18",
      source: "frankfurter",
    });
  });

  it("parses Fawaz USD→AUD rate", async () => {
    const { parseFawazResponse } = await import("../src/fx/provider.js");
    const rate = parseFawazResponse(fawazBody(1.4072), "fawaz-jsdelivr", "2026-08-19T00:00:00.000Z", 86_400);
    expect(rate).toMatchObject({
      base: "USD",
      quote: "AUD",
      rate: 1.4072,
      provider_date: "2026-08-18",
      source: "fawaz-jsdelivr",
    });
  });

  it("rejects non-positive rates", async () => {
    const { parseFrankfurterResponse } = await import("../src/fx/provider.js");
    expect(() => parseFrankfurterResponse(frankfurterBody(0))).toThrow(/invalid/i);
    expect(() => parseFrankfurterResponse(frankfurterBody(-1))).toThrow(/invalid/i);
    expect(() => parseFrankfurterResponse({ base: "USD", rates: {} })).toThrow(/invalid/i);
  });
});

describe("FX loader and fetcher", () => {
  it("loads and validates a cached rate", async () => {
    const { clearFxCache, loadFx, validateFxRate } = await import("../src/fx/loader.js");
    clearFxCache();
    const cached = validateFxRate({
      schema_version: 1,
      base: "USD",
      quote: "AUD",
      rate: 1.5,
      fetched_at: "2026-08-19T00:00:00.000Z",
      provider_date: "2026-08-18",
      source: "frankfurter",
      source_url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD",
      ttl_seconds: 86_400,
    });
    writeFileSync(cachePath, JSON.stringify(cached), "utf-8");
    expect(loadFx(cachePath).rate).toBe(1.5);
  });

  it("uses fresh cache without network", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const { clearFxCache, validateFxRate } = await import("../src/fx/loader.js");
    const { getFxStatus } = await import("../src/fx/index.js");
    clearFxCache();
    writeFileSync(
      cachePath,
      JSON.stringify(
        validateFxRate({
          schema_version: 1,
          base: "USD",
          quote: "AUD",
          rate: 1.52,
          fetched_at: new Date().toISOString(),
          source: "frankfurter",
          source_url: "https://example.test",
          ttl_seconds: 86_400,
        }),
      ),
      "utf-8",
    );

    const status = await getFxStatus();
    expect(status).toMatchObject({ available: true, rate: 1.52, stale: false });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("fetches Frankfurter and writes cache atomically", async () => {
    const upstream = vi.fn().mockResolvedValue(jsonResponse(frankfurterBody(1.4062)));
    vi.stubGlobal("fetch", upstream);
    const { clearFxCache } = await import("../src/fx/loader.js");
    const { refreshFxDetailed } = await import("../src/fx/fetcher.js");
    clearFxCache();

    const result = await refreshFxDetailed({ force: true, dest: cachePath });
    expect(result.error).toBeUndefined();
    expect(result.rate?.rate).toBe(1.4062);
    expect(existsSync(cachePath)).toBe(true);
    expect(JSON.parse(readFileSync(cachePath, "utf-8"))).toMatchObject({ rate: 1.4062, source: "frankfurter" });
    expect(upstream).toHaveBeenCalledWith(
      expect.stringContaining("frankfurter"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const calledUrl = String(upstream.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).not.toMatch(/session|token|cost|otel/i);
  });

  it("falls back to Fawaz when Frankfurter fails", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 503))
      .mockResolvedValueOnce(jsonResponse(fawazBody(1.41)));
    vi.stubGlobal("fetch", upstream);
    const { clearFxCache } = await import("../src/fx/loader.js");
    const { refreshFxDetailed } = await import("../src/fx/fetcher.js");
    clearFxCache();

    const result = await refreshFxDetailed({ force: true, dest: cachePath });
    expect(result.error).toBeUndefined();
    expect(result.rate).toMatchObject({ rate: 1.41, source: "fawaz-jsdelivr" });
  });

  it("preserves last-known-good cache when refresh fails", async () => {
    const { clearFxCache, validateFxRate } = await import("../src/fx/loader.js");
    const { getFxStatus } = await import("../src/fx/index.js");
    clearFxCache();
    writeFileSync(
      cachePath,
      JSON.stringify(
        validateFxRate({
          schema_version: 1,
          base: "USD",
          quote: "AUD",
          rate: 1.33,
          fetched_at: "2020-01-01T00:00:00.000Z",
          source: "frankfurter",
          source_url: "https://example.test",
          ttl_seconds: 86_400,
        }),
      ),
      "utf-8",
    );
    // Force stale by setting TTL to 0 days and clear retry marker suppression
    process.env.COPILOT_COST_REFRESH_FX_DAYS = "0";
    process.env.COPILOT_COST_REFRESH_RETRY_MINUTES = "0";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const status = await getFxStatus({ force: true });
    expect(status.available).toBe(true);
    expect(status.rate).toBe(1.33);
    expect(status.stale).toBe(true);
    expect(status.error).toMatch(/offline|HTTP|invalid/i);
  });

  it("returns unavailable status when offline with no cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { clearFxCache } = await import("../src/fx/loader.js");
    const { getFxStatus } = await import("../src/fx/index.js");
    clearFxCache();
    process.env.COPILOT_COST_REFRESH_RETRY_MINUTES = "0";

    const status = await getFxStatus({ force: true });
    expect(status).toMatchObject({
      available: false,
      base: "USD",
      quote: "AUD",
      rate: null,
      stale: false,
    });
    expect(status.error).toBeTruthy();
  });

  it("skips network when COPILOT_COST_AUTO_REFRESH=0 unless forced", async () => {
    const upstream = vi.fn().mockResolvedValue(jsonResponse(frankfurterBody(1.6)));
    vi.stubGlobal("fetch", upstream);
    process.env.COPILOT_COST_AUTO_REFRESH = "0";
    const { clearFxCache } = await import("../src/fx/loader.js");
    const { getFxStatus } = await import("../src/fx/index.js");
    clearFxCache();

    const auto = await getFxStatus();
    expect(auto.available).toBe(false);
    expect(upstream).not.toHaveBeenCalled();

    const forced = await getFxStatus({ force: true });
    expect(forced.available).toBe(true);
    expect(forced.rate).toBe(1.6);
    expect(upstream).toHaveBeenCalled();
  });
});
