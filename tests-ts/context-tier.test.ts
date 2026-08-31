import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearContextTierCache, resolveContextTier } from "../src/util/context-tier.js";
import { clearSessionMetaCache } from "../src/util/session-meta.js";

const root = path.resolve(".test-home", "context-tier");
const savedEnv = { ...process.env };

beforeEach(() => {
  clearContextTierCache();
  clearSessionMetaCache();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, ".copilot"), { recursive: true });
  process.env = { ...savedEnv, HOME: root };
});

afterEach(() => {
  process.env = { ...savedEnv };
  clearContextTierCache();
  clearSessionMetaCache();
  rmSync(root, { recursive: true, force: true });
});

describe("resolveContextTier", () => {
  it("defaults to default when nothing is configured", () => {
    expect(resolveContextTier()).toBe("default");
  });

  it("reads contextTier from settings.json", () => {
    writeFileSync(path.join(root, ".copilot", "settings.json"), JSON.stringify({ contextTier: "long_context" }));
    expect(resolveContextTier()).toBe("long_context");
  });

  it("prefers payload context_tier over settings", () => {
    writeFileSync(path.join(root, ".copilot", "settings.json"), JSON.stringify({ contextTier: "long_context" }));
    expect(resolveContextTier({ payload: { context_tier: "default" } })).toBe("default");
  });

  it("accepts model.contextTier aliases", () => {
    expect(resolveContextTier({ payload: { model: { contextTier: "long-context" } } })).toBe("long_context");
  });
});
