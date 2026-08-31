import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildSpans,
  readWorkspaceScalars,
  scanSessionDir,
  spansWereCapped,
  splitEvenly,
  type ScannedSession,
} from "../src/import/session-state.js";
import { detectOtelCutover, formatReport, IMPORT_FILENAME, runImport, tildeCollapse } from "../src/import/index.js";
import { normalizeSpan } from "../src/otel/parser.js";
import { sessions } from "../src/otel/aggregations.js";
import { clearSessionMetaCache, readSessionMeta } from "../src/util/session-meta.js";

const root = path.resolve(".test-work", "import-session-state");
const stateRoot = path.join(root, "session-state");
const otelRoot = path.join(root, "otel");
const savedEnv = { ...process.env };
const {
  COPILOT_OTEL_ENABLED,
  COPILOT_OTEL_FILE_EXPORTER_PATH,
  COPILOT_OTEL_EXPORTER_TYPE,
  COPILOT_OTEL_DIR,
  COPILOT_SESSION_STATE_DIR,
  ...envWithoutOtel
} = savedEnv;

/**
 * Every fixture here is invented. Real session logs carry prompts, repository paths and branch
 * names, so no capture from an actual machine belongs in this repository.
 */
interface FixtureOptions {
  id: string;
  startTime?: string;
  model?: string;
  requests?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  nanoAiu?: number;
  /** Per-call output tokens emitted as assistant.message events, the completeness check. */
  messageOutputs?: number[];
  includeShutdown?: boolean;
  includeStart?: boolean;
  workspaceName?: string;
  cwd?: string;
  extraShutdown?: boolean;
}

function writeFixture(options: FixtureOptions): string {
  const {
    id,
    startTime = "2026-05-01T00:00:00.000Z",
    model = "claude-sonnet-4.6",
    requests = 4,
    input = 1000,
    output = 200,
    cacheRead = 600,
    cacheWrite = 100,
    reasoning = 40,
    nanoAiu = 8_000_000_000,
    messageOutputs = [200],
    includeShutdown = true,
    includeStart = true,
    workspaceName = "Example session",
    cwd = "/tmp/example-project",
    extraShutdown = false,
  } = options;

  const dir = path.join(stateRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "workspace.yaml"),
    ["id: " + id, "cwd: " + cwd, "name: '" + workspaceName.split("'").join("''") + "'", "user_named: false", ""].join("\n"),
    "utf-8",
  );

  const lines: string[] = [];
  if (includeStart) {
    lines.push(
      JSON.stringify({
        type: "session.start",
        id: "e0",
        timestamp: startTime,
        data: { sessionId: id, startTime, selectedModel: model, contextTier: null, context: { cwd } },
      }),
    );
  }
  messageOutputs.forEach((outputTokens, index) => {
    lines.push(
      JSON.stringify({
        type: "assistant.message",
        id: `m${index}`,
        timestamp: startTime,
        data: { messageId: `m${index}`, model, outputTokens },
      }),
    );
  });
  const shutdown = {
    type: "session.shutdown",
    id: "z0",
    timestamp: startTime,
    data: {
      shutdownType: "routine",
      totalNanoAiu: nanoAiu,
      modelMetrics: {
        [model]: {
          requests: { count: requests, cost: 0 },
          usage: {
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            reasoningTokens: reasoning,
          },
          totalNanoAiu: nanoAiu,
        },
      },
    },
  };
  if (includeShutdown) lines.push(JSON.stringify(shutdown));
  if (extraShutdown) lines.push(JSON.stringify({ ...shutdown, id: "z1" }));

  writeFileSync(path.join(dir, "events.jsonl"), `${lines.join("\n")}\n`, "utf-8");
  return dir;
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(otelRoot, { recursive: true });
  process.env = { ...envWithoutOtel, COPILOT_OTEL_DIR: otelRoot, COPILOT_SESSION_STATE_DIR: stateRoot };
  clearSessionMetaCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  clearSessionMetaCache();
  rmSync(root, { recursive: true, force: true });
});

