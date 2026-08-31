const routes = {
  overview: { title: "Overview", render: renderOverview },
  sessions: { title: "Sessions", render: renderSessions },
  models: { title: "Models", render: renderModels },
  pricing: { title: "Pricing", render: renderPricing },
  settings: { title: "Settings", render: renderSettings },
};

const requestedTheme = new URLSearchParams(location.search).get("theme");
if (requestedTheme === "light" || requestedTheme === "dark") document.documentElement.dataset.theme = requestedTheme;

const ICONS = {
  overview: '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.25"/><rect x="11" y="2.5" width="6.5" height="6.5" rx="1.25"/><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.25"/><rect x="11" y="11" width="6.5" height="6.5" rx="1.25"/></svg>',
  sessions: '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h14"/><path d="M3 10h14"/><path d="M3 15h14"/></svg>',
  models: '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16V9"/><path d="M8.5 16V5"/><path d="M14 16v-5"/></svg>',
  pricing: '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5h-4a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4h-4.5"/><path d="M10 3v1.5"/><path d="M10 12.5V15"/></svg>',
  settings: '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="2.25"/><path d="M16.25 10a6.25 6.25 0 0 0-.1-1.1l1.6-1.25-1.5-2.6-1.9.65a6.25 6.25 0 0 0-1.9-1.1L12 2.5h-3l-.45 2.1a6.25 6.25 0 0 0-1.9 1.1l-1.9-.65-1.5 2.6 1.6 1.25a6.25 6.25 0 0 0 0 2.2l-1.6 1.25 1.5 2.6 1.9-.65a6.25 6.25 0 0 0 1.9 1.1L9 17.5h3l.45-2.1a6.25 6.25 0 0 0 1.9-1.1l1.9.65 1.5-2.6-1.6-1.25c.07-.36.1-.73.1-1.1Z"/></svg>',
};

const navItems = [
  ["overview", "Overview", ICONS.overview],
  ["sessions", "Sessions", ICONS.sessions],
  ["models", "Models", ICONS.models],
  ["pricing", "Pricing", ICONS.pricing],
  ["settings", "Settings", ICONS.settings],
];

const palette = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#7c3aed"];
function loadPreferredCurrency() {
  try {
    return localStorage.getItem("copilot-cost.currency") === "AUD" ? "AUD" : "USD";
  } catch {
    return "USD";
  }
}

function loadPreferredMetric() {
  try {
    return localStorage.getItem("copilot-cost.overviewMetric") === "tokens" ? "tokens" : "spend";
  } catch {
    return "spend";
  }
}

function loadPreferredRange() {
  try {
    const value = localStorage.getItem("copilot-cost.range");
    if (value === "1d" || value === "7d" || value === "30d" || value === "90d" || value === "all") return value;
  } catch {
    // localStorage may be unavailable
  }
  return "30d";
}

function loadPreferredChartGrain(range) {
  try {
    const value = localStorage.getItem(`copilot-cost.chartGrain.${range}`);
    if (range === "7d" && (value === "day" || value === "3h")) return value;
    if (range === "30d" && (value === "day" || value === "6h" || value === "12h")) return value;
  } catch {
    // localStorage may be unavailable
  }
  return range === "7d" ? "3h" : "day";
}

function loadPreferredTopModelsMetric() {
  try {
    return localStorage.getItem("copilot-cost.topModelsMetric") === "tokens" ? "tokens" : "spend";
  } catch {
    return "spend";
  }
}

function savePreferredMetric(metric) {
  try {
    localStorage.setItem("copilot-cost.overviewMetric", metric === "tokens" ? "tokens" : "spend");
  } catch {
    // localStorage may be unavailable in private or restricted browsing contexts.
  }
}

function savePreferredRange(range) {
  try {
    if (range === "1d" || range === "7d" || range === "30d" || range === "90d" || range === "all") {
      localStorage.setItem("copilot-cost.range", range);
    }
  } catch {
    // localStorage may be unavailable
  }
}

function savePreferredChartGrain(range, grain) {
  const valid = (range === "7d" && (grain === "day" || grain === "3h"))
    || (range === "30d" && (grain === "day" || grain === "6h" || grain === "12h"));
  if (!valid) return;
  try {
    localStorage.setItem(`copilot-cost.chartGrain.${range}`, grain);
  } catch {
    // localStorage may be unavailable in private or restricted browsing contexts.
  }
}

function savePreferredTopModelsMetric(metric) {
  try {
    localStorage.setItem("copilot-cost.topModelsMetric", metric === "tokens" ? "tokens" : "spend");
  } catch {
    // localStorage may be unavailable in private or restricted browsing contexts.
  }
}

const state = {
  /** Dashboard date range (default: "30d"). Persisted in localStorage. */
  range: loadPreferredRange(),
  chartGrain7d: loadPreferredChartGrain("7d"),
  chartGrain30d: loadPreferredChartGrain("30d"),
  /** Overview chart metric: "spend" (default) or "tokens". Persisted in localStorage. */
  metric: loadPreferredMetric(),
  /** Top models metric: "spend" (default) or "tokens". Persisted in localStorage. */
  topModelsMetric: loadPreferredTopModelsMetric(),
  currency: "USD",
  preferredCurrency: loadPreferredCurrency(),
  fx: { available: false, rate: null, fetched_at: null, provider_date: null, source: null, stale: false, error: null, status: "idle" },
  useMock: new URLSearchParams(location.search).get("mock") === "1",
  screenshot: new URLSearchParams(location.search).get("screenshot") === "1",
  cache: new Map(),
  chart: null,
  sort: { key: "last_seen_at", dir: "desc" },
  modelsSort: { key: "token_volume", dir: "desc" },
};

const page = document.querySelector("#page");
const pageTitle = document.querySelector("#page-title");
const sidebar = document.querySelector("#sidebar");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const drawerRoot = document.querySelector("#drawer-root");

const fmtUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtAud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtTok = new Intl.NumberFormat("en-US");
const fmtPct = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
function validFxRate(rate) {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function money(n) {
  const usd = Number(n || 0);
  if (state.currency === "AUD" && validFxRate(state.fx.rate)) return fmtAud.format(usd * state.fx.rate);
  return fmtUsd.format(usd);
}

function moneyUsd(n) {
  return fmtUsd.format(Number(n || 0));
}

const tok = (n) => fmtTok.format(Math.round(Number(n || 0)));
const pct = (n) => fmtPct.format(Number(n || 0));
const oneM = (n) => Number(n || 0) / 1_000_000;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
const routeName = () => (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];

async function api(path, options = {}) {
  if (state.useMock) return mockApi(path, options);
  const key = `${options.method || "GET"}:${path}`;
  try {
    const res = await fetch(path, { cache: "no-store", ...options, headers: { accept: "application/json", ...(options.headers || {}) } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!options.method || options.method === "GET") state.cache.set(key, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`API unavailable for ${path}: ${message}`);
  }
}

function updateFxStatus() {
  const element = document.querySelector("#fx-status");
  if (!element) return;
  let text = "";
  if (state.currency === "AUD" && validFxRate(state.fx.rate)) {
    const date = state.fx.provider_date || (state.fx.fetched_at ? new Date(state.fx.fetched_at).toISOString().slice(0, 10) : "unknown");
    const stale = state.fx.stale ? " · stale" : "";
    text = `1 USD = ${state.fx.rate.toFixed(4)} AUD · as of ${date} · ${state.fx.source || "unknown"}${stale} · AUD estimate, not a bill`;
  } else if (state.preferredCurrency === "AUD") {
    text = state.fx.status === "idle" || state.fx.status === "loading" ? "Loading AUD rate…" : "AUD unavailable — showing USD";
  }
  element.textContent = text;
  element.classList.toggle("hidden", !text);
  element.classList.toggle("lg:inline", Boolean(text));
}

async function ensureFxRate(force = false) {
  if (!force && state.fx.status !== "idle") {
    if (state.preferredCurrency === "AUD" && validFxRate(state.fx.rate)) state.currency = "AUD";
    updateCurrencyButtons();
    updateFxStatus();
    return validFxRate(state.fx.rate);
  }
  if (force) state.cache.delete("GET:/api/fx");
  state.fx.status = "loading";
  updateFxStatus();
  try {
    const response = await api("/api/fx");
    const available = response?.available === true && validFxRate(response?.rate);
    state.fx = {
      available,
      rate: available ? response.rate : null,
      fetched_at: response?.fetched_at || null,
      provider_date: response?.provider_date || null,
      source: response?.source || null,
      stale: response?.stale === true,
      error: response?.error || null,
      status: available ? "ready" : "unavailable",
    };
  } catch (error) {
    state.fx = { ...state.fx, available: false, rate: null, error: error instanceof Error ? error.message : String(error), status: "error" };
  }
  state.currency = state.preferredCurrency === "AUD" && validFxRate(state.fx.rate) ? "AUD" : "USD";
  updateCurrencyButtons();
  updateFxStatus();
  return validFxRate(state.fx.rate);
}

function setSkeleton() {
  page.innerHTML = `
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      ${Array.from({ length: 4 }, () => `<div class="kpi-card"><div class="skeleton h-4 w-24"></div><div class="skeleton mt-5 h-10 w-36"></div><div class="skeleton mt-4 h-4 w-full"></div></div>`).join("")}
    </div>
    <div class="mt-6 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
      <div class="surface p-5"><div class="skeleton h-6 w-40"></div><div class="skeleton mt-5 h-72 w-full"></div></div>
      <div class="surface p-5"><div class="skeleton h-6 w-32"></div><div class="mt-5 space-y-3">${Array.from({ length: 6 }, () => `<div class="skeleton h-10 w-full"></div>`).join("")}</div></div>
    </div>`;
}

function renderNav(active) {
  document.querySelector("#nav").innerHTML = navItems.map(([id, label, icon]) => `
    <a href="#/${id}" class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${active === id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}" ${active === id ? 'aria-current="page"' : ""}>
      <span class="flex h-5 w-5 items-center justify-center text-current" aria-hidden="true">${icon}</span><span>${label}</span>
    </a>`).join("");
}

function updateRangeButtons() {
  document.querySelectorAll(".range-btn").forEach((button) => {
    const active = button.dataset.range === state.range;
    button.classList.toggle("bg-muted", active);
    button.classList.toggle("text-foreground", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateCurrencyButtons() {
  document.querySelectorAll(".currency-btn").forEach((button) => {
    const active = button.dataset.currency === state.currency;
    button.classList.toggle("bg-muted", active);
    button.classList.toggle("text-foreground", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateMetricButtons() {
  document.querySelectorAll(".metric-btn").forEach((button) => {
    const metric = button.dataset.metricTarget === "top-models" ? state.topModelsMetric : state.metric;
    const active = button.dataset.metric === metric;
    button.classList.toggle("bg-muted", active);
    button.classList.toggle("text-foreground", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function loadRoute() {
  const id = routes[routeName()] ? routeName() : "overview";
  if (!routes[routeName()]) location.hash = "#/overview";
  setSkeleton();
  renderNav(id);
  updateRangeButtons();
  updateCurrencyButtons();
  updateFxStatus();
  pageTitle.textContent = routes[id].title;
  closeMobileNav();
  try {
    if (state.preferredCurrency === "AUD") await ensureFxRate();
    else state.currency = "USD";
    updateCurrencyButtons();
    updateFxStatus();
    const health = await api("/api/health");
    if (id !== "settings" && (!health.otel_enabled || Number(health.jsonl_files || 0) === 0)) {
      renderOnboarding(health);
      return;
    }
    await routes[id].render(health);
  } catch (error) {
    page.innerHTML = errorCard("Could not render dashboard", error.message);
  }
}

function isTokensMetric() {
  return state.metric === "tokens";
}

function inverseMetric(metric = state.metric) {
  return metric === "tokens" ? "spend" : "tokens";
}

function dailyTotals(series, days, metric) {
  return days.map((day) =>
    series
      .filter((row) => row.day === day)
      .reduce((sum, row) => sum + seriesValue(row, metric), 0),
  );
}

function chartMetricCopy() {
  if (isTokensMetric()) {
    return {
      title: "Tokens by model",
      subtitle: "Stacked daily token volume with total spend overlay.",
      aria: "Stacked bar chart of tokens by model with total spend line",
      inverseLegend: "Total spend",
    };
  }
  return {
    title: "Spend by model",
    subtitle: "Stacked daily usage with total token volume overlay.",
    aria: "Stacked bar chart of spend by model with total tokens line",
    inverseLegend: "Total tokens",
  };
}

function seriesValue(row, metric = state.metric) {
  if (metric === "tokens") {
    // Prefer API token_volume (matches models page). Fall back for older servers
    // that only emit input/output (+ optional cache) on timeseries rows.
    if (row.token_volume !== undefined && row.token_volume !== null && row.token_volume !== "") {
      const volume = Number(row.token_volume);
      if (Number.isFinite(volume)) return volume;
    }
    return Number(row.input_tokens || 0)
      + Number(row.output_tokens || 0)
      + Number(row.cache_read_tokens || row.cache_read || 0)
      + Number(row.cache_write_tokens || row.cache_creation || 0);
  }
  return Number(row.usd_cost || 0);
}

function modelMetricValue(model, metric = state.metric) {
  if (metric === "tokens") return Number(model.token_volume || 0);
  return Number(model.usd_cost || 0);
}

function formatMetric(value, metric = state.metric) {
  return metric === "tokens" ? tok(value) : money(value);
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function rangeQuery(range) {
  const tz = encodeURIComponent(browserTimeZone());
  let q = `range=${encodeURIComponent(range)}&tz=${tz}`;
  const grain = chartGrainForRange(range);
  if (grain) q += `&grain=${encodeURIComponent(grain)}`;
  return q;
}

function chartGrainForRange(range) {
  if (range === "7d") return state.chartGrain7d;
  if (range === "30d") return state.chartGrain30d;
  return null;
}

async function renderOverview() {
  const range = state.range === "all" ? "90d" : state.range;
  const tz = encodeURIComponent(browserTimeZone());
  const modelsQ = `range=${encodeURIComponent(range)}&tz=${tz}`;
  const seriesQ = rangeQuery(range);
  const [summary, sessions, models, series] = await Promise.all([
    api("/api/summary"),
    api("/api/sessions"),
    api(`/api/models?${modelsQ}`),
    api(`/api/timeseries?${seriesQ}`),
  ]);
  const month = summary.month || periodFromSeries(series, 30);
  const quarter = summary.quarter || periodFromSeries(series, 90);
  const cards = [
    ["Today", summary.today, deltaFromSeries(series, 1)],
    ["7-day", summary.week, deltaFromSeries(series, 7)],
    ["30-day", month, deltaFromSeries(series, 30)],
    state.range === "90d"
      ? ["90-day", quarter, deltaFromSeries(series, 90), "Rolling 90-day window"]
      : ["Lifetime", summary.lifetime, null],
  ];
  const chartMetric = state.metric;
  const topModelsMetric = state.topModelsMetric;
  const chartModels = [...models]
    .sort((a, b) => modelMetricValue(b, chartMetric) - modelMetricValue(a, chartMetric) || String(a.model).localeCompare(String(b.model)))
    .slice(0, 5);
  const topModels = [...models]
    .sort((a, b) => modelMetricValue(b, topModelsMetric) - modelMetricValue(a, topModelsMetric) || String(a.model).localeCompare(String(b.model)))
    .slice(0, 5);
  const topTotal = models.reduce((sum, m) => sum + modelMetricValue(m, topModelsMetric), 0);
  const recent = [...sessions].sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0)).slice(0, 8);
  const copy = chartMetricCopy();
  const chartSpendPressed = chartMetric === "spend";
  const chartTokensPressed = chartMetric === "tokens";
  const topModelsSpendPressed = topModelsMetric === "spend";
  const topModelsTokensPressed = topModelsMetric === "tokens";
  const grainOptions = range === "7d" ? ["day", "3h"] : range === "30d" ? ["day", "6h", "12h"] : [];
  const selectedGrain = range === "7d" ? state.chartGrain7d : state.chartGrain30d;
  const grainLabels = { day: "Daily", "3h": "3h", "6h": "6h", "12h": "12h" };

  page.innerHTML = `
    <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Usage summary">
      ${cards.map(([label, period, delta, emptyDeltaText]) => kpiCard(label, period, delta, emptyDeltaText)).join("")}
    </section>
    <section class="mt-6 grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-stretch">
      <div class="surface flex h-full min-h-[28rem] flex-col p-5">
        <div class="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-3">
              <h2 class="text-base font-semibold">${copy.title}</h2>
              <div class="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Chart metric">
                <button class="metric-btn btn-ghost h-8 px-2.5" data-metric-target="chart" data-metric="spend" type="button" aria-pressed="${chartSpendPressed}">Spend</button>
                <button class="metric-btn btn-ghost h-8 px-2.5" data-metric-target="chart" data-metric="tokens" type="button" aria-pressed="${chartTokensPressed}">Tokens</button>
              </div>
              ${grainOptions.length ? `<div class="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Chart granularity">${grainOptions.map((grain) => `<button class="grain-btn btn-ghost h-8 px-2.5" data-grain="${grain}" data-grain-range="${range}" type="button" aria-pressed="${selectedGrain === grain}">${grainLabels[grain]}</button>`).join("")}</div>` : ""}
            </div>
            <p class="mt-1 text-sm text-muted-foreground">${copy.subtitle}</p>
          </div>
          <div class="flex flex-wrap gap-2">${chartModels.map((m) => `<span class="pill"><span class="h-2 w-2 rounded-full" style="background:${modelColor(m.model)}"></span>${escapeHtml(shortModel(m.model))}</span>`).join("")}</div>
        </div>
        <div class="relative min-h-0 w-full flex-1">
          <canvas id="spend-chart" class="absolute inset-0 h-full w-full" aria-label="${copy.aria}" role="img"></canvas>
        </div>
      </div>
      <div class="surface flex h-full flex-col p-5">
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">Top models</h2>
            <p class="mt-1 text-sm text-muted-foreground">${range === "1d" ? "Today" : `Last ${range === "7d" ? "7" : range === "90d" ? "90" : "30"} days`}</p>
          </div>
          <div class="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Top models metric">
            <button class="metric-btn btn-ghost h-8 px-2.5" data-metric-target="top-models" data-metric="spend" type="button" aria-pressed="${topModelsSpendPressed}">Spend</button>
            <button class="metric-btn btn-ghost h-8 px-2.5" data-metric-target="top-models" data-metric="tokens" type="button" aria-pressed="${topModelsTokensPressed}">Tokens</button>
          </div>
        </div>
        <div class="mt-4 min-h-0 flex-1 space-y-3">${topModels.map((m) => modelPillRow(m, topTotal, topModelsMetric)).join("") || emptyInline("No model data yet.")}</div>
      </div>
    </section>
    <section class="surface mt-6 overflow-hidden">
      <div class="flex items-center justify-between gap-3 p-5"><div><h2 class="text-base font-semibold">Recent sessions</h2><p class="text-sm text-muted-foreground">Latest local Copilot CLI activity.</p></div><a class="btn-ghost" href="#/sessions">View all</a></div>
      <div class="overflow-x-auto">${sessionsTable(recent, false)}</div>
    </section>`;
  bindSessionRows();
  updateMetricButtons();
  await renderSpendChart(series);
}

function kpiCard(label, period = {}, delta, emptyDeltaText = "All recorded local usage") {
  const deltaClass = !delta ? "text-muted-foreground" : delta.value <= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
  const deltaText = delta ? `${delta.value >= 0 ? "▲" : "▼"} ${pct(Math.abs(delta.value))} vs previous` : emptyDeltaText;
  return `<article class="kpi-card">
    <div class="flex items-center justify-between gap-3"><h2 class="text-sm font-medium text-muted-foreground">${label}</h2><span class="pill">${tok(period.premium_requests)} req</span></div>
    <p class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">${money(period.usd_cost)}</p>
    <p class="mt-3 text-sm text-muted-foreground"><span class="${deltaClass}">${deltaText}</span></p>
    <dl class="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
      <div><dt>Input</dt><dd class="mt-1 font-medium text-foreground">${tok(period.input_tokens)}</dd></div>
      <div><dt>Output</dt><dd class="mt-1 font-medium text-foreground">${tok(period.output_tokens)}</dd></div>
      <div><dt>Cache</dt><dd class="mt-1 font-medium text-foreground">${tok(period.cache_tokens)}</dd></div>
    </dl>
  </article>`;
}

async function renderSessions() {
  const [sessions, series] = await Promise.all([api("/api/sessions"), api(`/api/timeseries?range=${state.range === "all" ? "90d" : state.range}`)]);
  page.innerHTML = `
    <section class="surface p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 class="text-base font-semibold">Sessions</h2><p class="text-sm text-muted-foreground">Filter, sort, and inspect individual LLM calls.</p></div>
        <label class="block text-sm font-medium text-muted-foreground">Filter
          <input id="session-filter" class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:w-80" placeholder="Name, path, or model" />
        </label>
      </div>
      <div id="sessions-table" class="mt-4 overflow-x-auto"></div>
    </section>`;
  const render = () => {
    const query = document.querySelector("#session-filter").value.trim().toLowerCase();
    let rows = sessions.filter((s) => [s.session_name, s.cwd, s.model, s.first_model, s.id].some((v) => String(v || "").toLowerCase().includes(query)));
    rows = sortRows(rows, state.sort.key, state.sort.dir);
    document.querySelector("#sessions-table").innerHTML = sessionsTable(rows, true, series);
    bindSessionRows();
    document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.sort = { key, dir: state.sort.key === key && state.sort.dir === "desc" ? "asc" : "desc" };
      render();
    }));
  };
  document.querySelector("#session-filter").addEventListener("input", render);
  render();
}

function sessionsTable(rows, sortable = false) {
  const head = (key, label) => sortable ? `<button class="inline-flex items-center gap-1 hover:text-foreground" data-sort="${key}" type="button">${label}${state.sort.key === key ? (state.sort.dir === "desc" ? " ↓" : " ↑") : ""}</button>` : label;
  return `<table class="table">
    <thead><tr><th>${head("session_name", "Session")}</th><th>${head("model", "Model")}</th><th>${head("usd_cost", "Cost")}</th><th>${head("total_input_tokens", "Tokens")}</th><th>Spark</th><th>${head("last_seen_at", "Last seen")}</th></tr></thead>
    <tbody>${rows.map((s) => `<tr class="cursor-pointer transition-colors hover:bg-muted/60" tabindex="0" role="button" data-session-id="${escapeHtml(s.id)}" aria-label="Open ${escapeHtml(s.session_name || s.id)} details">
      <td class="min-w-64"><div class="font-medium">${escapeHtml(s.session_name || s.id)}</div><div class="max-w-md truncate text-xs text-muted-foreground">${escapeHtml(s.cwd || "Unknown path")}</div></td>
      <td><span class="pill"><span class="h-2 w-2 rounded-full" style="background:${modelColor(s.model || s.first_model)}"></span>${escapeHtml(shortModel(s.model || s.first_model || "unknown"))}</span></td>
      <td class="font-medium">${money(s.usd_cost)}</td>
      <td>${tok(Number(s.total_input_tokens || 0) + Number(s.total_output_tokens || 0) + Number(s.total_cache_read_tokens || 0) + Number(s.total_cache_write_tokens || 0))}</td>
      <td>${sparkline(sessionPoints(s))}</td>
      <td class="whitespace-nowrap text-muted-foreground">${formatDate(s.last_seen_at)}</td>
    </tr>`).join("") || `<tr><td colspan="6">${emptyInline("No sessions match the current filter.")}</td></tr>`}</tbody>
  </table>`;
}

async function renderModels() {
  const [models, summary] = await Promise.all([api("/api/models"), api("/api/summary")]);
  const totalCost = Number(summary.lifetime?.usd_cost || models.reduce((sum, m) => sum + Number(m.usd_cost || 0), 0));
  const totalTokens = models.reduce((sum, m) => sum + Number(m.token_volume || 0), 0);
  const sortKey = state.modelsSort?.key || "token_volume";
  const sortDir = state.modelsSort?.dir || "desc";
  const sorted = sortRows(models, sortKey, sortDir);
  const head = (key, label) => `<button class="inline-flex items-center gap-1 hover:text-foreground" data-models-sort="${key}" type="button">${label}${sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</button>`;

  page.innerHTML = `<section class="surface overflow-hidden">
    <div class="p-5">
      <h2 class="text-base font-semibold">All models</h2>
      <p class="text-sm text-muted-foreground">Every model seen in local OTel traces with lifetime token usage. Total tokens = fresh input + output + cache read + cache write.</p>
      <dl class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-border p-3"><dt class="text-xs text-muted-foreground">Models tracked</dt><dd class="mt-1 text-lg font-semibold">${tok(models.length)}</dd></div>
        <div class="rounded-lg border border-border p-3"><dt class="text-xs text-muted-foreground">Total tokens</dt><dd class="mt-1 text-lg font-semibold">${tok(totalTokens)}</dd></div>
        <div class="rounded-lg border border-border p-3"><dt class="text-xs text-muted-foreground">Total spend</dt><dd class="mt-1 text-lg font-semibold">${money(totalCost)}</dd></div>
      </dl>
    </div>
    <div class="overflow-x-auto"><table class="table"><thead><tr>
      <th>${head("model", "Model")}</th>
      <th>${head("token_volume", "Total tokens")}</th>
      <th>${head("input_tokens", "Fresh input")}</th>
      <th>${head("output_tokens", "Output")}</th>
      <th>${head("cache_read_tokens", "Cache read")}</th>
      <th>${head("cache_write_tokens", "Cache write")}</th>
      <th>${head("cache_hit_ratio", "Cache hit")}</th>
      <th>${head("usd_cost", "Cost")}</th>
      <th>Token share</th>
      <th>${head("sessions", "Sessions")}</th>
      <th>$/1M tok</th>
    </tr></thead><tbody>
      ${sorted.map((m) => {
        const volume = Number(m.token_volume || (
          Number(m.input_tokens || 0) + Number(m.output_tokens || 0) + Number(m.cache_read_tokens || 0) + Number(m.cache_write_tokens || 0)
        ));
        const tokenShare = totalTokens ? volume / totalTokens : 0;
        const input = Number(m.input_tokens || 0);
        const output = Number(m.output_tokens || 0);
        const cacheRead = Number(m.cache_read_tokens || 0);
        const cacheWrite = Number(m.cache_write_tokens || 0);
        return `<tr>
          <td class="font-medium whitespace-nowrap"><span class="mr-2 inline-block h-2.5 w-2.5 rounded-full" style="background:${modelColor(m.model)}"></span>${escapeHtml(m.model)}</td>
          <td class="font-medium">${tok(volume)}</td>
          <td>${tok(input)}</td>
          <td>${tok(output)}</td>
          <td>${tok(cacheRead)}</td>
          <td>${tok(cacheWrite)}</td>
          <td>${pct(m.cache_hit_ratio)}</td>
          <td>${money(m.usd_cost)}</td>
          <td class="min-w-40"><div class="h-2 rounded-full bg-muted"><div class="h-2 rounded-full" style="width:${Math.min(100, tokenShare * 100)}%; background:${modelColor(m.model)}"></div></div><span class="mt-1 block text-xs text-muted-foreground">${pct(tokenShare)}</span></td>
          <td>${tok(m.sessions)}</td>
          <td>${volume ? money(Number(m.usd_cost || 0) / oneM(volume)) : "—"}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="11">${emptyInline("No model data yet.")}</td></tr>`}
    </tbody></table></div>
  </section>`;

  document.querySelectorAll("[data-models-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.modelsSort;
    const dir = state.modelsSort?.key === key && state.modelsSort?.dir === "desc" ? "asc" : "desc";
    state.modelsSort = { key, dir };
    renderModels();
  }));
}

function longContextThresholdLabel(row) {
  const threshold = Number(row?.long_context_threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) return "—";
  if (threshold >= 1_000_000) return `> ${(threshold / 1_000_000).toFixed(threshold % 1_000_000 === 0 ? 0 : 1)}M`;
  if (threshold >= 1_000) return `> ${(threshold / 1_000).toFixed(threshold % 1_000 === 0 ? 0 : 1)}K`;
  return `> ${threshold}`;
}

function pricingTierCell(row, defaultKeys, longKeys) {
  const base = pricingValue(row, defaultKeys);
  if (row?.long_context_threshold == null) return base;
  const long = pricingValue(row, longKeys);
  if (long === "—") return base;
  return `<div class="space-y-0.5"><div>${base} <span class="text-xs text-muted-foreground">default</span></div><div>${long} <span class="text-xs text-muted-foreground">long ctx</span></div></div>`;
}

async function renderPricing() {
  const pricing = await api("/api/pricing");
  const models = Object.entries(pricing.models || {}).sort(([a], [b]) => a.localeCompare(b));
  page.innerHTML = `<section class="surface overflow-hidden">
    <div class="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 class="text-base font-semibold">Pricing catalog</h2><p class="text-sm text-muted-foreground">Catalog rates are in USD; usage totals convert when AUD is selected. Fetched ${escapeHtml(formatDate(pricing.fetched_at) || "unknown")} · schema ${escapeHtml(pricing.schema_version || "n/a")} · default vs long_context window modes (pinned in Copilot settings, not dynamic)</p></div>
      <button id="refresh-pricing" class="btn" type="button">Refresh pricing</button>
    </div>
    <div class="overflow-x-auto"><table class="table"><thead><tr><th>Model</th><th>Has long_context mode</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th></tr></thead><tbody>
      ${models.map(([model, row]) => `<tr>
        <td class="font-medium">${escapeHtml(model)}</td>
        <td>${row?.long_context_input != null || row?.long_context_threshold != null ? `yes${longContextThresholdLabel(row) !== "—" ? ` · docs ${escapeHtml(longContextThresholdLabel(row))}` : ""}` : "—"}</td>
        <td>${pricingTierCell(row, ["input"], ["long_context_input"])}</td>
        <td>${pricingTierCell(row, ["output"], ["long_context_output"])}</td>
        <td>${pricingTierCell(row, ["cached_input"], ["long_context_cached_input"])}</td>
        <td>${pricingTierCell(row, ["cache_write"], ["long_context_cache_write"])}</td>
      </tr>`).join("") || `<tr><td colspan="6">${emptyInline("Pricing data is not available yet.")}</td></tr>`}
    </tbody></table></div>
  </section>`;
  document.querySelector("#refresh-pricing").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Refreshing…";
    await api("/api/refresh-pricing", { method: "POST" });
    state.cache.clear();
    await renderPricing();
  });
}

async function renderSettings(health) {
  page.innerHTML = `<div class="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
    <section class="surface p-5"><h2 class="text-base font-semibold">Runtime state</h2><dl class="mt-4 divide-y divide-border text-sm">
      ${settingRow("OTel enabled", health.otel_enabled ? "Enabled" : "Not enabled", health.otel_enabled)}
      ${settingRow("OTel directory", health.otel_dir || "Not resolved")}
      ${settingRow("JSONL files", tok(health.jsonl_files || 0), Number(health.jsonl_files || 0) > 0)}
      ${settingRow("Statusline", health.ok ? "Reachable" : "Needs attention", health.ok)}
      ${settingRow("Data source", state.useMock ? "Mock data mode" : "Local API")}
    </dl></section>
    <section class="surface p-5"><h2 class="text-base font-semibold">Enable telemetry</h2><p class="mt-2 text-sm text-muted-foreground">This dashboard reads local OpenTelemetry traces only. No usage data is sent by the UI.</p><pre class="mt-4 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-sm"><code>npx copilot-cost install</code></pre><button id="enable-otel" class="btn mt-4" type="button">Enable OTel</button></section>
    <section class="surface p-5 xl:col-span-2"><h2 class="text-base font-semibold">Environment reference</h2><div class="mt-4 grid gap-3 text-sm md:grid-cols-3">
      ${envCard("COPILOT_OTEL_ENABLED", "Enables Copilot CLI OpenTelemetry export.")}
      ${envCard("COPILOT_OTEL_EXPORTER_TYPE", "Set to file for local JSONL traces.")}
      ${envCard("COPILOT_OTEL_FILE_EXPORTER_PATH", "Local JSONL trace file read by the dashboard.")}
    </div><a class="btn-ghost mt-4" href="../README.md">Open README</a></section>
  </div>`;
  document.querySelector("#enable-otel").addEventListener("click", installOtel);
}

function renderOnboarding(health) {
  const hasJsonlFiles = Number(health.jsonl_files || 0) > 0;
  const configured = Boolean(health.otel_enabled || health.otel_env_enabled || health.otel_profile_configured);
  const message = configured && !hasJsonlFiles
    ? "OTel appears to be configured, but no Copilot trace files were found yet. Restart your shell and Copilot CLI, then send a Copilot CLI prompt."
    : "OpenTelemetry is not enabled for Copilot CLI yet. Install the local statusline collector to populate this dashboard.";
  const command = configured
    ? "copilot-cost doctor"
    : "npx copilot-cost install";
  const buttonText = configured ? "Reinstall OTel settings" : "Enable OTel";
  page.innerHTML = `<section class="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
    <div class="surface p-8 text-center">
      <span class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl" aria-hidden="true">💰</span>
      <h2 class="mt-5 text-2xl font-semibold tracking-tight">Enable local OTel collection</h2>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">${message}</p>
      <pre class="mt-5 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-left text-sm"><code>${command}</code></pre>
      <div id="install-feedback" class="mt-4 text-sm text-muted-foreground"></div>
      <button id="enable-otel" class="btn mt-5" type="button">${buttonText}</button>
      <a class="btn-ghost mt-5" href="#/settings">Open settings</a>
    </div>
  </section>`;
  document.querySelector("#enable-otel").addEventListener("click", installOtel);
}

async function installOtel(event) {
  const button = event.currentTarget;
  const feedback = document.querySelector("#install-feedback");
  button.disabled = true;
  button.textContent = "Installing…";
  try {
    const res = await fetch("/api/install-otel", { method: "POST", cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    if (feedback) feedback.textContent = "OTel installation requested. Refresh after your next Copilot session.";
  } catch (error) {
    if (feedback) feedback.textContent = "Automatic install was unavailable. Run the command above in your terminal.";
  } finally {
    button.disabled = false;
    button.textContent = "Enable OTel";
  }
}

function bindSessionRows() {
  document.querySelectorAll("[data-session-id]").forEach((row) => {
    const open = () => openSessionDrawer(row.dataset.sessionId);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

async function openSessionDrawer(id) {
  const previousFocus = document.activeElement;
  drawerRoot.innerHTML = `<div class="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <div class="absolute inset-0 bg-background/70 backdrop-blur-sm" data-close-drawer></div>
    <aside class="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-background p-6 shadow-xl">
      <div class="flex items-start justify-between gap-4"><div><p class="text-sm text-muted-foreground">Session details</p><h2 id="drawer-title" class="text-xl font-semibold">Loading…</h2></div><button class="btn-ghost px-2" type="button" aria-label="Close details" data-close-drawer>✕</button></div>
      <div class="mt-6 space-y-4">${Array.from({ length: 5 }, () => `<div class="skeleton h-16 w-full"></div>`).join("")}</div>
    </aside>
  </div>`;
  const dialog = drawerRoot.querySelector("[role='dialog']");
  const close = () => closeDrawer(previousFocus);
  drawerRoot.querySelectorAll("[data-close-drawer]").forEach((el) => el.addEventListener("click", close));
  document.addEventListener("keydown", trapDrawerFocus);
  drawerRoot.querySelector("button").focus();

  const [details, sessions] = await Promise.all([api(`/api/sessions/${encodeURIComponent(id)}`), api("/api/sessions")]);
  const session = sessions.find((s) => String(s.id) === String(id)) || {};
  dialog.querySelector("aside").innerHTML = drawerContent(session, details);
  drawerRoot.querySelectorAll("[data-close-drawer]").forEach((el) => el.addEventListener("click", close));
  drawerRoot.querySelector("button").focus();
}

function drawerContent(session, details) {
  const calls = details.llm_calls || [];
  const totalCache = Number(session.total_cache_read_tokens || 0) + Number(session.total_cache_write_tokens || 0);
  const totalTokens = Number(session.total_input_tokens || 0) + Number(session.total_output_tokens || 0) + totalCache;
  return `<div class="flex items-start justify-between gap-4">
    <div class="min-w-0"><p class="text-sm text-muted-foreground">Session details</p><h2 id="drawer-title" class="truncate text-xl font-semibold">${escapeHtml(session.session_name || details.session_id || session.id)}</h2><p class="mt-1 truncate text-xs font-mono text-muted-foreground">${escapeHtml(session.id || details.session_id || "—")}</p><p class="mt-1 truncate text-sm text-muted-foreground">${escapeHtml(session.cwd || "Unknown path")}</p></div>
    <button class="btn-ghost px-2" type="button" aria-label="Close details" data-close-drawer>✕</button>
  </div>
  <div class="mt-6 grid gap-3 sm:grid-cols-4">
    ${miniStat("Cost", money(session.usd_cost))}${miniStat("Model", shortModel(session.model || session.first_model))}${miniStat("Tokens", tok(totalTokens))}${miniStat("Duration", `${tok(session.api_duration_ms || 0)} ms`)}
  </div>
  <div class="mt-3 grid gap-3 sm:grid-cols-4">
    ${miniStat("Started", formatDate(session.started_at))}${miniStat("Last seen", formatDate(session.last_seen_at))}${miniStat("Requests", tok(session.premium_requests || calls.length))}${miniStat("Cache tokens", tok(totalCache))}
  </div>
  <section class="mt-6"><h3 class="text-sm font-semibold">LLM calls</h3><div class="mt-3 overflow-x-auto"><table class="table"><thead><tr><th>Time</th><th>Model</th><th>Cost</th><th>Fresh Input</th><th>Cache Read</th><th>Cache Write</th><th>Output</th><th>Duration</th></tr></thead><tbody>
    ${calls.map((call) => `<tr><td class="whitespace-nowrap text-muted-foreground">${formatDate(call.ts || call.started_at || call.timestamp || call.time)}</td><td>${escapeHtml(call.model || session.model || "unknown")}</td><td>${money(call.usd_cost)}</td><td>${tok(call.input_tokens)}</td><td>${tok(call.cache_read || 0)}</td><td>${tok(call.cache_creation || 0)}</td><td>${tok(call.output_tokens)}</td><td>${tok(call.duration_ms || call.api_duration_ms || 0)} ms</td></tr>`).join("") || `<tr><td colspan="8">${emptyInline("No per-call records were returned for this session.")}</td></tr>`}
  </tbody></table></div></section>`;
}

function closeDrawer(previousFocus) {
  drawerRoot.innerHTML = "";
  document.removeEventListener("keydown", trapDrawerFocus);
  if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
}

function trapDrawerFocus(event) {
  if (!drawerRoot.firstElementChild) return;
  if (event.key === "Escape") {
    closeDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...drawerRoot.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function errorCard(title, message) {
  return `<div class="surface p-6"><h2 class="text-lg font-semibold">${escapeHtml(title)}</h2><p class="mt-2 text-sm text-muted-foreground">${escapeHtml(message)}</p></div>`;
}

function emptyInline(message) {
  return `<div class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">${message}</div>`;
}

function modelPillRow(model, totalMetric, metric = state.metric) {
  const primary = modelMetricValue(model, metric);
  const share = totalMetric ? primary / Number(totalMetric || 1) : 0;
  const secondary = metric === "tokens"
    ? `${money(model.usd_cost)} spend · ${pct(model.cache_hit_ratio)} cache hit`
    : `${tok(model.token_volume)} tokens · ${pct(model.cache_hit_ratio)} cache hit`;
  return `<div class="rounded-lg border border-border p-3"><div class="flex items-center justify-between gap-3"><span class="font-medium"><span class="mr-2 inline-block h-2.5 w-2.5 rounded-full" style="background:${modelColor(model.model)}"></span>${escapeHtml(shortModel(model.model))}</span><span>${formatMetric(primary, metric)}</span></div><div class="mt-2 h-1.5 rounded-full bg-muted"><div class="h-1.5 rounded-full" style="width:${Math.min(100, share * 100)}%; background:${modelColor(model.model)}"></div></div><p class="mt-2 text-xs text-muted-foreground">${secondary}</p></div>`;
}

function settingRow(label, value, good) {
  const dot = good === undefined ? "bg-muted-foreground" : good ? "bg-emerald-500" : "bg-amber-500";
  return `<div class="flex items-center justify-between gap-4 py-3"><dt class="text-muted-foreground">${label}</dt><dd class="text-right font-medium"><span class="mr-2 inline-block h-2 w-2 rounded-full ${dot}"></span>${escapeHtml(value)}</dd></div>`;
}

function envCard(name, description) {
  return `<div class="rounded-lg border border-border p-3"><code class="text-xs font-semibold">${name}</code><p class="mt-2 text-muted-foreground">${description}</p></div>`;
}

function miniStat(label, value) {
  return `<div class="rounded-lg border border-border bg-card p-3"><p class="text-xs text-muted-foreground">${label}</p><p class="mt-1 truncate text-sm font-semibold">${escapeHtml(value || "—")}</p></div>`;
}

function pricingValue(row, keys) {
  const key = keys.find((candidate) => row && row[candidate] !== undefined);
  const value = key ? row[key] : undefined;
  return value === undefined ? "—" : typeof value === "number" ? moneyUsd(value) : escapeHtml(value);
}

function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    const cmp = typeof av === "number" || typeof bv === "number" ? Number(av || 0) - Number(bv || 0) : String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function shortModel(model = "unknown") {
  return String(model).replace(/^claude-/, "Claude ").replace(/^gpt-/, "GPT-").replace(/-/g, " ");
}

function hashString(value = "") {
  return [...String(value)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
}

function modelColor(model) {
  return palette[hashString(model) % palette.length];
}

function sessionPoints(session) {
  if (Array.isArray(session.daily) && session.daily.length) return session.daily.map((d) => Number(d.usd_cost || d.cost || 0));
  const seed = hashString(session.id || session.session_name);
  const total = Number(session.usd_cost || 0);
  return Array.from({ length: 10 }, (_, index) => Math.max(0.001, total * (((seed >> (index % 8)) & 7) + 1) / 80));
}

function sparkline(points) {
  const width = 96;
  const height = 26;
  const max = Math.max(...points, 0.001);
  const step = width / Math.max(1, points.length - 1);
  const d = points.map((point, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)} ${Math.max(2, height - (point / max) * (height - 4)).toFixed(1)}`).join(" ");
  return `<svg class="h-7 w-24" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" class="text-muted-foreground" vector-effect="non-scaling-stroke" /></svg>`;
}

function periodFromSeries(series, days) {
  const selected = uniqueDays(series).slice(-days);
  return selected.reduce((acc, day) => {
    series.filter((row) => row.day === day).forEach((row) => {
      acc.usd_cost += Number(row.usd_cost || 0);
      acc.input_tokens += Number(row.input_tokens || 0);
      acc.output_tokens += Number(row.output_tokens || 0);
    });
    return acc;
  }, { usd_cost: 0, input_tokens: 0, output_tokens: 0, cache_tokens: 0, premium_requests: 0 });
}

function deltaFromSeries(series, days) {
  const allDays = uniqueDays(series);
  if (allDays.length < days * 2) return null;
  const currentDays = allDays.slice(-days);
  const previousDays = allDays.slice(-(days * 2), -days);
  const sum = (wanted) => series.filter((row) => wanted.includes(row.day)).reduce((total, row) => total + Number(row.usd_cost || 0), 0);
  const previous = sum(previousDays);
  if (!previous) return null;
  return { value: (sum(currentDays) - previous) / previous };
}

function uniqueDays(series) {
  return [...new Set(series.map((row) => String(row.day || "")).filter(Boolean))].sort();
}

let chartModulePromise;
async function getChart() {
  if (window.Chart) return { Chart: window.Chart };
  chartModulePromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./chart.umd.js", import.meta.url).href;
    script.async = true;
    script.onload = () => window.Chart ? resolve({ Chart: window.Chart }) : reject(new Error("Chart.js did not expose window.Chart"));
    script.onerror = () => reject(new Error("Chart.js local asset could not load"));
    document.head.append(script);
  });
  return chartModulePromise;
}

function formatChartDay(day, { includeDate = false } = {}) {
  // Bucket keys are already wall-clock in the browser's IANA zone (server ?tz=).
  const key = String(day);
  const hourMatch = key.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
  if (hourMatch) {
    const [, year, month, date, hour] = hourMatch;
    const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), Number(hour)));
    if (includeDate) {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        timeZone: "UTC",
      }).format(probe);
    }
    const timeProbe = new Date(Date.UTC(2000, 0, 1, Number(hour), 0, 0));
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(timeProbe);
  }
  const dayMatch = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayMatch) {
    const probe = new Date(`${key}T12:00:00.000Z`);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(probe);
  }
  return key.slice(5);
}

function formatChartLabels(days) {
  const prefixes = new Set(days.map((day) => String(day).slice(0, 10)));
  const includeDate = prefixes.size > 1;
  return days.map((day) => formatChartDay(day, { includeDate }));
}

async function renderSpendChart(series) {
  const canvas = document.querySelector("#spend-chart");
  if (!canvas) return;
  const metric = state.metric;
  const copy = chartMetricCopy();
  if (state.screenshot) {
    canvas.outerHTML = svgSpendChart(series, metric);
    return;
  }
  try {
    const { Chart } = await getChart();
    if (state.chart) state.chart.destroy();
    const days = uniqueDays(series);
    const models = [...new Set(series.map((row) => row.model || "unknown"))].sort();
    // Ensure the canvas matches the flex-filled parent before Chart.js measures it.
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    const inverse = inverseMetric(metric);
    const inverseColor = getComputedStyle(canvas).getPropertyValue("color")
      || getComputedStyle(document.body).color
      || "#94a3b8";
    state.chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: formatChartLabels(days),
        datasets: [
          ...models.map((model) => ({
            type: "bar",
            label: shortModel(model),
            data: days.map((day) => series.filter((row) => row.day === day && (row.model || "unknown") === model).reduce((sum, row) => sum + seriesValue(row, metric), 0)),
            backgroundColor: modelColor(model),
            borderRadius: 3,
            borderSkipped: false,
            yAxisID: "y",
            order: 1,
            metric,
          })),
          {
            type: "line",
            label: copy.inverseLegend,
            data: dailyTotals(series, days, inverse),
            yAxisID: "y1",
            order: 0,
            borderColor: inverseColor,
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 2.5,
            pointHoverRadius: 4,
            pointBackgroundColor: inverseColor,
            fill: false,
            metric: inverse,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "right",
            align: "center",
            labels: {
              boxWidth: 12,
              boxHeight: 2,
              usePointStyle: false,
              filter: (item, chartData) => chartData.datasets[item.datasetIndex]?.yAxisID === "y1",
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const dsMetric = ctx.dataset.metric || (ctx.dataset.yAxisID === "y1" ? inverse : metric);
                return `${ctx.dataset.label}: ${formatMetric(ctx.parsed.y, dsMetric)}`;
              },
            },
          },
        },
        layout: { padding: { top: 8, right: 4, bottom: 4, left: 4 } },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 10,
              maxRotation: 0,
              minRotation: 0,
              padding: 6,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grace: "2%",
            ticks: { padding: 6, callback: (value) => formatMetric(value, metric) },
          },
          y1: {
            position: "right",
            stacked: false,
            beginAtZero: true,
            grace: "2%",
            grid: { drawOnChartArea: false },
            ticks: { padding: 6, callback: (value) => formatMetric(value, inverse) },
          },
        },
      },
    });
    canvas.setAttribute("aria-label", copy.aria);
  } catch (error) {
    canvas.outerHTML = emptyInline("Chart.js could not load. Tables and KPI data remain available.");
  }
}

