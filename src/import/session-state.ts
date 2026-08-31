import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Copilot CLI keeps a per-session event log at
 * `~/.copilot/session-state/<session-id>/events.jsonl`. That log exists whether or not the
 * OpenTelemetry file exporter was ever switched on, which makes it the only source of truth
 * for usage that happened before `copilot-cost install`.
 *
 * The billing figures live on the `session.shutdown` event, under `modelMetrics`. Field
 * semantics match the OTel spans exactly, including `inputTokens` being cache-inclusive, so
 * the same `fresh = total - cache_read - cache_write` derivation applies with no adjustment.
 *
 * See `docs/importing-history.md` for the reconciliation rules and known limitations.
 */

export const SESSION_STATE_DIRNAME = "session-state";

export interface ImportedModelUsage {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  nano_aiu: number;
}

export type SessionSkipReason =
  | "no-events-file"
  | "no-session-start"
  | "no-shutdown-event"
  | "no-model-metrics"
  | "no-usage"
  | "incomplete-usage"
  | "covered-by-otel";

export interface ScannedSession {
  session_id: string;
  started_at: string;
  started_ms: number;
  session_name: string | null;
  cwd: string | null;
  selected_model: string | null;
  context_tier: "default" | "long_context" | null;
  models: ImportedModelUsage[];
  /** Output tokens summed from `assistant.message` events; an independent completeness check. */
  message_output_tokens: number;
  message_count: number;
  /** Output tokens claimed by `session.shutdown`, summed across every shutdown in the log. */
  shutdown_output_tokens: number;
  shutdown_count: number;
  /** shutdown_output_tokens / message_output_tokens, or null when there is nothing to compare. */
  completeness: number | null;
  skip_reason: SessionSkipReason | null;
}

export function resolveSessionStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COPILOT_SESSION_STATE_DIR) return path.resolve(env.COPILOT_SESSION_STATE_DIR);
  return path.join(env.HOME || homedir(), ".copilot", SESSION_STATE_DIRNAME);
}

export function listSessionDirs(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(path.join(root, entry.name));
  }
  return out.sort();
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Minimal reader for the handful of scalar keys we need out of `workspace.yaml`. The repo has no
 * YAML dependency and this file is written by Copilot, not by a user, so the shapes are narrow:
 * plain scalars plus single- or double-quoted scalars that may wrap onto following lines.
 */
export function readWorkspaceScalars(text: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? "";
    if (!keys.includes(key) || key in out) continue;
    const rest = (match[2] ?? "").trim();
    if (rest === "") continue;
    const quote = rest.startsWith("'") ? "'" : rest.startsWith('"') ? '"' : "";
    if (!quote) {
      out[key] = rest;
      continue;
    }
    let body = rest.slice(1);
    while (lastUnescapedQuote(body, quote) < 0 && i + 1 < lines.length) {
      i += 1;
      body += ` ${(lines[i] ?? "").trim()}`;
    }
    const close = lastUnescapedQuote(body, quote);
    const raw = close >= 0 ? body.slice(0, close) : body;
    out[key] = quote === "'" ? raw.split("''").join("'") : raw.split('\\"').join('"');
  }
  return out;
}

function lastUnescapedQuote(body: string, quote: string): number {
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== quote) continue;
    if (quote === "'" && body[i + 1] === "'") {
      i += 1;
      continue;
    }
    if (quote === '"' && body[i - 1] === "\\") continue;
    return i;
  }
  return -1;
}

function mergeModelMetrics(target: Map<string, ImportedModelUsage>, metrics: unknown): void {
  const record = asRecord(metrics);
  if (!record) return;
  for (const [model, raw] of Object.entries(record)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const usage = asRecord(entry.usage) ?? {};
    const requests = asRecord(entry.requests) ?? {};
    const existing = target.get(model) ?? {
      model,
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      nano_aiu: 0,
    };
    existing.requests += toInt(requests.count);
    existing.input_tokens += toInt(usage.inputTokens);
    existing.output_tokens += toInt(usage.outputTokens);
    existing.cache_read_tokens += toInt(usage.cacheReadTokens);
    existing.cache_write_tokens += toInt(usage.cacheWriteTokens);
    existing.reasoning_tokens += toInt(usage.reasoningTokens);
    existing.nano_aiu += toInt(entry.totalNanoAiu);
    target.set(model, existing);
  }
}

