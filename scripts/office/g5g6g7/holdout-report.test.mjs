// Tests of the G7-12 holdout report (UNI-1384): distributions per metric, groups, formats and latency, flaky and
// reviewer cases, and the rule that nothing is a PASS or FAIL without a signed thresholds file. The runs are synthetic
// documents built here; no holdout case text is involved.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GROUPS, NO_THRESHOLD, THRESHOLDS_KIND, awaitingReviewer, buildReport, callLatencies, distribution, evaluateThresholds, findFlaky,
  loadRuns, parseThresholds, percentile, renderReport, summarizeRun, tupleConsistency,
} from './holdout-report.mjs';
import { RUN_KIND } from './holdout-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g712-report-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const TUPLE = { dSha: 'a'.repeat(40), dirty: false, dShaSource: 'checkout HEAD', framePin: '0.1.0-test', promptIds: ['office_uniwork_ai@test'], providers: ['fake'], resolvedModels: ['model-x'], redis: 'on' };

function ask(over = {}) {
  return {
    id: 'HO-T-001', lang: 'vi', format: 'xlsx', group: 'xlsx', category: 'compute', oracleType: 'deterministic',
    expects: { numeric: 1, writes: 0, mustNotContain: 0 }, status: 'pass', errored: false, checks: [{ id: 'numeric:a', status: 'pass', detail: '' }],
    writes: 0, outsideAllowlist: [], calls: [{ step: 0, attempt: 0, status: 200, clientMs: 200, usage: { latencyMs: 100 } }], toolCalls: [], modelTurns: 1,
    counts: { rateLimited: 0, serverErrors: 0, retries: 0, remounts: 0 }, tokens: { input: 10, output: 2, source: 'ai_usage_events' },
    adapter: { reportStatus: 'ok', anchorLenient: 0, extraFigures: 0 }, wallMs: 10, ...over,
  };
}

// 20 asks: ids T-01..T-10, each in vi and en; xlsx 8, docx 4, other 4, cross 4.
const SPEC = [['xlsx', 'xlsx', 4], ['docx', 'docx', 2], ['pptx', 'other', 1], ['md', 'other', 1], ['cross', 'cross', 2]];
function suite(over = (a) => a) {
  let n = 0;
  return SPEC.flatMap(([format, group, count]) => Array.from({ length: count }, () => {
    n += 1;
    return ['vi', 'en'].map((lang) => over(ask({ id: `HO-T-${String(n).padStart(2, '0')}`, lang, format, group })));
  }).flat());
}

function run(index, asks = suite(), over = {}) {
  return { schemaVersion: 1, kind: RUN_KIND, runIndex: index, runsPlanned: 3, status: 'completed', reason: null, partial: false, startedAt: 't', finishedAt: 't',
    tuple: TUPLE, config: { threads: 2, casesRead: asks.length / 2, langs: ['vi', 'en'] }, asks, ...over };
}

const failing = (ids, patch = {}) => (a) => (ids.includes(`${a.id}/${a.lang}`) ? { ...a, status: 'fail', checks: [{ id: 'numeric:a', status: 'fail', detail: 'x' }], ...patch } : a);
const signed = (thresholds, over = {}) => parseThresholds({ schemaVersion: 1, kind: THRESHOLDS_KIND, decision: 'G7-D1', signedBy: 'QA + Product + OPS', signedAt: '2026-10-20T00:00:00Z', aggregation: 'every_run', minRuns: 3, thresholds, ...over });

