#!/usr/bin/env node
// G7-12 holdout report (UNI-1384): reads the run-NN.json files of holdout-run.mjs and prints the distribution of every
// spec §9.2 metric (min / median / max over the runs), per group and per format, the model-call latency per run and
// pooled, the flaky cases and the cases that wait for a reviewer.
//
//   node scripts/office/g5g6g7/holdout-report.mjs --runs <dir> [--thresholds <signed.json>] [--out <dir>]
//
// Without --thresholds the overall status is ALWAYS "chưa có ngưỡng" (no threshold): the numbers are shown, no metric
// gets a verdict and the words PASS/FAIL do not appear (G7-D1 decision D5). A verdict exists only with a signed
// thresholds file, and then the rule is "every run must pass" (the worst run decides, never the best); a missing run, a
// partial or blocked run, a reviewer case that is still open or a run tuple that changed between runs is INCONCLUSIVE,
// never PASS.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RUN_KIND } from './holdout-run.mjs';

export const THRESHOLDS_KIND = 'uniwork-office-g7-holdout-thresholds';
export const NO_THRESHOLD = 'chưa có ngưỡng (no threshold)';
export const GROUPS = ['xlsx', 'docx', 'other', 'cross'];
export const FORMATS = ['xlsx', 'docx', 'pptx', 'pdf', 'md', 'html', 'cross'];
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
    latency: {
      calls: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), min: sorted[0] ?? null, max: sorted.at(-1) ?? null,
      source: lat.source, failedCalls: lat.failedCalls,
    },
    load: {
      asks: run.asks.length, modelCalls: sum((a) => a.calls.length), modelTurns: sum((a) => a.modelTurns), retries: sum((a) => a.counts.retries),
      rateLimited: sum((a) => a.counts.rateLimited), serverErrors: sum((a) => a.counts.serverErrors), remounts: sum((a) => a.counts.remounts),
      inputTokens: sum((a) => a.tokens?.input ?? 0), outputTokens: sum((a) => a.tokens?.output ?? 0),
      tokensFromUsageRows: run.asks.filter((a) => a.tokens?.source === 'ai_usage_events').length,
      toolCalls: sum((a) => a.toolCalls.length), writes: sum((a) => a.writes),
    },
    adapter: {
      reportMissing: run.asks.filter((a) => a.adapter?.reportStatus === 'missing').length,
      reportInvalid: run.asks.filter((a) => a.adapter?.reportStatus === 'invalid').length,
      anchorLenient: sum((a) => a.adapter?.anchorLenient ?? 0),
      extraFigures: sum((a) => a.adapter?.extraFigures ?? 0),
    },
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

const TUPLE_FIELDS = ['dSha', 'dirty', 'framePin', 'promptIds', 'providers', 'resolvedModels', 'redis'];
export function tupleConsistency(runs) {
  const differing = TUPLE_FIELDS.filter((f) => new Set(runs.map((r) => JSON.stringify(r.tuple?.[f] ?? null))).size > 1);
  return { consistent: differing.length === 0, differing };
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
  if (!Number.isInteger(doc.minRuns) || doc.minRuns < 1) problems.push('minRuns must be an integer >= 1');
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
      return { value: Math.min(...groups.map((t) => t.rate)), optimistic: Math.min(...groups.map((t) => t.rateIfReviewed)) };
    }
    case 'modelLatencyP50Ms': return { value: s.latency.p50 };
    case 'modelLatencyP95Ms': return { value: s.latency.p95 };
    default: return { value: null };
  }
}

const holds = (comparator, value, limit) => (comparator === 'max' ? value <= limit : value >= limit);

