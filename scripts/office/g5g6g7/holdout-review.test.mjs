// Tests of the blinded review export, the model-graded reviews format and the spot-check sheet (G7-12, UNI-1384; G7-D1 D1.c
// amendment 2026-10-16). The session is a stub written to a temp dir; the cases are read at runtime (no case content is copied here).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { reportingFooter } from './holdout-answer.mjs';
import { applyReviews, buildReport, loadSession, parseReviews, parseThresholds, renderReport } from './holdout-report.mjs';
import { buildPacket, validateReviewsFile } from './holdout-review-export.mjs';
import { GRADING_WORDING, PACKET_KIND, REVIEWS_KIND, pickSpotChecks, seededShuffle } from './holdout-review.mjs';
import { DEFAULT_CASES_DIR, MANIFEST_KIND, RUN_KIND, caseSetSha256, groupOf, sha256Hex } from './holdout-run.mjs';
import { buildSkeleton, mergeSpotChecks, spotCheckList } from './holdout-spotcheck.mjs';
import { loadCases } from './holdout-score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g712-review-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const { cases } = loadCases(DEFAULT_CASES_DIR);
const CASE_SHA = caseSetSha256(cases);
const isPending = (c) => c.oracle.type === 'rubric' || c.expected.structural.some((s) => s.kind === 'caveat');
const pendingCases = cases.filter(isPending);
const pendingIds = new Set(pendingCases.map((c) => c.id));
const injectionPending = pendingCases.filter((c) => c.category === 'injection');
const RUNS = 3;
const FINISHED = '2026-10-19T10:00:00.000Z';

// Values that identify the model/provider: none may reach the packet.
const SECRET_TUPLE = { dSha: 'a'.repeat(40), dirty: false, dShaSource: 'checkout HEAD', framePin: '0.1.0-test', promptIds: ['prompt-secret@1'], providers: ['provider-secret-x'], resolvedModels: ['model-secret-x'], redis: 'on' };
const SURFACE = Object.fromEntries(['sheets', 'docs', 'slides', 'pdf', 'markdown', 'html'].map((m) => [m, { source: m === 'sheets' || m === 'docs' ? 'devset' : `file:${'b'.repeat(64)}`, tools: ['t'], offered: 1, frameTotal: 10, droppedFromFile: [], schemasSha256: 'c'.repeat(64) }]));
const CONFIG = { threads: 2, langs: ['vi', 'en'], answerProtocol: 'v1', numbers: 'strict', anchors: 'strict', computeByReply: true, maxRetries: 3, footerSha256: sha256Hex(reportingFooter()), toolSurface: SURFACE, toolSurfaceSha256: 'd'.repeat(64), usageReader: 'ai_usage_events', usageReaderError: null, casesRead: cases.length };

/** The marker the stub answer of an ask carries: the quote that is verbatim in that run's answer and in no other. */
const markerOf = (id, lang, run) => `claim-${id}-${lang}-r${run}`;

function stubAsk(caseDoc, lang, runIndex) {
  const pending = isPending(caseDoc);
  const caveats = caseDoc.expected.structural.filter((s) => s.kind === 'caveat');
  const checks = [{ id: 'numeric:x', status: 'pass', detail: '' }];
  if (caseDoc.oracle.type === 'rubric') checks.push({ id: 'rubric', status: 'needs_reviewer', detail: 'x' });
  for (const c of caveats) checks.push({ id: `reviewer:caveat@${c.anchor}`, status: 'needs_reviewer', detail: 'x' });
  return {
    id: caseDoc.id, lang, format: caseDoc.format, group: groupOf(caseDoc), category: caseDoc.category, oracleType: caseDoc.oracle.type,
    expects: { numeric: caseDoc.expected.numeric.length, writes: caseDoc.expected.writes, mustNotContain: caseDoc.expected.mustNotContain.length },
    status: pending ? 'needs_reviewer' : 'pass', errored: false, checks, writes: 0, outsideAllowlist: [],
    calls: [{ step: 0, attempt: 0, status: 200, clientMs: 4321, usage: { latencyMs: 100 }, model: 'model-secret-x' }], toolCalls: [{ name: 'read_range', write: false, denied: null }], modelTurns: 1,
    counts: { rateLimited: 0, serverErrors: 0, retries: 0, remounts: 0 }, tokens: { input: 10, output: 2, source: 'ai_usage_events' }, models: ['model-secret-x'],
    adapter: { reportStatus: 'ok', anchorLenient: 0, extraFigures: 0 }, wallMs: 987,
    answer: { text: `Stub answer. ${markerOf(caseDoc.id, lang, runIndex)}. More stub text.`, tools: { used: ['read_range'] }, writes: 0 }, ...(pending ? {} : {}),
  };
}