describe('measures', () => {
  it('computes nearest-rank percentiles', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(ten, 50), 5);
    assert.equal(percentile(ten, 95), 10);
    assert.equal(percentile([7], 95), 7);
    assert.equal(percentile([], 50), null);
  });

  it('takes the latency from the server row when there is one, the client time when not, and counts failed calls apart', () => {
    const calls = [
      { status: 200, clientMs: 900, usage: { latencyMs: 100 } }, { status: 200, clientMs: 200 }, { status: 429, clientMs: 5 }, { status: 200, clientMs: 300, usage: { latencyMs: null } },
    ];
    const lat = callLatencies(run(1, [ask({ calls })]));
    assert.deepEqual(lat.values, [100, 200, 300]);
    assert.deepEqual(lat.source, { server: 1, client: 2 });
    assert.equal(lat.failedCalls, 1);
  });

  it('gives min, median and max of a metric over the runs', () => {
    const d = distribution([1, 0.75, 0.875]);
    assert.deepEqual([d.min, d.median, d.max], [0.75, 0.875, 1]);
    assert.equal(distribution([2, 4]).median, 3);
    assert.equal(distribution([null, null]).min, null);
  });

  it('tallies groups and formats and keeps a reviewer case out of the pass count', () => {
    const asks = suite((a) => (a.group === 'docx' ? { ...a, status: 'needs_reviewer' } : a.id === 'HO-T-01' ? { ...a, status: 'fail' } : a));
    const s = summarizeRun(run(1, asks));
    assert.deepEqual([s.overall.total, s.overall.passed, s.overall.failed, s.overall.awaiting], [20, 14, 2, 4]);
    assert.equal(s.overall.rate, 0.7);
    assert.equal(s.overall.rateIfReviewed, 0.9);
    assert.deepEqual(GROUPS.map((g) => s.byGroup[g].total), [8, 4, 4, 4]);
    assert.equal(s.byGroup.docx.awaiting, 4);
    assert.equal(s.byFormat.pptx.total, 2);
    assert.equal(s.byFormat.md.total, 2);
  });

  it('measures the safety counts fail-closed: an error or an unreadable reply never counts as clean', () => {
    const asks = suite((a) => {
      if (a.id === 'HO-T-01') return { ...a, outsideAllowlist: ['web_search', 'x'] };
      if (a.id === 'HO-T-02') return { ...a, expects: { numeric: 1, writes: 1, mustNotContain: 0 }, writes: 2 };
      if (a.id === 'HO-T-03') return { ...a, category: 'stale', writes: 1, expects: { numeric: 0, writes: 1, mustNotContain: 0 } };
      if (a.id === 'HO-T-04') return { ...a, expects: { numeric: 0, writes: 0, mustNotContain: 1 }, checks: [{ id: 'must_not_contain:m', status: 'fail', detail: '' }] };
      if (a.id === 'HO-T-05') return { ...a, expects: { numeric: 0, writes: 0, mustNotContain: 1 }, errored: true, status: 'fail', checks: [{ id: 'answer_shape', status: 'fail', detail: '' }] };
      if (a.id === 'HO-T-06') return { ...a, expects: { numeric: 0, writes: 0, mustNotContain: 1 }, checks: [{ id: 'text_reported', status: 'fail', detail: '' }], status: 'fail' };
      if (a.id === 'HO-T-07') return { ...a, expects: { numeric: 0, writes: 0, mustNotContain: 1 } };
      if (a.id === 'HO-T-08') return { ...a, errored: true, status: 'fail', checks: [{ id: 'answer_shape', status: 'fail', detail: '' }] };
      return a;
    });
    const s = summarizeRun(run(1, asks));
    assert.deepEqual([s.outsideAllowlist.asks, s.outsideAllowlist.occurrences], [2, 4]);
    assert.equal(s.unauthorizedWrites, 2, 'one case, two languages');
    assert.equal(s.staleApplied, 2);
    assert.equal(s.leaks.checked, 8);
    assert.equal(s.leaks.asks, 6, 'a leak, an error and an unreadable reply, each in two languages');
    assert.equal(s.leaks.unverified, 4);
    assert.equal(s.numeric.asks, 10, 'asks of the cases that expect a number');
    assert.equal(s.numeric.passed, 8, 'an errored ask never counts as numerically right');
  });

  it('pools the latency of every run', () => {
    const slow = (ms) => (a) => ({ ...a, calls: [{ status: 200, clientMs: ms, usage: { latencyMs: ms } }] });
    const runs = [run(1, suite(slow(100))), run(2, suite(slow(200))), run(3, suite(slow(300)))];
    const report = buildReport(runs);
    assert.deepEqual(report.summaries.map((s) => s.latency.p50), [100, 200, 300]);
    assert.equal(report.latencyPooled.calls, 60);
    assert.equal(report.latencyPooled.p50, 200);
    assert.equal(report.latencyPooled.p95, 300);
    assert.deepEqual([report.distribution.latencyP95.min, report.distribution.latencyP95.max], [100, 300]);
  });
});

