import type { FxRate } from "./types.js";

export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD";
export const FAWAZ_JSDLIVR_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";
export const FAWAZ_CLOUDFLARE_URL = "https://latest.currency-api.pages.dev/v1/currencies/usd.json";

type JsonObject = Record<string, unknown>;
type Provider = {
  source: FxRate["source"];
  url: string;
  parse: (value: unknown, fetchedAt: string, ttlSeconds: number, sourceUrl: string) => FxRate;
};

function objectValue(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? value as JsonObject : {};
}

function positiveRate(value: unknown): number {
  const rate = value;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("invalid USD/AUD FX rate");
  }
  return rate;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function makeRate(
  rate: unknown,
  providerDate: unknown,
  source: FxRate["source"],
  sourceUrl: string,
  fetchedAt: string,
  ttlSeconds: number,
): FxRate {
  const date = stringValue(providerDate);
  return {
    schema_version: 1,
    base: "USD",
    quote: "AUD",
    rate: positiveRate(rate),
    fetched_at: fetchedAt,
    ...(date ? { provider_date: date } : {}),
    source,
    source_url: sourceUrl,
    ttl_seconds: ttlSeconds,
  };
}

export function parseFrankfurterResponse(
  value: unknown,
  fetchedAt = new Date().toISOString(),
  ttlSeconds = 86_400,
  sourceUrl = FRANKFURTER_URL,
): FxRate {
  const body = objectValue(value);
  const rates = objectValue(body.rates);
  return makeRate(rates.AUD, body.date, "frankfurter", sourceUrl, fetchedAt, ttlSeconds);
}

export const parseFrankfurter = parseFrankfurterResponse;

export function parseFawazResponse(
  value: unknown,
  source: FxRate["source"] = "fawaz-jsdelivr",
  fetchedAt = new Date().toISOString(),
  ttlSeconds = 86_400,
  sourceUrl = source === "fawaz-cloudflare" ? FAWAZ_CLOUDFLARE_URL : FAWAZ_JSDLIVR_URL,
): FxRate {
  const body = objectValue(value);
  const usd = objectValue(body.usd);
  return makeRate(usd.aud, body.date, source, sourceUrl, fetchedAt, ttlSeconds);
}

export const parseFawaz = parseFawazResponse;

async function request(provider: Provider, ttlSeconds: number): Promise<FxRate> {
  const response = await fetch(provider.url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as unknown;
  return provider.parse(body, new Date().toISOString(), ttlSeconds, provider.url);
}

export async function fetchFxRate(ttlSeconds = 86_400): Promise<FxRate> {
  const providers: Provider[] = [
    { source: "frankfurter", url: FRANKFURTER_URL, parse: parseFrankfurterResponse },
    {
      source: "fawaz-jsdelivr",
      url: FAWAZ_JSDLIVR_URL,
      parse: (value, fetchedAt, ttl, url) => parseFawazResponse(value, "fawaz-jsdelivr", fetchedAt, ttl, url),
    },
    {
      source: "fawaz-cloudflare",
      url: FAWAZ_CLOUDFLARE_URL,
      parse: (value, fetchedAt, ttl, url) => parseFawazResponse(value, "fawaz-cloudflare", fetchedAt, ttl, url),
    },
  ];
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await request(provider, ttlSeconds);
    } catch (error) {
      errors.push(`${provider.source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("; "));
}