/** Writes a stub session (3 runs over every case, both languages) the way the runner does and loads it back. */
function writeSession(name, { sessionId = 's-review-1', manifestOver = {}, caseSha = CASE_SHA } = {}) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
    const asks = cases.flatMap((c) => ['vi', 'en'].map((lang) => stubAsk(c, lang, runIndex)));
    const doc = { schemaVersion: 1, kind: RUN_KIND, sessionId, runIndex, runsPlanned: RUNS, status: 'completed', reason: null, partial: false, startedAt: 't', finishedAt: 't', caseCount: cases.length, caseSetSha256: caseSha, tuple: SECRET_TUPLE, config: CONFIG, redactions: [], asks };
    const json = `${JSON.stringify(doc)}\n`;
    const file = `run-0${runIndex}.json`;
    fs.writeFileSync(path.join(dir, file), json);
    entries.push({ runIndex, file, sha256: sha256Hex(json), status: 'completed', asks: asks.length });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, kind: MANIFEST_KIND, sessionId, runsPlanned: RUNS, caseCount: cases.length, caseSetSha256: caseSha, status: 'completed', partial: false, startedAt: '2026-10-19T09:00:00.000Z', finishedAt: FINISHED, runs: entries, ...manifestOver }));
  return { dir, session: loadSession(dir) };
}

const base = writeSession('base');
const SEED = 42;
const { packet, skeleton } = buildPacket(base.session, cases, SEED);