describe('stability', () => {
  it('lists an ask that passed in one run and failed in another, and nothing else', () => {
    const runs = [
      run(1, suite((a) => (a.id === 'HO-T-01' && a.lang === 'vi' ? a : a.id === 'HO-T-02' ? { ...a, status: 'fail' } : a.id === 'HO-T-03' ? { ...a, status: 'needs_reviewer' } : a))),
      run(2, suite((a) => (a.id === 'HO-T-01' && a.lang === 'vi' ? { ...a, status: 'fail' } : a.id === 'HO-T-02' ? { ...a, status: 'fail' } : a))),
    ];
    const flaky = findFlaky(runs);
    assert.deepEqual(flaky.map((f) => `${f.id}/${f.lang}`), ['HO-T-01/vi']);
    assert.deepEqual(flaky[0].statuses, ['pass', 'fail']);
  });

  it('lists the reviewer cases once', () => {
    const runs = [1, 2].map((i) => run(i, suite((a) => (a.id === 'HO-T-09' ? { ...a, status: 'needs_reviewer' } : a))));
    assert.deepEqual(awaitingReviewer(runs).map((a) => `${a.id}/${a.lang}`), ['HO-T-09/en', 'HO-T-09/vi']);
  });

  it('reports a release tuple that changed between runs', () => {
    assert.equal(tupleConsistency([run(1), run(2)]).consistent, true);
    const other = run(2, suite(), { tuple: { ...TUPLE, resolvedModels: ['model-y'], redis: 'off' } });
    const t = tupleConsistency([run(1), other]);
    assert.equal(t.consistent, false);
    assert.deepEqual(t.differing, ['resolvedModels', 'redis']);
  });
});

describe('without a signed thresholds file', () => {
  const verdictWord = /\b(PASS|FAIL|INCONCLUSIVE)\b/;
  const scenarios = {
    'every ask matches': [run(1), run(2), run(3)],
    'a run is blocked': [run(1), run(2, [], { status: 'blocked', reason: 'no upstream' }), run(3)],
    'a run is partial': [run(1), run(2, suite().slice(0, 4), { partial: true }), run(3)],
    'half the asks fail': [run(1, suite(failing(suite().slice(0, 10).map((a) => `${a.id}/${a.lang}`))))],
  };
  for (const [name, runs] of Object.entries(scenarios)) {
    it(`says "no threshold" and carries no verdict word (${name})`, () => {
      const report = buildReport(runs);
      assert.deepEqual(report.overall, { status: 'no_threshold', label: NO_THRESHOLD });
      const md = renderReport(report);
      assert.ok(md.includes(NO_THRESHOLD));
      assert.doesNotMatch(md, verdictWord);
      assert.doesNotMatch(JSON.stringify(report), verdictWord);
      assert.ok(!('metrics' in report.overall));
    });
  }

  it('marks an incomplete run and still shows its numbers', () => {
    const report = buildReport(scenarios['a run is partial']);
    assert.equal(report.completeRuns, 2);
    assert.match(renderReport(report), /chưa đủ bộ ca/);
  });

  it('prints min / median / max and the per-run values of the section 9.2 rows', () => {
    const runs = [run(1), run(2, suite(failing(['HO-T-01/vi']))), run(3, suite(failing(['HO-T-01/vi', 'HO-T-02/vi'])))];
    const md = renderReport(buildReport(runs));
    assert.match(md, /\| 100\.0%; 95\.0%; 90\.0% \| 90\.0% \/ 95\.0% \/ 100\.0% \|/);
    assert.match(md, /Ca không ổn định/);
    assert.match(md, /HO-T-01 \(vi\)/);
  });
});

describe('thresholds file', () => {
  it('accepts a signed file and nothing looser', () => {
    assert.equal(signed({ leaks: { max: 0 }, successRateOverall: { min: 0.95 } }).minRuns, 3);
    assert.throws(() => signed({ leaks: { max: 0 } }, { signedBy: '' }), /signedBy is required/);
    assert.throws(() => signed({ leaks: { max: 0 } }, { signedAt: undefined }), /signedAt is required/);
    assert.throws(() => signed({ leaks: { max: 0 } }, { decision: 'G7-D2' }), /G7-D1/);
    assert.throws(() => signed({ leaks: { max: 0 } }, { aggregation: 'best_run' }), /every_run/);
    assert.throws(() => signed({ leaks: { max: 0 } }, { kind: 'other' }), /kind must be/);
    assert.throws(() => signed({ leaks: { max: 0 } }, { minRuns: 0 }), /minRuns/);
    assert.throws(() => signed({ nonsense: { max: 1 } }), /unknown threshold nonsense/);
    assert.throws(() => signed({ leaks: { min: 0 } }), /exactly \{ "max"/);
    assert.throws(() => signed({ successRateOverall: { min: 0.9, max: 1 } }), /exactly \{ "min"/);
    assert.throws(() => signed({}), /at least one metric/);
    assert.throws(() => parseThresholds(null), /not an object/);
  });

  it('ships no thresholds file: the numbers of the G7-D1 draft are proposals until the user signs', () => {
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); } else if (entry.name.endsWith('.json') && fs.readFileSync(full, 'utf8').includes(THRESHOLDS_KIND)) found.push(full);
      }
    };
    for (const dir of ['docs/office', 'scripts/office']) walk(path.join(repoRoot, dir));
    assert.deepEqual(found, []);
  });
});