function svgSpendChart(series, metric = state.metric) {
  const days = uniqueDays(series);
  const models = [...new Set(series.map((row) => row.model || "unknown"))].sort();
  const totals = dailyTotals(series, days, metric);
  const max = Math.max(...totals, metric === "tokens" ? 1 : 0.01);
  const inverse = inverseMetric(metric);
  const inverseTotals = dailyTotals(series, days, inverse);
  const inverseMax = Math.max(...inverseTotals, inverse === "tokens" ? 1 : 0.01);
  const chartLabels = formatChartLabels(days);
  const width = 860;
  const height = 360;
  const plotTop = 20;
  const plotBottom = 320;
  const plotH = plotBottom - plotTop;
  const barGap = 5;
  const plotRight = width - 120;
  const plotWidth = plotRight - 55;
  const barW = Math.max(8, (plotWidth - days.length * barGap) / Math.max(days.length, 1));
  const bars = days.map((day, dayIndex) => {
    let y = plotBottom;
    return models.map((model) => {
      const value = series.filter((row) => row.day === day && (row.model || "unknown") === model).reduce((sum, row) => sum + seriesValue(row, metric), 0);
      const h = Math.max(1, (value / max) * plotH);
      y -= h;
      return `<rect x="${55 + dayIndex * (barW + barGap)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${modelColor(model)}" />`;
    }).join("");
  }).join("");
  const labels = days.filter((_, index) => index % Math.ceil(days.length / 8) === 0 || index === days.length - 1).map((day, index, shown) => {
    const dayIndex = days.indexOf(day);
    const x = 55 + dayIndex * (barW + barGap) + barW / 2;
    return `<text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="${index === shown.length - 1 ? "end" : "middle"}" fill="currentColor" opacity="0.6" font-size="12">${chartLabels[dayIndex]}</text>`;
  }).join("");
  const copy = chartMetricCopy();
  return `<svg class="h-full w-full text-muted-foreground" viewBox="0 0 ${width} ${height}" role="img" aria-label="${copy.aria}">
    <line x1="50" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="currentColor" opacity="0.18" />
    <line x1="50" y1="${((plotTop + plotBottom) / 2).toFixed(1)}" x2="${plotRight}" y2="${((plotTop + plotBottom) / 2).toFixed(1)}" stroke="currentColor" opacity="0.12" />
    <line x1="50" y1="${plotTop}" x2="${plotRight}" y2="${plotTop}" stroke="currentColor" opacity="0.12" />
    <text x="0" y="24" fill="currentColor" opacity="0.65" font-size="12">${formatMetric(max, metric)}</text>
    <text x="0" y="${((plotTop + plotBottom) / 2 + 4).toFixed(1)}" fill="currentColor" opacity="0.65" font-size="12">${formatMetric(max / 2, metric)}</text>
    ${bars}
    <polyline points="${days.map((_, index) => `${(55 + index * (barW + barGap) + barW / 2).toFixed(1)},${(plotBottom - (inverseTotals[index] / inverseMax) * plotH).toFixed(1)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <text x="${plotRight + 8}" y="24" fill="currentColor" opacity="0.65" font-size="12">${formatMetric(inverseMax, inverse)}</text>
    <text x="${plotRight + 8}" y="${((plotTop + plotBottom) / 2 + 4).toFixed(1)}" fill="currentColor" opacity="0.65" font-size="12">${formatMetric(inverseMax / 2, inverse)}</text>
    <line x1="${width - 108}" y1="52" x2="${width - 84}" y2="52" stroke="currentColor" stroke-width="2" />
    <text x="${width - 78}" y="56" fill="currentColor" font-size="12">${copy.inverseLegend}</text>
    ${labels}
  </svg>`;
}

function openMobileNav() {
  sidebar.classList.remove("hidden");
  sidebarBackdrop.classList.remove("hidden");
}

function closeMobileNav() {
  sidebar.classList.add("hidden");
  sidebarBackdrop.classList.add("hidden");
}

document.querySelector("#menu-button").addEventListener("click", openMobileNav);
sidebarBackdrop.addEventListener("click", closeMobileNav);
document.querySelector("#refresh").addEventListener("click", async () => {
  state.cache.clear();
  if (state.currency === "AUD" || state.preferredCurrency === "AUD") {
    state.fx.status = "idle";
    state.fx.error = null;
  }
  await loadRoute();
});
document.querySelectorAll(".range-btn").forEach((button) => button.addEventListener("click", () => {
  state.range = button.dataset.range;
  savePreferredRange(state.range);
  loadRoute();
}));
document.addEventListener("click", (event) => {
  const grainButton = event.target.closest(".grain-btn");
  if (grainButton) {
    const range = grainButton.dataset.grainRange;
    const grain = grainButton.dataset.grain;
    if (range === "7d") state.chartGrain7d = grain;
    if (range === "30d") state.chartGrain30d = grain;
    savePreferredChartGrain(range, grain);
    loadRoute();
    return;
  }
  const metricButton = event.target.closest(".metric-btn");
  if (!metricButton) return;
  const next = metricButton.dataset.metric === "tokens" ? "tokens" : "spend";
  if (metricButton.dataset.metricTarget === "top-models") {
    if (state.topModelsMetric === next) return;
    state.topModelsMetric = next;
    savePreferredTopModelsMetric(next);
  } else {
    if (state.metric === next) return;
    state.metric = next;
    savePreferredMetric(next);
  }
  loadRoute();
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest(".currency-btn");
  if (!button) return;
  const currency = button.dataset.currency === "AUD" ? "AUD" : "USD";
  state.preferredCurrency = currency;
  try {
    localStorage.setItem("copilot-cost.currency", currency);
  } catch {
    // localStorage may be unavailable in private or restricted browsing contexts.
  }
  if (currency === "USD") {
    state.currency = "USD";
    updateCurrencyButtons();
    updateFxStatus();
  } else {
    state.fx.status = validFxRate(state.fx.rate) ? state.fx.status : "idle";
    updateFxStatus();
    await ensureFxRate();
  }
  await loadRoute();
});
window.addEventListener("hashchange", loadRoute);
if (!location.hash) location.hash = "#/overview";

const mock = (() => {
  const models = ["claude-sonnet-4.5", "gpt-5.2-codex", "claude-haiku-4.5", "gpt-5.4-mini"];
  const today = new Date();
  // Wall-clock keys in the browser's local zone (matches live ?tz= bucketing).
  const localParts = (date) => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: browserTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const map = {};
    for (const part of dtf.formatToParts(date)) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
    };
  };
  const pad = (n) => String(n).padStart(2, "0");
  const dayKeyFromParts = (p) => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const todayParts = localParts(today);
  const todayKey = dayKeyFromParts(todayParts);
  const days = Array.from({ length: 90 }, (_, index) => {
    const offset = 89 - index;
    const date = new Date(today.getTime() - offset * 86_400_000);
    return dayKeyFromParts(localParts(date));
  });
  const timeseries = days.flatMap((day, dayIndex) => models.map((model, modelIndex) => {
    const input_tokens = Math.round((modelIndex + 1) * 9000 + dayIndex * 120);
    const output_tokens = Math.round((modelIndex + 1) * 2600 + dayIndex * 40);
    const cache_read_tokens = Math.round(input_tokens * 0.18);
    const cache_write_tokens = Math.round(input_tokens * 0.04);
    return {
      day,
      model,
      usd_cost: Number(((Math.sin(dayIndex / 5 + modelIndex) + 1.5) * (modelIndex + 1) * 0.018).toFixed(4)),
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
      token_volume: input_tokens + output_tokens + cache_read_tokens + cache_write_tokens,
    };
  }));
  const hourlyTimeseries = Array.from({ length: todayParts.hour + 1 }, (_, hour) => models.map((model, modelIndex) => {
    const activity = 0.65 + ((hour + modelIndex * 2) % 6) * 0.12;
    const input_tokens = Math.round((modelIndex + 1) * 1200 * activity);
    const output_tokens = Math.round((modelIndex + 1) * 360 * activity);
    const cache_read_tokens = Math.round(input_tokens * 0.18);
    const cache_write_tokens = Math.round(input_tokens * 0.04);
    return {
      day: `${todayKey}T${pad(hour)}`,
      model,
      usd_cost: Number((activity * (modelIndex + 1) * 0.012).toFixed(4)),
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
      token_volume: input_tokens + output_tokens + cache_read_tokens + cache_write_tokens,
    };
  })).flat();
  const threeHourlyTimeseries = days.slice(-7).flatMap((day, dayIndex) =>
    Array.from({ length: 8 }, (_, bucketIndex) => models.map((model, modelIndex) => {
      const hour = bucketIndex * 3;
      const activity = 0.55 + ((bucketIndex + modelIndex * 2 + dayIndex) % 7) * 0.1;
      const input_tokens = Math.round((modelIndex + 1) * 1050 * activity);
      const output_tokens = Math.round((modelIndex + 1) * 300 * activity);
      const cache_read_tokens = Math.round(input_tokens * 0.18);
      const cache_write_tokens = Math.round(input_tokens * 0.04);
      return {
        day: `${day}T${pad(hour)}`,
        model,
        usd_cost: Number((activity * (modelIndex + 1) * 0.011).toFixed(4)),
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        token_volume: input_tokens + output_tokens + cache_read_tokens + cache_write_tokens,
      };
    })).flat()
  );
  const multiHourlyTimeseries = (grain) => {
    const interval = Number.parseInt(grain, 10);
    return days.slice(-30).flatMap((day, dayIndex) =>
      Array.from({ length: 24 / interval }, (_, bucketIndex) => models.map((model, modelIndex) => {
        const activity = 0.58 + ((bucketIndex + modelIndex * 2 + dayIndex) % 7) * 0.09;
        const input_tokens = Math.round((modelIndex + 1) * 900 * activity * interval / 3);
        const output_tokens = Math.round((modelIndex + 1) * 250 * activity * interval / 3);
        const cache_read_tokens = Math.round(input_tokens * 0.18);
        const cache_write_tokens = Math.round(input_tokens * 0.04);
        return {
          day: `${day}T${pad(bucketIndex * interval)}`,
          model,
          usd_cost: Number((activity * (modelIndex + 1) * 0.009 * interval / 3).toFixed(4)),
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          token_volume: input_tokens + output_tokens + cache_read_tokens + cache_write_tokens,
        };
      })).flat()
    );
  };
  const sixHourlyTimeseries = multiHourlyTimeseries("6h");
  const twelveHourlyTimeseries = multiHourlyTimeseries("12h");
  const sessions = Array.from({ length: 16 }, (_, index) => {
    const model = models[index % models.length];
    const cost = Number((0.035 + index * 0.017).toFixed(4));
    return {
      id: `mock-session-${index + 1}`,
      cwd: `/demo/workspace/project-${(index % 4) + 1}`,
      first_model: model,
      model,
      session_name: ["Refactor parser", "Review access rules", "Build dashboard", "Investigate tests"][index % 4],
      started_at: new Date(today.getTime() - (index + 1) * 3600_000).toISOString(),
      last_seen_at: new Date(today.getTime() - index * 2700_000).toISOString(),
      usd_cost: cost,
      total_input_tokens: 42000 + index * 4100,
      total_output_tokens: 11000 + index * 1200,
      total_cache_read_tokens: 8000 + index * 1000,
      total_cache_write_tokens: 2000 + index * 400,
      premium_requests: 3 + index,
      api_duration_ms: 18000 + index * 1500,
    };
  });
  const totalPeriod = (slice) => slice.reduce((acc, row) => {
    acc.usd_cost += row.usd_cost;
    acc.input_tokens += row.input_tokens;
    acc.output_tokens += row.output_tokens;
    acc.cache_tokens += Math.round(row.input_tokens * 0.22);
    acc.premium_requests += 1;
    return acc;
  }, { usd_cost: 0, input_tokens: 0, output_tokens: 0, cache_tokens: 0, premium_requests: 0 });
  const modelRowsFor = (rowsToAggregate) => models.map((model) => {
    const rows = rowsToAggregate.filter((row) => row.model === model);
    const usd = rows.reduce((sum, row) => sum + row.usd_cost, 0);
    const input_tokens = rows.reduce((sum, row) => sum + row.input_tokens, 0);
    const output_tokens = rows.reduce((sum, row) => sum + row.output_tokens, 0);
    const cache_read_tokens = rows.reduce((sum, row) => sum + row.cache_read_tokens, 0);
    const cache_write_tokens = rows.reduce((sum, row) => sum + row.cache_write_tokens, 0);
    const volume = input_tokens + output_tokens + cache_read_tokens + cache_write_tokens;
    const denom = input_tokens + cache_read_tokens + cache_write_tokens || 1;
    return {
      model,
      sessions: sessions.filter((s) => s.model === model).length,
      usd_cost: Number(usd.toFixed(4)),
      token_volume: volume,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
      cache_hit_ratio: cache_read_tokens / denom,
    };
  });
  const modelRows = modelRowsFor(timeseries);
  return {
    health: { ok: true, otel_enabled: true, otel_dir: "~/.copilot/otel", jsonl_files: 8 },
    summary: {
      lifetime: totalPeriod(timeseries),
      today: totalPeriod(timeseries.filter((row) => row.day === days.at(-1))),
      week: totalPeriod(timeseries.filter((row) => days.slice(-7).includes(row.day))),
      month: totalPeriod(timeseries.filter((row) => days.slice(-30).includes(row.day))),
      quarter: totalPeriod(timeseries.filter((row) => days.slice(-90).includes(row.day))),
      session_count: sessions.length,
      range: { from: days[0], to: days.at(-1) },
    },
    sessions,
    timeseries,
    hourlyTimeseries,
    threeHourlyTimeseries,
    sixHourlyTimeseries,
    twelveHourlyTimeseries,
    todayKey,
    models: modelRows,
    modelsForRows: modelRowsFor,
    pricing: {
      schema_version: "mock-v1",
      fetched_at: new Date().toISOString(),
      models: Object.fromEntries(models.map((model, index) => [model, { input_per_mtok: 3 + index, output_per_mtok: 15 + index * 2, cache_read_per_mtok: 0.3 + index / 10, cache_write_per_mtok: 3.75 + index / 5, premium_request: 0.04 + index / 100 }])),
    },
  };
})();

function mockApi(path, options = {}) {
  if (path === "/api/health") return Promise.resolve(mock.health);
  if (path === "/api/fx") return Promise.resolve({
    available: true,
    base: "USD",
    quote: "AUD",
    rate: 1.5,
    fetched_at: new Date().toISOString(),
    provider_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    source: "mock",
    stale: false,
    error: null,
  });
  if (path === "/api/summary") return Promise.resolve(mock.summary);
  if (path === "/api/sessions") return Promise.resolve(mock.sessions);
  if (path.startsWith("/api/sessions/")) {
    const id = decodeURIComponent(path.split("/").pop());
    const session = mock.sessions.find((row) => row.id === id) || mock.sessions[0];
    return Promise.resolve({
      session_id: session.id,
      llm_calls: Array.from({ length: 6 }, (_, index) => ({
        started_at: new Date(new Date(session.started_at).getTime() + index * 420_000).toISOString(),
        model: session.model,
        usd_cost: Number((session.usd_cost / 6).toFixed(4)),
        input_tokens: Math.round(session.total_input_tokens / 6),
        output_tokens: Math.round(session.total_output_tokens / 6),
        duration_ms: Math.round(session.api_duration_ms / 6),
      })),
    });
  }
  if (path.startsWith("/api/timeseries")) {
    const params = new URL(path, location.origin).searchParams;
    const range = params.get("range") || "30d";
    const grain = params.get("grain");
    if (range === "1d") {
      return Promise.resolve(mock.hourlyTimeseries.filter((row) => row.day.startsWith(`${mock.todayKey}T`)));
    }
    if (range === "7d") {
      const days = uniqueDays(mock.timeseries).slice(-7);
      return Promise.resolve(grain === "day" ? mock.timeseries.filter((row) => days.includes(row.day)) : mock.threeHourlyTimeseries);
    }
    if (range === "30d" && grain === "6h") return Promise.resolve(mock.sixHourlyTimeseries);
    if (range === "30d" && grain === "12h") return Promise.resolve(mock.twelveHourlyTimeseries);
    const count = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const days = uniqueDays(mock.timeseries).slice(-count);
    return Promise.resolve(mock.timeseries.filter((row) => days.includes(row.day)));
  }
  if (new URL(path, location.origin).pathname === "/api/models") {
    const range = new URL(path, location.origin).searchParams.get("range");
    if (!range) return Promise.resolve(mock.models);
    if (range === "1d") return Promise.resolve(mock.modelsForRows(mock.hourlyTimeseries.filter((row) => row.day.startsWith(`${mock.todayKey}T`))));
    if (range === "7d") return Promise.resolve(mock.modelsForRows(mock.threeHourlyTimeseries));
    const count = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
    const days = count ? uniqueDays(mock.timeseries).slice(-count) : uniqueDays(mock.timeseries);
    return Promise.resolve(mock.modelsForRows(mock.timeseries.filter((row) => days.includes(row.day))));
  }
  if (path === "/api/pricing" || path === "/api/refresh-pricing") return Promise.resolve(options.method === "POST" ? { ok: true, pricing: mock.pricing } : mock.pricing);
  return Promise.resolve({ ok: true });
}

loadRoute();
