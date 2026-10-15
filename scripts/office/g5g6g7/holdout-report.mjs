#!/usr/bin/env node
// G7-12 holdout report (UNI-1384): reads one session folder of holdout-run.mjs (run-NN.json + manifest.json) and prints the
// distribution of every spec §9.2 metric (min / median / max over the runs), per group and per format, the model-call
// latency per run and pooled, the flaky cases and the cases that wait for a reviewer.
//
//   node scripts/office/g5g6g7/holdout-report.mjs --runs <session folder> [--reviews <file>] [--thresholds <signed.json>]
//     [--out <dir>] [--allow-in-repo]
//
// Without --thresholds the overall status is ALWAYS "chưa có ngưỡng" (no threshold): the numbers are shown, no metric
// gets a verdict and the words PASS/FAIL do not appear (G7-D1 decision D5). A verdict exists only with a signed
// thresholds file, and then the rule is "every run must pass" (the worst run decides, never the best). The verdict is
// INCONCLUSIVE, never PASS, unless the run set is complete and consistent (exactly the runs of one invocation, each
// complete over the whole case set), the release tuple is known and unchanged, the measurement policy is the default
// and the same in every run, no tool surface is name-only, nothing was redacted, every latency is the gateway's own and
// no ask still waits for a reviewer.
//
// Exit codes: 0 signed PASS, 1 signed FAIL, 2 INCONCLUSIVE, 3 no threshold (no verdict), 4 usage or read error.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { reportingFooter } from './holdout-answer.mjs';
import { MANIFEST_KIND, RUN_KIND, isInsideRepo } from './holdout-run.mjs';

export const THRESHOLDS_KIND = 'uniwork-office-g7-holdout-thresholds';
export const REVIEWS_KIND = 'uniwork-office-g7-holdout-reviews';
export const NO_THRESHOLD = 'chưa có ngưỡng (no threshold)';
export const GROUPS = ['xlsx', 'docx', 'other', 'cross'];
export const FORMATS = ['xlsx', 'docx', 'pptx', 'pdf', 'md', 'html', 'cross'];
// The suite D1 is about: a run set over fewer cases is a subset, never a verdict.
export const MIN_CASES = 100;
export const EXIT = { pass: 0, fail: 1, inconclusive: 2, noThreshold: 3, error: 4 };
// The metrics a signed file may gate, each with its comparator (the G7-D1 table, D1.a).
export const THRESHOLD_KEYS = {
  outsideAllowlistCases: 'max',
  numericPassRate: 'min',
  unauthorizedWrites: 'max',
  leaks: 'max',
  staleApplied: 'max',
  successRateOverall: 'min',
  successRateGroupMin: 'min',
  modelLatencyP50Ms: 'max',
  modelLatencyP95Ms: 'max',
};
// Emulated by the harness backend (a stale case refuses every write, so the count is 0 by construction): a signed file
// may carry the key, but it never gates; the report says so.
export const NON_GATING = {
  staleApplied: 'emulated by the harness backend: every write of a stale case is refused, so the count is 0 by construction',
};

// The signed file must pin what D1 assumes: at least this many runs, every gating metric of the D1.a table, the full case set.
export const MIN_RUNS = 3;
export const GATING_KEYS = Object.keys(THRESHOLD_KEYS).filter((key) => !NON_GATING[key]);

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

/** Nearest-rank percentile of an ascending list (the same rule as the dev set runner). */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function loadRuns(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`no run-NN.json in ${dir}`);
  return files.map((f) => {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (doc.kind !== RUN_KIND || doc.schemaVersion !== 1) throw new Error(`${f} is not a ${RUN_KIND} schemaVersion 1 file`);
    return doc;
  });
}

/** The run files of a folder with their sha256, and the manifest (null when absent) with its own hash. */
export function loadSession(dir) {
  const runs = loadRuns(dir);
  const files = fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort()
    .map((file) => ({ file, sha256: sha256Hex(fs.readFileSync(path.join(dir, file))) }));
  const manifestFile = path.join(dir, 'manifest.json');
  let manifest = null;
  let manifestSha256 = null;
  if (fs.existsSync(manifestFile)) {
    const bytes = fs.readFileSync(manifestFile);
    manifestSha256 = sha256Hex(bytes);
    try { manifest = JSON.parse(bytes.toString('utf8')); } catch { manifest = { unreadable: true }; }
  }
  return { runs, files, manifest, manifestSha256 };
}

const askKey = (ask) => `${ask.id}/${ask.lang}`;
const rate = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);

/** Latency of the successful model calls of one run: the server's own latency_ms when it logged one, else client time. */
export function callLatencies(run) {
  const values = [];
  const source = { server: 0, client: 0 };
  let failedCalls = 0;
  for (const ask of run.asks) {
    for (const call of ask.calls) {
      if (call.status !== 200) { failedCalls += 1; continue; }
      if (call.usage && Number.isFinite(call.usage.latencyMs)) { values.push(call.usage.latencyMs); source.server += 1; }
      else { values.push(call.clientMs); source.client += 1; }
    }
  }
  return { values, source, failedCalls };
}

function tallyOf(asks, statusOf) {
  const t = { total: asks.length, passed: 0, failed: 0, awaiting: 0 };
  for (const ask of asks) {
    const s = statusOf(ask);
    if (s === 'pass') t.passed += 1;
    else if (s === 'needs_reviewer') t.awaiting += 1;
    else t.failed += 1;
  }
  return { ...t, rate: rate(t.passed, t.total), rateIfReviewed: rate(t.passed + t.awaiting, t.total), rateConclusive: rate(t.passed, t.passed + t.failed) };
}

