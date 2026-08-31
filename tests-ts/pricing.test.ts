import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearPricingCache, computeCost, getModelPrice, loadPricing, normalizeModel } from "../src/pricing/loader.js";

const root = path.resolve(".test-work", "pricing-loader");
const pricingFile = path.join(root, "pricing.yaml");

function pricingYaml(input: number, extra = ""): string {
  return `schema_version: 1
fetched_at: "2025-01-01T00:00:00.000Z"
models:
  gpt-5-mini:
    vendor: openai
    input: ${input}
    cached_input: 0.1
    output: 2
${extra}`;
}

beforeEach(() => {
  clearPricingCache();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  clearPricingCache();
  rmSync(root, { recursive: true, force: true });
});

describe("pricing loader", () => {
  it("loads the bundled snapshot with numeric prices", () => {
    const pricing = loadPricing();
    expect(Object.keys(pricing.models).length).toBeGreaterThanOrEqual(3);
    const first = Object.values(pricing.models)[0];
    expect(first).toBeDefined();
    expect(typeof first?.input).toBe("number");
    expect(typeof first?.cached_input).toBe("number");
    expect(typeof first?.output).toBe("number");
  });

  it("memoizes pricing by path until the file changes", () => {
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");

    const first = loadPricing(pricingFile);
    const second = loadPricing(pricingFile);

    expect(second).toBe(first);
  });

  it("invalidates memoized pricing when mtime or size changes", () => {
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");
    const first = loadPricing(pricingFile);

    writeFileSync(pricingFile, pricingYaml(3, "    cache_write: 4\n"), "utf-8");
    const second = loadPricing(pricingFile);

    expect(second).not.toBe(first);
    expect(second.models["gpt-5-mini"]?.input).toBe(3);
    expect(second.models["gpt-5-mini"]?.cache_write).toBe(4);
  });

  it("clearPricingCache forces pricing to be read again", () => {
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");
    const first = loadPricing(pricingFile);

    clearPricingCache();
    const second = loadPricing(pricingFile);

    expect(second).not.toBe(first);
    expect(second.models["gpt-5-mini"]?.input).toBe(1);
  });

  it("normalizes internal suffixes while preserving fast model pricing", () => {
    expect(normalizeModel("claude-opus-4.7-1m-internal")).toBe("claude-opus-4.7");
    expect(normalizeModel("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro");
    expect(normalizeModel("gpt-5-mini-fast")).toBe("gpt-5-mini-fast");
    expect(normalizeModel("Claude Opus 4.8 (fast mode) (preview)")).toBe("claude-opus-4.8-fast");
  });

  it("normalizes display names and auto labels", () => {
    expect(normalizeModel("Claude Opus 4.7")).toBe("claude-opus-4.7");
    expect(normalizeModel("GPT-5 mini")).toBe("gpt-5-mini");
    expect(normalizeModel("Auto (Claude Sonnet 4.6)")).toBe("claude-sonnet-4.6");
  });

  it("computes cost using fresh, cache read, cache write, and output tokens", () => {
    const price = { vendor: "anthropic", input: 5, cached_input: 0.5, cache_write: 6.25, output: 25 };
    const cost = computeCost({ input: 38_200, cache_read: 12_000, cache_write: 3_100, output: 6_100 }, price);
    expect(cost).toBeCloseTo(0.293375, 9);
  });

  it("uses long-context rates only when the context-window mode is long_context", () => {
    const price = {
      vendor: "openai",
      input: 2.5,
      cached_input: 0.25,
      output: 15,
      long_context_threshold: 272_000,
      long_context_input: 5,
      long_context_cached_input: 0.5,
      long_context_output: 22.5,
    };
    const tokens = { input: 500_000, cache_read: 0, cache_write: 0, output: 1_000 };
    // Large input alone must NOT flip tiers — Copilot pins default vs long_context mode.
    expect(computeCost(tokens, price)).toBeCloseTo(1.265);
    expect(computeCost(tokens, price, { contextTier: "default" })).toBeCloseTo(1.265);
    expect(computeCost(tokens, price, { contextTier: "long_context" })).toBeCloseTo(2.5225);
  });

  it("applies mode-based long-context rates for every catalog model that has a tier", () => {
    const pricing = loadPricing();
    const longContextModels = Object.entries(pricing.models).filter(
      ([, price]) => price.long_context_input != null || price.long_context_threshold != null,
    );
    // Current GitHub catalog: GPT-5.4/5.5/5.6*, Gemini 3.1 Pro, Grok 4.5, …
    expect(longContextModels.length).toBeGreaterThanOrEqual(7);

    const tokens = { input: 400_000, cache_read: 100_000, cache_write: 0, output: 5_000 };
    for (const [model, price] of longContextModels) {
      const defaultCost = computeCost(tokens, price, { contextTier: "default" });
      const longCost = computeCost(tokens, price, { contextTier: "long_context" });
      const expectedDefault =
        (300_000 / 1_000_000) * price.input +
        (100_000 / 1_000_000) * price.cached_input +
        (5_000 / 1_000_000) * price.output;
      const expectedLong =
        (300_000 / 1_000_000) * (price.long_context_input ?? price.input) +
        (100_000 / 1_000_000) * (price.long_context_cached_input ?? price.cached_input) +
        (5_000 / 1_000_000) * (price.long_context_output ?? price.output);

      expect(defaultCost, model).toBeCloseTo(expectedDefault, 10);
      expect(longCost, model).toBeCloseTo(expectedLong, 10);
      expect(longCost, model).toBeGreaterThan(defaultCost);
      // Input token count must not matter for tier selection.
      expect(computeCost({ ...tokens, input: 10_000 }, price, { contextTier: "long_context" }), model)
        .toBeLessThan(longCost);
    }
  });

  it("falls back to the bundled snapshot when a refreshed pricing table drops a retired model", () => {
    // A live-refreshed pricing table only lists models GitHub currently publishes, so it
    // can omit models a user historically used. getModelPrice must fall back to the
    // bundled snapshot rather than silently reporting $0 for that historical usage.
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");

    const missingFromRefresh = getModelPrice("gpt-4.1", pricingFile);
    expect(missingFromRefresh.price).not.toBeNull();
    expect(missingFromRefresh.price?.input).toBeGreaterThan(0);

    // A model present in the refreshed table must still take precedence over the snapshot.
    const presentInRefresh = getModelPrice("gpt-5-mini", pricingFile);
    expect(presentInRefresh.price?.input).toBe(1);
  });
});
