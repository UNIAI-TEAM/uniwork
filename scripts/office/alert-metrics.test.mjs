import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

// An alert on a metric nobody registers never fires and nobody notices: the
// gauge is absent, the comparison is empty, and the pager stays quiet exactly
// when it should speak. Every metric name in an `expr` of deploy/alerts.yml
// must therefore be registered by non-test server code (G7-07, plan §5).

// Series that do not come from server/ code: the blackbox exporter's probe.
const EXTERNAL = new Set(["probe_success"]);

const PROMQL_WORDS = new Set([
  "by", "without", "on", "ignoring", "group_left", "group_right", "bool", "offset",
  "and", "or", "unless", "inf", "nan",
]);

/** Every non-test .go file under server/. */
function goFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...goFiles(full));
    else if (entry.name.endsWith(".go") && !entry.name.endsWith("_test.go")) out.push(full);
  }
  return out;
}

/** The text of the `{ ... }` literal that opens at `open`, brace-balanced. */
function literalAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/**
 * `src` with Go comments (`// ...` and `/* ... *\/`) blanked out. A scanner of
 * string literals keeps a `//` inside "..." or `...` (a URL) from hiding the
 * rest of its line; newlines stay so the text keeps its shape.
 */
function stripGoComments(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else if (c === '"' || c === "`" || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && !(c !== "`" && src[j] === "\n")) j += c !== "`" && src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Metric names a Go file registers: every `prometheus.*Opts{...}` literal,
 * joined as Namespace_Subsystem_Name the way client_golang builds the name,
 * every `prometheus.NewDesc("name", ...)` (the lag collectors) and the
 * realtime collector's `newRealtimeDesc("suffix", ...)` helper.
 */
// ponytail: regexes over the declarations, not a Go parser - every metric in
// server/ is a prometheus.<Kind>Opts literal or a NewDesc call with string
// constants; a metric named any other way fails the test until taught here.
function registeredNames(raw) {
  const src = stripGoComments(raw);
  const names = [];
  const optsOpen = /prometheus\.\w*Opts\{/g;
  let m;
  while ((m = optsOpen.exec(src))) {
    const body = literalAt(src, m.index + m[0].length - 1);
    const field = (k) => body.match(new RegExp(`\\b${k}:\\s*"([^"]*)"`))?.[1];
    const name = field("Name");
    if (name === undefined) continue;
    names.push([field("Namespace"), field("Subsystem"), name].filter(Boolean).join("_"));
  }
  for (const d of src.matchAll(/\bNewDesc\(\s*"([^"]+)"/g)) names.push(d[1]);
  for (const d of src.matchAll(/\bnewRealtimeDesc\(\s*"([^"]+)"/g)) names.push(`uniwork_realtime_${d[1]}`);
  return names;
}

function registered() {
  const names = new Set();
  for (const f of goFiles(path.join(root, "server"))) {
    for (const n of registeredNames(fs.readFileSync(f, "utf8"))) names.add(n);
  }
  return names;
}

/** `{alert, expr}` pairs: `expr:` is a one-line value or a `|` block. */
function rules(yml) {
  const out = [];
  const lines = yml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const alert = lines[i].match(/^\s*- alert:\s*(\S+)/);
    if (alert) out.push({ alert: alert[1], expr: "" });
    const expr = lines[i].match(/^(\s*)expr:\s*(.*)$/);
    if (!expr) continue;
    if (expr[2] !== "|") {
      out.at(-1).expr = expr[2];
      continue;
    }
    const parts = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === "" || lines[i + 1].match(/^\s*/)[0].length > expr[1].length)) {
      parts.push(lines[++i]);
    }
    out.at(-1).expr = parts.join("\n");
  }
  return out;
}

/** Metric names an expression selects, PromQL suffixes of histograms kept. */
function metricsIn(expr) {
  const bare = expr
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\{[^}]*\}/g, "")
    .replace(/\b(?:by|without)\s*\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "");
  const found = new Set();
  for (const m of bare.matchAll(/[A-Za-z_:][A-Za-z0-9_:]*/g)) {
    const next = bare.slice(m.index + m[0].length).trimStart()[0];
    if (next === "(" || PROMQL_WORDS.has(m[0])) continue;
    found.add(m[0]);
  }
  return [...found];
}