/** Every §9.2 metric of one run. `flaky` (a Set of ask keys) is forced to fail, as the G7-D1 aggregation rule asks. */
export function summarizeRun(run, flaky = new Set()) {
  const statusOf = (ask) => (flaky.has(askKey(ask)) ? 'fail' : ask.status);
  const numericAsks = run.asks.filter((a) => a.expects.numeric > 0);
  const numericOk = numericAsks.filter((a) => !flaky.has(askKey(a)) && !a.errored && !a.checks.some((c) => c.id.startsWith('numeric') && c.status === 'fail'));
  const leakAsks = run.asks.filter((a) => a.expects.mustNotContain > 0);
  const leakNotClean = leakAsks.filter((a) => a.errored || a.checks.some((c) => (c.id.startsWith('must_not_contain:') || c.id === 'text_reported') && c.status === 'fail'));
  const lat = callLatencies(run);
  const sorted = [...lat.values].sort((a, b) => a - b);
  const sum = (pick) => run.asks.reduce((n, a) => n + pick(a), 0);
  const outside = run.asks.filter((a) => a.outsideAllowlist.length > 0);
  const refused = {};
  for (const ask of run.asks) for (const d of ask.denied ?? []) refused[d.reason] = (refused[d.reason] ?? 0) + 1;
  return {
    runIndex: run.runIndex,
    status: run.status,
    partial: run.partial,
    overall: tallyOf(run.asks, statusOf),
    errored: run.asks.filter((a) => a.errored).length,
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, tallyOf(run.asks.filter((a) => a.group === g), statusOf)])),
    byFormat: Object.fromEntries(FORMATS.map((f) => [f, tallyOf(run.asks.filter((a) => a.format === f), statusOf)])),
    outsideAllowlist: { asks: outside.length, occurrences: outside.reduce((n, a) => n + a.outsideAllowlist.length, 0), names: [...new Set(outside.flatMap((a) => a.outsideAllowlist))].sort() },
    numeric: { asks: numericAsks.length, passed: numericOk.length, rate: rate(numericOk.length, numericAsks.length) },
    unauthorizedWrites: run.asks.filter((a) => a.writes > a.expects.writes).length,
    leaks: { asks: leakNotClean.length, checked: leakAsks.length, unverified: leakNotClean.filter((a) => a.errored || a.checks.some((c) => c.id === 'text_reported' && c.status === 'fail')).length },
    staleApplied: run.asks.filter((a) => a.category === 'stale' && a.writes > 0).length,
    emulatedRefusals: { total: Object.values(refused).reduce((n, v) => n + v, 0), byReason: refused },
    latency: {
      calls: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), min: sorted[0] ?? null, max: sorted.at(-1) ?? null,
      source: lat.source, failedCalls: lat.failedCalls,
    },
    load: {
      asks: run.asks.length, modelCalls: sum((a) => a.calls.length), modelTurns: sum((a) => a.modelTurns), retries: sum((a) => a.counts.retries),
      rateLimited: sum((a) => a.counts.rateLimited), serverErrors: sum((a) => a.counts.serverErrors), remounts: sum((a) => a.counts.remounts),
      inputTokens: sum((a) => a.tokens?.input ?? 0), outputTokens: sum((a) => a.tokens?.output ?? 0),
      tokensFromUsageRows: run.asks.filter((a) => a.tokens?.source === 'ai_usage_events').length,
      tokenCallsWithRow: sum((a) => a.tokens?.callsWithRow ?? 0), tokenCalls: sum((a) => (a.tokens?.source === 'ai_usage_events' ? a.tokens.calls ?? a.calls.length : 0)),
      toolCalls: sum((a) => a.toolCalls.length), writes: sum((a) => a.writes),
    },
    adapter: {
      reportMissing: run.asks.filter((a) => a.adapter?.reportStatus === 'missing').length,
      reportInvalid: run.asks.filter((a) => a.adapter?.reportStatus === 'invalid').length,
      anchorLenient: sum((a) => a.adapter?.anchorLenient ?? 0),
      extraFigures: sum((a) => a.adapter?.extraFigures ?? 0),
      proseMismatchAsks: run.asks.filter((a) => (a.adapter?.proseFigureMismatch ?? 0) > 0).length,
      writeBacked: sum((a) => a.adapter?.writeBacked ?? 0),
      writeUnbacked: sum((a) => a.adapter?.writeUnbacked ?? 0),
      writeSelfReported: sum((a) => a.adapter?.writeSelfReported ?? 0),
      writeSelfPreserved: sum((a) => a.adapter?.writeSelfPreserved ?? 0),
      noAppliedWriteAsks: run.asks.filter((a) => a.adapter?.noAppliedWrite === true).length,
      invalidArgumentAsks: run.asks.filter((a) => (a.invalidArguments ?? []).length > 0).length,
    },
    redactedAsks: run.asks.filter((a) => (a.redactions ?? []).length > 0).length,
    wallMs: sum((a) => a.wallMs),
  };
}

/** min / median / max of one numeric metric over the runs (null values are skipped, and counted). */
export function distribution(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return { values, n: nums.length, min: nums.length ? Math.min(...nums) : null, median: median(nums), max: nums.length ? Math.max(...nums) : null };
}

/** Asks that passed in at least one run and failed in another (a reviewer-pending result is neither). */
export function findFlaky(runs) {
  const seen = new Map();
  for (const run of runs) {
    for (const ask of run.asks) {
      const entry = seen.get(askKey(ask)) ?? { id: ask.id, lang: ask.lang, statuses: [] };
      entry.statuses.push(ask.status);
      seen.set(askKey(ask), entry);
    }
  }
  return [...seen.values()].filter((e) => e.statuses.includes('pass') && e.statuses.includes('fail')).sort((a, b) => askKey(a).localeCompare(askKey(b)));
}

/** Cases whose tools no offered tool could serve in some run (a harness gap, listed so it is never read as a model fault). */
export function unobtainable(runs) {
  const byId = new Map();
  for (const run of runs) for (const ask of run.asks) if ((ask.unobtainableOps ?? []).length > 0) byId.set(ask.id, { id: ask.id, ops: [...ask.unobtainableOps].sort() });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function awaitingReviewer(runs) {
  const byKey = new Map();
  for (const run of runs) for (const ask of run.asks) if (ask.status === 'needs_reviewer') byKey.set(askKey(ask), { id: ask.id, lang: ask.lang, group: ask.group });
  return [...byKey.values()].sort((a, b) => askKey(a).localeCompare(askKey(b)));
}

/** Per case and language: the asks (over all runs) where something worth a look happened, as "id (lang) xN". */
function listAsks(runs, pick) {
  const counts = new Map();
  for (const run of runs) for (const ask of run.asks) { const n = pick(ask); if (n > 0) counts.set(askKey(ask), (counts.get(askKey(ask)) ?? 0) + n); }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => ({ key, count: n }));
}

/**
 * Per edit case (an ask that expects a write), over all runs and both languages: asks without an applied write that carries
 * the edit, and the items split into backed by the write arguments / unbacked / self-reported because the document already held
 * them (preserved) / self-reported counts and format probes (G712-16).
 */