/** The skeleton filled by `verdictOf(item)`; quote = the marker of that item's run; spot-checks by `spot(item)`. */
function graded({ verdictOf = () => 'pass', spot = () => undefined, over = {} } = {}) {
  return {
    ...skeleton, ...over,
    reviews: skeleton.reviews.map((r) => {
      const entry = { ...r, verdict: verdictOf(r), reason: `reason for ${r.id}`, quote: markerOf(r.id, r.lang, r.run) };
      const sc = spot(r);
      return sc ? { ...entry, spotCheck: { by: 'user', date: '2026-10-21', ...sc } } : entry;
    }),
  };
}
const key = (r) => `${r.id}/${r.lang}/${r.run}`;
const thresholds = () => parseThresholds(JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/office/g5g6g7/holdout/thresholds-G7-D1.json'), 'utf8')));
const judge = (doc, { session = base.session } = {}) => buildReport(session.runs, { thresholds: thresholds(), reviews: doc === null ? null : parseReviews(doc), session });
// Every mandatory item plus the random passes, spot-checked as the grader said (what a user who agrees with the grader files).
const spotAll = (doc) => {
  const reviews = parseReviews(doc);
  const picked = new Set(pickSpotChecks(reviews.reviews, SEED).map(({ entry }) => key(entry)));
  return graded({ verdictOf: (r) => doc.reviews.find((d) => key(d) === key(r)).verdict, spot: (r) => (picked.has(key(r)) ? { verdict: doc.reviews.find((d) => key(d) === key(r)).verdict === 'fail' ? 'fail' : 'pass' } : undefined) });
};

describe('blinded export', () => {
  it('writes one item per case, language and run that waits for a human, and the stub really has some', () => {
    assert.ok(pendingCases.length > 0 && injectionPending.length > 0, 'the case set has reviewer cases and injection reviewer cases');
    assert.equal(packet.kind, PACKET_KIND);
    assert.equal(packet.itemCount, pendingCases.length * 2 * RUNS);
    assert.deepEqual(new Set(packet.items.map((i) => i.id)), pendingIds);
    assert.equal(new Set(packet.items.map(key)).size, packet.items.length, 'one item per (case, language, run)');
  });

  it('carries the question, the reference items, the answer verbatim, the tool summary and the injection flag', () => {
    const byId = new Map(cases.map((c) => [c.id, c]));
    for (const item of packet.items) {
      const c = byId.get(item.id);
      assert.equal(item.question, c.query[item.lang]);
      assert.equal(item.injection, c.category === 'injection');
      assert.equal(item.answer, `Stub answer. ${markerOf(item.id, item.lang, item.run)}. More stub text.`, 'the answer is verbatim');
      assert.equal(item.reference.text, c.referenceAnswer.text);
      assert.deepEqual(item.toolSummary, { calls: ['read_range'], writes: 0, deniedByBackend: [] });
      assert.ok(item.needs.length > 0);
      if (item.needs.some((n) => n.startsWith('caveat@'))) assert.ok(item.reference.caveats.length > 0, 'a caveat item names the reference caveat');
      if (item.injection) assert.ok(item.untrusted, 'an injection item shows the grader what was hidden and what must not be repeated');
      else assert.equal(item.untrusted, undefined);
    }
    assert.ok(packet.items.some((i) => i.injection));
  });

  it('is blinded: no provider, model, tuple, timing, token or score field or value', () => {
    const forbidden = /provider|model|tuple|latency|token|usage|score|status|checks|wallms|clientms|dsha|framepin|promptid|redis|thread|sha256/i;
    const walk = (value, at) => {
      if (Array.isArray(value)) value.forEach((v) => walk(v, at));
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { assert.doesNotMatch(k, forbidden, `${at}.${k}`); walk(v, `${at}.${k}`); }
    };
    const { sessionId, manifestSha256, ...rest } = packet;
    // The binding fields of the packet itself are the one allowed hash; everything else is walked.
    assert.ok(sessionId && /^[0-9a-f]{64}$/.test(manifestSha256));
    walk(rest, 'packet');
    for (const value of ['provider-secret-x', 'model-secret-x', 'prompt-secret@1', 'a'.repeat(40), '4321', 'ai_usage_events']) {
      assert.ok(!JSON.stringify(packet).includes(value) && !JSON.stringify(skeleton).includes(value), `${value} must not appear in the packet or the skeleton`);
    }
    for (const item of packet.items) assert.deepEqual(Object.keys(item).sort(), [...['id', 'lang', 'run', 'format', 'injection', 'needs', 'question', 'reference', 'answer', 'toolSummary', ...(item.injection ? ['untrusted'] : [])]].sort());
  });

  it('shuffles with the recorded seed: same seed same order, another seed another order, ids not in file order', () => {
    assert.equal(packet.seed, SEED);
    assert.deepEqual(buildPacket(base.session, cases, SEED).packet.items.map(key), packet.items.map(key));
    assert.notDeepEqual(buildPacket(base.session, cases, SEED + 1).packet.items.map(key), packet.items.map(key));
    const sorted = [...packet.items.map(key)].sort();
    assert.notDeepEqual(packet.items.map(key), sorted, 'the order is shuffled');
    const unshuffled = buildPacket(base.session, cases, SEED).skeleton.reviews.map(key).sort();
    assert.deepEqual(seededShuffle(unshuffled, SEED).length, unshuffled.length, 'the shuffle keeps every item');
  });

  it('writes a reviews skeleton bound to the session, in packet order, with one empty verdict per item', () => {
    assert.equal(skeleton.kind, REVIEWS_KIND);
    assert.equal(skeleton.sessionId, packet.sessionId);
    assert.equal(skeleton.manifestSha256, base.session.manifestSha256);
    assert.deepEqual(skeleton.grader, { kind: 'model-session', name: 'Opus 5.5 grader' });
    assert.deepEqual(skeleton.reviews.map(key), packet.items.map(key));
    for (const r of skeleton.reviews) assert.deepEqual([r.verdict, r.reason, r.quote], [null, '', '']);
    assert.throws(() => parseReviews(skeleton), /verdict must be pass, fail or borderline/, 'an empty skeleton is not a reviews file yet');
  });

  it('refuses a session it cannot bind, and cases that are not the ones the session ran over', () => {
    assert.throws(() => buildPacket({ ...base.session, manifest: null, manifestSha256: null }, cases, SEED), /no readable manifest/);
    assert.throws(() => buildPacket(base.session, cases.slice(1), SEED), /not the case set this session was run over/);
  });

  it('is wired into the command line, refuses an out dir inside the repo, and writes the three files outside it', () => {
    const script = path.join(here, 'holdout-review-export.mjs');
    const inRepo = spawnSync(process.execPath, [script, '--runs', base.dir, '--out', path.join(repoRoot, 'tmp-review-out'), '--seed', '1'], { encoding: 'utf8' });
    assert.equal(inRepo.status, 4);
    assert.match(inRepo.stderr, /inside the repo/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'tmp-review-out')), false);
    const link = path.join(tmpRoot, 'link-into-repo');
    fs.symlinkSync(repoRoot, link);
    const viaLink = spawnSync(process.execPath, [script, '--runs', base.dir, '--out', path.join(link, 'tmp-review-out2')], { encoding: 'utf8' });
    assert.equal(viaLink.status, 4, 'a symlink into the repo does not get around it');
    const out = path.join(tmpRoot, 'export-out');
    const res = spawnSync(process.execPath, [script, '--runs', base.dir, '--out', out, '--seed', String(SEED)], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readdirSync(out).sort(), ['GRADER-BRIEF.md', 'review-packet.json', 'reviews-skeleton.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'review-packet.json'), 'utf8')).items.map(key), packet.items.map(key));
  });
});

describe('model-graded reviews file', () => {
  it('validates the format: grader, verdict set, reason and quote required, run required, spot-check shape', () => {
    assert.doesNotThrow(() => parseReviews(graded()));
    const bad = (mutate, pattern) => assert.throws(() => parseReviews(mutate(graded())), pattern);
    bad((d) => ({ ...d, grader: { kind: 'human', name: 'x' } }), /grader.kind must be model-session/);
    bad((d) => ({ ...d, grader: { kind: 'model-session', name: ' ' } }), /grader.name is required/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], verdict: 'maybe' }] }), /verdict must be pass, fail or borderline/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], reason: '' }] }), /reason is required/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], quote: ' ' }] }), /quote is required/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], quote: '\t\n ' }] }), /quote is required/);
    // A quote of invisible format characters only proves nothing: refused like the empty and whitespace arms (G712-30).
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], quote: '\u200b' }] }), /quote is required/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], quote: '\u200b\u00a0\t\ufeff' }] }), /quote is required/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], run: undefined }] }), /run is required/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], spotCheck: { by: 'model', date: '2026-10-21', verdict: 'pass' } }] }), /spotCheck.by must be "user"/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], spotCheck: { by: 'user', date: '2026-10-21', verdict: 'borderline' } }] }), /spotCheck.verdict must be pass or fail/);
    bad((d) => ({ ...d, reviews: [{ ...d.reviews[0], spotCheck: { by: 'user', date: 'soon', verdict: 'pass' } }] }), /spotCheck.date must be a date/);
    // A human file (no grader) cannot smuggle a spot-check or a borderline in.
    assert.throws(() => parseReviews({ schemaVersion: 1, kind: REVIEWS_KIND, sessionId: 's', manifestSha256: 'f'.repeat(64), reviews: [{ id: 'HO-DOCX-001', lang: 'vi', verdict: 'borderline', reviewer: 'QA', date: '2026-10-21' }] }), /verdict must be pass or fail/);
  });

  it('enforces the binding to the session: another session, another manifest, a changed run, a date before the session ended', () => {
    const run = (doc) => judge(doc).reviews;
    assert.deepEqual(run(graded()).refused, []);
    assert.match(run(graded({ over: { sessionId: 's-other' } })).refused.join(' '), /for session s-other/);
    assert.match(run(graded({ over: { manifestSha256: 'b'.repeat(64) } })).refused.join(' '), /another manifest sha256/);
    const early = run(graded({ spot: () => ({ verdict: 'pass', date: '2026-10-18' }) }));
    assert.match(early.refused.join(' '), /dated before the session finished/, 'a spot-check dated before the session counts too');
    assert.equal(run(graded({ over: { sessionId: 's-other' } })).applied, 0, 'a refused file applies to nothing');
    // Another run set (a different session id on disk) is refused by the validator as well.
    const other = writeSession('other-session', { sessionId: 's-review-2' });
    assert.match(validateReviewsFile(other.session, graded()).problems.join(' '), /for session s-review-1, this run set is session s-review-2/);
    // A run file that changes after the packet was made changes the manifest hash: the old reviews no longer bind.
    const changed = writeSession('changed-run', { manifestOver: { finishedAt: '2026-10-20T10:00:00.000Z' } });
    assert.match(validateReviewsFile(changed.session, graded()).problems.join(' '), /another manifest sha256/);
  });

  it('demands a verbatim quote: a paraphrase, another run\'s quote or a changed case is rejected and the ask keeps waiting', () => {
    const target = skeleton.reviews[0];
    const withQuote = (quote) => graded({ spot: () => ({ verdict: 'pass' }), over: {} }).reviews.map((r) => (key(r) === key(target) ? { ...r, quote } : r));
    const doc = (quote) => ({ ...graded(), reviews: withQuote(quote) });
    const rejected = (quote) => judge(doc(quote)).reviews.rejected.map((r) => r.key);
    assert.deepEqual(rejected(markerOf(target.id, target.lang, target.run)), []);
    assert.deepEqual(rejected('a paraphrase of the answer'), [key(target)]);
    assert.deepEqual(rejected(markerOf(target.id, target.lang, target.run).toUpperCase()), [key(target)], 'verbatim means exact, not case-folded');
    const otherRun = (target.run % RUNS) + 1;
    assert.deepEqual(rejected(markerOf(target.id, target.lang, otherRun)), [key(target)], 'a quote of another run\'s answer is not a quote of this one');
    const report = judge(doc('a paraphrase of the answer'));
    assert.ok(report.awaitingReviewer.some((a) => a.id === target.id && a.lang === target.lang), 'the rejected ask keeps waiting');
    assert.match(report.overall.blockers.join(' '), /1 graded ask\(s\) were rejected: the quote is not a verbatim part of the answer/);
    const check = validateReviewsFile(base.session, doc('a paraphrase of the answer'));
    assert.equal(check.ok, false);
    assert.match(check.problems.join('\n'), new RegExp(`${key(target).replace(/[/]/g, '\\/')}: the quote is not a verbatim part`));
    assert.equal(validateReviewsFile(base.session, graded()).ok, true);
    assert.match(validateReviewsFile(base.session, { ...graded(), reviews: graded().reviews.slice(1) }).problems.join('\n'), /waits for a reviewer and has no entry/);
  });

  it('accepts the run-less human entry the report applies to every run (G712-31)', () => {
    const pairs = [...new Map(skeleton.reviews.map((r) => [`${r.id}/${r.lang}`, { id: r.id, lang: r.lang }])).values()];
    const human = { schemaVersion: 1, kind: REVIEWS_KIND, sessionId: packet.sessionId, manifestSha256: base.session.manifestSha256, reviews: pairs.map((p) => ({ ...p, verdict: 'pass', reviewer: 'QA reviewer', date: '2026-10-21' })) };
    const check = validateReviewsFile(base.session, human);
    assert.equal(check.ok, true, check.problems.join('\n'));
    assert.equal(applyReviews(base.session.runs, parseReviews(human)).applied, pairs.length * RUNS, 'one run-less entry covers the pair in every run');
    const missing = validateReviewsFile(base.session, { ...human, reviews: human.reviews.slice(1) });
    assert.equal(missing.ok, false, 'a pair with no entry is still reported');
    for (let run = 1; run <= RUNS; run += 1) assert.match(missing.problems.join('\n'), new RegExp(`${human.reviews[0].id}/${human.reviews[0].lang}/${run} waits for a reviewer and has no entry`));
  });

  it('keeps a borderline "chưa kết luận" until the user spot-check resolves it', () => {
    const border = skeleton.reviews.find((r) => !r.injection);
    const doc = (spotBorder) => graded({ verdictOf: (r) => (key(r) === key(border) ? 'borderline' : 'pass'), spot: (r) => (key(r) === key(border) ? spotBorder : { verdict: 'pass' }) });
    const open = judge(doc(undefined));
    assert.deepEqual(open.reviews.pending.map((p) => p.key), [key(border)]);
    assert.match(open.reviews.pending[0].why, /borderline/);
    assert.equal(open.overall.metrics.successRateOverall.verdict, 'inconclusive');
    assert.match(open.overall.metrics.successRateOverall.reasons.join(' '), /chưa kết luận/);
    assert.equal(open.overall.metrics.leaks.verdict, 'pass', 'a criterion no reviewer case feeds is still judged');
    const closed = judge(doc({ verdict: 'pass', note: 'agreed' }));
    assert.deepEqual(closed.reviews.pending, []);
    assert.equal(closed.overall.metrics.successRateOverall.verdict, 'pass');
    assert.equal(judge(doc({ verdict: 'fail' })).reviews.confirmed.find((c) => key(c) === key(border)).verdict, 'fail');
  });

  it('keeps the reviewer-fed criteria "chưa kết luận" for a model-graded file with no spot-check at all, and says so', () => {
    const report = judge(graded());
    assert.equal(report.reviews.applied, 0);
    assert.equal(report.reviews.grading.noSpotCheck, true);
    assert.equal(report.awaitingReviewer.length, pendingCases.length * 2);
    for (const metric of ['successRateOverall', 'successRateGroupMin']) assert.equal(report.overall.metrics[metric].verdict, 'inconclusive', metric);
    assert.equal(report.overall.status, 'INCONCLUSIVE');
    assert.match(report.overall.blockers.join(' '), /chưa kết luận/);
    const md = renderReport(report);
    assert.match(md, /Chưa có kiểm mẫu nào của người dùng/);
    assert.ok(md.includes(GRADING_WORDING.vi) && md.includes(GRADING_WORDING.en));
    // The same file without a model grader would have decided: the spot-check is what the model verdict waits for.
    assert.equal(judge(spotAll(graded())).overall.metrics.successRateOverall.verdict, 'pass');
  });

  it('lets a spot-check override the grader in both directions, and leaves an unchecked fail as the grader said', () => {
    const [a, b, c] = skeleton.reviews.filter((r) => !r.injection);
    const verdicts = new Map([[key(a), 'fail'], [key(b), 'pass'], [key(c), 'fail']]);
    const doc = graded({ verdictOf: (r) => verdicts.get(key(r)) ?? 'pass', spot: (r) => (key(r) === key(a) ? { verdict: 'pass' } : key(r) === key(b) ? { verdict: 'fail' } : key(r) === key(skeleton.reviews.find((x) => x.injection)) ? { verdict: 'pass' } : undefined) });
    const out = applyReviews(base.session.runs, parseReviews(doc));
    const statusOf = (r) => out.runs[r.run - 1].asks.find((x) => x.id === r.id && x.lang === r.lang).status;
    assert.equal(statusOf(a), 'pass', 'grader fail, user pass: pass');
    assert.equal(statusOf(b), 'fail', 'grader pass, user fail: fail');
    assert.equal(statusOf(c), 'fail', 'grader fail, no spot-check yet, others exist: the grader verdict stands');
    const injection = skeleton.reviews.filter((r) => r.injection);
    const unchecked = injection.find((r) => !doc.reviews.find((d) => key(d) === key(r)).spotCheck);
    assert.equal(statusOf(unchecked), 'needs_reviewer', 'an injection pass the user has not looked at never resolves');
    assert.match(out.pending.find((p) => p.key === key(unchecked)).why, /injection/);
    const grading = judge(doc).reviews.grading;
    assert.equal(grading.spotChecked.count, doc.reviews.filter((r) => r.spotCheck).length);
    assert.equal(grading.spotChecked.overrides, 2);
  });

  it('prints "graded by Opus 5.5, spot-checked by the user" with the counts wherever reviewer-fed results appear', () => {
    const doc = spotAll(graded({ verdictOf: (r) => (r.run === 1 && r.lang === 'vi' && !r.injection ? 'fail' : 'pass') }));
    const report = judge(doc);
    const md = renderReport(report);
    const g = report.reviews.grading;
    assert.equal(g.items, skeleton.reviews.length);
    assert.equal(g.graded.fail + g.graded.pass + g.graded.borderline, g.items);
    assert.ok(g.graded.fail > 0 && g.spotChecked.count >= g.graded.fail + injectionPending.length * 2 * RUNS);
    const occurrences = md.split(GRADING_WORDING.vi).length - 1;
    assert.ok(occurrences >= 3, `the Vietnamese wording appears in sections 3, 6 and 8 (found ${occurrences})`);
    assert.equal(md.split(GRADING_WORDING.en).length - 1 >= 3, true);
    assert.match(md, new RegExp(`Đã chấm ${g.items} mục: ${g.graded.pass} pass, ${g.graded.fail} fail, ${g.graded.borderline} borderline`));
    assert.match(md, new RegExp(`Người dùng kiểm mẫu ${g.spotChecked.count} mục`));
    assert.match(md, /Hai tiêu chí tỷ lệ thành công có ca do model chấm/);
    // Without a reviews file the report does not claim any grading.
    assert.doesNotMatch(renderReport(judge(null)), new RegExp(GRADING_WORDING.vi));
  });
});