describe("workspace.yaml scalar reader", () => {
  it("reads plain, single-quoted and double-quoted scalars", () => {
    const text = ["id: abc", "cwd: /tmp/x", `name: 'A session with '' an escaped quote'`, 'title: "quoted"'].join("\n");
    expect(readWorkspaceScalars(text, ["id", "cwd", "name", "title"])).toEqual({
      id: "abc",
      cwd: "/tmp/x",
      name: "A session with ' an escaped quote",
      title: "quoted",
    });
  });

  it("joins a quoted scalar that wraps across lines", () => {
    const text = ["name: 'first part", "  second part'", "cwd: /tmp/y"].join("\n");
    const out = readWorkspaceScalars(text, ["name", "cwd"]);
    expect(out.name).toBe("first part second part");
    expect(out.cwd).toBe("/tmp/y");
  });

  it("ignores keys that were not asked for", () => {
    expect(readWorkspaceScalars("secret: value\nid: keep", ["id"])).toEqual({ id: "keep" });
  });
});

describe("splitEvenly", () => {
  it("preserves the total exactly and spreads the remainder", () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(10, 3).reduce((a, b) => a + b, 0)).toBe(10);
    expect(splitEvenly(0, 4)).toEqual([0, 0, 0, 0]);
    expect(splitEvenly(7, 1)).toEqual([7]);
    expect(splitEvenly(5, 0)).toEqual([]);
  });

  it("never emits negative counts", () => {
    expect(splitEvenly(-5, 2)).toEqual([0, 0]);
  });
});

describe("scanSessionDir", () => {
  it("reads the per-model cost basis out of session.shutdown", async () => {
    const dir = writeFixture({ id: "s-ok" });
    const session = await scanSessionDir(dir, 0.8);
    expect(session.skip_reason).toBeNull();
    expect(session.session_name).toBe("Example session");
    expect(session.cwd).toBe("/tmp/example-project");
    expect(session.models).toHaveLength(1);
    expect(session.models[0]).toMatchObject({
      model: "claude-sonnet-4.6",
      requests: 4,
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_tokens: 600,
      cache_write_tokens: 100,
      reasoning_tokens: 40,
      nano_aiu: 8_000_000_000,
    });
  });

  it("sums multiple shutdown events in one log", async () => {
    const dir = writeFixture({ id: "s-two", extraShutdown: true, messageOutputs: [400] });
    const session = await scanSessionDir(dir, 0.8);
    expect(session.shutdown_count).toBe(2);
    expect(session.models[0]?.output_tokens).toBe(400);
    expect(session.models[0]?.requests).toBe(8);
  });

  it("rejects a session whose shutdown undercounts the per-message output tokens", async () => {
    // The failure mode this guards: a resumed session keeps only its final run's counters.
    const dir = writeFixture({ id: "s-partial", output: 50, messageOutputs: [400, 400, 400] });
    const session = await scanSessionDir(dir, 0.8);
    expect(session.skip_reason).toBe("incomplete-usage");
    expect(session.completeness).toBeCloseTo(50 / 1200, 5);
  });

  it("accepts a session that reconciles within the floor", async () => {
    const dir = writeFixture({ id: "s-near", output: 95, messageOutputs: [100] });
    const session = await scanSessionDir(dir, 0.8);
    expect(session.skip_reason).toBeNull();
    expect(session.completeness).toBeCloseTo(0.95, 5);
  });

  it("skips sessions with no shutdown event and with no usable metrics", async () => {
    const noShutdown = writeFixture({ id: "s-none", includeShutdown: false });
    expect((await scanSessionDir(noShutdown, 0.8)).skip_reason).toBe("no-shutdown-event");

    const zero = writeFixture({ id: "s-zero", input: 0, output: 0, nanoAiu: 0, messageOutputs: [] });
    expect((await scanSessionDir(zero, 0.8)).skip_reason).toBe("no-model-metrics");

    const missing = path.join(stateRoot, "s-empty");
    mkdirSync(missing, { recursive: true });
    expect((await scanSessionDir(missing, 0.8)).skip_reason).toBe("no-events-file");
  });
});