/** The registered name behind a series name, or undefined. */
function resolve(series, known) {
  if (known.has(series)) return series;
  for (const suffix of ["_bucket", "_sum", "_count"]) {
    if (series.endsWith(suffix) && known.has(series.slice(0, -suffix.length))) return series.slice(0, -suffix.length);
  }
  return undefined;
}

/** Unregistered series of every rule in `yml`, as `Alert: series` lines. */
function unknownSeries(yml, known) {
  const bad = [];
  for (const r of rules(yml)) {
    for (const series of metricsIn(r.expr)) {
      if (!EXTERNAL.has(series) && !resolve(series, known)) bad.push(`${r.alert}: ${series}`);
    }
  }
  return bad;
}

const alertsYml = () => fs.readFileSync(path.join(root, "deploy/alerts.yml"), "utf8");

test("every metric in an alert expr is registered by D server code", () => {
  const known = registered();
  assert.ok(known.has("uniwork_http_requests_total"), "namespace/subsystem/name join is broken");
  assert.deepEqual(unknownSeries(alertsYml(), known), [], "alerts on metrics no server code registers");
});

test("the Office and UniWork AI alerts are present and read registered metrics", () => {
  const known = registered();
  const office = rules(alertsYml()).filter((r) => /^(Office|Uniwork)/.test(r.alert));
  assert.ok(office.length >= 10, `expected the G7-07 alerts, found ${office.length}`);
  for (const r of office) {
    const series = metricsIn(r.expr);
    assert.ok(series.length > 0, `${r.alert}: no metric found in expr`);
    for (const s of series) assert.ok(resolve(s, known), `${r.alert}: ${s} is not registered`);
  }
});

test("an unregistered name is reported with the alert that uses it", () => {
  const known = registered();
  const bogus = "- alert: Bogus\n  expr: sum(rate(uniwork_not_a_real_metric_total[5m])) > 1\n";
  assert.deepEqual(unknownSeries(bogus, known), ["Bogus: uniwork_not_a_real_metric_total"]);
  const ok = "- alert: Fine\n  expr: histogram_quantile(0.95, sum by (le) (rate(uniwork_http_request_duration_seconds_bucket[5m]))) > 1\n";
  assert.deepEqual(unknownSeries(ok, known), []);
});

test("a name that appears only in a Go comment is not registered", () => {
  const src = [
    '// A future metric prometheus.NewDesc("uniwork_phantom_line_total", "help", nil, nil) would go here.',
    '// prometheus.CounterOpts{ Name: "uniwork_phantom_line_opts_total" }',
    '/* prometheus.NewDesc("uniwork_phantom_block_total", "help", nil, nil) */',
    "/*",
    " * c := prometheus.NewCounter(prometheus.CounterOpts{",
    ' *     Namespace: "uniwork", Name: "phantom_block_opts_total",',
    " * })",
    " */",
    'var real = prometheus.NewDesc("uniwork_real_total", "help", nil, nil) // not uniwork_trailing_total',
    'var opts = prometheus.GaugeOpts{ Namespace: "uniwork", Subsystem: "x", Name: "real_gauge" } /* tail */',
    'var url = "http://example.test/not-a-comment" // a "//" inside a string must not hide the next line',
    'var more = prometheus.NewDesc("uniwork_after_url_total", "help", nil, nil)',
  ].join("\n");
  assert.deepEqual(registeredNames(src), ["uniwork_x_real_gauge", "uniwork_real_total", "uniwork_after_url_total"]);
  const known = new Set(registeredNames(src));
  const phantom = "- alert: Phantom\n  expr: max(uniwork_phantom_line_total) > 300\n";
  assert.deepEqual(unknownSeries(phantom, known), ["Phantom: uniwork_phantom_line_total"]);
});