/** Verdict per gated metric: the WORST run is judged; a rate that only a reviewer case can rescue is "inconclusive". */
export function evaluateThresholds(summaries, thresholds, { completeRuns, tuple }) {
  const metrics = {};
  for (const [key, spec] of Object.entries(thresholds.thresholds)) {
    const comparator = THRESHOLD_KEYS[key];
    const limit = spec[comparator];
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
  const blockers = [];
  if (completeRuns < thresholds.minRuns) blockers.push(`only ${completeRuns} complete run(s), the signed file needs ${thresholds.minRuns}`);
  if (!tuple.consistent) blockers.push(`the release tuple changed between runs (${tuple.differing.join(', ')})`);
  const verdicts = Object.values(metrics).map((m) => m.verdict);
  const status = verdicts.includes('fail') ? 'FAIL' : blockers.length > 0 || verdicts.includes('inconclusive') ? 'INCONCLUSIVE' : 'PASS';
  return { status, blockers, metrics, signedBy: thresholds.signedBy, signedAt: thresholds.signedAt };
}

// ---- report ----

export function buildReport(runs, { thresholds = null } = {}) {
  const flaky = findFlaky(runs);
  const flakyKeys = new Set(flaky.map(askKey));
  const summaries = runs.map((r) => summarizeRun(r));
  const completeRuns = runs.filter((r) => r.status === 'completed' && !r.partial && r.asks.length === r.config.casesRead * r.config.langs.length).length;
  const tuple = tupleConsistency(runs);
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
    latencyP50: distribution(summaries.map((s) => s.latency.p50)),
    latencyP95: distribution(summaries.map((s) => s.latency.p95)),
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, distribution(summaries.map((s) => s.byGroup[g].rate))])),
    byFormat: Object.fromEntries(FORMATS.map((f) => [f, distribution(summaries.map((s) => s.byFormat[f].rate))])),
  };
  const pooled = runs.flatMap((r) => callLatencies(r).values).sort((a, b) => a - b);
  const report = {
    kind: 'uniwork-office-g7-holdout-report', schemaVersion: 1, runs: runs.length, completeRuns, tuple, tuples: runs.map((r) => r.tuple),
    config: runs.map((r) => r.config), summaries, distribution: dist,
    latencyPooled: { calls: pooled.length, p50: percentile(pooled, 50), p95: percentile(pooled, 95) },
    flaky, awaitingReviewer: awaitingReviewer(runs), unobtainable: unobtainable(runs),
    notMeasured: ['silent overwrite', 'lost acknowledged draft'],
  };
  if (thresholds) {
    const adjusted = runs.map((r) => summarizeRun(r, flakyKeys));
    report.overall = evaluateThresholds(adjusted, thresholds, { completeRuns, tuple });
    report.flakyCountedAsFailed = flaky.length;
  } else {
    report.overall = { status: 'no_threshold', label: NO_THRESHOLD };
  }
  return report;
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
  w('# Báo cáo holdout AI G7-12 (UNI-1384)');
  w();
  if (!gated) w(`> **Trạng thái tổng: ${NO_THRESHOLD}.** Các số dưới đây là số đo, không phải kết luận: chưa có tệp ngưỡng đã ký (G7-D1), nên không chỉ số nào có nhãn đạt hay trượt.`);
  else w(`> **Trạng thái tổng: ${report.overall.status}** theo tệp ngưỡng đã ký bởi ${report.overall.signedBy} (${report.overall.signedAt}); lần chạy xấu nhất quyết định, không bao giờ lần đẹp nhất.`);
  w();
  w(`${report.runs} lần chạy, ${report.completeRuns} lần đủ bộ ca. Mỗi ô "min / trung vị / max" là phân bố trên các lần chạy; không chọn lần chạy nào.`);
  if (report.completeRuns < report.runs) w('**Có lần chạy chưa đủ bộ ca (một phần, bị chặn hoặc dừng giữa chừng): số đo của lần đó chỉ để tham khảo.**');
  w();
  w('## 1. Release tuple');
  w();
  w(`Nhất quán giữa các lần chạy: ${report.tuple.consistent ? 'có' : `KHÔNG (${report.tuple.differing.join(', ')})`}.`);
  w();
  w('| Lần | SHA D | Ghim khung | prompt_id | Nhà cung cấp | Model đã phân giải | Redis |');
  w('| ---: | --- | --- | --- | --- | --- | --- |');
  report.tuples.forEach((t, i) => w(`| ${i + 1} | ${t.dSha.slice(0, 12)}${t.dirty ? ' (cây làm việc có thay đổi)' : ''} | ${t.framePin} | ${t.promptIds.join(', ')} | ${t.providers.join(', ')} | ${t.resolvedModels.join(', ') || 'unknown'} | ${t.redis} |`));
  w();
  w('## 2. Tải của lần chạy');
  w();
  w('| Lần | Luồng | Lượt hỏi | Lượt gọi model | Thử lại | 429 | 5xx/mạng | Token vào | Token ra | Nguồn token |');
  w('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  report.summaries.forEach((s, i) => w(`| ${s.runIndex} | ${report.config[i].threads} | ${s.load.asks} | ${s.load.modelCalls} | ${s.load.retries} | ${s.load.rateLimited} | ${s.load.serverErrors} | ${s.load.inputTokens} | ${s.load.outputTokens} | ${s.load.tokensFromUsageRows > 0 ? 'ai_usage_events' : s.load.inputTokens > 0 ? 'phản hồi façade' : 'không có'} |`));
  w();
  w('## 3. Chỉ số §9.2 (min / trung vị / max trên các lần chạy)');
  w();
  w('| Chỉ số | Mỗi lần chạy | min / trung vị / max |');
  w('| --- | --- | --- |');
  const row = (label, dist, fmt = num) => w(`| ${label} | ${dist.values.map(fmt).join('; ')} | ${triple(dist, fmt)} |`);
  row('Lượt hỏi gọi công cụ ngoài allowlist hoặc bịa công cụ (số lượt hỏi)', d.outsideAllowlistAsks);
  row('Số/công thức: tỷ lệ khớp đáp án (ca có đáp án số)', d.numericRate, pct);
  row('Ghi trái phép (ghi vượt trần của ca, số lượt hỏi)', d.unauthorizedWrites);
  row('Lộ marker cấm hoặc không kiểm chứng được (số lượt hỏi)', d.leaks);
  row('Ghi áp lên bản cũ (ca stale có ghi, số lượt hỏi)', d.staleApplied);
  row('Thành công đầu-cuối: tỷ lệ khớp đáp án trên tổng lượt hỏi (ca chờ người duyệt chưa tính)', d.successRate, pct);
  row('Số lượt hỏi lệch đáp án', d.failed);
  row('Số lượt hỏi chờ người duyệt', d.awaiting);
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
  w('Chỉ tính lượt gọi thành công; ưu tiên `latency_ms` mà cổng AI ghi (chỉ thời gian chờ upstream), nếu không có thì thời gian phía client. Lỗi 429/5xx đếm riêng ở mục 2.');
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
  if (report.awaitingReviewer.length === 0) w('Không có.');
  else {
    w(`${report.awaitingReviewer.length} lượt hỏi (${new Set(report.awaitingReviewer.map((a) => a.id)).size} ca) cần người duyệt chấm; bộ chấm không bao giờ tự xác nhận.`);
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
  w('| Lần | Thiếu dòng UNIWORK_ANSWER | Dòng không hợp lệ | Giá trị khớp nhưng sai anchor | Số thừa |');
  w('| ---: | ---: | ---: | ---: | ---: |');
  report.summaries.forEach((s) => w(`| ${s.runIndex} | ${s.adapter.reportMissing} | ${s.adapter.reportInvalid} | ${s.adapter.anchorLenient} | ${s.adapter.extraFigures} |`));
  w();
  w('Một lượt hỏi thiếu dòng báo cáo bị chấm lệch đáp án (đóng theo hướng an toàn); cột này tách lỗi giao thức khỏi lỗi trả lời.');
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
    for (const [key, m] of Object.entries(report.overall.metrics)) w(`| ${key} | ${m.comparator === 'max' ? '≤' : '≥'} ${m.limit} | ${num(m.worst)} | ${m.verdict.toUpperCase()}${m.reason ? ` (${m.reason})` : ''} |`);
  }
  return `${out.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runs') args.runs = path.resolve(argv[++i]);
    else if (argv[i] === '--thresholds') args.thresholds = path.resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.runs) throw new Error('usage: holdout-report.mjs --runs <dir> [--thresholds <signed.json>] [--out <dir>]');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = loadRuns(args.runs);
  const thresholds = args.thresholds ? parseThresholds(JSON.parse(fs.readFileSync(args.thresholds, 'utf8'))) : null;
  const report = buildReport(runs, { thresholds });
  const outDir = args.out ?? args.runs;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const md = renderReport(report);
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  process.stdout.write(md);
  process.exitCode = report.overall.status === 'FAIL' ? 1 : report.overall.status === 'INCONCLUSIVE' ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err?.message ?? err}\n`);
    process.exit(1);
  }
}
