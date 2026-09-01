import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readSessionMeta } from "./session-meta.js";

/** Copilot CLI context-window billing tier (selected mode, not dynamic token growth). */
export type ContextTier = "default" | "long_context";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function normalizeTier(value: unknown): ContextTier | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "default" || raw === "standard" || raw === "small") return "default";
  if (raw === "long_context" || raw === "longcontext" || raw === "long" || raw === "large") return "long_context";
  return null;
}

function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME || homedir(), ".copilot", "settings.json");
}

interface SettingsCache {
  mtimeMs: number;
  size: number;
  tier: ContextTier | null;
}

let settingsCache: SettingsCache | null = null;

export function clearContextTierCache(): void {
  settingsCache = null;
}

/** Read global `contextTier` from ~/.copilot/settings.json (CLI-selected window mode). */
export function readSettingsContextTier(env: NodeJS.ProcessEnv = process.env): ContextTier | null {
  const target = settingsPath(env);
  if (!existsSync(target)) return null;
  try {
    const st = statSync(target);
    if (settingsCache && settingsCache.mtimeMs === st.mtimeMs && settingsCache.size === st.size) {
      return settingsCache.tier;
    }
    const parsed = JSON.parse(readFileSync(target, "utf-8")) as unknown;
    const root = asObject(parsed);
    const tier = normalizeTier(root.contextTier ?? root.context_tier);
    settingsCache = { mtimeMs: st.mtimeMs, size: st.size, tier };
    return tier;
  } catch {
    settingsCache = null;
    return null;
  }
}

/** Latest known tier for a session from statusline sidecar meta (if recorded). */
export function readSessionContextTier(sessionId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): ContextTier | null {
  if (!sessionId) return null;
  const meta = readSessionMeta(env);
  for (let i = meta.length - 1; i >= 0; i -= 1) {
    const entry = meta[i];
    if (entry?.session_id !== sessionId) continue;
    const tier = normalizeTier((entry as { context_tier?: unknown }).context_tier);
    if (tier) return tier;
  }
  return null;
}

/**
 * Resolve which pricing tier to use.
 *
 * Copilot bills by the selected context-window mode (`default` vs `long_context`),
 * not by dynamically growing past an input-token threshold mid-session.
 */
export function resolveContextTier(opts: {
  explicit?: unknown;
  payload?: unknown;
  sessionId?: string | null;
  env?: NodeJS.ProcessEnv;
} = {}): ContextTier {
  const env = opts.env ?? process.env;

  const fromExplicit = normalizeTier(opts.explicit);
  if (fromExplicit) return fromExplicit;

  const root = asObject(opts.payload);
  const model = asObject(root.model);
  const fromPayload = normalizeTier(
    root.context_tier
      ?? root.contextTier
      ?? root.context_tiers
      ?? model.context_tier
      ?? model.contextTier
      ?? model.context_tiers,
  );
  if (fromPayload) return fromPayload;

  const fromSession = readSessionContextTier(opts.sessionId ?? (typeof root.session_id === "string" ? root.session_id : null), env);
  if (fromSession) return fromSession;

  const fromSettings = readSettingsContextTier(env);
  if (fromSettings) return fromSettings;

  return "default";
}

export function modelSupportsLongContextTier(price: { long_context_input?: number; long_context_output?: number; long_context_threshold?: number } | null | undefined): boolean {
  if (!price) return false;
  return price.long_context_input != null || price.long_context_output != null || price.long_context_threshold != null;
}