describe("buildSpans", () => {
  async function scan(options: FixtureOptions): Promise<ScannedSession> {
    return scanSessionDir(writeFixture(options), 0.8);
  }

  it("emits one span per recorded request and preserves totals exactly", async () => {
    const session = await scan({ id: "b-1", requests: 3, input: 1001, output: 101, cacheRead: 601, cacheWrite: 11, reasoning: 7 });
    const spans = buildSpans(session);
    expect(spans).toHaveLength(3);

    const sum = (key: string): number =>
      spans.reduce((acc, span) => {
        const attributes = span.attributes as Record<string, number>;
        return acc + (attributes[key] ?? 0);
      }, 0);
    expect(sum("gen_ai.usage.input_tokens")).toBe(1001);
    expect(sum("gen_ai.usage.output_tokens")).toBe(101);
    expect(sum("gen_ai.usage.cache_read.input_tokens")).toBe(601);
    expect(sum("gen_ai.usage.cache_creation.input_tokens")).toBe(11);
    expect(sum("gen_ai.usage.reasoning.output_tokens")).toBe(7);
  });

  it("marks every span as imported and gives each a distinct span id", async () => {
    const session = await scan({ id: "b-2", requests: 5 });
    const spans = buildSpans(session);
    const ids = new Set(spans.map((span) => span.spanId));
    expect(ids.size).toBe(5);
    for (const span of spans) {
      const attributes = span.attributes as Record<string, unknown>;
      expect(attributes["copilot_cost.imported"]).toBe(true);
      expect(attributes["copilot_cost.import_source"]).toBe("session-state");
      expect(attributes["gen_ai.operation.name"]).toBe("chat");
    }
  });

  it("is deterministic, so a re-import replaces rather than duplicates", async () => {
    const session = await scan({ id: "b-3", requests: 4 });
    expect(buildSpans(session).map((s) => s.spanId)).toEqual(buildSpans(session).map((s) => s.spanId));
  });

  it("emits a single span when the request count is missing", async () => {
    const session = await scan({ id: "b-4", requests: 0 });
    expect(buildSpans(session)).toHaveLength(1);
  });

  it("flags a session whose request count exceeds the ceiling", async () => {
    const session = await scan({ id: "b-cap", requests: 50 });
    expect(spansWereCapped(session, { maxSpansPerModel: 10 })).toBe(true);
    expect(spansWereCapped(session)).toBe(false);
  });

  it("respects the per-model span ceiling while keeping totals intact", async () => {
    const session = await scan({ id: "b-5", requests: 5000, input: 999 });
    const spans = buildSpans(session, { maxSpansPerModel: 10 });
    expect(spans).toHaveLength(10);
    const total = spans.reduce((acc, span) => acc + ((span.attributes as Record<string, number>)["gen_ai.usage.input_tokens"] ?? 0), 0);
    expect(total).toBe(999);
  });

  it("produces spans the existing parser accepts, with fresh input derived correctly", async () => {
    const session = await scan({ id: "b-6", requests: 1, input: 1000, cacheRead: 600, cacheWrite: 100, output: 50 });
    const call = normalizeSpan(buildSpans(session)[0]);
    expect(call).not.toBeNull();
    // input_tokens on a NormalizedCall is fresh input: total minus both cache classes.
    expect(call?.input_tokens).toBe(300);
    expect(call?.cache_read).toBe(600);
    expect(call?.cache_creation).toBe(100);
    expect(call?.output_tokens).toBe(50);
    expect(call?.session_id).toBe("b-6");
  });

  it("rolls up through aggregations to the session totals it started from", async () => {
    const session = await scan({ id: "b-7", requests: 6, input: 1200, cacheRead: 700, cacheWrite: 100, output: 90 });
    const calls = buildSpans(session)
      .map((span) => normalizeSpan(span))
      .filter((call): call is NonNullable<typeof call> => call !== null);
    const rows = sessions(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total_input_tokens).toBe(400);
    expect(rows[0]?.total_cache_read_tokens).toBe(700);
    expect(rows[0]?.total_cache_write_tokens).toBe(100);
    expect(rows[0]?.total_output_tokens).toBe(90);
    expect(rows[0]?.premium_requests).toBe(6);
  });
});