function editCaseSplit(runs) {
  const byId = new Map();
  for (const run of runs) {
    for (const ask of run.asks) {
      if (!((ask.expects?.writes ?? 0) > 0)) continue;
      const row = byId.get(ask.id) ?? { id: ask.id, asks: 0, noAppliedWrite: 0, backed: 0, unbacked: 0, selfPreserved: 0, selfOther: 0 };
      const a = ask.adapter ?? {};
      row.asks += 1;
      row.noAppliedWrite += a.noAppliedWrite === true ? 1 : 0;
      row.backed += a.writeBacked ?? 0;
      row.unbacked += a.writeUnbacked ?? 0;
      row.selfPreserved += a.writeSelfPreserved ?? 0;
      row.selfOther += (a.writeSelfReported ?? 0) - (a.writeSelfPreserved ?? 0);
      byId.set(ask.id, row);
    }
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

const TUPLE_FIELDS = ['dSha', 'dirty', 'framePin', 'promptIds', 'providers', 'resolvedModels', 'redis'];
export function tupleConsistency(runs) {
  const differing = TUPLE_FIELDS.filter((f) => new Set(runs.map((r) => JSON.stringify(r.tuple?.[f] ?? null))).size > 1);
  return { consistent: differing.length === 0, differing };
}

// ---- reviewer input (G712-4) ----

/** Validates a reviews file: one verdict per case id and language (optionally per run), by a named reviewer, on a date. */
export function parseReviews(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('reviews file is not an object');
  if (doc.kind !== REVIEWS_KIND) problems.push(`kind must be ${REVIEWS_KIND}`);
  if (doc.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (typeof doc.sessionId !== 'string' || doc.sessionId.trim() === '') problems.push('sessionId is required (the session the reviews were made for)');
  if (typeof doc.manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.manifestSha256)) problems.push('manifestSha256 is required (the sha256 of the session manifest.json the reviews were made for)');
  if (!Array.isArray(doc.reviews) || doc.reviews.length === 0) problems.push('reviews must be a non-empty array');
  const seen = new Set();
  for (const [i, r] of (Array.isArray(doc.reviews) ? doc.reviews : []).entries()) {
    const at = `reviews[${i}]`;
    if (!r || typeof r !== 'object') { problems.push(`${at} is not an object`); continue; }
    if (typeof r.id !== 'string' || !/^HO-[A-Z]+-\d{3}$/.test(r.id)) problems.push(`${at}.id must be a case id`);
    if (!['vi', 'en'].includes(r.lang)) problems.push(`${at}.lang must be vi or en`);
    if (!['pass', 'fail'].includes(r.verdict)) problems.push(`${at}.verdict must be pass or fail`);
    if (typeof r.reviewer !== 'string' || r.reviewer.trim() === '') problems.push(`${at}.reviewer is required`);
    if (typeof r.date !== 'string' || Number.isNaN(Date.parse(r.date))) problems.push(`${at}.date must be a date`);
    if (r.run !== undefined && !(Number.isInteger(r.run) && r.run >= 1)) problems.push(`${at}.run must be a run index >= 1`);
    const key = `${r.id}/${r.lang}/${r.run ?? '*'}`;
    if (seen.has(key)) problems.push(`${at} repeats ${key}`);
    seen.add(key);
  }
  if (problems.length > 0) throw new Error(`invalid reviews file:\n- ${problems.join('\n- ')}`);
  return doc;
}

/**
 * Is the reviews file about THIS run set? Returns the reasons it is not ([] = bound). The file names the session and the
 * sha256 of its manifest (which holds the sha256 of every run file), so a file written for another session, another model
 * or a changed run set is refused as a whole, and no review is dated before the session finished (G712-18).
 */
export function checkReviewBinding(reviews, session) {
  const manifest = session?.manifest && !session.manifest.unreadable ? session.manifest : null;
  if (!manifest || !session.manifestSha256) return ['there is no readable manifest.json, so the reviews cannot be tied to this run set'];
  const problems = [];
  if (reviews.sessionId !== manifest.sessionId) problems.push(`the reviews are for session ${reviews.sessionId}, this run set is session ${manifest.sessionId}`);
  if (reviews.manifestSha256 !== session.manifestSha256) problems.push('the reviews name another manifest sha256: they were made for a different run set, or the runs changed after the reviews were written');
  const finished = Date.parse(manifest.finishedAt ?? '');
  if (Number.isNaN(finished)) problems.push('the manifest has no finishedAt, so the review dates cannot be checked');
  else {
    const day = Math.floor(finished / 86400000) * 86400000;
    const early = reviews.reviews.filter((r) => Date.parse(r.date) < day).length;
    if (early > 0) problems.push(`${early} review(s) are dated before the session finished (${manifest.finishedAt})`);
  }
  return problems;
}

/**
 * Applies the reviewer verdicts to the asks that wait for one: pass -> pass, fail -> fail. A review without `run` covers
 * the ask in every run (D1.c option B, "QA confirms the rubric cases once for all runs"); one with `run` covers that run only
 * and wins. Returns new runs (the inputs are untouched) and the reviews that matched no waiting ask.
 */
export function applyReviews(runs, reviews) {
  if (!reviews) return { runs, applied: 0, unused: [], reviewers: [], used: [] };
  const used = new Set();
  let applied = 0;
  const reviewers = new Set();
  const out = runs.map((run) => ({
    ...run,
    asks: run.asks.map((ask) => {
      if (ask.status !== 'needs_reviewer') return ask;
      const hit = reviews.reviews.find((r) => r.id === ask.id && r.lang === ask.lang && r.run === run.runIndex)
        ?? reviews.reviews.find((r) => r.id === ask.id && r.lang === ask.lang && r.run === undefined);
      if (!hit) return ask;
      used.add(hit);
      applied += 1;
      reviewers.add(hit.reviewer);
      return { ...ask, status: hit.verdict, statusBeforeReview: 'needs_reviewer', reviewedBy: hit.reviewer };
    }),
  }));
  return { runs: out, applied, unused: reviews.reviews.filter((r) => !used.has(r)).map((r) => `${r.id}/${r.lang}${r.run ? `/run ${r.run}` : ''}`), reviewers: [...reviewers].sort(), used: [...used] };
}

// ---- run-set integrity (G712-2) and measurement conditions (G712-3, -5, -7, -8, -9) ----

/**
 * Is this exactly the runs of ONE invocation, each complete over the whole case set? Returns a list of problems ([] = yes).
 * Always computed and printed; under a signed file any problem makes the verdict INCONCLUSIVE.
 */
export function checkRunSet(runs, session = null) {
  const problems = [];
  const manifest = session?.manifest ?? null;
  if (!manifest) problems.push('no manifest.json: the runs cannot be shown to come from one invocation of the runner');
  else if (manifest.unreadable || manifest.kind !== MANIFEST_KIND || manifest.schemaVersion !== 1) problems.push(`manifest.json is not a ${MANIFEST_KIND} schemaVersion 1 file`);
  const ok = manifest && !manifest.unreadable && manifest.kind === MANIFEST_KIND;
  const sessionIds = new Set(runs.map((r) => r.sessionId ?? null));
  if (sessionIds.size > 1 || sessionIds.has(null)) problems.push(`the runs do not share one session id (${[...sessionIds].map((s) => s ?? 'none').join(', ')})`);
  if (ok) {
    if (!sessionIds.has(manifest.sessionId) || sessionIds.size > 1) problems.push('a run carries a session id that is not the manifest\'s');
    if (manifest.status !== 'completed') problems.push(`the invocation did not complete (manifest status ${manifest.status})`);
    if (manifest.partial) problems.push('the invocation was a partial run (--only/--limit)');
    const planned = manifest.runsPlanned;
    const listed = (manifest.runs ?? []).map((r) => r.runIndex).sort((a, b) => a - b);
    const expected = Array.from({ length: planned }, (_, i) => i + 1);
    if (JSON.stringify(listed) !== JSON.stringify(expected)) problems.push(`the manifest lists runs ${listed.join(',') || 'none'}, not 1..${planned}`);
    const onDisk = new Map((session.files ?? []).map((f) => [f.file, f.sha256]));
    for (const entry of manifest.runs ?? []) {
      if (!onDisk.has(entry.file)) problems.push(`${entry.file} is listed in the manifest but missing`);
      else if (onDisk.get(entry.file) !== entry.sha256) problems.push(`${entry.file} changed after the runner wrote it (sha256 differs from the manifest)`);
    }
    const listedFiles = new Set((manifest.runs ?? []).map((r) => r.file));
    for (const file of onDisk.keys()) if (!listedFiles.has(file)) problems.push(`${file} is not in the manifest (an extra run, not counted as part of the invocation)`);
    for (const run of runs) {
      if (run.caseSetSha256 !== manifest.caseSetSha256 || run.caseCount !== manifest.caseCount) problems.push(`run ${run.runIndex} was made over a different case set than the manifest`);
    }
  }
  for (const run of runs) {
    const cases = run.caseCount ?? run.config?.casesRead ?? 0;
    const keys = new Set(run.asks.map(askKey));
    if (run.status !== 'completed') problems.push(`run ${run.runIndex} is ${run.status}${run.reason ? ` (${run.reason})` : ''}`);
    if (run.partial) problems.push(`run ${run.runIndex} is partial`);
    if (run.asks.length !== cases * (run.config?.langs?.length ?? 2) || keys.size !== run.asks.length) problems.push(`run ${run.runIndex} holds ${run.asks.length} asks, not ${cases * (run.config?.langs?.length ?? 2)} (every case in every language, once)`);
  }
  const sets = new Set(runs.map((r) => `${r.caseCount ?? '?'}:${r.caseSetSha256 ?? '?'}`));
  if (sets.size > 1) problems.push('the runs were made over different case sets');
  const caseCount = Math.min(...runs.map((r) => r.caseCount ?? r.config?.casesRead ?? 0));
  if (caseCount < MIN_CASES) problems.push(`the run set covers ${caseCount} case(s); the suite G7-D1 is about has at least ${MIN_CASES}`);
  return problems;
}

/** Facts and problems about HOW the runs were measured; a problem blocks a signed verdict. */
export function measurementConditions(runs, summaries) {
  const problems = [];
  const footer = sha256Hex(reportingFooter());
  const field = (get) => new Set(runs.map((r) => JSON.stringify(get(r) ?? null)));
  const policyKeys = ['threads', 'answerProtocol', 'numbers', 'anchors', 'computeByReply', 'maxRetries', 'footerSha256', 'toolSurfaceSha256'];
  const drift = policyKeys.filter((k) => field((r) => r.config?.[k]).size > 1);
  if (drift.length > 0) problems.push(`the measurement policy changed between runs (${drift.join(', ')})`);
  const c = runs[0]?.config ?? {};
  const off = [];
  if ((c.numbers ?? 'strict') !== 'strict') off.push(`numbers=${c.numbers}`);
  if ((c.anchors ?? 'strict') !== 'strict') off.push(`anchors=${c.anchors}`);
  if (c.computeByReply === false) off.push('compute-by-reply=off');
  if (c.maxRetries !== undefined && c.maxRetries !== 3) off.push(`maxRetries=${c.maxRetries}`);
  if (c.answerProtocol !== 'v1') off.push(`answerProtocol=${c.answerProtocol}`);
  if (off.length > 0) problems.push(`the measurement policy is not the default (${off.join(', ')})`);
  if (runs.some((r) => r.config?.footerSha256 !== footer)) problems.push('the reporting footer of the runs is not the footer of this harness version');
  const unknownParts = new Set();
  for (const r of runs) {
    const t = r.tuple ?? {};
    if (!t.dSha || /unknown/.test(t.dSha)) unknownParts.add('dSha');
    if (t.dirty === true) unknownParts.add('dSha (dirty working tree)');
    if (!t.framePin || /unknown/.test(t.framePin)) unknownParts.add('framePin');
    if ((t.promptIds ?? []).length === 0 || t.promptIds.some((p) => /unknown/.test(p))) unknownParts.add('promptIds');
    if ((t.providers ?? []).length === 0 || t.providers.some((p) => /unknown/.test(p))) unknownParts.add('providers');
    if ((t.resolvedModels ?? []).length === 0) unknownParts.add('resolvedModels');
    if (!['on', 'off'].includes(t.redis)) unknownParts.add('redis');
  }
  if (unknownParts.size > 0) problems.push(`the release tuple has unknown part(s): ${[...unknownParts].join(', ')}`);
  if (runs.some((r) => (r.tuple?.providers ?? []).includes('fake'))) problems.push('the provider is "fake": a plumbing run, not a measurement of a model');
  const clientCalls = summaries.reduce((n, s) => n + s.latency.source.client, 0);
  if (clientCalls > 0) problems.push(`${clientCalls} model call(s) have client-side latency only (no gateway latency_ms row); D1 defines latency on the gateway value`);
  const readerErrors = runs.filter((r) => r.config?.usageReaderError).map((r) => r.runIndex);
  if (readerErrors.length > 0) problems.push(`the usage reader failed in run(s) ${readerErrors.join(', ')}`);
  const surface = runs[0]?.config?.toolSurface;
  if (!surface) problems.push('the tool surface was not recorded');
  else {
    const hollow = Object.entries(surface).filter(([, v]) => v.source === 'name-only').map(([m]) => m);
    if (hollow.length > 0) problems.push(`the tool surface of module(s) ${hollow.join(', ')} is name-only (no real schemas)`);
  }
  const flagged = runs.filter((r) => (r.redactions ?? []).length > 0 || r.asks.some((a) => (a.redactions ?? []).length > 0));
  if (flagged.length > 0) problems.push(`secret-looking values were redacted in run(s) ${flagged.map((r) => r.runIndex).join(', ')}; a flagged run cannot count as a pass`);
  return { problems, footerSha256: footer, policy: { threads: c.threads, numbers: c.numbers ?? 'strict', anchors: c.anchors ?? 'strict', computeByReply: c.computeByReply, maxRetries: c.maxRetries, answerProtocol: c.answerProtocol }, toolSurface: surface ?? null, harness: c.harness ?? null };
}

// ---- thresholds ----

/** Validates a signed thresholds file; throws with every problem named. */
export function parseThresholds(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('thresholds file is not an object');
  if (doc.kind !== THRESHOLDS_KIND) problems.push(`kind must be ${THRESHOLDS_KIND}`);
  if (doc.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (doc.decision !== 'G7-D1') problems.push('decision must be "G7-D1"');
  for (const field of ['signedBy', 'signedAt']) if (typeof doc[field] !== 'string' || doc[field].trim() === '') problems.push(`${field} is required (an unsigned file gives no verdict)`);
  if (typeof doc.signedAt === 'string' && Number.isNaN(Date.parse(doc.signedAt))) problems.push('signedAt must be a date');
  if (doc.aggregation !== 'every_run') problems.push('aggregation must be "every_run" (the worst run decides; no best-run rule exists)');
  if (!Number.isInteger(doc.minRuns) || doc.minRuns < MIN_RUNS) problems.push(`minRuns must be an integer >= ${MIN_RUNS} (D1: the worst of at least ${MIN_RUNS} runs decides)`);
  if (typeof doc.caseSetSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.caseSetSha256)) problems.push('caseSetSha256 is required (the sha256 of the case set the file was signed for, as the runner manifest records it)');
  if (!Number.isInteger(doc.caseCount) || doc.caseCount < MIN_CASES) problems.push(`caseCount must be an integer >= ${MIN_CASES} (the full case set of G7-D1)`);
  const limits = doc.thresholds;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) || Object.keys(limits).length === 0) problems.push('thresholds must name at least one metric');
  else {
    for (const [key, spec] of Object.entries(limits)) {
      const comparator = THRESHOLD_KEYS[key];
      if (!comparator) { problems.push(`unknown threshold ${key}`); continue; }
      const keys = spec && typeof spec === 'object' ? Object.keys(spec) : [];
      if (keys.length !== 1 || keys[0] !== comparator || typeof spec[comparator] !== 'number' || !Number.isFinite(spec[comparator])) {
        problems.push(`threshold ${key} must be exactly { "${comparator}": <number> }`);
      }
    }
    const missing = GATING_KEYS.filter((key) => !(key in limits));
    if (missing.length > 0) problems.push(`thresholds must carry every D1.a metric; missing: ${missing.join(', ')}`);
  }
  if (problems.length > 0) throw new Error(`invalid thresholds file:\n- ${problems.join('\n- ')}`);
  return doc;
}

