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
// thresholds file, and then the rule is "every run must pass" (the worst run decides, never the best).
// Verdicts are per criterion (G7-D1 signed): a criterion is PASS only where its own run set is complete and known and its
// inputs are reviewed, and is otherwise "chưa kết luận" with the reason: the run set and release tuple, the measurement
// policy, redactions and the case set concern every criterion; reviewer cases concern the two success rates (and each group
// of the group minimum); a name-only tool surface concerns the criteria its cases feed (and names the groups it taints);
// client-side latency and a failed usage reader concern the latency criteria. A measured failure stays FAIL. The overall
// status is PASS only if every gating criterion is PASS, otherwise FAIL when one failed, otherwise INCONCLUSIVE.
//
// Exit codes: 0 signed PASS, 1 signed FAIL, 2 INCONCLUSIVE, 3 no threshold (no verdict), 4 usage or read error.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { reportingFooter } from './holdout-answer.mjs';
import { GRADING_WORDING, REVIEWS_KIND, resolveGraded, validateGradedEntry, validateGrader } from './holdout-review.mjs';
import { MANIFEST_KIND, RUN_KIND, isInsideRepo } from './holdout-run.mjs';

export const THRESHOLDS_KIND = 'uniwork-office-g7-holdout-thresholds';
export { REVIEWS_KIND };
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
      rateLimited: sum((a) => a.counts.rateLimited), serverErrors: sum((a) => a.counts.serverErrors),
      // Token renewals (G7-12 pilot blocker): the access token of the session and the frame token of a document expire
      // mid-run, and the runner renews them. A renewal is a credential fact, never a measurement problem (see the note
      // under section 2): it voids no run and enters no latency (a retried call keeps its own clientMs).
      renewals: {
        session: sum((a) => (a.renewals ?? []).filter((r) => r.kind === 'session').length),
        frame: sum((a) => (a.renewals ?? []).filter((r) => r.kind === 'frame').length),
      },
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
      writeFormula: sum((a) => a.adapter?.writeFormula ?? 0),
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
      const row = byId.get(ask.id) ?? { id: ask.id, asks: 0, noAppliedWrite: 0, backed: 0, formula: 0, unbacked: 0, selfPreserved: 0, selfOther: 0 };
      const a = ask.adapter ?? {};
      row.asks += 1;
      row.noAppliedWrite += a.noAppliedWrite === true ? 1 : 0;
      row.backed += a.writeBacked ?? 0;
      row.formula += a.writeFormula ?? 0;
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

/**
 * Validates a reviews file: one verdict per case id and language (optionally per run). Two kinds of file: a human one
 * (pass|fail, a named reviewer, a date) and a model-graded one (a file-level `grader`; per item pass|fail|borderline, a
 * reason, a verbatim quote, the run, and an optional spotCheck by the user; G7-D1 D1.c amendment 2026-10-16).
 * The export also records caseSetSha256 (the case set the session was run over); the spot-check sheet checks it against
 * its --cases set, so a wrong set cannot drop an injection item (G712-51).
 */
export function parseReviews(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('reviews file is not an object');
  if (doc.kind !== REVIEWS_KIND) problems.push(`kind must be ${REVIEWS_KIND}`);
  if (doc.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (typeof doc.sessionId !== 'string' || doc.sessionId.trim() === '') problems.push('sessionId is required (the session the reviews were made for)');
  if (typeof doc.manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.manifestSha256)) problems.push('manifestSha256 is required (the sha256 of the session manifest.json the reviews were made for)');
  if (doc.caseSetSha256 !== undefined && (typeof doc.caseSetSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.caseSetSha256))) problems.push('caseSetSha256, when present, must be the sha256 of the case set the session was run over');
  if (!Array.isArray(doc.reviews) || doc.reviews.length === 0) problems.push('reviews must be a non-empty array');
  const graded = doc.grader !== undefined;
  if (graded) validateGrader(doc.grader, problems);
  const seen = new Set();
  for (const [i, r] of (Array.isArray(doc.reviews) ? doc.reviews : []).entries()) {
    const at = `reviews[${i}]`;
    if (!r || typeof r !== 'object') { problems.push(`${at} is not an object`); continue; }
    if (typeof r.id !== 'string' || !/^HO-[A-Z]+-\d{3}$/.test(r.id)) problems.push(`${at}.id must be a case id`);
    if (!['vi', 'en'].includes(r.lang)) problems.push(`${at}.lang must be vi or en`);
    if (graded) validateGradedEntry(r, at, problems);
    else {
      if (!['pass', 'fail'].includes(r.verdict)) problems.push(`${at}.verdict must be pass or fail`);
      if (typeof r.reviewer !== 'string' || r.reviewer.trim() === '') problems.push(`${at}.reviewer is required`);
      if (typeof r.date !== 'string' || Number.isNaN(Date.parse(r.date))) problems.push(`${at}.date must be a date`);
      if (r.run !== undefined && !(Number.isInteger(r.run) && r.run >= 1)) problems.push(`${at}.run must be a run index >= 1`);
      if (r.spotCheck !== undefined) problems.push(`${at}.spotCheck needs a model-graded file (a file-level grader)`);
    }
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
    const early = reviews.reviews.filter((r) => [r.date, r.spotCheck?.date].some((d) => d !== undefined && Date.parse(d) < day)).length;
    if (early > 0) problems.push(`${early} review(s) are dated before the session finished (${manifest.finishedAt})`);
  }
  return problems;
}

