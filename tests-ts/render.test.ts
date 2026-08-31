import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { computeCost, getModelPrice } from "../src/pricing/loader.js";
import { renderPayload } from "../src/render.js";

const payload = JSON.parse(readFileSync(path.resolve("tests/fixtures/sample-payload.json"), "utf-8")) as unknown;
const savedEnv = { ...process.env };
const tmpHome = path.resolve(".test-home", "render-tests");

beforeEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  process.env = { ...savedEnv, HOME: tmpHome, COPILOT_OTEL_DIR: path.join(tmpHome, ".copilot", "otel") };
  delete process.env.COPILOT_COST_FORMAT;
  delete process.env.COPILOT_COST_METRIC;
  delete process.env.COPILOT_COST_HIDE_ZERO;
  delete process.env.COPILOT_COST_NO_COLOR;
  delete process.env.COPILOT_COST_COLOR;
  delete process.env.NO_COLOR;
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("renderPayload", () => {
  it("renders default standard format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const output = renderPayload(payload, { persist: false });
    expect(output).toContain("$0.2934");
    expect(output).toContain("29.34 AIC");
    expect(output).toContain("38.2k in / 6.1k out");
  });

  it("does not write session metadata when persistence is disabled", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    renderPayload(payload, { persist: false });
    expect(existsSync(path.join(process.env.COPILOT_OTEL_DIR ?? "", "copilot-cost-meta.jsonl"))).toBe(false);
  });

  it("renders a numeric AIC amount for non-numeric token counts", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const malformedPayload = JSON.parse(JSON.stringify(payload)) as { context_window: { total_input_tokens: string } };
    malformedPayload.context_window.total_input_tokens = "not-a-number";

    const output = renderPayload(malformedPayload, { persist: false });

    expect(output).toMatch(/\d+\.\d{2} AIC/);
    expect(output).not.toContain("NaN");
  });

  it("renders compact format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "compact";
    expect(renderPayload(payload, { persist: false })).toBe("$0.2934");
  });

  it("renders verbose format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "verbose";
    const output = renderPayload(payload, { persist: false });
    expect(output).toContain("$0.2934 · 29.34 AIC");
    expect(output).toContain("fresh / 12.0k cache rd / 3.1k cache wr / 6.1k out");
    expect(output).toContain("900 reason");
  });

  it("uses explicit payload AI credits when provided", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const payloadWithCredits = JSON.parse(JSON.stringify(payload)) as { cost: { total_ai_credits: number } };
    payloadWithCredits.cost.total_ai_credits = 12.345;

    expect(renderPayload(payloadWithCredits, { persist: false })).toContain("12.35 AIC");
  });

  it("prefers Copilot CLI ai_used nano-AIU over token-derived cost", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    // 163 AIC = 163e9 nano-AIU (matches CLI footer "Session: 163 AIC used")
    const withNative = JSON.parse(JSON.stringify(payload)) as {
      ai_used: { total_nano_aiu: number; formatted: string };
      model: { id: string; display_name: string };
    };
    withNative.model.id = "grok-4.5";
    withNative.model.display_name = "Grok 4.5";
    withNative.ai_used = { total_nano_aiu: 163_000_000_000, formatted: "163" };

    const output = renderPayload(withNative, { persist: false });
    expect(output).toContain("163.00 AIC");
    expect(output).toContain("$1.6300");
    expect(output).not.toContain("325.37");
  });

  it("uses default-window rates unless context tier is long_context", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const grokSession = JSON.parse(JSON.stringify(payload)) as {
      model: { id: string; display_name: string };
      context_tier?: string;
      context_window: {
        total_input_tokens: number;
        total_output_tokens: number;
        total_cache_read_tokens: number;
        total_cache_write_tokens: number;
      };
    };
    grokSession.model.id = "grok-4.5";
    grokSession.model.display_name = "Grok 4.5";
    grokSession.context_window = {
      total_input_tokens: 2_450_000,
      total_output_tokens: 31_100,
      total_cache_read_tokens: 2_306_500,
      total_cache_write_tokens: 0,
    };

    // Large cumulative tokens still bill at default (small window) rates.
    expect(renderPayload(grokSession, { persist: false })).toContain("$1.6269");

    grokSession.context_tier = "long_context";
    // Same tokens at the pinned large-window mode → long-context rates.
    expect(renderPayload(grokSession, { persist: false })).toContain("$3.2537");
  });

  it.each([
    ["grok-4.5", "Grok 4.5"],
    ["gpt-5.4", "GPT-5.4"],
    ["gpt-5.5", "GPT-5.5"],
    ["gpt-5.6-luna", "GPT-5.6 Luna"],
    ["gpt-5.6-sol", "GPT-5.6 Sol"],
    ["gpt-5.6-terra", "GPT-5.6 Terra"],
    ["gemini-3.1-pro", "Gemini 3.1 Pro"],
  ])("statusline honors pinned context tier for %s", (id, display) => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_METRIC = "usd";
    process.env.COPILOT_COST_FORMAT = "compact";
    const session = JSON.parse(JSON.stringify(payload)) as {
      model: { id: string; display_name: string };
      context_tier?: string;
      context_window: {
        total_input_tokens: number;
        total_output_tokens: number;
        total_cache_read_tokens: number;
        total_cache_write_tokens: number;
      };
    };
    session.model.id = id;
    session.model.display_name = display;
    session.context_window = {
      total_input_tokens: 1_000_000,
      total_output_tokens: 10_000,
      total_cache_read_tokens: 800_000,
      total_cache_write_tokens: 0,
    };

    const { price } = getModelPrice(id);
    expect(price).not.toBeNull();
    const tokens = { input: 1_000_000, cache_read: 800_000, cache_write: 0, output: 10_000 };

    session.context_tier = "default";
    expect(renderPayload(session, { persist: false })).toBe(
      `$${computeCost(tokens, price!, { contextTier: "default" }).toFixed(4)}`,
    );

    session.context_tier = "long_context";
    expect(renderPayload(session, { persist: false })).toBe(
      `$${computeCost(tokens, price!, { contextTier: "long_context" }).toFixed(4)}`,
    );
  });

  it("keeps rendering token usage when auto model pricing is unavailable", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const autoPayload = JSON.parse(JSON.stringify(payload)) as { model: { id: string; display_name: string } };
    autoPayload.model.id = "auto";
    autoPayload.model.display_name = "Auto";

    const output = renderPayload(autoPayload, { persist: false });

    expect(output).toContain("? AIC (auto)");
    expect(output).toContain("38.2k in / 6.1k out");
    expect(output).not.toContain("$?");
  });

  it.each([
    ["standard", "$0.2934 · 29.34 AIC · 38.2k in / 6.1k out · 15.1k cache"],
    ["compact", "$0.2934"],
    ["full", "$0.2934 · 29.34 AIC · 23.1k fresh / 12.0k cache rd / 3.1k cache wr / 6.1k out · Σ 44.3k · 900 reason"],
  ])("prices auto model from display name in %s format", (format, expected) => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = format;
    const autoPayload = JSON.parse(JSON.stringify(payload)) as { model: { id: string } };
    autoPayload.model.id = "auto";

    expect(renderPayload(autoPayload, { persist: false })).toBe(expected);
  });

  it.each([
    ["standard", "? AIC (auto) · 38.2k in / 6.1k out · 15.1k cache"],
    ["compact", "? AIC (auto)"],
    ["full", "? AIC (auto) · 23.1k fresh / 12.0k cache rd / 3.1k cache wr / 6.1k out · Σ 44.3k · 900 reason"],
  ])("renders auto model without pricing in %s format", (format, expected) => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = format;
    const autoPayload = JSON.parse(JSON.stringify(payload)) as { model: { id: string; display_name: string } };
    autoPayload.model.id = "auto";
    autoPayload.model.display_name = "Auto";

    expect(renderPayload(autoPayload, { persist: false })).toBe(expected);
  });

  it("converts explicit AI credits to dollars in verbose format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "verbose";
    const autoPayload = JSON.parse(JSON.stringify(payload)) as { model: { id: string }; cost: { total_ai_credits: number } };
    autoPayload.model.id = "auto";
    autoPayload.cost.total_ai_credits = 12.345;

    expect(renderPayload(autoPayload, { persist: false })).toContain("$0.1235 · 12.35 AIC");
  });

  it("allows AIC-only metric in compact format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "compact";
    process.env.COPILOT_COST_METRIC = "aic";

    expect(renderPayload(payload, { persist: false })).toBe("29.34 AIC");
  });

  it("allows dollars-only metric in standard format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_METRIC = "usd";

    expect(renderPayload(payload, { persist: false })).toBe("$0.2934 · 38.2k in / 6.1k out · 15.1k cache");
  });

  it("strips ANSI color when color is disabled", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const output = renderPayload(payload, { persist: false });
    expect(output).not.toMatch(/\u001b\[/);
  });

  it("renders a zero placeholder by default when payload has no usage", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    expect(renderPayload({}, { persist: false })).toBe("$0.0000 · 0.00 AIC · 0 in / 0 out");
  });

  it("returns empty string when payload has no usage and COPILOT_COST_HIDE_ZERO is set", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_HIDE_ZERO = "1";
    expect(renderPayload({}, { persist: false })).toBe("");
  });

  it("renders a zero placeholder in compact format by default", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "compact";
    expect(renderPayload({}, { persist: false })).toBe("$0.0000");
  });
});