describe('spot-check sheet', () => {
  // A graded file with a mix: every verdict, injection items, and many passes.
  const mixed = () => graded({ verdictOf: (r) => (r.run === 1 && r.lang === 'vi' && !r.injection ? 'fail' : r.run === 2 && r.lang === 'en' && !r.injection ? 'borderline' : 'pass') });
  const entries = () => parseReviews(mixed()).reviews;

  it('lists every fail, every borderline, every injection item and exactly 10 seeded random passes', () => {
    const reviews = parseReviews(mixed());
    const list = spotCheckList(reviews, 7);
    const keys = new Set(list.map(({ entry }) => key(entry)));
    for (const e of entries()) {
      if (e.verdict === 'fail' || e.verdict === 'borderline' || e.injection) assert.ok(keys.has(key(e)), `${key(e)} (${e.verdict}${e.injection ? ', injection' : ''}) must be listed`);
    }
    const mandatory = entries().filter((e) => e.verdict !== 'pass' || e.injection);
    const randoms = list.filter(({ because }) => because.includes('random pass'));
    assert.equal(randoms.length, 10);
    assert.equal(list.length, mandatory.length + 10);
    for (const { entry } of randoms) assert.ok(entry.verdict === 'pass' && !entry.injection, 'a random pass is a plain pass');
    assert.equal(new Set(list.map(({ entry }) => key(entry))).size, list.length, 'no item twice');
  });

  it('takes the injection flag from the case set, so an item whose flag the grader dropped stays on the sheet (G712-29)', () => {
    const doc = mixed();
    const injections = doc.reviews.filter((r) => r.injection);
    assert.ok(injections.length > 0, 'the stub has injection items');
    const dropped = { ...doc, reviews: doc.reviews.map(({ injection, ...rest }) => rest) };
    const reviews = parseReviews(dropped);
    const caseIds = new Set(cases.filter((c) => c.category === 'injection').map((c) => c.id));
    for (const seed of [0, 7, 23, 41, 59]) {
      const list = spotCheckList(reviews, seed, caseIds);
      for (const r of injections) {
        const found = list.find(({ entry }) => key(entry) === key(r));
        assert.ok(found, `seed ${seed}: ${key(r)} is an injection case and must be on the sheet`);
        assert.ok(found.because.includes('injection'), `seed ${seed}: ${key(r)} must be on the sheet as an injection item`);
      }
      const blind = spotCheckList(reviews, seed).find(({ entry }) => key(entry) === key(injections[0]));
      if (blind) assert.deepEqual(blind.because, ['random pass'], `seed ${seed}: without the case set the dropped flag is all the sheet has`);
    }
    // The command line reads the case set itself, so the sheet it writes carries every injection item as such.
    const reviewsFile = path.join(tmpRoot, 'reviews-dropped-flag.json');
    fs.writeFileSync(reviewsFile, JSON.stringify(dropped));
    const out = path.join(tmpRoot, 'spot-dropped-flag');
    const res = spawnSync(process.execPath, [path.join(here, 'holdout-spotcheck.mjs'), '--reviews', reviewsFile, '--seed', '7', '--out', out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const skeletonOut = JSON.parse(fs.readFileSync(path.join(out, 'spotcheck-skeleton.json'), 'utf8'));
    assert.equal(skeletonOut.items.filter((i) => i.because.includes('injection')).length, injections.length, 'every injection item is listed as one, none drawn as a random pass');
  });

  it('draws the same sample for the same seed and another for another seed', () => {
    const reviews = parseReviews(mixed());
    const sample = (seed) => spotCheckList(reviews, seed).filter(({ because }) => because.includes('random pass')).map(({ entry }) => key(entry));
    assert.deepEqual(sample(7), sample(7));
    assert.notDeepEqual(sample(7), sample(8));
  });

  it('skips items the user already checked, and writes a skeleton with one empty spotCheck per listed item', () => {
    const doc = mixed();
    const first = spotCheckList(parseReviews(doc), 7);
    const done = new Set(first.slice(0, 3).map(({ entry }) => key(entry)));
    const partial = parseReviews({ ...doc, reviews: doc.reviews.map((r) => (done.has(key(r)) ? { ...r, spotCheck: { by: 'user', date: '2026-10-21', verdict: 'pass' } } : r)) });
    const list = spotCheckList(partial, 7);
    assert.ok(list.every(({ entry }) => !done.has(key(entry))));
    const sheet = buildSkeleton(partial, list, 7);
    assert.equal(sheet.items.length, list.length);
    assert.deepEqual(sheet.items[0].spotCheck, { by: 'user', date: '', verdict: '', note: '' });
    assert.equal(sheet.sessionId, partial.sessionId);
  });

  it('merges a filled skeleton into a reviews file the report accepts, and refuses an unknown item or a bad verdict', () => {
    const reviews = parseReviews(mixed());
    const list = spotCheckList(reviews, 7);
    const filled = buildSkeleton(reviews, list, 7);
    filled.items.forEach((i) => { i.spotCheck = { by: 'user', date: '2026-10-21', verdict: i.graderVerdict === 'fail' ? 'fail' : 'pass', note: '' }; });
    const merged = mergeSpotChecks(reviews, filled);
    assert.equal(merged.reviews.filter((r) => r.spotCheck).length, list.length);
    assert.equal(merged.reviews.find((r) => r.spotCheck && r.spotCheck.note !== undefined), undefined, 'an empty note is dropped');
    assert.equal(judge(merged).reviews.grading.spotChecked.count, list.length);
    assert.throws(() => mergeSpotChecks(reviews, { ...filled, items: [...filled.items, { id: 'HO-NOPE-001', lang: 'vi', run: 1, spotCheck: { by: 'user', date: '2026-10-21', verdict: 'pass' } }] }), /is not an item of the reviews file/);
    assert.throws(() => mergeSpotChecks(reviews, { ...filled, items: [{ ...filled.items[0], spotCheck: { by: 'user', date: '2026-10-21', verdict: 'borderline' } }] }), /verdict must be pass or fail/);
    assert.throws(() => mergeSpotChecks(reviews, { ...filled, sessionId: 's-other' }), /another session or manifest/);
  });

  it('is wired into the command line: prints a Vietnamese/English sheet, writes the skeleton, and merges', () => {
    const script = path.join(here, 'holdout-spotcheck.mjs');
    const reviewsFile = path.join(tmpRoot, 'reviews.json');
    fs.writeFileSync(reviewsFile, JSON.stringify(mixed()));
    const out = path.join(tmpRoot, 'spot-out');
    const res = spawnSync(process.execPath, [script, '--reviews', reviewsFile, '--seed', '7', '--out', out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Phiếu kiểm mẫu \/ Spot-check sheet/);
    assert.ok(res.stdout.includes(GRADING_WORDING.vi));
    const skeletonOut = JSON.parse(fs.readFileSync(path.join(out, 'spotcheck-skeleton.json'), 'utf8'));
    assert.equal(skeletonOut.items.length, spotCheckList(parseReviews(mixed()), 7).length);
    assert.equal(spawnSync(process.execPath, [script, '--reviews', reviewsFile], { encoding: 'utf8' }).status, 4, '--seed is required');
    const inRepo = spawnSync(process.execPath, [script, '--reviews', reviewsFile, '--seed', '7', '--out', path.join(repoRoot, 'tmp-spot-out')], { encoding: 'utf8' });
    assert.equal(inRepo.status, 4);
    assert.equal(fs.existsSync(path.join(repoRoot, 'tmp-spot-out')), false);
    skeletonOut.items.forEach((i) => { i.spotCheck = { by: 'user', date: '2026-10-21', verdict: 'pass', note: '' }; });
    const filledFile = path.join(tmpRoot, 'spot-filled.json');
    fs.writeFileSync(filledFile, JSON.stringify(skeletonOut));
    const merge = spawnSync(process.execPath, [script, '--reviews', reviewsFile, '--merge', filledFile, '--out', out], { encoding: 'utf8' });
    assert.equal(merge.status, 0, merge.stderr);
    assert.equal(parseReviews(JSON.parse(fs.readFileSync(path.join(out, 'reviews-spot-checked.json'), 'utf8'))).reviews.filter((r) => r.spotCheck).length, skeletonOut.items.length);
    // The validator command accepts the filled reviews file and refuses a broken quote (exit 1).
    const exportScript = path.join(here, 'holdout-review-export.mjs');
    fs.writeFileSync(reviewsFile, JSON.stringify(graded()));
    assert.equal(spawnSync(process.execPath, [exportScript, '--runs', base.dir, '--validate', reviewsFile], { encoding: 'utf8' }).status, 0);
    const broken = graded();
    broken.reviews[0].quote = 'not in the answer';
    fs.writeFileSync(reviewsFile, JSON.stringify(broken));
    const bad = spawnSync(process.execPath, [exportScript, '--runs', base.dir, '--validate', reviewsFile], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /not a verbatim part/);
  });
});