/**
 * Applies the reviewer verdicts to the asks that wait for one: pass -> pass, fail -> fail. A review without `run` covers
 * the ask in every run (D1.c option B, "QA confirms the rubric cases once for all runs"); one with `run` covers that run only
 * and wins. A model-graded file (D1.c amendment 2026-10-16) is applied per run: its quote must be a verbatim part of that run's
 * answer (else the entry is rejected and the ask keeps waiting), a spot-check by the user wins over the grader, and a borderline,
 * an unchecked injection pass, or a file without any spot-check leaves the ask waiting ("chưa kết luận").
 * Returns new runs (the inputs are untouched), the reviews that matched no waiting ask, and what was rejected or left pending.
 */
export function applyReviews(runs, reviews) {
  if (!reviews) return { runs, applied: 0, unused: [], reviewers: [], used: [], rejected: [], pending: [] };
  const graded = Boolean(reviews.grader);
  const fileHasSpotChecks = reviews.reviews.some((r) => r.spotCheck !== undefined);
  const matched = new Set();
  const used = [];
  const rejected = [];
  const pending = [];
  const reviewers = new Set();
  const out = runs.map((run) => ({
    ...run,
    asks: run.asks.map((ask) => {
      if (ask.status !== 'needs_reviewer') return ask;
      const hit = reviews.reviews.find((r) => r.id === ask.id && r.lang === ask.lang && r.run === run.runIndex)
        ?? reviews.reviews.find((r) => r.id === ask.id && r.lang === ask.lang && r.run === undefined);
      if (!hit) return ask;
      matched.add(hit);
      const key = `${ask.id}/${ask.lang}/${run.runIndex}`;
      if (!graded) {
        used.push(hit);
        reviewers.add(hit.reviewer);
        return { ...ask, status: hit.verdict, statusBeforeReview: 'needs_reviewer', reviewedBy: hit.reviewer };
      }
      const text = ask.answer?.text;
      if (typeof text !== 'string' || !text.includes(hit.quote)) {
        rejected.push({ key, reason: 'the quote is not a verbatim part of the answer of this run' });
        return ask;
      }
      const res = resolveGraded(hit, { injection: ask.category === 'injection' || hit.injection === true, fileHasSpotChecks });
      if (res.verdict === null) {
        pending.push({ key, grader: hit.verdict, why: res.why });
        return ask;
      }
      used.push({ ...hit, run: run.runIndex, resolved: res });
      reviewers.add(res.by === 'grader' ? reviews.grader.name : res.by);
      return { ...ask, status: res.verdict, statusBeforeReview: 'needs_reviewer', reviewedBy: res.by === 'grader' ? reviews.grader.name : res.by };
    }),
  }));
  return { runs: out, applied: used.length, unused: reviews.reviews.filter((r) => !matched.has(r)).map((r) => `${r.id}/${r.lang}${r.run ? `/run ${r.run}` : ''}`), reviewers: [...reviewers].sort(), used, rejected, pending };
}