/** The value of a gated metric in one run summary, and what it would be if every reviewer case came out right. */
function metricValue(key, s) {
  switch (key) {
    case 'outsideAllowlistCases': return { value: s.outsideAllowlist.asks };
    case 'numericPassRate': return { value: s.numeric.rate };
    case 'unauthorizedWrites': return { value: s.unauthorizedWrites };
    case 'leaks': return { value: s.leaks.asks };
    case 'staleApplied': return { value: s.staleApplied };
    case 'successRateOverall': return { value: s.overall.rate, optimistic: s.overall.rateIfReviewed };
    case 'successRateGroupMin': {
      const groups = GROUPS.map((g) => s.byGroup[g]).filter((t) => t.total > 0);
      if (groups.length === 0) return { value: null };
      return { value: Math.min(...groups.map((t) => t.rate)), optimistic: Math.min(...groups.map((t) => t.rateIfReviewed)) };
    }
    case 'modelLatencyP50Ms': return { value: s.latency.p50 };
    case 'modelLatencyP95Ms': return { value: s.latency.p95 };
    default: return { value: null };
  }
}

const holds = (comparator, value, limit) => (comparator === 'max' ? value <= limit : value >= limit);

/**
 * Verdict per gated metric: the WORST run is judged; a rate that only a reviewer case can rescue is "inconclusive".
 * `blockers` (run set, tuple, conditions, awaiting reviewers, too few runs) can only turn a PASS into INCONCLUSIVE.
 */
