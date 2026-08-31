import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { resolveOtelDir, resolveOtelFiles } from "../otel/paths.js";
import { appendSessionMeta, readSessionMeta } from "../util/session-meta.js";
import {
  buildSpans,
  spansWereCapped,
  listSessionDirs,
  resolveSessionStateDir,
  scanSessionDir,
  type ScannedSession,
  type SessionSkipReason,
} from "./session-state.js";

/** Spans produced by the importer live in their own file so an import can be undone by deleting it. */
export const IMPORT_FILENAME = "copilot-cost-imported.jsonl";

/**
 * Default reconciliation floor. A session whose `session.shutdown` accounts for at least this
 * fraction of the output tokens seen across its `assistant.message` events is treated as complete.
 */
export const DEFAULT_MIN_COMPLETENESS = 0.8;

/** How many leading lines of each existing OTel file to read when auto-detecting the cutover. */
const CUTOVER_SCAN_LINES = 5000;

export interface ImportOptions {
  env?: NodeJS.ProcessEnv;
  /** Only import sessions that started strictly before this. Defaults to the OTel cutover. */
  until?: Date | null;
  /** Import even where existing OTel data already covers the session. Risks double counting. */
  allowOverlap?: boolean;
  minCompleteness?: number;
  /** When false, nothing is written. */
  write?: boolean;
}

export interface ImportedSessionSummary {
  session_id: string;
  started_at: string;
  /**
   * Deliberately absent: the session title. It is derived from the session's opening prompt, and
   * this report is the thing a user pastes into a bug report. Titles stay in the local sidecar.
   */
  models: string[];
  spans: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  nano_aiu: number;
  /** True when a model's request count exceeded the span ceiling, so counts are under-reported. */
  spans_capped: boolean;
}

export interface ImportReport {
  session_state_dir: string;
  otel_dir: string;
  output_path: string;
  cutover: string | null;
  cutover_source: "otel-scan" | "option" | "none";
  scanned: number;
  imported: ImportedSessionSummary[];
  skipped: { session_id: string; reason: SessionSkipReason; completeness: number | null }[];
  totals: {
    sessions: number;
    spans: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    nano_aiu: number;
  };
  written: boolean;
}

function tupleToMs(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sec = Number(value[0]);
  const ns = Number(value[1] ?? 0);
  if (!Number.isFinite(sec)) return null;
  return sec * 1000 + (Number.isFinite(ns) ? Math.floor(ns / 1_000_000) : 0);
}

/**
 * Finds the earliest record time in the existing OTel export. Those files are append-only and
 * therefore chronological, so reading the first few thousand lines of each is enough and avoids
 * walking exports that routinely reach several GB.
 */
export async function detectOtelCutover(env: NodeJS.ProcessEnv = process.env): Promise<Date | null> {
  const files = resolveOtelFiles(env).filter((file) => path.basename(file) !== IMPORT_FILENAME);
  let earliest: number | null = null;

  for (const file of files) {
    const stream = createReadStream(file, { encoding: "utf-8" });
    const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    let seen = 0;
    try {
      for await (const line of lines) {
        if (seen >= CUTOVER_SCAN_LINES) break;
        seen += 1;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed === null || typeof parsed !== "object") continue;
        const record = parsed as Record<string, unknown>;
        const candidates: number[] = [];
        const own = tupleToMs(record.startTime);
        if (own !== null) candidates.push(own);
        if (Array.isArray(record.dataPoints)) {
          for (const point of record.dataPoints) {
            if (point === null || typeof point !== "object") continue;
            const ms = tupleToMs((point as Record<string, unknown>).startTime);
            if (ms !== null) candidates.push(ms);
          }
        }
        for (const ms of candidates) {
          if (ms > 0 && (earliest === null || ms < earliest)) earliest = ms;
        }
      }
    } finally {
      lines.close();
      stream.close();
    }
  }

  return earliest === null ? null : new Date(earliest);
}