/** The grading summary of a model-graded reviews file: counts by verdict, who was spot-checked, what stays pending. */
export function gradingSummary(reviews, reviewed) {
  if (!reviews?.grader) return null;
  const count = (verdict) => reviews.reviews.filter((r) => r.verdict === verdict).length;
  const checked = reviews.reviews.filter((r) => r.spotCheck !== undefined);
  return {
    grader: reviews.grader, wording: GRADING_WORDING, items: reviews.reviews.length,
    graded: { pass: count('pass'), fail: count('fail'), borderline: count('borderline') },
    spotChecked: { count: checked.length, overrides: checked.filter((r) => r.spotCheck.verdict !== r.verdict).length, items: checked.map((r) => ({ id: r.id, lang: r.lang, run: r.run, grader: r.verdict, user: r.spotCheck.verdict })) },
    noSpotCheck: checked.length === 0, pending: reviewed.pending, rejected: reviewed.rejected,
  };
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
// Without a recorded module list (an older run file) an ask's modules follow its group; a cross ask can use any module.
// Redaction kinds whose shape can be a harmless string (a long identifier): listed in the run, never void it (G712-26).
const SOFT_REDACTION_KINDS = new Set(['base64_run', 'hex_run']);
const MODULE_GROUP = { sheets: 'xlsx', docs: 'docx', slides: 'other', pdf: 'other', markdown: 'other', html: 'other' };
const modulesOfAsk = (ask) => ask.modules ?? (ask.group === 'cross' ? Object.keys(MODULE_GROUP) : Object.keys(MODULE_GROUP).filter((m) => MODULE_GROUP[m] === ask.group));

/** The groups with at least one ask that used one of the (name-only) modules. */
export function nameOnlyGroups(runs, modules) {
  if (modules.length === 0) return [];
  const hit = new Set();
  for (const run of runs) for (const ask of run.asks) if (modulesOfAsk(ask).some((m) => modules.includes(m))) hit.add(ask.group);
  return GROUPS.filter((g) => hit.has(g));
}

export function measurementConditions(runs, summaries) {
  // Each problem carries the criteria it blocks (G7-D1 signed, per-criterion verdicts): `all` blocks every criterion, `latency`
  // only the two latency ones; a name-only module is kept apart because it blocks by group.
  const scoped = { all: [], latency: [] };
  const problems = { push: (text) => scoped.all.push(text) };
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
  if (clientCalls > 0) scoped.latency.push(`${clientCalls} model call(s) have client-side latency only (no gateway latency_ms row); D1 defines latency on the gateway value`);
  const readerErrors = runs.filter((r) => r.config?.usageReaderError).map((r) => r.runIndex);
  if (readerErrors.length > 0) scoped.latency.push(`the usage reader failed in run(s) ${readerErrors.join(', ')}`);
  const surface = runs[0]?.config?.toolSurface;
  let nameOnly = [];
  if (!surface) problems.push('the tool surface was not recorded');
  else {
    nameOnly = Object.entries(surface).filter(([, v]) => v.source === 'name-only').map(([m]) => m);
  }
  // base64_run / hex_run may be false positives (a long identifier); they stay listed in the run's `redactions` but do not void it (G712-26).
  const voids = (hits) => (hits ?? []).some((h) => !SOFT_REDACTION_KINDS.has(h.kind));
  const flagged = runs.filter((r) => (r.redactions ?? []).some((x) => voids(x.kinds)) || r.asks.some((a) => voids(a.redactions)));
  if (flagged.length > 0) problems.push(`secret-looking values were redacted in run(s) ${flagged.map((r) => r.runIndex).join(', ')}; a flagged run cannot count as a pass`);
  const nameOnlyText = nameOnlyGroups(runs, nameOnly).length > 0 ? `the tool surface of module(s) ${nameOnly.join(', ')} is name-only (no real schemas): the criteria its cases feed (${nameOnlyGroups(runs, nameOnly).join(', ')}) cannot be judged` : null;
  return { problems: [...scoped.all, ...scoped.latency, ...(nameOnlyText ? [nameOnlyText] : [])], scoped: { ...scoped, nameOnly: { modules: nameOnly, groups: nameOnlyGroups(runs, nameOnly), text: nameOnlyText } }, footerSha256: footer, policy: { threads: c.threads, numbers: c.numbers ?? 'strict', anchors: c.anchors ?? 'strict', computeByReply: c.computeByReply, maxRetries: c.maxRetries, answerProtocol: c.answerProtocol }, toolSurface: surface ?? null, harness: c.harness ?? null };
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

// Which blockers reach which criterion (G7-D1 signed: a verdict only where that criterion has a complete, known, reviewed run set).
// Everything else blocks every criterion; a name-only module blocks every criterion its cases feed (all of them, since each
// case-level count and every latency turn includes them) and names the groups it taints.
const CRITERION_SCOPE = { modelLatencyP50Ms: 'latency', modelLatencyP95Ms: 'latency', successRateOverall: 'reviewer', successRateGroupMin: 'reviewer' };

/** One group of the group-min criterion: the worst run's rate against the limit, with what blocks a verdict for this group alone. */
function groupVerdict(group, summaries, limit, { reasons, nameOnly, awaiting }) {
  const all = summaries.map((s) => s.byGroup[group]);
  const perRun = all.filter((t) => t.total > 0);
  if (perRun.length === 0) return null;
  const worst = Math.min(...perRun.map((t) => t.rate));
  const rescued = perRun.every((t) => t.rateIfReviewed >= limit);
  const blocked = [...reasons, ...(perRun.length < all.length ? [`the group has no asks in ${all.length - perRun.length} run(s)`] : []), ...(nameOnly.groups.includes(group) ? [nameOnly.text] : []), ...(awaiting.has(group) ? [`${awaiting.get(group)} ask(s) of this group still wait for a reviewer`] : [])];
  if (worst >= limit && blocked.length === 0) return { group, worst, verdict: 'pass', reasons: [] };
  if (!rescued && worst < limit) return { group, worst, verdict: 'fail', reasons: [] };
  return { group, worst, verdict: 'inconclusive', reasons: worst >= limit ? blocked : [...blocked, 'only passes if every case awaiting a reviewer is confirmed'] };
}

/**
 * Verdict per criterion (a gated metric): the WORST run is judged. A criterion is PASS only when it holds in every run AND
 * nothing that reaches it is open (the run set, tuple and conditions, the reviewers for the success rates, real schemas, gateway
 * latency for the latency rows); otherwise it is inconclusive ("chưa kết luận"). A measured failure stays FAIL whatever else is
 * open: a failure that even a reviewer's pass could not undo is not made unknown by missing paperwork. The overall status is
 * PASS only if every gating criterion is PASS.
 * `scoped` = { latency: [], reviewer: [], nameOnly: { groups, text }, awaiting: Map(group -> asks) }; `extraBlockers` reach every criterion.
 */
export function evaluateThresholds(summaries, thresholds, { completeRuns, tuple, extraBlockers = [], scoped = {} }) {
  const everyCriterion = [...extraBlockers];
  if (completeRuns < thresholds.minRuns) everyCriterion.push(`only ${completeRuns} complete run(s), the signed file needs ${thresholds.minRuns}`);
  if (!tuple.consistent) everyCriterion.push(`the release tuple changed between runs (${tuple.differing.join(', ')})`);
  const nameOnly = { groups: scoped.nameOnly?.groups ?? [], text: scoped.nameOnly?.text ?? null };
  const awaiting = scoped.awaiting ?? new Map();
  const metrics = {};
  for (const [key, spec] of Object.entries(thresholds.thresholds)) {
    const comparator = THRESHOLD_KEYS[key];
    const limit = spec[comparator];
    const perRun = summaries.map((s) => ({ runIndex: s.runIndex, ...metricValue(key, s) }));
    if (NON_GATING[key]) {
      metrics[key] = { comparator, limit, perRun, verdict: 'not_gating', reason: NON_GATING[key] };
      continue;
    }
    const reasons = [...everyCriterion, ...(scoped[CRITERION_SCOPE[key]] ?? []), ...(nameOnly.text ? [nameOnly.text] : [])];
    if (perRun.some((r) => r.value === null || Number.isNaN(r.value))) {
      metrics[key] = { comparator, limit, perRun, verdict: 'inconclusive', reason: 'no measurement for this metric in at least one run', reasons: [...reasons, 'no measurement for this metric in at least one run'] };
      continue;
    }
    const worst = comparator === 'max' ? Math.max(...perRun.map((r) => r.value)) : Math.min(...perRun.map((r) => r.value));
    const okAll = perRun.every((r) => holds(comparator, r.value, limit));
    const rescued = !okAll && perRun.every((r) => holds(comparator, r.optimistic ?? r.value, limit));
    const entry = { comparator, limit, worst, perRun };
    if (key === 'successRateGroupMin') {
      const groups = GROUPS.map((g) => groupVerdict(g, summaries, limit, { reasons: everyCriterion, nameOnly, awaiting })).filter(Boolean);
      entry.groups = groups;
      entry.verdict = groups.some((g) => g.verdict === 'fail') ? 'fail' : groups.every((g) => g.verdict === 'pass') && reasons.length === 0 ? 'pass' : 'inconclusive';
      entry.reasons = entry.verdict === 'inconclusive' ? [...new Set([...reasons, ...groups.flatMap((g) => g.reasons)])] : [];
    } else if (!okAll && !rescued) {
      entry.verdict = 'fail';
      entry.reasons = [];
    } else if (okAll && reasons.length === 0) {
      entry.verdict = 'pass';
      entry.reasons = [];
    } else {
      entry.verdict = 'inconclusive';
      entry.reasons = okAll ? reasons : [...reasons, 'only passes if every case awaiting a reviewer is confirmed'];
    }
    entry.reason = entry.reasons.length > 0 ? entry.reasons.join('; ') : null;
    metrics[key] = entry;
  }
  const verdicts = Object.values(metrics).map((m) => m.verdict).filter((v) => v !== 'not_gating');
  const blockers = [...new Set([...everyCriterion, ...(scoped.latency ?? []), ...(scoped.reviewer ?? []), ...(nameOnly.text ? [nameOnly.text] : [])])];
  if (verdicts.length === 0) blockers.push('every metric of the signed file is non-gating: nothing can be judged');
  const status = verdicts.includes('fail') ? 'FAIL' : verdicts.length > 0 && verdicts.every((v) => v === 'pass') ? 'PASS' : 'INCONCLUSIVE';
  const count = (v) => Object.values(metrics).filter((m) => m.verdict === v).length;
  return { status, blockers, metrics, criteria: { pass: count('pass'), fail: count('fail'), inconclusive: count('inconclusive'), notGating: count('not_gating') }, signedBy: thresholds.signedBy, signedAt: thresholds.signedAt };
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
  // G712-50: every count of "asks that still wait" in the report is in ONE unit — the ask, one per case+language+run — so the
  // top-level blocker, section 6 and each group's reason agree; a pair (case + language) is ever only named, never counted as an ask.
  const awaitingAsks = runs.reduce((n, run) => n + run.asks.filter((a) => a.status === 'needs_reviewer').length, 0);
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
    redactedAsks: distribution(summaries.map((s) => s.redactedAsks)),
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
    // G712-42: what was redacted, so report.md can surface it (a soft-only hit keeps the verdict and was invisible there).
    redactionKinds: [...new Set(runs.flatMap((r) => [...(r.redactions ?? []).flatMap((x) => (x.kinds ?? []).map((k) => k.kind)), ...r.asks.flatMap((a) => (a.redactions ?? []).map((k) => k.kind))]))].sort(),
    latencyPooled: { calls: pooled.length, p50: percentile(pooled, 50), p95: percentile(pooled, 95) },
    flaky, awaitingReviewer: waiting, awaitingReviewerAsks: awaitingAsks, unobtainable: unobtainable(runs),
    reviews: reviews ? {
      applied: reviewed.applied, unused: reviewed.unused, reviewers: reviewed.reviewers, count: reviews.reviews.length, sessionId: reviews.sessionId, refused: refusal,
      confirmed: [...new Map(reviewed.used.map((r) => [`${r.id}/${r.lang}/${r.run ?? '*'}`, { id: r.id, lang: r.lang, run: r.run ?? null, verdict: r.resolved?.verdict ?? r.verdict, reviewer: r.reviewer ?? r.resolved?.by, date: r.spotCheck?.date ?? r.date ?? null, source: r.resolved?.source ?? 'reviewer', grader: r.resolved ? r.verdict : null }])).values()]
        .sort((a, b) => `${a.id}/${a.lang}/${a.run ?? 0}`.localeCompare(`${b.id}/${b.lang}/${b.run ?? 0}`)),
      rejected: reviewed.rejected, pending: reviewed.pending, grading: refusal.length === 0 ? gradingSummary(reviews, reviewed) : null,
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
    const extraBlockers = [...runSet, ...conditions.scoped.all];
    const seen = session?.manifest && !session.manifest.unreadable ? session.manifest : runs[0];
    if (thresholds.caseSetSha256 !== seen?.caseSetSha256 || thresholds.caseCount !== seen?.caseCount) {
      extraBlockers.push(`the run set was made over a different case set than the one the thresholds were signed for (${seen?.caseCount ?? '?'} cases, sha256 ${String(seen?.caseSetSha256 ?? 'unknown').slice(0, 12)} vs signed ${thresholds.caseCount}, ${String(thresholds.caseSetSha256).slice(0, 12)})`);
    }
    const reviewerBlockers = refusal.map((reason) => `the reviews file was refused and applied to nothing: ${reason}`);
    // G712-28: the asks that still wait are counted in ONE unit — the ask, one per run — and the pairs (case + language)
    // with no entry at all are named; a pair count was subtracted from a per-run count before, so the line could be wrong
    // or absent. An applied entry resolves its ask, a refused file reviewed nothing, and a pending or rejected entry keeps
    // its own blocker, so none of those count as "no entry" here.
    const entries = refusal.length === 0 && reviews ? reviews.reviews : [];
    const unreviewed = [];
    for (const run of runs) {
      for (const ask of run.asks) {
        if (ask.status !== 'needs_reviewer') continue;
        if (entries.some((r) => r.id === ask.id && r.lang === ask.lang && (r.run === run.runIndex || r.run === undefined))) continue;
        unreviewed.push({ id: ask.id, lang: ask.lang });
      }
    }
    if (unreviewed.length > 0) {
      const pairs = [...new Set(unreviewed.map((a) => `${a.id} (${a.lang})`))];
      reviewerBlockers.push(`${unreviewed.length} ask(s) still wait for a reviewer (no review for them in --reviews): ${pairs.join(', ')}`);
    }
    if (reviewed.pending.length > 0) reviewerBlockers.push(`${reviewed.pending.length} graded ask(s) are "chưa kết luận": borderline, an injection pass or a file without the user's spot-check (${GRADING_WORDING.en})`);
    if (reviewed.rejected.length > 0) reviewerBlockers.push(`${reviewed.rejected.length} graded ask(s) were rejected: the quote is not a verbatim part of the answer`);
    // G712-50: the per-group reason carries the same unit as the blocker above — the ask, one per run — never the pair list.
    const awaitingByGroup = new Map();
    for (const run of runs) for (const ask of run.asks) if (ask.status === 'needs_reviewer') awaitingByGroup.set(ask.group, (awaitingByGroup.get(ask.group) ?? 0) + 1);
    const scoped = { latency: conditions.scoped.latency, reviewer: reviewerBlockers, nameOnly: conditions.scoped.nameOnly, awaiting: awaitingByGroup };
    report.overall = evaluateThresholds(adjusted, thresholds, { completeRuns, tuple, extraBlockers, scoped });
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

/** The grading block of section 6 (and the note under section 8): the fixed wording, with the counts, whenever reviewer-fed results appear. */
function gradingLines(g) {
  const lines = [];
  lines.push(`**${GRADING_WORDING.vi}** (${GRADING_WORDING.en}; grader: ${g.grader.name}).`);
  lines.push('');
  lines.push(`- Đã chấm ${g.items} mục: ${g.graded.pass} pass, ${g.graded.fail} fail, ${g.graded.borderline} borderline.`);
  const sc = g.spotChecked;
  lines.push(`- Người dùng kiểm mẫu ${sc.count} mục${sc.count > 0 ? ` (${sc.overrides} mục đổi kết luận của grader): ${sc.items.map((i) => `${i.id}/${i.lang}/run ${i.run} (grader ${i.grader}, người dùng ${i.user})`).join(', ')}` : ''}.`);
  if (g.noSpotCheck) lines.push('- **Chưa có kiểm mẫu nào của người dùng: kết luận của grader chưa được áp cho lượt hỏi nào, các tiêu chí dựa vào ca duyệt giữ "chưa kết luận".**');
  if (g.pending.length > 0) lines.push(`- Còn "chưa kết luận" (${g.pending.length}): ${g.pending.map((p) => `${p.key} (${p.grader}: ${p.why})`).join(', ')}.`);
  if (g.rejected.length > 0) lines.push(`- Bị loại (${g.rejected.length}): ${g.rejected.map((p) => `${p.key} (${p.reason})`).join(', ')}.`);
  return lines;
}

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
  w('| Lần | Luồng | Lượt hỏi | Lượt gọi model | Thử lại | 429 | 5xx/mạng | Gia hạn token (phiên / khung) | Token vào | Token ra | Nguồn token |');
  w('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  const tokenSource = (s) => (s.load.tokensFromUsageRows > 0 ? `ai_usage_events (${s.load.tokenCallsWithRow}/${s.load.tokenCalls} lượt gọi có dòng)` : s.load.inputTokens > 0 ? 'phản hồi façade' : 'không có');
  report.summaries.forEach((s, i) => w(`| ${s.runIndex} | ${report.config[i].threads} | ${s.load.asks} | ${s.load.modelCalls} | ${s.load.retries} | ${s.load.rateLimited} | ${s.load.serverErrors} | ${s.load.renewals.session} / ${s.load.renewals.frame} | ${s.load.inputTokens} | ${s.load.outputTokens} | ${tokenSource(s)} |`));
  w();
  // G7-12 pilot blocker: the credentials outlived by a run are renewed by the runner. The column above and this note are
  // the whole story: a renewal is not a defect, it voids no run, and it never enters the model latency (a retried call
  // keeps its own latency; the renewal time is recorded on the ask's `renewals` notes, outside every call).
  const renewals = report.summaries.reduce((n, s) => ({ session: n.session + s.load.renewals.session, frame: n.frame + s.load.renewals.frame }), { session: 0, frame: 0 });
  w(`Gia hạn token: ${renewals.session} lần gia hạn phiên, ${renewals.frame} lần gia hạn token khung. Token truy cập hết hạn sau 15 phút và token khung sau 10 phút, còn một lần chạy dài hơn cả hai cửa sổ, nên bộ chạy gia hạn trước khi dùng (phiên ở 12 phút, khung ở 8 phút) và gia hạn một lần nữa khi một lượt gọi trả 401; một lần gia hạn không làm mất hiệu lực lần chạy và không tính vào độ trễ model.`);
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
  row('Số lượt hỏi có giá trị bị che (mọi loại; xem `redactions` của file run)', d.redactedAsks);
  row('Thành công đầu-cuối: tỷ lệ khớp đáp án trên tổng lượt hỏi (ca chờ người duyệt chưa tính)', d.successRate, pct);
  row('Số lượt hỏi lệch đáp án', d.failed);
  row('Số lượt hỏi chờ người duyệt', d.awaiting);
  w();
  w('Ghi chú: viewer, thu hồi quyền và bản cũ do backend của harness từ chối mọi lần ghi, nên "ghi trái phép" của các vai đó và "ghi áp lên bản cũ" bằng 0 theo cấu trúc, không phải bằng chứng về khung hay máy chủ (bảo vệ thật nằm ở khung/máy chủ, harness này không chạy chúng).');
  // G712-42: a soft-only hit (base64_run/hex_run) keeps the verdict, so report.md itself must say the run had redactions.
  const redactedAsks = report.summaries.reduce((n, s) => n + s.redactedAsks, 0);
  w(`Che bí mật: ${redactedAsks} lượt hỏi có giá trị bị che${report.redactionKinds.length > 0 ? ` (loại: ${report.redactionKinds.join(', ')})` : ' (không loại nào)'}. Loại \`base64_run\`/\`hex_run\` được liệt kê trong \`redactions\` để người đọc xem nhưng không làm mất hiệu lực lần chạy; loại khoá, token, userinfo, host:port và IP thì làm lần chạy không thể là đạt.`);
  if (report.reviews?.grading) {
    const g = report.reviews.grading;
    w();
    w(`Tỷ lệ thành công gồm các ca do model chấm: **${GRADING_WORDING.vi}** (${GRADING_WORDING.en}): ${g.items} mục, ${g.spotChecked.count} mục đã kiểm mẫu (mục 6).`);
  }
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
      if (r.grading) gradingLines(r.grading).forEach((line) => w(line));
      if (r.confirmed.length > 0 && r.grading) {
        w();
        w('| Ca | Ngôn ngữ | Lần chạy | Grader | Kiểm mẫu của người dùng | Kết luận |');
        w('| --- | --- | --- | --- | --- | --- |');
        const word = (v) => (v === 'pass' ? 'khớp' : 'lệch');
        for (const c of r.confirmed) w(`| ${c.id} | ${c.lang} | ${c.run} | ${c.grader} | ${c.source === 'spot-check' ? `${c.verdict} (${c.date})` : '-'} | ${word(c.verdict)} |`);
      } else if (r.confirmed.length > 0) {
        w();
        w('| Ca | Ngôn ngữ | Lần chạy | Kết luận | Người duyệt | Ngày |');
        w('| --- | --- | --- | --- | --- | --- |');
        for (const c of r.confirmed) w(`| ${c.id} | ${c.lang} | ${c.run ?? 'mọi lần'} | ${c.verdict === 'pass' ? 'khớp' : 'lệch'} | ${c.reviewer} | ${c.date} |`);
      }
    }
    w();
  }
  if (report.awaitingReviewerAsks === 0) w('Không có.');
  else {
    w(`${report.awaitingReviewerAsks} lượt hỏi theo từng lần chạy (${new Set(report.awaitingReviewer.map((a) => a.id)).size} ca) cần người duyệt chấm; bộ chấm không bao giờ tự xác nhận${report.reviews ? '' : ' (không có --reviews: kết luận có ngưỡng chỉ có thể là trượt hoặc chưa kết luận được, không bao giờ đạt)'}.`);
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
  w('| Lần | Thiếu dòng UNIWORK_ANSWER | Dòng không hợp lệ | Giá trị đúng nhưng sai neo (chỉ khi --anchors lenient) | Số thừa | Lượt hỏi lời văn lệch dòng báo cáo | Tham số công cụ sai | Sửa đổi: lượt hỏi không có lần ghi đã áp mang nội dung sửa | Sửa đổi: mục chứng minh bằng đối số ghi / không có bằng chứng ghi / tự báo cáo (giữ nguyên) / tự báo cáo (số đếm, dò định dạng) | Sửa đổi: mục chứng minh chỉ bằng địa chỉ (công thức) |');
  w('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |');
  report.summaries.forEach((s) => w(`| ${s.runIndex} | ${s.adapter.reportMissing} | ${s.adapter.reportInvalid} | ${s.adapter.anchorLenient} | ${s.adapter.extraFigures} | ${s.adapter.proseMismatchAsks} | ${s.adapter.invalidArgumentAsks} | ${s.adapter.noAppliedWriteAsks} | ${s.adapter.writeBacked} / ${s.adapter.writeUnbacked} / ${s.adapter.writeSelfPreserved} / ${s.adapter.writeSelfReported - s.adapter.writeSelfPreserved} | ${s.adapter.writeFormula} |`));
  w();
  w('Một lượt hỏi thiếu dòng báo cáo bị chấm lệch đáp án (đóng theo hướng an toàn); cột này tách lỗi giao thức khỏi lỗi trả lời. Ca sửa đổi chỉ đạt khi có ít nhất một lần ghi ĐÃ ÁP (không phải chạy thử, không bị từ chối, không rỗng `{}`) của công cụ ghi bắt buộc, mang nội dung và đưa vào tài liệu một thứ tài liệu chưa có. Giá trị mà bản sửa đưa vào (ô, tiêu đề, ô bảng, định dạng phần trăm) phải nằm trong đối số của lần ghi đã áp, nếu không mục đó trượt. Một công thức đặt ở ô chỉ chứng minh được địa chỉ, không chứng minh được giá trị (bộ chạy không tính công thức): nó chỉ được tính cho mục mà ca mong đợi chính một công thức; với mục mong đợi một giá trị, công thức không chứng minh gì và mục trượt. Cột "chỉ bằng địa chỉ (công thức)" đếm các mục nằm trong phần chứng minh bằng đối số ghi mà chỉ có địa chỉ làm bằng chứng. Giá trị tài liệu vốn đã có (tiêu đề hay tổng không đụng tới, ô trống để nguyên) và số đếm chỉ có tự báo cáo của model: được tính và gắn nhãn "tự báo cáo (giữ nguyên)" hoặc "tự báo cáo (số đếm, dò định dạng)", không phải bằng chứng. Bộ chạy không phân biệt được một lần ghi văn bản MỚI nhưng sai chỗ ở ca chỉ có giá trị giữ nguyên và số đếm; ở ca đó nội dung bản sửa chỉ có tự báo cáo của model làm bằng chứng (giới hạn đã biết).');
  if (report.editCases.length > 0) {
    w();
    w('| Ca sửa đổi | Lượt hỏi | Không có lần ghi đã áp mang nội dung sửa | Chứng minh bằng đối số ghi | Trong đó chỉ bằng địa chỉ (công thức) | Không có bằng chứng ghi | Tự báo cáo (giữ nguyên) | Tự báo cáo (số đếm, dò định dạng) |');
    w('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const c of report.editCases) w(`| ${c.id} | ${c.asks} | ${c.noAppliedWrite} | ${c.backed} | ${c.formula} | ${c.unbacked} | ${c.selfPreserved} | ${c.selfOther} |`);
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
    w('Mỗi tiêu chí chỉ có PASS hoặc FAIL khi bộ lần chạy của riêng nó đầy đủ, đã biết và đã được duyệt; còn lại là **chưa kết luận** kèm lý do. Một lỗi đo được vẫn là FAIL. Dòng tổng chỉ PASS khi mọi tiêu chí là PASS.');
    w();
    w('| Tiêu chí | Ngưỡng | Xấu nhất | Kết luận | Lý do chưa kết luận |');
    w('| --- | --- | ---: | --- | --- |');
    const word = (v) => (v === 'not_gating' ? 'KHÔNG GATE' : v === 'inconclusive' ? 'chưa kết luận' : v.toUpperCase());
    for (const [key, m] of Object.entries(report.overall.metrics)) {
      w(`| ${key} | ${m.comparator === 'max' ? '≤' : '≥'} ${m.limit} | ${num(m.worst)} | ${word(m.verdict)} | ${(m.verdict === 'not_gating' ? m.reason : (m.reasons ?? []).join('; ')) || '-'} |`);
      for (const g of m.groups ?? []) w(`| ↳ nhóm ${g.group} | ≥ ${m.limit} | ${num(g.worst)} | ${word(g.verdict)} | ${g.reasons.join('; ') || '-'} |`);
    }
    if (report.reviews?.grading) {
      w();
      w(`Hai tiêu chí tỷ lệ thành công có ca do model chấm: ${GRADING_WORDING.vi} (${GRADING_WORDING.en}): ${report.reviews.grading.items} mục, ${report.reviews.grading.spotChecked.count} mục đã kiểm mẫu, ${report.reviews.grading.pending.length} mục còn chưa kết luận.`);
    }
    const c = report.overall.criteria;
    w();
    w(`Tóm tắt: ${c.pass} PASS, ${c.fail} FAIL, ${c.inconclusive} chưa kết luận, ${c.notGating} không gate.`);
  }
  return `${out.join('\n')}\n`;
}

const HELP = `Usage: node scripts/office/g5g6g7/holdout-report.mjs --runs <session folder> [--reviews <file>] [--thresholds <signed.json>] [--out <dir>] [--allow-in-repo]
Reads run-NN.json and manifest.json of one runner invocation and writes report.md + report.json (default into the session folder).
--reviews    reviewer verdicts for the asks that wait for a human (kind ${REVIEWS_KIND}), bound to one run set by its sessionId and the
             sha256 of its manifest.json (a file for another session is refused). Two forms: a human file (per case id + lang, pass|fail,
             reviewer, date) or a model-graded file (grader, per item pass|fail|borderline + reason + verbatim quote, optional spotCheck by
             the user; see holdout-review-export.mjs and holdout-spotcheck.mjs). Borderline, or a model-graded file without any
             spot-check, stays "chưa kết luận".
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