/** Streams one session's events.jsonl. These files reach hundreds of MB, so never read whole. */
export async function scanSessionDir(dir: string, minCompleteness: number): Promise<ScannedSession> {
  const sessionId = path.basename(dir);
  const eventsPath = path.join(dir, "events.jsonl");
  const base: ScannedSession = {
    session_id: sessionId,
    started_at: "",
    started_ms: 0,
    session_name: null,
    cwd: null,
    selected_model: null,
    context_tier: null,
    models: [],
    message_output_tokens: 0,
    message_count: 0,
    shutdown_output_tokens: 0,
    shutdown_count: 0,
    completeness: null,
    skip_reason: null,
  };

  const workspacePath = path.join(dir, "workspace.yaml");
  if (existsSync(workspacePath)) {
    try {
      const scalars = readWorkspaceScalars(readFileSync(workspacePath, "utf-8"), ["name", "cwd", "created_at"]);
      base.session_name = scalars.name ?? null;
      base.cwd = scalars.cwd ?? null;
      if (scalars.created_at) base.started_at = scalars.created_at;
    } catch {
      // Workspace metadata is a nicety; usage data does not depend on it.
    }
  }

  if (!existsSync(eventsPath)) return { ...base, skip_reason: "no-events-file" };

  const models = new Map<string, ImportedModelUsage>();
  let sawStart = false;

  const stream = createReadStream(eventsPath, { encoding: "utf-8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      // Cheap substring guard first: the vast majority of lines are tool and hook noise.
      if (
        !line.includes('"session.shutdown"') &&
        !line.includes('"assistant.message"') &&
        !line.includes('"session.start"')
      ) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const event = asRecord(parsed);
      if (!event) continue;
      const data = asRecord(event.data);
      if (!data) continue;

      if (event.type === "session.start" && !sawStart) {
        sawStart = true;
        const startTime = typeof data.startTime === "string" ? data.startTime : "";
        if (startTime) base.started_at = startTime;
        base.selected_model = typeof data.selectedModel === "string" ? data.selectedModel : null;
        const tier = data.contextTier;
        base.context_tier = tier === "default" || tier === "long_context" ? tier : null;
        const context = asRecord(data.context);
        if (context && typeof context.cwd === "string") base.cwd = context.cwd;
      } else if (event.type === "assistant.message") {
        const out = data.outputTokens;
        if (typeof out === "number" && Number.isFinite(out)) {
          base.message_output_tokens += Math.max(Math.trunc(out), 0);
          base.message_count += 1;
        }
      } else if (event.type === "session.shutdown") {
        base.shutdown_count += 1;
        mergeModelMetrics(models, data.modelMetrics);
      }
    }
  } finally {
    lines.close();
    stream.close();
  }

  base.models = [...models.values()].filter((m) => m.input_tokens + m.output_tokens + m.nano_aiu > 0);
  base.shutdown_output_tokens = base.models.reduce((sum, m) => sum + m.output_tokens, 0);
  const parsedStart = base.started_at ? Date.parse(base.started_at) : Number.NaN;
  base.started_ms = Number.isFinite(parsedStart) ? parsedStart : 0;

  if (!base.started_at || !Number.isFinite(parsedStart)) return { ...base, skip_reason: "no-session-start" };
  if (base.shutdown_count === 0) return { ...base, skip_reason: "no-shutdown-event" };
  if (base.models.length === 0) return { ...base, skip_reason: "no-model-metrics" };

  // `session.shutdown` reports what the CLI process that flushed it observed. A session resumed
  // across processes keeps only the final run's counters, which silently undercounts. The
  // `assistant.message.outputTokens` values are emitted per model call for the whole session, so
  // they form an independent lower bound to reconcile against.
  if (base.message_output_tokens > 0) {
    base.completeness = base.shutdown_output_tokens / base.message_output_tokens;
    if (base.completeness < minCompleteness) return { ...base, skip_reason: "incomplete-usage" };
  } else if (base.shutdown_output_tokens === 0) {
    return { ...base, skip_reason: "no-usage" };
  }

  return base;
}

export interface SpanBuildOptions {
  /** Hard ceiling on spans emitted for one session and model pair. */
  maxSpansPerModel?: number;
}