export async function runImport(options: ImportOptions = {}): Promise<ImportReport> {
  const env = options.env ?? process.env;
  const minCompleteness = options.minCompleteness ?? DEFAULT_MIN_COMPLETENESS;
  const sessionStateDir = resolveSessionStateDir(env);
  const otelDir = resolveOtelDir(env);
  const outputPath = path.join(otelDir, IMPORT_FILENAME);

  let cutover: Date | null = null;
  let cutoverSource: ImportReport["cutover_source"] = "none";
  if (options.until) {
    cutover = options.until;
    cutoverSource = "option";
  } else if (!options.allowOverlap) {
    cutover = await detectOtelCutover(env);
    if (cutover) cutoverSource = "otel-scan";
  }

  const report: ImportReport = {
    session_state_dir: sessionStateDir,
    otel_dir: otelDir,
    output_path: outputPath,
    cutover: cutover ? cutover.toISOString() : null,
    cutover_source: cutoverSource,
    scanned: 0,
    imported: [],
    skipped: [],
    totals: {
      sessions: 0,
      spans: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      nano_aiu: 0,
    },
    written: false,
  };

  const dirs = listSessionDirs(sessionStateDir);
  const cutoverMs = cutover ? cutover.getTime() : Number.POSITIVE_INFINITY;
  const spanLines: string[] = [];
  const accepted: ScannedSession[] = [];

  for (const dir of dirs) {
    report.scanned += 1;
    let session: ScannedSession;
    try {
      session = await scanSessionDir(dir, minCompleteness);
    } catch {
      report.skipped.push({ session_id: path.basename(dir), reason: "no-events-file", completeness: null });
      continue;
    }

    if (session.skip_reason) {
      report.skipped.push({
        session_id: session.session_id,
        reason: session.skip_reason,
        completeness: session.completeness,
      });
      continue;
    }

    if (session.started_ms >= cutoverMs) {
      report.skipped.push({ session_id: session.session_id, reason: "covered-by-otel", completeness: session.completeness });
      continue;
    }

    const spans = buildSpans(session);
    for (const span of spans) spanLines.push(JSON.stringify(span));

    const totals = session.models.reduce(
      (acc, m) => ({
        input: acc.input + m.input_tokens,
        output: acc.output + m.output_tokens,
        cacheRead: acc.cacheRead + m.cache_read_tokens,
        cacheWrite: acc.cacheWrite + m.cache_write_tokens,
        nano: acc.nano + m.nano_aiu,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, nano: 0 },
    );

    accepted.push(session);
    report.imported.push({
      session_id: session.session_id,
      started_at: session.started_at,
      models: session.models.map((m) => m.model),
      spans: spans.length,
      input_tokens: totals.input,
      output_tokens: totals.output,
      cache_read_tokens: totals.cacheRead,
      cache_write_tokens: totals.cacheWrite,
      nano_aiu: totals.nano,
      spans_capped: spansWereCapped(session),
    });

    report.totals.sessions += 1;
    report.totals.spans += spans.length;
    report.totals.input_tokens += totals.input;
    report.totals.output_tokens += totals.output;
    report.totals.cache_read_tokens += totals.cacheRead;
    report.totals.cache_write_tokens += totals.cacheWrite;
    report.totals.nano_aiu += totals.nano;
  }

  if (options.write && spanLines.length > 0) {
    mkdirSync(otelDir, { recursive: true });
    // Rewritten wholesale rather than appended: span ids are deterministic, so a re-run replaces
    // the previous import instead of stacking a second copy of the same history.
    writeFileSync(outputPath, `${spanLines.join("\n")}\n`, "utf-8");
    report.written = true;

    const known = new Set(readSessionMeta(env).map((entry) => entry.session_id));
    for (const session of accepted) {
      if (known.has(session.session_id)) continue;
      appendSessionMeta(
        {
          ts: session.started_at,
          session_id: session.session_id,
          session_name: session.session_name,
          cwd: session.cwd,
          model: session.models[0]?.model ?? session.selected_model,
          context_tier: session.context_tier,
        },
        env,
      );
    }
  }

  return report;
}

function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

/** Collapses the home prefix so a pasted report does not disclose the OS username. */
export function tildeCollapse(target: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || homedir();
  if (!home || !target.startsWith(home)) return target;
  const rest = target.slice(home.length);
  return rest === "" ? "~" : rest.startsWith(path.sep) ? `~${rest}` : target;
}

export function formatReport(report: ImportReport): string {
  const lines: string[] = [];
  lines.push(`session-state: ${tildeCollapse(report.session_state_dir)}`);
  lines.push(`otel dir:      ${tildeCollapse(report.otel_dir)}`);
  if (report.cutover) {
    const source = report.cutover_source === "otel-scan" ? "earliest existing OTel record" : "--until";
    lines.push(`cutover:       ${report.cutover}  (${source})`);
  } else {
    lines.push("cutover:       none - every session is eligible");
  }
  lines.push("");
  lines.push(`scanned ${report.scanned} sessions, importing ${report.totals.sessions}`);

  if (report.skipped.length > 0) {
    const byReason = new Map<SessionSkipReason, number>();
    for (const skip of report.skipped) byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1);
    lines.push("");
    lines.push("skipped:");
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${String(count).padStart(5)}  ${reason}`);
    }
  }

  if (report.totals.sessions > 0) {
    lines.push("");
    lines.push("recovered usage:");
    lines.push(`  spans          ${formatInt(report.totals.spans)}`);
    lines.push(`  input tokens   ${formatInt(report.totals.input_tokens)}`);
    lines.push(`  output tokens  ${formatInt(report.totals.output_tokens)}`);
    lines.push(`  cache read     ${formatInt(report.totals.cache_read_tokens)}`);
    lines.push(`  cache write    ${formatInt(report.totals.cache_write_tokens)}`);
    lines.push(`  AI credits     ${(report.totals.nano_aiu / 1e9).toFixed(2)} AIC`);
  }

  const capped = report.imported.filter((s) => s.spans_capped);
  if (capped.length > 0) {
    lines.push("");
    lines.push(`note: ${capped.length} session(s) exceeded the per-model span ceiling.`);
    lines.push("      Token and cost totals are still exact; only their request counts are capped.");
    for (const s of capped.slice(0, 5)) lines.push(`      ${s.session_id}`);
  }

  lines.push("");
  lines.push(
    report.written
      ? `wrote ${tildeCollapse(report.output_path)}\nRestart the dashboard to pick it up. Delete that file to undo the import.`
      : "dry run - nothing written. Re-run with --write to apply.",
  );
  return lines.join("\n");
}
