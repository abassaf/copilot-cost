import { expect, test } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const testHome = path.resolve(".test-home/e2e");
const otelDir = path.join(testHome, ".copilot", "otel");
const jsonlPath = path.join(otelDir, "copilot-otel.jsonl");

function tupleFrom(date: Date): [number, number] {
  return [Math.floor(date.getTime() / 1000), (date.getTime() % 1000) * 1_000_000];
}

function writeOtelFixture(): void {
  rmSync(testHome, { recursive: true, force: true });
  mkdirSync(otelDir, { recursive: true });
  const now = new Date();
  const lines = [
    {
      type: "span",
      name: "chat claude-opus-4.7",
      traceId: "trace-e2e-a",
      spanId: "span-e2e-a",
      startTime: tupleFrom(now),
      endTime: tupleFrom(new Date(now.getTime() + 1200)),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "claude-opus-4.7",
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.cache_read.input_tokens": 200,
        "gen_ai.usage.cache_creation.input_tokens": 50,
        "gen_ai.usage.output_tokens": 150,
        "copilot.session_id": "e2e-session-build",
        "copilot.session_name": "Build dashboard e2e",
        "copilot.cwd": "/tmp/copilot-cost-e2e",
      },
    },
    {
      type: "span",
      name: "chat gpt-5-mini",
      traceId: "trace-e2e-b",
      spanId: "span-e2e-b",
      startTime: tupleFrom(new Date(now.getTime() - 86_400_000)),
      endTime: tupleFrom(new Date(now.getTime() - 86_398_500)),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-5-mini",
        "gen_ai.usage.input_tokens": 700,
        "gen_ai.usage.cache_read.input_tokens": 100,
        "gen_ai.usage.output_tokens": 90,
        "copilot.session_id": "e2e-session-test",
        "copilot.session_name": "Verify E2E test",
        "copilot.cwd": "/tmp/copilot-cost-e2e",
      },
    },
  ];
  writeFileSync(jsonlPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
}

test.beforeEach(() => {
  writeOtelFixture();
});

test.afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

test("renders live dashboard data and supports session drilldown", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible();
  await expect(page.getByText("Build dashboard e2e")).toBeVisible();
  await expect(page.getByText("Verify E2E test")).toBeVisible();
  await expect(page.getByText("Claude opus 4.7").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spend by model" })).toBeVisible();
  await expect(page.locator("canvas#spend-chart, svg[aria-label*='spend by model' i]")).toBeVisible();
  await expect(page.locator("#spend-chart")).toHaveAttribute("aria-label", /spend by model.*total tokens line/i);

  const metric = page.getByRole("group", { name: "Chart metric" });
  // Fresh browser context defaults to Spend unless localStorage was seeded.
  await expect(metric.getByRole("button", { name: "Spend" })).toHaveAttribute("aria-pressed", "true");
  await metric.getByRole("button", { name: "Tokens" }).click();
  await expect(metric.getByRole("button", { name: "Tokens" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Tokens by model" })).toBeVisible();
  await expect(page.locator("canvas#spend-chart, svg[aria-label*='token' i]")).toBeVisible();
  await expect(page.locator("#spend-chart")).toHaveAttribute("aria-label", /tokens by model.*total spend line/i);

  const topModelsMetric = page.getByRole("group", { name: "Top models metric" });
  await expect(topModelsMetric.getByRole("button", { name: "Spend" })).toHaveAttribute("aria-pressed", "true");
  await topModelsMetric.getByRole("button", { name: "Tokens" }).click();
  await expect(topModelsMetric.getByRole("button", { name: "Tokens" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Tokens by model" })).toBeVisible();
  await topModelsMetric.getByRole("button", { name: "Spend" }).click();
  await expect(topModelsMetric.getByRole("button", { name: "Spend" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Tokens by model" })).toBeVisible();

  // Preference persists across reload via localStorage.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tokens by model" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Chart metric" }).getByRole("button", { name: "Tokens" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Top models metric" }).getByRole("button", { name: "Spend" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
  await page.getByPlaceholder("Name, path, or model").fill("verify");
  await expect(page.getByText("Verify E2E test")).toBeVisible();
  await expect(page.getByText("Build dashboard e2e")).toHaveCount(0);

  await page.getByText("Verify E2E test").click();
  await expect(page.getByRole("dialog")).toContainText("e2e-session-test");
});

test("toggles display currency between USD and AUD", async ({ page }) => {
  const fxCacheDir = path.join(testHome, ".copilot", "cost-cache");
  mkdirSync(fxCacheDir, { recursive: true });
  writeFileSync(
    path.join(fxCacheDir, "fx-usd-aud.json"),
    JSON.stringify({
      schema_version: 1,
      base: "USD",
      quote: "AUD",
      rate: 1.5,
      fetched_at: new Date().toISOString(),
      provider_date: "2026-08-18",
      source: "frankfurter",
      source_url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD",
      ttl_seconds: 86_400,
    }),
    "utf-8",
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Display currency" })).toBeVisible();

  const usdButton = page.getByRole("button", { name: "USD", exact: true });
  const audButton = page.getByRole("button", { name: "AUD", exact: true });
  await expect(usdButton).toHaveAttribute("aria-pressed", "true");

  // Capture a visible USD amount from a KPI card, then compare after AUD conversion.
  const kpiCost = page.locator(".kpi-card p.text-3xl, .kpi-card p").filter({ hasText: /\$/ }).first();
  await expect(kpiCost).toBeVisible();
  const usdText = (await kpiCost.textContent()) ?? "";
  const usdValue = Number(usdText.replace(/[^0-9.-]/g, ""));
  expect(Number.isFinite(usdValue)).toBe(true);

  await audButton.click();
  await expect(audButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#fx-status")).toContainText("1 USD = 1.5000 AUD");

  await expect
    .poll(async () => {
      const text = (await kpiCost.textContent()) ?? "";
      return Number(text.replace(/[^0-9.-]/g, ""));
    })
    .toBeCloseTo(usdValue * 1.5, 3);

  await page.reload();
  await expect(page.getByRole("button", { name: "AUD", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#fx-status")).toContainText("AUD");

  await page.getByRole("button", { name: "USD", exact: true }).click();
  await expect(page.getByRole("button", { name: "USD", exact: true })).toHaveAttribute("aria-pressed", "true");
});
