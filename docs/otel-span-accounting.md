# OTel span accounting

How `copilot-cost` turns Copilot CLI OpenTelemetry JSONL into session token/cost totals, and how that lines up with the Copilot CLI usage panel.

## Pipeline

```
~/.copilot/otel/*.jsonl
        │
        ▼
  reader.ts   — tail files, dedupe by dedup_key, enrich session meta
        │
        ▼
  parser.ts   — keep billable chat completions only → NormalizedCall
        │
        ▼
  aggregations.ts — roll up by session / model / day
        │
        ▼
  dashboard UI / statusline
```

## Which spans count

Copilot CLI emits several `gen_ai.operation.name` values into the same JSONL file:

| Operation | Example span name | Counted? | Why |
| --- | --- | --- | --- |
| `chat` | `chat grok-4.5` | **Yes** | One leaf LLM completion (the billable unit). |
| `invoke_agent` | `invoke_agent` | **No** | Parent rollup of every child `chat` in a turn. |
| `execute_tool` | `execute_tool bash` | **No** | Tool execution; no independent model bill. |

Implementation: `isChatSpan()` in `src/otel/parser.ts`.

- If `gen_ai.operation.name` is present and is not `chat` (and does not start with `chat `), the span is ignored.
- If the operation is `chat`, or the span name starts with `chat `, it is normalized.
- Legacy spans with no operation name still use the older model + `input_tokens` heuristic so fixtures and older exporters keep working.

### Why parent `invoke_agent` spans must be dropped

Each user turn roughly looks like:

```
invoke_agent                          ← parent (no gen_ai.response.id)
├── chat grok-4.5                     ← leaf (has response id + usage)
├── execute_tool …
├── chat grok-4.5
├── …
└── chat grok-4.5
```

The parent copies the **sum** of child `gen_ai.usage.*` counters and `github.copilot.nano_aiu`. Counting parent + children doubles:

- input / cache / output / reasoning tokens
- estimated USD (and nano-AIU-derived cost)
- request counts (if each span is treated as one request)

### Regression evidence (illustrative session)

Representative round figures for one long multi-turn session. What matters is the
relationship between the columns, not the absolute values: counting parents plus
children doubles every counter, while leaf-only totals track the Copilot CLI panel.

| Metric | Copilot CLI usage panel | Parent + children (bug) | Leaf `chat` only (fix) |
| --- | --- | --- | --- |
| Input tokens | ~2.5m (2.4m cached) | ~5.0m | ~2.5m (2.4m cache) |
| Output tokens | ~28k | ~56k | ~28k |
| Reasoning tokens | ~3.5k | ~7k | ~3.5k |
| Estimated cost (nano-AIU) | - | 2x baseline | 1x baseline |

Official UI figures are rounded; leaf totals match within normal rounding.

Regression coverage: `tests-ts/otel-parser.test.ts`  
(`skips invoke_agent parent rollups…`, `skips execute_tool spans…`).

## Token field semantics

On a leaf `chat` span, Copilot typically sets:

| Attribute | Meaning |
| --- | --- |
| `gen_ai.usage.input_tokens` | **Total** input for the call (fresh + cache read + cache write). |
| `gen_ai.usage.cache_read.input_tokens` (and aliases) | Cache-hit input tokens. |
| `gen_ai.usage.cache_creation.input_tokens` / `cache_write*` | Cache-write input tokens. |
| `gen_ai.usage.output_tokens` | Completion tokens. |
| `gen_ai.usage.reasoning.output_tokens` | Reasoning tokens (when present). |
| `github.copilot.nano_aiu` | Backend-stamped bill for the call (preferred cost source). |

Parser normalization (`normalizeSpan`):

```
fresh_input = max(input_tokens - cache_read - cache_creation, 0)
```

`NormalizedCall.input_tokens` stores **fresh** input only. Cache read/write are separate fields so pricing can apply different $/MTok rates and the UI can show them apart.

### How the dashboard “Tokens” KPI is composed

Session list + drawer total tokens:

```
total_input_tokens          (fresh)
+ total_output_tokens
+ total_cache_read_tokens
+ total_cache_write_tokens
```

That equals total prompt tokens + completion tokens (cache is not added on top of an already-inclusive input figure, because fresh already had cache subtracted).

Overview KPI cards keep input / output / cache as three separate numbers (`PeriodTotals`).

## Cost

Prefer, in order:

1. **`github.copilot.nano_aiu`** on the leaf span → `nanoAiuToUsd()` (matches backend bill; 1 AIC = 1e9 nano-AIU, 100 AIC = $1 under current GitHub packaging used here).
2. Else **token × snapshot price** via `computeCost()`, using the session’s pinned `contextTier` (`default` | `long_context`), not a dynamic token-threshold switch.

Parent `invoke_agent` also carries rolled-up `nano_aiu`. Dropping parents is required for cost parity as well as token parity.

## Dedup

- Primary key: `traceId:spanId` when both exist.
- Else `gen_ai.response.id`, log-record hrTime, or a content hash.
- Reader dedupes within a file and again across files (`dedup_key`).
- Dedup alone does **not** fix the parent/child double count: parent and child have different span IDs.

## What to do if totals look ~2× again

1. Confirm the running binary includes the `isChatSpan` operation-name guard (`npm run build` after pull; global install is often `npm link`’d to this repo).
2. Restart `copilot-cost dashboard` so it loads the new `dist/cli.js`.
3. Spot-check a session in the JSONL:

   ```bash
   # count ops for one conversation id
   rg 'YOUR-SESSION-ID' ~/.copilot/otel/copilot-otel.jsonl \
     | rg -o 'gen_ai.operation.name.:.[^,}\\]]+' \
     | sort | uniq -c
   ```

   You should see many `chat` / `execute_tool` lines and far fewer `invoke_agent` lines. Only `chat` should contribute to totals.
4. If a **new** aggregator operation appears (not `invoke_agent` / `execute_tool`), extend the allow-list logic in `isChatSpan` the same way: non-`chat` operations must not become `NormalizedCall`s.
5. Compare leaf-only sums to the Copilot CLI session usage strip (input ↑, cached, output ↓, reasoning).

## Related files

- `src/otel/parser.ts` — `isChatSpan`, `normalizeSpan`
- `src/otel/reader.ts` — file tail cache, cross-file dedup, session-meta enrich
- `src/otel/aggregations.ts` — session / summary rollups
- `src/util/aiu.ts` — nano-AIU → USD
- `tests-ts/otel-parser.test.ts` — chat vs invoke_agent / execute_tool
- `CHANGELOG.md` — `[Unreleased]` entry for this fix
