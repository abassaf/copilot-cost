import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import http, { type Server } from "node:http";
import path from "node:path";

const savedEnv = { ...process.env };
const { COPILOT_OTEL_ENABLED, COPILOT_OTEL_FILE_EXPORTER_PATH, COPILOT_OTEL_EXPORTER_TYPE, COPILOT_OTEL_DIR, ...envWithoutOtel } = savedEnv;
const root = path.resolve(".test-home", "server-tests");
let server: Server | null = null;

async function listen(srv: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const address = srv.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}

async function rawGet(base: string, pathName: string, headers: Record<string, string>): Promise<{ body: string; status: number }> {
  const url = new URL(pathName, base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ body, status: res.statusCode ?? 0 });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function setup() {
  vi.resetModules();
  const home = path.join(root, String(Date.now()));
  rmSync(home, { recursive: true, force: true });
  const otelDir = path.join(home, ".copilot", "otel");
  mkdirSync(otelDir, { recursive: true });
  const jsonl = path.join(otelDir, "copilot-otel.jsonl");
  writeFileSync(jsonl, JSON.stringify({ session_id: "s1", model: "gpt-5.4", input_tokens: 10, output_tokens: 5 }) + "\n", "utf-8");
  process.env = { ...envWithoutOtel, HOME: home, COPILOT_OTEL_DIR: otelDir, COPILOT_OTEL_ENABLED: "true", COPILOT_OTEL_FILE_EXPORTER_PATH: jsonl };
  return import("../src/dashboard/server.js");
}

afterEach(async () => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
});

