# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `copilot-cost import-history` recovers usage from before the OTel exporter was enabled, reading Copilot CLI's own `~/.copilot/session-state/*/events.jsonl`. Dry run by default; `--write` applies it. Imported spans go to a single `copilot-cost-imported.jsonl` so an import can be undone by deleting one file, and span ids are deterministic so re-running replaces rather than duplicates. Sessions whose `session.shutdown` totals fail to reconcile against their per-message output tokens are skipped and reported rather than estimated. An OTel cutover guard prevents double counting sessions the exporter already captured. See [`docs/importing-history.md`](docs/importing-history.md).

- Overview chart granularity toggles: **7d** Daily vs 3h; **30d** Daily vs 6h vs 12h (persisted). Timeseries API accepts `?grain=`.
- Overview `7d` chart now buckets usage into 3-hour local wall-clock windows (instead of one bar per day), with axis labels that include the date.
- Added a `1d` dashboard range with an hourly overview chart bucketing in the browser's local IANA timezone (`?tz=`, e.g. Australia/Sydney).
- Overview Top models and chart legends now follow the selected date range.
- Overview homepage chart can switch between **Spend by model** (default) and **Tokens by model** (total token volume: fresh input + output + cache read + cache write, matching the Models page). Top models has an independent Spend/Tokens toggle, with preferences persisted in `localStorage` (`copilot-cost.overviewMetric` and `copilot-cost.topModelsMetric`).
- Overview Spend/Tokens chart now overlays the inverse metric as a total-per-day line on a right axis (spend line when viewing tokens, tokens line when viewing spend), with a right-side legend for the overlay.
- Models page lists every tracked model with lifetime total tokens plus fresh input / output / cache read / cache write breakdown, token share, cost, sessions, and sortable columns (default sort: total tokens).
- Dashboard USD/AUD display toggle. Usage totals stay canonical USD; the UI multiplies by a locally cached USD→AUD reference rate from Frankfurter (Fawaz fallback) via `GET /api/fx`. Preference persists in `localStorage`; pricing catalog and CSV export remain USD.
- Dashboard date-range selection (1d/7d/30d/90d/All) now persists across reloads via localStorage (`copilot-cost.range`).

### Fixed

- Stop double-counting tokens/cost when Copilot emits parent `invoke_agent` spans that roll up every child `chat` call. Dashboard session totals now match the Copilot CLI usage panel (leaf chat spans only).
- Statusline now prefers Copilot CLI's native session AIC (`ai_used.total_nano_aiu`, 1 AIC = 1e9 nano-AIU) so the bottom bar matches the header "Session: N AIC used" figure.
- Long-context pricing is **mode-based**, matching Copilot CLI: rates follow the pinned `contextTier` (`default` vs `long_context` from the model picker / `~/.copilot/settings.json`), not a dynamic “input tokens crossed threshold” switch. Applies to every tiered model (Grok, GPT-5.4/5.5/5.6*, Gemini 3.1 Pro, …). Rates still load from GitHub’s pricing docs via `refresh-pricing`.
- Treat upstream `cache_write: Not applicable` as “no write charge” instead of inventing an input-price write rate.
- Dashboard Pricing page shows default vs long_context $/MTok rates for tiered models.
- Refreshed the bundled `pricing.snapshot.yaml` from GitHub's published models-and-pricing data (includes Grok 4.5 and current long-context tiers; keeps retired models for historical OTel).

## [0.3.1] - 2026-07-16

### Fixed

- Corrected fresh-input accounting so both cache reads and cache writes are excluded from fresh tokens, including alternate OpenTelemetry cache attribute names emitted by Copilot CLI.
- Corrected the dashboard pricing table to use the bundled `cached_input` field and expanded per-call details to show fresh input, cache reads, and cache writes separately.

## [0.3.0] - 2026-05-21

### Changed

- Changed the statusline UX so `compact` / `minimal` default to estimated USD only, while `standard` and `full` show both estimated USD and GitHub AI Credits (AIC).
- Added `COPILOT_COST_METRIC` to choose `usd`, `aic`, or `both`, with friendly aliases for dollars, credits, and all metrics.
- Clarified README disclaimers that displayed costs are local estimates based on GitHub's published per-model pricing, not billing data or a guarantee of what GitHub will charge.
- Refreshed the bundled pricing snapshot from GitHub's published Copilot models and pricing data.

## [0.1.0] - 2026-05-14

Initial public release.

### Added

- Statusline renderer for the GitHub Copilot CLI with `standard`, `compact`, and `full` formats, configurable via `COPILOT_COST_FORMAT`, `COPILOT_COST_COLOR`, `COPILOT_COST_NO_COLOR`, and `COPILOT_COST_HIDE_ZERO`.
- One-line `copilot-cost install` that wires up the Copilot CLI statusline and appends an idempotent OpenTelemetry block to the user's shell profile (opt out with `--no-otel-profile`).
- Cross-platform installer support: POSIX shell shim on macOS and Linux, plus a `copilot-cost.cmd` shim and PowerShell profile OpenTelemetry setup on Windows.
- `copilot-cost uninstall` to cleanly revert settings owned by this tool.
- `copilot-cost doctor` to verify statusline setup, OpenTelemetry output, pricing freshness, and dashboard readiness.
- Local web dashboard (`copilot-cost dashboard`) bound to `127.0.0.1` by default, with Overview, Sessions, Models, Pricing, and Settings pages, light and dark themes, charts, and CSV export.
- OpenTelemetry JSONL reader and aggregator that rolls token usage up by session, model, and day from `~/.copilot/otel/*.jsonl`.
- Bundled pricing snapshot plus `copilot-cost refresh-pricing` (with `--force`) to pull the latest model pricing from the GitHub Docs.
- `/api/health` and `/api/install-otel` HTTP endpoints for the dashboard.

### Security & Privacy

- All usage data is read from local files; nothing is sent to third parties.
- Dashboard server refuses non-loopback hosts.
- No analytics or telemetry emitted by this package.