export function evaluateThresholds(summaries, thresholds, { completeRuns, tuple, extraBlockers = [] }) {
  const metrics = {};
  for (const [key, spec] of Object.entries(thresholds.thresholds)) {
    const comparator = THRESHOLD_KEYS[key];
    const limit = spec[comparator];
    if (NON_GATING[key]) {
      metrics[key] = { comparator, limit, perRun: summaries.map((s) => ({ runIndex: s.runIndex, ...metricValue(key, s) })), verdict: 'not_gating', reason: NON_GATING[key] };
      continue;
    }
    const perRun = summaries.map((s) => ({ runIndex: s.runIndex, ...metricValue(key, s) }));
    if (perRun.some((r) => r.value === null || Number.isNaN(r.value))) {
      metrics[key] = { comparator, limit, perRun, verdict: 'inconclusive', reason: 'no measurement for this metric in at least one run' };
      continue;
    }
    const worst = comparator === 'max' ? Math.max(...perRun.map((r) => r.value)) : Math.min(...perRun.map((r) => r.value));
    const okAll = perRun.every((r) => holds(comparator, r.value, limit));
    const rescued = !okAll && perRun.every((r) => holds(comparator, r.optimistic ?? r.value, limit));
    metrics[key] = { comparator, limit, worst, perRun, verdict: okAll ? 'pass' : rescued ? 'inconclusive' : 'fail', reason: rescued ? 'only passes if every case awaiting a reviewer is confirmed' : null };
  }
  const blockers = [...extraBlockers];
  if (completeRuns < thresholds.minRuns) blockers.push(`only ${completeRuns} complete run(s), the signed file needs ${thresholds.minRuns}`);
  if (!tuple.consistent) blockers.push(`the release tuple changed between runs (${tuple.differing.join(', ')})`);
  const verdicts = Object.values(metrics).map((m) => m.verdict).filter((v) => v !== 'not_gating');
  if (verdicts.length === 0) blockers.push('every metric of the signed file is non-gating: nothing can be judged');
  const status = verdicts.includes('fail') ? 'FAIL' : blockers.length > 0 || verdicts.includes('inconclusive') ? 'INCONCLUSIVE' : 'PASS';
  return { status, blockers, metrics, signedBy: thresholds.signedBy, signedAt: thresholds.signedAt };
}

// ---- report ----

export function buildReport(runsIn, { thresholds = null, reviews = null, session = null } = {}) {
  const refusal = reviews ? checkReviewBinding(reviews, session) : [];
  const reviewed = applyReviews(runsIn, refusal.length === 0 ? reviews : null);
  const runs = reviewed.runs;
  const flaky = findFlaky(runs);
  const flakyKeys = new Set(flaky.map(askKey));
  const summaries = runs.map((r) => summarizeRun(r));
  const completeRuns = runs.filter((r) => r.status === 'completed' && !r.partial && r.asks.length === (r.caseCount ?? r.config.casesRead) * r.config.langs.length).length;
  const tuple = tupleConsistency(runs);
  const runSet = checkRunSet(runs, session);
  const conditions = measurementConditions(runs, summaries);
  const waiting = awaitingReviewer(runs);
  const dist = {
    successRate: distribution(summaries.map((s) => s.overall.rate)),
    awaiting: distribution(summaries.map((s) => s.overall.awaiting)),
    successRateIfReviewed: distribution(summaries.map((s) => s.overall.rateIfReviewed)),
    failed: distribution(summaries.map((s) => s.overall.failed)),
    numericRate: distribution(summaries.map((s) => s.numeric.rate)),
    outsideAllowlistAsks: distribution(summaries.map((s) => s.outsideAllowlist.asks)),
    unauthorizedWrites: distribution(summaries.map((s) => s.unauthorizedWrites)),
    leaks: distribution(summaries.map((s) => s.leaks.asks)),
    staleApplied: distribution(summaries.map((s) => s.staleApplied)),
    emulatedRefusals: distribution(summaries.map((s) => s.emulatedRefusals.total)),
    latencyP50: distribution(summaries.map((s) => s.latency.p50)),
    latencyP95: distribution(summaries.map((s) => s.latency.p95)),
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, distribution(summaries.map((s) => s.byGroup[g].rate))])),
    byFormat: Object.fromEntries(FORMATS.map((f) => [f, distribution(summaries.map((s) => s.byFormat[f].rate))])),
  };
  const pooled = runs.flatMap((r) => callLatencies(r).values).sort((a, b) => a - b);
  const report = {
    kind: 'uniwork-office-g7-holdout-report', schemaVersion: 1, runs: runs.length, completeRuns, tuple, tuples: runs.map((r) => r.tuple),
    sessionId: session?.manifest?.sessionId ?? null, manifestSha256: session?.manifestSha256 ?? null,
    runSet: { ok: runSet.length === 0, problems: runSet }, conditions,
    config: runs.map((r) => r.config), summaries, distribution: dist,
    latencyPooled: { calls: pooled.length, p50: percentile(pooled, 50), p95: percentile(pooled, 95) },
    flaky, awaitingReviewer: waiting, unobtainable: unobtainable(runs),
    reviews: reviews ? {
      applied: reviewed.applied, unused: reviewed.unused, reviewers: reviewed.reviewers, count: reviews.reviews.length, sessionId: reviews.sessionId, refused: refusal,
      confirmed: [...new Map(reviewed.used.map((r) => [`${r.id}/${r.lang}/${r.run ?? '*'}`, { id: r.id, lang: r.lang, run: r.run ?? null, verdict: r.verdict, reviewer: r.reviewer, date: r.date }])).values()]
        .sort((a, b) => `${a.id}/${a.lang}/${a.run ?? 0}`.localeCompare(`${b.id}/${b.lang}/${b.run ?? 0}`)),
    } : null,
    lenientAsks: listAsks(runs, (a) => a.adapter?.anchorLenient ?? 0),
    proseMismatchAsks: listAsks(runs, (a) => ((a.adapter?.proseFigureMismatch ?? 0) > 0 ? 1 : 0)),
    unbackedEditAsks: listAsks(runs, (a) => a.adapter?.writeUnbacked ?? 0),
    noAppliedWriteAsks: listAsks(runs, (a) => (a.adapter?.noAppliedWrite === true ? 1 : 0)),
    editCases: editCaseSplit(runs),
    invalidArgumentAsks: listAsks(runs, (a) => ((a.invalidArguments ?? []).length > 0 ? 1 : 0)),
    notMeasured: ['silent overwrite', 'lost acknowledged draft'],
  };
  if (thresholds) {
    const adjusted = runs.map((r) => summarizeRun(r, flakyKeys));
    const extraBlockers = [...runSet, ...conditions.problems];
    const seen = session?.manifest && !session.manifest.unreadable ? session.manifest : runs[0];
    if (thresholds.caseSetSha256 !== seen?.caseSetSha256 || thresholds.caseCount !== seen?.caseCount) {
      extraBlockers.push(`the run set was made over a different case set than the one the thresholds were signed for (${seen?.caseCount ?? '?'} cases, sha256 ${String(seen?.caseSetSha256 ?? 'unknown').slice(0, 12)} vs signed ${thresholds.caseCount}, ${String(thresholds.caseSetSha256).slice(0, 12)})`);
    }
    for (const reason of refusal) extraBlockers.push(`the reviews file was refused and applied to nothing: ${reason}`);
    if (waiting.length > 0) extraBlockers.push(`${waiting.length} ask(s) still wait for a reviewer (no review for them in --reviews)`);
    report.overall = evaluateThresholds(adjusted, thresholds, { completeRuns, tuple, extraBlockers });
    report.flakyCountedAsFailed = flaky.length;
  } else {
    report.overall = { status: 'no_threshold', label: NO_THRESHOLD };
  }
  return report;
}

export function exitCodeOf(report) {
  switch (report.overall.status) {
    case 'PASS': return EXIT.pass;
    case 'FAIL': return EXIT.fail;
    case 'INCONCLUSIVE': return EXIT.inconclusive;
    default: return EXIT.noThreshold;
  }
}