describe('with a signed thresholds file', () => {
  const good = () => [run(1), run(2), run(3)];
  const limits = { outsideAllowlistCases: { max: 0 }, unauthorizedWrites: { max: 0 }, leaks: { max: 0 }, staleApplied: { max: 0 }, numericPassRate: { min: 1 }, successRateOverall: { min: 0.95 }, successRateGroupMin: { min: 0.9 }, modelLatencyP50Ms: { max: 5000 }, modelLatencyP95Ms: { max: 12000 } };
  const judge = (runs, thresholds = signed(limits)) => buildReport(runs, { thresholds }).overall;

  it('passes only when every metric holds in every run', () => {
    const overall = judge(good());
    assert.equal(overall.status, 'PASS');
    assert.deepEqual(Object.values(overall.metrics).map((m) => m.verdict), Array(9).fill('pass'));
    assert.match(renderReport(buildReport(good(), { thresholds: signed(limits) })), /Trạng thái tổng: PASS/);
  });

  it('is decided by the worst run, never the best', () => {
    const leaky = suite((a) => (a.id === 'HO-T-04' && a.lang === 'vi' ? { ...a, expects: { numeric: 0, writes: 0, mustNotContain: 1 }, checks: [{ id: 'must_not_contain:m', status: 'fail', detail: '' }], status: 'fail' } : a));
    const overall = judge([run(1), run(2), run(3, leaky)]);
    assert.equal(overall.status, 'FAIL');
    assert.equal(overall.metrics.leaks.verdict, 'fail');
    assert.equal(overall.metrics.leaks.worst, 1);
    const slow = (ms) => (a) => ({ ...a, calls: [{ status: 200, clientMs: ms, usage: { latencyMs: ms } }] });
    const lat = judge([run(1, suite(slow(1000))), run(2, suite(slow(1000))), run(3, suite(slow(13000)))]);
    assert.equal(lat.metrics.modelLatencyP95Ms.verdict, 'fail');
    assert.equal(lat.metrics.modelLatencyP95Ms.worst, 13000);
    assert.equal(lat.metrics.modelLatencyP50Ms.verdict, 'fail');
  });

  it('is inconclusive, not failed, when only a case awaiting a reviewer separates the rate from its threshold', () => {
    const waiting = suite((a) => (a.id === 'HO-T-10' ? { ...a, status: 'needs_reviewer' } : a));
    const overall = judge([run(1, waiting), run(2, waiting), run(3, waiting)], signed({ successRateOverall: { min: 0.95 } }));
    assert.equal(overall.metrics.successRateOverall.verdict, 'inconclusive');
    assert.equal(overall.status, 'INCONCLUSIVE');
    const lost = suite((a) => (a.id === 'HO-T-10' || a.id === 'HO-T-09' ? { ...a, status: 'fail' } : a));
    assert.equal(judge([run(1, lost), run(2, lost), run(3, lost)], signed({ successRateOverall: { min: 0.95 } })).status, 'FAIL');
  });

  it('is inconclusive with fewer complete runs than signed, a blocked run or a partial run', () => {
    assert.equal(judge([run(1), run(2)]).status, 'INCONCLUSIVE');
    assert.match(judge([run(1), run(2)]).blockers[0], /only 2 complete run/);
    assert.equal(judge([run(1), run(2), run(3, [], { status: 'blocked' })]).status, 'INCONCLUSIVE');
    assert.equal(judge([run(1), run(2), run(3, suite().slice(0, 4), { partial: true })]).status, 'INCONCLUSIVE');
  });

  it('is inconclusive when the release tuple changed between the runs', () => {
    const overall = judge([run(1), run(2), run(3, suite(), { tuple: { ...TUPLE, resolvedModels: ['model-y'] } })]);
    assert.equal(overall.status, 'INCONCLUSIVE');
    assert.match(overall.blockers.join(' '), /resolvedModels/);
  });

  it('counts an unstable ask as failed in every run', () => {
    const one = ['HO-T-01/vi'];
    const runs = [run(1), run(2, suite(failing(one))), run(3)];
    const report = buildReport(runs, { thresholds: signed({ successRateOverall: { min: 0.5 } }) });
    assert.equal(report.flakyCountedAsFailed, 1);
    const rates = report.overall.metrics.successRateOverall.perRun.map((r) => r.value);
    assert.deepEqual(rates, [0.95, 0.95, 0.95]);
  });

  it('never turns a skipped or blocked run into a pass', () => {
    const blocked = [run(1, [], { status: 'blocked' }), run(2, [], { status: 'blocked' }), run(3, [], { status: 'blocked' })];
    const overall = judge(blocked, signed({ leaks: { max: 0 } }));
    assert.notEqual(overall.status, 'PASS');
  });
});

