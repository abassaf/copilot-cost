export interface FxRate {
  schema_version: 1;
  base: "USD";
  quote: "AUD";
  rate: number;
  fetched_at: string;
  provider_date?: string;
  source: "frankfurter" | "fawaz-jsdelivr" | "fawaz-cloudflare";
  source_url: string;
  ttl_seconds: number;
}

export interface FxStatus {
  available: boolean;
  base: "USD";
  quote: "AUD";
  rate: number | null;
  fetched_at?: string;
  provider_date?: string;
  source?: string;
  ttl_seconds: number;
  stale: boolean;
  error?: string;
}
