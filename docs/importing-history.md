# Importing history from before the OTel exporter

`copilot-cost` reads GitHub Copilot CLI's OpenTelemetry JSONL, and the CLI only writes that file
once `COPILOT_OTEL_EXPORTER_TYPE=file` is set. Everything before `copilot-cost install` is therefore
invisible: a fresh install shows an empty dashboard even for someone who has used Copilot daily for
months.

`copilot-cost import-history` fills that gap from a source the CLI keeps regardless of telemetry
settings.

```bash
copilot-cost import-history           # dry run: report what would be imported
copilot-cost import-history --write   # apply it
```

## Where the numbers come from

Copilot CLI writes a per-session event log at `~/.copilot/session-state/<session-id>/events.jsonl`.
On shutdown it appends a `session.shutdown` event carrying a per-model billing summary. Its shape,
with illustrative round figures:

```jsonc
{
  "type": "session.shutdown",
  "data": {
    "totalNanoAiu": 14000000000,
    "modelMetrics": {
      "claude-sonnet-4.6": {
        "requests": { "count": 30, "cost": 0 },
        "usage": {
          "inputTokens": 2160000,       // total input: fresh + cache read + cache write
          "outputTokens": 13000,
          "cacheReadTokens": 1800000,
          "cacheWriteTokens": 350000,
          "reasoningTokens": 2700
        },
        "totalNanoAiu": 14000000000
      }
    }
  }
}
```

The field semantics line up with the OTel span attributes one for one, including `inputTokens`
being cache-inclusive. The importer applies the same derivation the parser uses on live spans:

```
fresh_input = max(inputTokens - cacheReadTokens - cacheWriteTokens, 0)
```

`totalNanoAiu` is the backend-stamped bill, the same quantity as `github.copilot.nano_aiu` on a live
span, so imported sessions cost out through the identical code path rather than an estimate.

This equivalence was checked against a session present in both sources. Every field matched exactly:
request count, input, output, cache read, reasoning tokens, and nano-AIU.

## How it is applied

The importer writes OTel-shaped leaf `chat` spans to `~/.copilot/otel/copilot-cost-imported.jsonl`.
The reader already globs `*.jsonl` in that directory, so nothing downstream needs to change: imported
usage flows through the same parser, dedup, pricing and aggregation path as live telemetry.

Span ids are derived deterministically from the session id, model and index, so re-running the import
replaces the previous file rather than stacking a second copy of the same history.

**To undo an import, delete that one file** and restart the dashboard.

Every imported span carries:

| Attribute | Meaning |
| --- | --- |
| `copilot_cost.imported` | Always `true`. Distinguishes imported spans from live telemetry. |
| `copilot_cost.import_source` | `session-state`. |
| `copilot_cost.uniform_split` | `true` when a session/model total was spread across several spans. |

## Two deliberate approximations

Neither invents usage. Both are visible on every span.

**Per-call granularity.** `session.shutdown` records session totals per model, not per call. The
importer splits those totals evenly across the recorded `requests.count`, with the remainder
distributed so the sum is exact. Every rollup the dashboard displays (session, model, day, model
leaderboard, timeseries) is therefore exact. Only the per-call list in the session drawer is
artificially uniform.

**Timestamps.** Per-call times are not recorded either, so every span carries the session start time.
Usage lands on the day the session began rather than being smeared across a session that may have run
for days. This is a single stated rule rather than an invented distribution.

## The completeness check

`session.shutdown` reports what the CLI process that flushed it observed. A session resumed across
processes keeps only its final run's counters, so trusting shutdown blindly silently undercounts.

`assistant.message` events carry `outputTokens` per model call for the whole session, which gives an
independent lower bound. The importer compares the two:

```
completeness = shutdown output tokens / assistant.message output tokens
```

A session below the floor (default `0.8`, tunable with `--min-completeness`) is **skipped**, not
imported and not estimated, and appears in the report under `incomplete-usage`. The dashboard then
shows only measured usage. Sessions are also skipped when they have no `events.jsonl`, no
`session.start`, no `session.shutdown`, or no `modelMetrics`.

In testing against a real history, roughly 90% of pre-exporter sessions reconciled cleanly. Most of
the remainder had no shutdown event at all; a few undercounted.

## The overlap guard

Importing a session that OTel already covers would double its tokens and cost. Before importing, the
tool reads the leading lines of each existing export to find the earliest record time. Those files are
append-only and therefore chronological, so this is cheap even for multi-gigabyte exports. Only
sessions that started strictly before that cutover are imported.

- `--until <iso>` sets the cutover explicitly.
- `--allow-overlap` disables the guard. It can double count; use it only with `--until`.

## Options

| Flag | Effect |
| --- | --- |
| `--write` | Apply the import. Without it the command is a dry run. |
| `--until <iso>` | Only import sessions started before this timestamp. |
| `--allow-overlap` | Skip the OTel cutover guard. May double count. |
| `--min-completeness <ratio>` | Reconciliation floor, `0`-`1`. Default `0.8`. |
| `--json` | Print the raw report as JSON. |

`COPILOT_SESSION_STATE_DIR` overrides the session-state location; `COPILOT_OTEL_DIR` overrides where
the import is written.

## Privacy

Session logs are considerably more sensitive than telemetry. `workspace.yaml` holds the session's
opening prompt, and `session.start` holds the working directory, git root and branch name.

The importer reads only what it needs: the prompt as a session title, and the cwd for the session
list. It never reads the git root, the branch name, the commit SHA, or any message content.

Those two values are written to exactly one place, `~/.copilot/otel/copilot-cost-meta.jsonl`, the
same local sidecar the live path already uses. They are deliberately **not** stamped onto the
imported spans: a value on a span overrides the sidecar when read back, which would mean deleting
the sidecar failed to remove them. They also never appear in the command's output, including
`--json`, so an import report is safe to paste into a bug report.

To store no titles at all, delete `~/.copilot/otel/copilot-cost-meta.jsonl` after importing.
Sessions then show as their ids, and nothing prompt-derived remains on disk.

Nothing is transmitted anywhere. `copilot-cost` emits no telemetry of its own, and the import is a
local file read and a local file write.

## Related files

- `src/import/session-state.ts` — event log scanning, reconciliation, span construction
- `src/import/index.ts` — cutover detection, orchestration, reporting
- `tests-ts/import-session-state.test.ts` — coverage, on synthetic fixtures only
- `docs/otel-span-accounting.md` — which spans count and what the token fields mean