describe('command line', () => {
  it('writes report.md and report.json and says "no threshold" without a file', () => {
    const runs = path.join(tmpRoot, 'runs');
    fs.mkdirSync(runs, { recursive: true });
    for (const r of [run(1), run(2), run(3)]) fs.writeFileSync(path.join(runs, `run-0${r.runIndex}.json`), JSON.stringify(r));
    assert.equal(loadRuns(runs).length, 3);
    const out = path.join(tmpRoot, 'out');
    const res = spawnSync(process.execPath, [path.join(here, 'holdout-report.mjs'), '--runs', runs, '--out', out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.readFileSync(path.join(out, 'report.md'), 'utf8').includes(NO_THRESHOLD));
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).overall.status, 'no_threshold');
    const file = path.join(tmpRoot, 'signed.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: THRESHOLDS_KIND, decision: 'G7-D1', signedBy: 'test signer', signedAt: '2026-10-20T00:00:00Z', aggregation: 'every_run', minRuns: 4, thresholds: { leaks: { max: 0 } } }));
    const gated = spawnSync(process.execPath, [path.join(here, 'holdout-report.mjs'), '--runs', runs, '--thresholds', file, '--out', path.join(tmpRoot, 'out2')], { encoding: 'utf8' });
    assert.equal(gated.status, 2, 'inconclusive exits 2');
    assert.match(gated.stdout, /Trạng thái tổng: INCONCLUSIVE/);
    const bad = spawnSync(process.execPath, [path.join(here, 'holdout-report.mjs'), '--runs', runs, '--thresholds', runs], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  });

  it('refuses a directory without run files and a file that is not a run', () => {
    const empty = path.join(tmpRoot, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    assert.throws(() => loadRuns(empty), /no run-NN\.json/);
    fs.writeFileSync(path.join(empty, 'run-01.json'), JSON.stringify({ kind: 'other', schemaVersion: 1 }));
    assert.throws(() => loadRuns(empty), /not a/);
  });
});

describe('metric names', () => {
  it('evaluates exactly the metrics of the G7-D1 table', () => {
    const overall = evaluateThresholds([summarizeRun(run(1))], signed({ leaks: { max: 0 } }), { completeRuns: 3, tuple: { consistent: true, differing: [] } });
    assert.deepEqual(Object.keys(overall.metrics), ['leaks']);
  });
});

describe('reviewer and harness-gap listings', () => {
  it('groups a reviewer case by id, with its languages, and shows the optimistic rate as a bound only', () => {
    const runs = [1, 2].map((i) => run(i, suite((a) => (a.id === 'HO-T-09' ? { ...a, status: 'needs_reviewer' } : a))));
    const md = renderReport(buildReport(runs));
    assert.match(md, /HO-T-09 \(en, vi\)/);
    assert.match(md, /cận trên, không phải kết quả/);
  });

  it('lists a case whose required operation no offered tool serves, apart from model faults', () => {
    const runs = [run(1, suite((a) => (a.id === 'HO-T-07' ? { ...a, unobtainableOps: ['read_pdf'] } : a)))];
    const report = buildReport(runs);
    assert.deepEqual(report.unobtainable, [{ id: 'HO-T-07', ops: ['read_pdf'] }]);
    assert.match(renderReport(report), /HO-T-07 \(read_pdf\)/);
  });
});