describe("dashboard server", () => {
  it("serves health, summary, and pricing", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const health = await fetch(`${base}/api/health`);
    expect(health.headers.get("content-type")).toContain("application/json");
    expect(await health.json()).toMatchObject({ ok: true, otel_enabled: true, jsonl_files: 1 });

    const summary = await fetch(`${base}/api/summary`);
    expect(summary.headers.get("content-type")).toContain("application/json");
    expect(await summary.json()).toBeTruthy();

    const pricing = await fetch(`${base}/api/pricing`);
    expect(pricing.headers.get("content-type")).toContain("application/json");
    const body = (await pricing.json()) as { models: Record<string, unknown> };
    expect(Object.keys(body.models).length).toBeGreaterThan(0);
  });

  it("serves lifetime models by default and scopes them by range", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const lifetime = await fetch(`${base}/api/models`);
    expect(lifetime.status).toBe(200);
    expect(await lifetime.json()).toHaveLength(1);

    const recent = await fetch(`${base}/api/models?range=7d`);
    expect(recent.status).toBe(200);
    expect(await recent.json()).toEqual([]);
  });

  it("accepts the 1d range for timeseries and models", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const timeseries = await fetch(`${base}/api/timeseries?range=1d`);
    expect(timeseries.status).toBe(200);
    expect(await timeseries.json()).toEqual(expect.any(Array));

    const models = await fetch(`${base}/api/models?range=1d`);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual(expect.any(Array));
  });

  it("accepts an explicit timeseries grain", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const timeseries = await fetch(`${base}/api/timeseries?range=30d&grain=6h`);
    expect(timeseries.status).toBe(200);
    expect(await timeseries.json()).toEqual(expect.any(Array));
  });

  it("accepts tz query for timeseries and models", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const timeseries = await fetch(`${base}/api/timeseries?range=1d&tz=Australia%2FSydney`);
    expect(timeseries.status).toBe(200);
    expect(await timeseries.json()).toEqual(expect.any(Array));

    const models = await fetch(`${base}/api/models?range=7d&tz=Australia%2FSydney`);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual(expect.any(Array));

    const badTz = await fetch(`${base}/api/timeseries?range=1d&tz=Not%2FA%2FZone`);
    expect(badTz.status).toBe(200);
    expect(await badTz.json()).toEqual(expect.any(Array));
  });

  it("serves /api/fx from cache without upstream when fresh", async () => {
    const nativeFetch = globalThis.fetch;
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    vi.resetModules();
    const home = path.join(root, `fx-cache-${Date.now()}`);
    const otelDir = path.join(home, ".copilot", "otel");
    const cacheDir = path.join(home, ".copilot", "cost-cache");
    const fxCache = path.join(cacheDir, "fx-usd-aud.json");
    rmSync(home, { recursive: true, force: true });
    mkdirSync(otelDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(otelDir, "copilot-otel.jsonl"), "\n", "utf-8");
    writeFileSync(
      fxCache,
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
    process.env = {
      ...envWithoutOtel,
      HOME: home,
      COPILOT_OTEL_DIR: otelDir,
      COPILOT_OTEL_ENABLED: "true",
      COPILOT_COST_FX_CACHE: fxCache,
      COPILOT_COST_AUTO_REFRESH: "0",
    };
    const { makeServer } = await import("../src/dashboard/server.js");
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const fx = await nativeFetch(`${base}/api/fx`);
    expect(fx.status).toBe(200);
    expect(await fx.json()).toMatchObject({
      available: true,
      base: "USD",
      quote: "AUD",
      rate: 1.5,
      stale: false,
      source: "frankfurter",
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("returns 200 unavailable for /api/fx when offline with no cache", async () => {
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.resetModules();
    const home = path.join(root, `fx-offline-${Date.now()}`);
    const otelDir = path.join(home, ".copilot", "otel");
    const fxCache = path.join(home, ".copilot", "cost-cache", "fx-usd-aud.json");
    rmSync(home, { recursive: true, force: true });
    mkdirSync(otelDir, { recursive: true });
    writeFileSync(path.join(otelDir, "copilot-otel.jsonl"), "\n", "utf-8");
    process.env = {
      ...envWithoutOtel,
      HOME: home,
      COPILOT_OTEL_DIR: otelDir,
      COPILOT_OTEL_ENABLED: "true",
      COPILOT_COST_FX_CACHE: fxCache,
      COPILOT_COST_REFRESH_RETRY_MINUTES: "0",
    };
    const { makeServer } = await import("../src/dashboard/server.js");
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const fx = await nativeFetch(`${base}/api/fx`);
    expect(fx.status).toBe(200);
    expect(await fx.json()).toMatchObject({
      available: false,
      base: "USD",
      quote: "AUD",
      rate: null,
    });
  });

  it("rejects /api/fx with a foreign Host", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);
    const fx = await rawGet(base, "/api/fx", { Host: "evil.com" });
    expect(fx.status).toBe(403);
    expect(JSON.parse(fx.body)).toEqual({ error: "forbidden host" });
  });

  it("rejects requests with a foreign Host", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const health = await rawGet(base, "/api/health", { Host: "evil.com" });
    expect(health.status).toBe(403);
    expect(JSON.parse(health.body)).toEqual({ error: "forbidden host" });
  });

  it("rejects refresh-pricing requests with a foreign Origin", async () => {
    const nativeFetch = globalThis.fetch;
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const refresh = await nativeFetch(`${base}/api/refresh-pricing`, {
      method: "POST",
      headers: { Origin: "http://evil.com" },
    });
    expect(refresh.status).toBe(403);
    expect(await refresh.json()).toEqual({ error: "forbidden origin" });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects install-otel requests with a foreign Origin", async () => {
    const { makeServer } = await setup();
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const install = await fetch(`${base}/api/install-otel`, {
      method: "POST",
      headers: { Origin: "http://evil.com" },
    });
    expect(install.status).toBe(403);
    expect(await install.json()).toEqual({ error: "forbidden origin" });
  });

  it("refuses non-local binds", async () => {
    const { makeServer } = await setup();
    expect(() => makeServer("0.0.0.0", 0)).toThrow(/local binds/);
  });

  it("reports OTel enabled when the shell profile is configured", async () => {
    vi.resetModules();
    const home = path.join(root, `profile-${Date.now()}`);
    const otelDir = path.join(home, ".copilot", "otel");
    rmSync(home, { recursive: true, force: true });
    mkdirSync(otelDir, { recursive: true });
    process.env = { ...envWithoutOtel, HOME: home, COPILOT_OTEL_DIR: otelDir, SHELL: "/bin/zsh" };
    const { appendOtelExporterBlock } = await import("../src/install.js");
    const { makeServer } = await import("../src/dashboard/server.js");
    appendOtelExporterBlock(path.join(home, ".zshrc"));
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toMatchObject({
      ok: true,
      otel_enabled: true,
      otel_env_enabled: false,
      otel_profile_configured: true,
      jsonl_files: 0,
    });
  });

  it("reports the exporter path directory when COPILOT_OTEL_DIR is unset", async () => {
    vi.resetModules();
    const home = path.join(root, `exporter-dir-${Date.now()}`);
    const otelDir = path.join(home, ".copilot", "custom-otel");
    const jsonl = path.join(otelDir, "copilot-otel.jsonl");
    rmSync(home, { recursive: true, force: true });
    mkdirSync(otelDir, { recursive: true });
    writeFileSync(jsonl, JSON.stringify({ session_id: "s1", model: "gpt-5.4", input_tokens: 10, output_tokens: 5 }) + "\n", "utf-8");
    process.env = {
      ...envWithoutOtel,
      HOME: home,
      COPILOT_OTEL_ENABLED: "true",
      COPILOT_OTEL_EXPORTER_TYPE: "file",
      COPILOT_OTEL_FILE_EXPORTER_PATH: jsonl,
    };
    const { makeServer } = await import("../src/dashboard/server.js");
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toMatchObject({
      ok: true,
      otel_enabled: true,
      otel_env_enabled: true,
      otel_dir: otelDir,
      jsonl_files: 1,
    });
  });

  it("creates the exporter file from the install endpoint", async () => {
    vi.resetModules();
    const home = path.join(root, `api-install-${Date.now()}`);
    rmSync(home, { recursive: true, force: true });
    process.env = { ...envWithoutOtel, HOME: home, SHELL: "/bin/zsh" };
    const { makeServer } = await import("../src/dashboard/server.js");
    server = makeServer("127.0.0.1", 0);
    const base = await listen(server);

    const install = await fetch(`${base}/api/install-otel`, {
      method: "POST",
      headers: { Origin: base },
    });
    expect(await install.json()).toMatchObject({
      ok: true,
      exporter_path: path.join(home, ".copilot", "otel", "copilot-otel.jsonl"),
      action: "appended",
    });
    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toMatchObject({
      ok: true,
      otel_enabled: true,
      otel_profile_configured: true,
      jsonl_files: 1,
    });
  });
});