describe("prompt-derived data containment", () => {
  // The session title comes from the session's opening prompt and the cwd is a real filesystem
  // path. Both belong in the local sidecar only. These tests exist because stamping them onto
  // spans also silently overrides the sidecar on read, which would defeat deleting it.
  const SECRET_TITLE = "Fix billing bug in acme-internal-service";
  const SECRET_CWD = "/Users/someone/work/acme-internal-service";

  it("never stamps the session title or cwd onto a span", async () => {
    const session = await scanSessionDir(
      writeFixture({ id: "p-1", requests: 3, workspaceName: SECRET_TITLE, cwd: SECRET_CWD }),
      0.8,
    );
    expect(session.session_name).toBe(SECRET_TITLE);

    const spans = buildSpans(session);
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      const attributes = span.attributes as Record<string, unknown>;
      expect(attributes["copilot.session_name"]).toBeUndefined();
      expect(attributes["copilot.cwd"]).toBeUndefined();
      expect(JSON.stringify(span)).not.toContain(SECRET_TITLE);
      expect(JSON.stringify(span)).not.toContain(SECRET_CWD);
    }
  });

  it("keeps the title and cwd out of the report, including --json", async () => {
    writeFixture({ id: "p-2", workspaceName: SECRET_TITLE, cwd: SECRET_CWD });
    const report = await runImport({ write: false });
    expect(report.totals.sessions).toBe(1);

    // --json serialises the whole report object, and users paste that into bug reports.
    const asJson = JSON.stringify(report);
    expect(asJson).not.toContain(SECRET_TITLE);
    expect(asJson).not.toContain(SECRET_CWD);
    expect(formatReport(report)).not.toContain(SECRET_TITLE);
    expect(formatReport(report)).not.toContain(SECRET_CWD);
  });

  it("still records the title in the local sidecar, which the user can delete", async () => {
    writeFixture({ id: "p-3", workspaceName: SECRET_TITLE, cwd: SECRET_CWD });
    await runImport({ write: true });
    clearSessionMetaCache();
    expect(readSessionMeta(process.env)[0]?.session_name).toBe(SECRET_TITLE);

    // Deleting the sidecar must actually remove it: nothing in the span file may carry it back.
    rmSync(path.join(otelRoot, "copilot-cost-meta.jsonl"), { force: true });
    clearSessionMetaCache();
    expect(readSessionMeta(process.env)).toHaveLength(0);
    expect(readFileSync(path.join(otelRoot, IMPORT_FILENAME), "utf-8")).not.toContain(SECRET_TITLE);
  });

  it("collapses the home prefix so reports do not disclose the OS username", () => {
    expect(tildeCollapse("/home/someone/.copilot/otel", { HOME: "/home/someone" } as NodeJS.ProcessEnv)).toBe("~/.copilot/otel");
    expect(tildeCollapse("/home/someone", { HOME: "/home/someone" } as NodeJS.ProcessEnv)).toBe("~");
    expect(tildeCollapse("/etc/elsewhere", { HOME: "/home/someone" } as NodeJS.ProcessEnv)).toBe("/etc/elsewhere");
    // Must not collapse a sibling directory that merely shares the prefix.
    expect(tildeCollapse("/home/someone-else/x", { HOME: "/home/someone" } as NodeJS.ProcessEnv)).toBe("/home/someone-else/x");
  });
});