/**
 * Safety valve only. Real logs top out around 3k requests for a single model in one session, so
 * this is set well clear of that: hitting it would cap the request count the dashboard reports,
 * and the importer flags any session that does.
 */
const DEFAULT_MAX_SPANS_PER_MODEL = 10000;

function hexId(bytes: number, ...parts: string[]): string {
  return createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, bytes * 2);
}

/** Splits `total` into `parts` whole numbers that sum back to exactly `total`. */
export function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const safeTotal = Math.max(Math.trunc(total), 0);
  const base = Math.floor(safeTotal / parts);
  const out = new Array<number>(parts).fill(base);
  let remainder = safeTotal - base * parts;
  for (let i = 0; remainder > 0; i = (i + 1) % parts) {
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

/**
 * Builds OTel-shaped leaf `chat` spans for one session.
 *
 * Two deliberate approximations, both documented and both marked on every span:
 *  - Per-call granularity is not recorded anywhere, so a model's session totals are split evenly
 *    across its request count. Every rollup the dashboard shows (session, model, day) is exact;
 *    only the per-call list in the session drawer is uniform.
 *  - Per-call timestamps are not recorded either, so all spans carry the session start time.
 *    Usage lands on the day the session began rather than being smeared across its lifetime.
 */
export function spansWereCapped(session: ScannedSession, options: SpanBuildOptions = {}): boolean {
  const maxSpans = options.maxSpansPerModel ?? DEFAULT_MAX_SPANS_PER_MODEL;
  return session.models.some((usage) => usage.requests > maxSpans);
}

export function buildSpans(session: ScannedSession, options: SpanBuildOptions = {}): Record<string, unknown>[] {
  const maxSpans = options.maxSpansPerModel ?? DEFAULT_MAX_SPANS_PER_MODEL;
  const seconds = Math.floor(session.started_ms / 1000);
  const nanos = (session.started_ms % 1000) * 1_000_000;
  const spans: Record<string, unknown>[] = [];

  for (const usage of session.models) {
    const count = Math.min(Math.max(usage.requests, 1), maxSpans);
    const input = splitEvenly(usage.input_tokens, count);
    const output = splitEvenly(usage.output_tokens, count);
    const cacheRead = splitEvenly(usage.cache_read_tokens, count);
    const cacheWrite = splitEvenly(usage.cache_write_tokens, count);
    const reasoning = splitEvenly(usage.reasoning_tokens, count);
    const nano = splitEvenly(usage.nano_aiu, count);
    const traceId = hexId(16, session.session_id, usage.model);

    for (let i = 0; i < count; i += 1) {
      spans.push({
        type: "span",
        traceId,
        spanId: hexId(8, session.session_id, usage.model, String(i)),
        name: `chat ${usage.model}`,
        kind: 2,
        startTime: [seconds, nanos],
        endTime: [seconds, nanos],
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "github",
          "gen_ai.request.model": usage.model,
          "gen_ai.response.model": usage.model,
          "gen_ai.conversation.id": session.session_id,
          // Only non-sensitive identifiers go on the span. The session title is derived from the
          // opening prompt and the cwd is a real filesystem path, so both live solely in the
          // session-meta sidecar, exactly as they do for live telemetry. Stamping them here would
          // also override the sidecar on read (see reader.ts), which would make deleting the
          // sidecar fail to remove them.
          "copilot.session_id": session.session_id,
          ...(session.context_tier ? { "copilot.context_tier": session.context_tier } : {}),
          "gen_ai.usage.input_tokens": input[i] ?? 0,
          "gen_ai.usage.output_tokens": output[i] ?? 0,
          "gen_ai.usage.cache_read.input_tokens": cacheRead[i] ?? 0,
          "gen_ai.usage.cache_creation.input_tokens": cacheWrite[i] ?? 0,
          "gen_ai.usage.reasoning.output_tokens": reasoning[i] ?? 0,
          "github.copilot.nano_aiu": nano[i] ?? 0,
          "copilot_cost.imported": true,
          "copilot_cost.import_source": "session-state",
          "copilot_cost.uniform_split": count > 1,
        },
        status: { code: 0 },
        resource: { attributes: { "service.name": "copilot-cli", "service.version": "imported" } },
      });
    }
  }
  return spans;
}