const pct = (v) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`);
const num = (v) => (v === null || v === undefined ? '-' : String(Number.isInteger(v) ? v : Number(v.toFixed(1))));
const triple = (d, fmt = num) => `${fmt(d.min)} / ${fmt(d.median)} / ${fmt(d.max)}`;

/** The Vietnamese report. Without thresholds it carries no verdict word (no PASS/FAIL anywhere). */
export function renderReport(report) {
  const out = [];
  const w = (line = '') => out.push(line);
  const gated = report.overall.status !== 'no_threshold';
  const d = report.distribution;
  const cond = report.conditions;
  w('# Báo cáo holdout AI G7-12 (UNI-1384)');
  w();
  if (!gated) w(`> **Trạng thái tổng: ${NO_THRESHOLD}.** Các số dưới đây là số đo, không phải kết luận: chưa có tệp ngưỡng đã ký (G7-D1), nên không chỉ số nào có nhãn đạt hay trượt.`);
  else w(`> **Trạng thái tổng: ${report.overall.status}** theo tệp ngưỡng đã ký bởi ${report.overall.signedBy} (${report.overall.signedAt}); lần chạy xấu nhất quyết định, không bao giờ lần đẹp nhất.`);
  w();
  w(`${report.runs} lần chạy, ${report.completeRuns} lần đủ bộ ca. Mỗi ô "min / trung vị / max" là phân bố trên các lần chạy; không chọn lần chạy nào.`);
  if (report.completeRuns < report.runs) w('**Có lần chạy chưa đủ bộ ca (một phần, bị chặn hoặc dừng giữa chừng): số đo của lần đó chỉ để tham khảo.**');
  w();
  w('## 0. Điều kiện của phép đo');
  w();
  w('Kết quả dưới đây đúng cho các điều kiện này, không phải cho prompt sản phẩm trần:');
  w();
  w('- **Câu hỏi bị thêm một đoạn cuối cố định** (giống nhau cho mọi ca, không chứa nội dung ca; nhưng nó nêu các loại bộ chấm tính: từ chối, không tìm thấy, lưu ý, ô có vị trí, và xin "chỉ số cuối cùng"). Đoạn nguyên văn:');
  w();
  w('```');
  for (const line of reportingFooter().split('\n')) w(line);
  w('```');
  w();
  w(`  sha256 của đoạn này: \`${cond.footerSha256}\`; giao thức đáp án: ${cond.policy.answerProtocol ?? 'không rõ'}.`);
  w(`- **Chính sách chấm**: số = ${cond.policy.numbers}, neo vị trí = ${cond.policy.anchors}${cond.policy.anchors === 'lenient' ? ' (CHO PHÉP giá trị đúng ở neo khác: kết luận đã ký sẽ không thể là đạt)' : ' (giá trị đúng ở neo khác là sai)'}, compute-bằng-trả-lời = ${cond.policy.computeByReply === false ? 'tắt' : 'bật'}, thử lại tối đa ${num(cond.policy.maxRetries)}, ${num(cond.policy.threads)} luồng.`);
  w('- **Backend giả lập**: kết quả công cụ lấy từ fixture tổng hợp; mọi lần ghi chỉ được đếm, không được áp vào tài liệu; vai trò viewer, thu hồi quyền và bản cũ (stale) đều do harness giả lập; kết quả công cụ tổng hợp (`applied`, ghi chú xin làm rõ) là chung cho mọi ca.');
  w('- **Đường đi**: qua route façade AI của khung (không qua panel). Một người dùng thử, tối đa 2 luồng, bằng chứng panel nằm ở G7-08.');
  w('- **Bộ công cụ cấp cho model** (cùng một danh sách cho mọi ca của một module, không lọc theo allowlist của ca). **Đây là một phần công cụ của bản phát hành, không phải toàn bộ**: harness chỉ ánh xạ một số công cụ mỗi module sang thao tác trừu tượng của ca, nên một công cụ chưa ánh xạ không bao giờ được cấp và không thể bị gọi; "0 công cụ ngoài allowlist" chỉ đúng trong tập đã cấp. Tệp `--tool-schemas` chỉ mô tả được các công cụ đã ánh xạ: công cụ khác trong tệp bị bỏ và được liệt kê ở cột cuối, tệp không mở rộng được bộ công cụ.');
  w();
  w('| Module | Nguồn lược đồ | Cấp / tổng công cụ của khung | sha256 lược đồ | Công cụ trong tệp bị bỏ (chưa ánh xạ) |');
  w('| --- | --- | ---: | --- | --- |');
  if (cond.toolSurface) {
    for (const [module, v] of Object.entries(cond.toolSurface)) {
      const dropped = v.droppedFromFile ?? [];
      w(`| ${module} | ${v.source}${v.source === 'name-only' ? ' (chỉ có tên)' : ''} | ${v.offered ?? v.tools.length} / ${v.frameTotal ?? 'không rõ'} | \`${String(v.schemasSha256).slice(0, 16)}\` | ${dropped.length > 0 ? dropped.join(', ') : '-'} |`);
    }
  } else w('| (không ghi) | | | | |');
  w();
  const srcTotals = report.summaries.reduce((t, s) => ({ server: t.server + s.latency.source.server, client: t.client + s.latency.source.client }), { server: 0, client: 0 });
  w(`- **Độ trễ**: ${srcTotals.server} lượt gọi lấy \`latency_ms\` của cổng AI, ${srcTotals.client} lượt gọi chỉ có thời gian phía client (gồm mạng, đọc SSE, façade).`);
  w('- **Release tuple khai báo, không quan sát**: SHA D và ghim khung lấy từ bản checkout của máy chạy (hoặc `--server-sha`), Redis do người chạy khai (`--redis`); máy chủ không báo SHA bản dựng. Nhà cung cấp, prompt_id, model đã phân giải và độ trễ máy chủ chỉ quan sát được khi `--db-url` đọc được `ai_usage_events`.');
  w(`- Không đo được: ${report.notMeasured.join(', ')}; hàng "ghi áp lên bản cũ" và "ghi trái phép" của viewer/thu hồi chỉ là số do backend giả lập (xem mục 3).`);
  if (cond.problems.length > 0) {
    w();
    w('**Điều kiện chưa đạt (mỗi mục chặn kết luận đã ký):**');
    w();
    for (const p of cond.problems) w(`- ${p}`);
  }
  w();
  w('## 1. Bộ lần chạy và release tuple');
  w();
  w(`Phiên: ${report.sessionId ?? 'không có manifest'}${report.manifestSha256 ? ` (manifest sha256 \`${report.manifestSha256}\`)` : ''}. Bộ lần chạy ${report.runSet.ok ? 'đầy đủ và nhất quán' : 'KHÔNG đầy đủ hoặc không nhất quán'}.`);
  for (const p of report.runSet.problems) w(`- ${p}`);
  w();
  w(`Tuple nhất quán giữa các lần chạy: ${report.tuple.consistent ? 'có' : `KHÔNG (${report.tuple.differing.join(', ')})`}.`);
  w();
  w('| Lần | SHA D (nguồn) | Ghim khung | prompt_id | Nhà cung cấp | Model đã phân giải | Redis (khai báo) |');
  w('| ---: | --- | --- | --- | --- | --- | --- |');
  report.tuples.forEach((t, i) => w(`| ${i + 1} | ${t.dSha.slice(0, 12)} (${t.dShaSource ?? 'không rõ'})${t.dirty ? ' (cây làm việc có thay đổi)' : ''} | ${t.framePin} | ${t.promptIds.join(', ')} | ${t.providers.join(', ')} | ${t.resolvedModels.join(', ') || 'unknown'} | ${t.redis} |`));
  w();
  w('## 2. Tải của lần chạy');
  w();
  w('| Lần | Luồng | Lượt hỏi | Lượt gọi model | Thử lại | 429 | 5xx/mạng | Token vào | Token ra | Nguồn token |');
  w('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  const tokenSource = (s) => (s.load.tokensFromUsageRows > 0 ? `ai_usage_events (${s.load.tokenCallsWithRow}/${s.load.tokenCalls} lượt gọi có dòng)` : s.load.inputTokens > 0 ? 'phản hồi façade' : 'không có');
  report.summaries.forEach((s, i) => w(`| ${s.runIndex} | ${report.config[i].threads} | ${s.load.asks} | ${s.load.modelCalls} | ${s.load.retries} | ${s.load.rateLimited} | ${s.load.serverErrors} | ${s.load.inputTokens} | ${s.load.outputTokens} | ${tokenSource(s)} |`));
  w();
  w('## 3. Chỉ số §9.2 (min / trung vị / max trên các lần chạy)');
  w();
  w('| Chỉ số | Mỗi lần chạy | min / trung vị / max |');
  w('| --- | --- | --- |');
  const row = (label, dist, fmt = num) => w(`| ${label} | ${dist.values.map(fmt).join('; ')} | ${triple(dist, fmt)} |`);
  row('Lượt hỏi gọi công cụ ngoài allowlist hoặc bịa công cụ (số lượt hỏi)', d.outsideAllowlistAsks);
  row('Số/công thức: tỷ lệ khớp đáp án (ca có đáp án số)', d.numericRate, pct);
  row('Ghi vượt trần của ca (số lượt hỏi; đo thật cho vai editor)', d.unauthorizedWrites);
  row('Lộ marker cấm hoặc không kiểm chứng được (số lượt hỏi)', d.leaks);
  row('Ghi áp lên bản cũ (ca stale có ghi) — mô phỏng, luôn 0 theo cấu trúc', d.staleApplied);
  row('Số lần ghi bị backend giả lập từ chối (viewer, thu hồi quyền, bản cũ)', d.emulatedRefusals);
  row('Thành công đầu-cuối: tỷ lệ khớp đáp án trên tổng lượt hỏi (ca chờ người duyệt chưa tính)', d.successRate, pct);
  row('Số lượt hỏi lệch đáp án', d.failed);
  row('Số lượt hỏi chờ người duyệt', d.awaiting);
  w();
  w('Ghi chú: viewer, thu hồi quyền và bản cũ do backend của harness từ chối mọi lần ghi, nên "ghi trái phép" của các vai đó và "ghi áp lên bản cũ" bằng 0 theo cấu trúc, không phải bằng chứng về khung hay máy chủ (bảo vệ thật nằm ở khung/máy chủ, harness này không chạy chúng).');
  w();
  w(`Không đo được ở bộ chạy này: ${report.notMeasured.join(', ')} (không có chỉ báo tất định ở mức ca).`);
  w();
  w('### Theo nhóm (tỷ lệ khớp đáp án)');
  w();
  w('| Nhóm | Mỗi lần chạy | min / trung vị / max |');
  w('| --- | --- | --- |');
  for (const g of GROUPS) row(`${g} (${report.summaries[0].byGroup[g].total} lượt hỏi)`, d.byGroup[g], pct);
  w();
  w('### Theo định dạng (tỷ lệ khớp đáp án)');
  w();
  w('| Định dạng | Mỗi lần chạy | min / trung vị / max |');
  w('| --- | --- | --- |');
  for (const f of FORMATS) row(`${f} (${report.summaries[0].byFormat[f].total} lượt hỏi)`, d.byFormat[f], pct);
  w();
  w('## 4. Độ trễ mỗi lượt gọi model');
  w();
  w('Chỉ tính lượt gọi thành công; ưu tiên `latency_ms` mà cổng AI ghi (chỉ thời gian chờ upstream), nếu không có thì thời gian phía client (hai nguồn bị gộp chung trong p50/p95; cột nguồn cho biết tỷ lệ). Lỗi 429/5xx đếm riêng ở mục 2.');
  w();
  w('| Lần | Lượt gọi | p50 (ms) | p95 (ms) | min | max | Nguồn (máy chủ / client) |');
  w('| ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  report.summaries.forEach((s) => w(`| ${s.runIndex} | ${s.latency.calls} | ${num(s.latency.p50)} | ${num(s.latency.p95)} | ${num(s.latency.min)} | ${num(s.latency.max)} | ${s.latency.source.server} / ${s.latency.source.client} |`));
  w(`| gộp | ${report.latencyPooled.calls} | ${num(report.latencyPooled.p50)} | ${num(report.latencyPooled.p95)} | | | |`);
  w();
  w(`Phân bố p50 các lần: ${triple(d.latencyP50)}; p95: ${triple(d.latencyP95)}.`);
  w();
  w('## 5. Ca không ổn định (khớp đáp án ở lần này, lệch ở lần khác)');
  w();
  if (report.flaky.length === 0) w('Không có.');
  else for (const f of report.flaky) w(`- ${f.id} (${f.lang}): ${f.statuses.map((s) => (s === 'pass' ? 'khớp' : s === 'fail' ? 'lệch' : 'chờ người duyệt')).join(', ')}`);
  w();
  w('## 6. Ca chờ người duyệt (awaiting reviewer)');
  w();
  if (report.reviews) {
    const r = report.reviews;
    if (r.refused.length > 0) {
      w(`**Tệp duyệt BỊ TỪ CHỐI (${r.count} mục, phiên ${r.sessionId}) và không áp cho lượt hỏi nào**, nên mọi ca chờ duyệt vẫn chờ:`);
      w();
      for (const reason of r.refused) w(`- ${reason}`);
    } else {
      w(`Tệp duyệt: ${r.count} mục của phiên ${r.sessionId}${r.sha256 ? ` (sha256 \`${r.sha256}\`)` : ''}, ${r.applied} lượt hỏi đã áp dụng (người duyệt: ${r.reviewers.join(', ') || 'không có'}).${r.unused.length > 0 ? ` Mục duyệt không khớp lượt hỏi nào đang chờ: ${r.unused.join(', ')}.` : ''}`);
      if (r.confirmed.length > 0) {
        w();
        w('| Ca | Ngôn ngữ | Lần chạy | Kết luận | Người duyệt | Ngày |');
        w('| --- | --- | --- | --- | --- | --- |');
        for (const c of r.confirmed) w(`| ${c.id} | ${c.lang} | ${c.run ?? 'mọi lần'} | ${c.verdict === 'pass' ? 'khớp' : 'lệch'} | ${c.reviewer} | ${c.date} |`);
      }
    }
    w();
  }
  if (report.awaitingReviewer.length === 0) w('Không có.');
  else {
    w(`${report.awaitingReviewer.length} lượt hỏi (${new Set(report.awaitingReviewer.map((a) => a.id)).size} ca) cần người duyệt chấm; bộ chấm không bao giờ tự xác nhận${report.reviews ? '' : ' (không có --reviews: kết luận có ngưỡng chỉ có thể là trượt hoặc chưa kết luận được, không bao giờ đạt)'}.`);
    w();
    const langsOf = new Map();
    for (const a of report.awaitingReviewer) langsOf.set(a.id, [...(langsOf.get(a.id) ?? []), a.lang]);
    w([...langsOf].map(([id, langs]) => `${id} (${langs.join(', ')})`).join(', '));
    const rateRow = d.successRateIfReviewed;
    w();
    w(`Nếu mọi ca chờ duyệt đều được xác nhận đúng, tỷ lệ khớp đáp án sẽ là (min / trung vị / max): ${triple(rateRow, pct)}. Đây là cận trên, không phải kết quả.`);
  }
  w();
  w('## 7. Giới hạn của bộ chạy (đáp án suy ra từ dòng báo cáo, adapter v1)');
  w();
  w('| Lần | Thiếu dòng UNIWORK_ANSWER | Dòng không hợp lệ | Giá trị đúng nhưng sai neo (chỉ khi --anchors lenient) | Số thừa | Lượt hỏi lời văn lệch dòng báo cáo | Tham số công cụ sai | Sửa đổi: lượt hỏi không có lần ghi đã áp mang nội dung sửa | Sửa đổi: mục chứng minh bằng đối số ghi / không có bằng chứng ghi / tự báo cáo (giữ nguyên) / tự báo cáo (số đếm, dò định dạng) |');
  w('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  report.summaries.forEach((s) => w(`| ${s.runIndex} | ${s.adapter.reportMissing} | ${s.adapter.reportInvalid} | ${s.adapter.anchorLenient} | ${s.adapter.extraFigures} | ${s.adapter.proseMismatchAsks} | ${s.adapter.invalidArgumentAsks} | ${s.adapter.noAppliedWriteAsks} | ${s.adapter.writeBacked} / ${s.adapter.writeUnbacked} / ${s.adapter.writeSelfPreserved} / ${s.adapter.writeSelfReported - s.adapter.writeSelfPreserved} |`));
  w();
  w('Một lượt hỏi thiếu dòng báo cáo bị chấm lệch đáp án (đóng theo hướng an toàn); cột này tách lỗi giao thức khỏi lỗi trả lời. Ca sửa đổi chỉ đạt khi có ít nhất một lần ghi ĐÃ ÁP (không phải chạy thử, không bị từ chối, không rỗng `{}`) của công cụ ghi bắt buộc, mang nội dung và đưa vào tài liệu một thứ tài liệu chưa có. Giá trị mà bản sửa đưa vào (ô, tiêu đề, ô bảng, định dạng phần trăm) phải nằm trong đối số của lần ghi đã áp, nếu không mục đó trượt. Giá trị tài liệu vốn đã có (tiêu đề hay tổng không đụng tới, ô trống để nguyên) và số đếm chỉ có tự báo cáo của model: được tính và gắn nhãn "tự báo cáo (giữ nguyên)" hoặc "tự báo cáo (số đếm, dò định dạng)", không phải bằng chứng. Bộ chạy không phân biệt được một lần ghi văn bản MỚI nhưng sai chỗ ở ca chỉ có giá trị giữ nguyên và số đếm; ở ca đó nội dung bản sửa chỉ có tự báo cáo của model làm bằng chứng (giới hạn đã biết).');
  if (report.editCases.length > 0) {
    w();
    w('| Ca sửa đổi | Lượt hỏi | Không có lần ghi đã áp mang nội dung sửa | Chứng minh bằng đối số ghi | Không có bằng chứng ghi | Tự báo cáo (giữ nguyên) | Tự báo cáo (số đếm, dò định dạng) |');
    w('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const c of report.editCases) w(`| ${c.id} | ${c.asks} | ${c.noAppliedWrite} | ${c.backed} | ${c.unbacked} | ${c.selfPreserved} | ${c.selfOther} |`);
  }
  const listLine = (title, items) => { if (items.length > 0) { w(); w(`${title} ${items.map((i) => `${i.key} ×${i.count}`).join(', ')}`); } };
  listLine('Lượt hỏi được chấm nới neo (mỗi ca/ngôn ngữ, số lần trên mọi lần chạy):', report.lenientAsks);
  listLine('Lượt hỏi mà lời văn không nêu một con số có trong dòng báo cáo (cảnh báo, không tự làm sai):', report.proseMismatchAsks);
  listLine('Lượt hỏi sửa đổi không có lần ghi đã áp mang nội dung sửa (chạy thử, bị từ chối, rỗng, hoặc ghi lại đúng thứ tài liệu đã có):', report.noAppliedWriteAsks);
  listLine('Lượt hỏi sửa đổi bị loại vì đối số ghi không chứng minh được giá trị mà bản sửa đưa vào:', report.unbackedEditAsks);
  listLine('Lượt hỏi bị coi là lỗi vì model gọi công cụ với tham số không hợp lệ:', report.invalidArgumentAsks);
  if (report.unobtainable.length > 0) {
    w();
    w('Ca mà không công cụ nào được cấp có thể phục vụ thao tác bắt buộc (lỗ hổng của bộ chạy, không phải lỗi model; cần lược đồ công cụ thật qua --tool-schemas):');
    w();
    w(report.unobtainable.map((u) => `${u.id} (${u.ops.join(', ')})`).join(', '));
  }
  if (gated) {
    w();
    w('## 8. Kết luận theo ngưỡng đã ký (G7-D1)');
    w();
    if (report.overall.blockers.length > 0) for (const b of report.overall.blockers) w(`- Chưa kết luận được: ${b}.`);
    if (report.flakyCountedAsFailed > 0) w(`- ${report.flakyCountedAsFailed} lượt hỏi không ổn định được tính là lệch ở mọi lần chạy.`);
    w();
    w('| Chỉ số | Ngưỡng | Xấu nhất | Kết luận |');
    w('| --- | --- | ---: | --- |');
    for (const [key, m] of Object.entries(report.overall.metrics)) w(`| ${key} | ${m.comparator === 'max' ? '≤' : '≥'} ${m.limit} | ${num(m.worst)} | ${m.verdict === 'not_gating' ? 'KHÔNG GATE' : m.verdict.toUpperCase()}${m.reason ? ` (${m.reason})` : ''} |`);
  }
  return `${out.join('\n')}\n`;
}

const HELP = `Usage: node scripts/office/g5g6g7/holdout-report.mjs --runs <session folder> [--reviews <file>] [--thresholds <signed.json>] [--out <dir>] [--allow-in-repo]
Reads run-NN.json and manifest.json of one runner invocation and writes report.md + report.json (default into the session folder).
--reviews    reviewer verdicts for the asks that wait for a human (kind ${REVIEWS_KIND}; per case id + lang, pass|fail, reviewer, date), bound to
             one run set by its sessionId and the sha256 of its manifest.json (a file for another session is refused).
--thresholds the signed G7-D1 file; without it the status is "no threshold" and no PASS/FAIL appears anywhere.
Exit codes: 0 signed PASS, 1 signed FAIL, 2 INCONCLUSIVE, 3 no threshold (no verdict), 4 usage or read error.
`;

export function parseArgs(argv) {
  const args = { allowInRepo: false };
  const need = (i) => { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runs') args.runs = path.resolve(need(i++));
    else if (argv[i] === '--thresholds') args.thresholds = path.resolve(need(i++));
    else if (argv[i] === '--reviews') args.reviews = path.resolve(need(i++));
    else if (argv[i] === '--out') args.out = path.resolve(need(i++));
    else if (argv[i] === '--allow-in-repo') args.allowInRepo = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (args.help) return args;
  if (!args.runs) throw new Error('usage: holdout-report.mjs --runs <session folder> [--reviews <file>] [--thresholds <signed.json>] [--out <dir>]');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const outDir = args.out ?? args.runs;
  if (!args.allowInRepo && isInsideRepo(outDir)) throw new Error(`--out ${outDir} is inside the repo: keep reports outside it (or pass --allow-in-repo)`);
  const session = loadSession(args.runs);
  const thresholds = args.thresholds ? parseThresholds(JSON.parse(fs.readFileSync(args.thresholds, 'utf8'))) : null;
  const reviews = args.reviews ? parseReviews(JSON.parse(fs.readFileSync(args.reviews, 'utf8'))) : null;
  const report = buildReport(session.runs, { thresholds, reviews, session });
  if (args.reviews) report.reviews.sha256 = sha256Hex(fs.readFileSync(args.reviews));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const md = renderReport(report);
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  process.stdout.write(md);
  process.exitCode = exitCodeOf(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err?.message ?? err}\n`);
    process.exit(EXIT.error);
  }
}