describe("detectOtelCutover", () => {
  it("returns the earliest record time across existing exports", async () => {
    writeFileSync(
      path.join(otelRoot, "copilot-otel.jsonl"),
      [
        JSON.stringify({ type: "span", startTime: [1_760_000_000, 0], attributes: {} }),
        JSON.stringify({ type: "span", startTime: [1_750_000_000, 0], attributes: {} }),
      ].join("\n"),
      "utf-8",
    );
    const cutover = await detectOtelCutover(process.env);
    expect(cutover?.getTime()).toBe(1_750_000_000_000);
  });

  it("ignores the importer's own output file", async () => {
    writeFileSync(path.join(otelRoot, IMPORT_FILENAME), JSON.stringify({ type: "span", startTime: [1, 0] }), "utf-8");
    expect(await detectOtelCutover(process.env)).toBeNull();
  });

  it("returns null when there is no export yet", async () => {
    expect(await detectOtelCutover(process.env)).toBeNull();
  });
});

describe("runImport", () => {
  it("writes nothing on a dry run", async () => {
    writeFixture({ id: "r-1" });
    const report = await runImport({ write: false });
    expect(report.totals.sessions).toBe(1);
    expect(report.written).toBe(false);
    expect(existsSync(path.join(otelRoot, IMPORT_FILENAME))).toBe(false);
    expect(formatReport(report)).toContain("dry run");
  });

  it("writes spans and session metadata when asked", async () => {
    writeFixture({ id: "r-2", requests: 2, workspaceName: "Named session" });
    const report = await runImport({ write: true });
    expect(report.written).toBe(true);

    const written = readFileSync(path.join(otelRoot, IMPORT_FILENAME), "utf-8").trim().split("\n");
    expect(written).toHaveLength(2);

    clearSessionMetaCache();
    const meta = readSessionMeta(process.env);
    expect(meta).toHaveLength(1);
    expect(meta[0]?.session_id).toBe("r-2");
    expect(meta[0]?.session_name).toBe("Named session");
  });

  it("is idempotent across repeated writes", async () => {
    writeFixture({ id: "r-3", requests: 3 });
    await runImport({ write: true });
    const first = readFileSync(path.join(otelRoot, IMPORT_FILENAME), "utf-8");
    clearSessionMetaCache();
    await runImport({ write: true });
    const second = readFileSync(path.join(otelRoot, IMPORT_FILENAME), "utf-8");
    expect(second).toBe(first);

    clearSessionMetaCache();
    expect(readSessionMeta(process.env)).toHaveLength(1);
  });

  it("skips sessions already covered by the existing OTel export", async () => {
    writeFixture({ id: "r-old", startTime: "2026-01-01T00:00:00.000Z" });
    writeFixture({ id: "r-new", startTime: "2026-06-01T00:00:00.000Z" });
    writeFileSync(
      path.join(otelRoot, "copilot-otel.jsonl"),
      JSON.stringify({ type: "span", startTime: [Math.floor(Date.parse("2026-03-01T00:00:00.000Z") / 1000), 0] }),
      "utf-8",
    );

    const report = await runImport({ write: false });
    expect(report.imported.map((s) => s.session_id)).toEqual(["r-old"]);
    expect(report.skipped.find((s) => s.session_id === "r-new")?.reason).toBe("covered-by-otel");
    expect(report.cutover_source).toBe("otel-scan");
  });

  it("honours an explicit --until over the detected cutover", async () => {
    writeFixture({ id: "r-a", startTime: "2026-01-01T00:00:00.000Z" });
    writeFixture({ id: "r-b", startTime: "2026-06-01T00:00:00.000Z" });
    const report = await runImport({ write: false, until: new Date("2026-02-01T00:00:00.000Z") });
    expect(report.imported.map((s) => s.session_id)).toEqual(["r-a"]);
    expect(report.cutover_source).toBe("option");
  });

  it("reports skip reasons and recovered totals", async () => {
    writeFixture({ id: "r-good" });
    writeFixture({ id: "r-bad", output: 10, messageOutputs: [500] });
    const report = await runImport({ write: false });
    expect(report.totals.sessions).toBe(1);
    expect(report.skipped.find((s) => s.session_id === "r-bad")?.reason).toBe("incomplete-usage");
    const text = formatReport(report);
    expect(text).toContain("incomplete-usage");
    expect(text).toContain("AI credits");
  });
});
