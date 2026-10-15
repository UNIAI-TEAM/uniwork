// Tests of the G7-12 holdout runner (UNI-1384): the tool backend, the answer adapter, the runner against a stub façade
// (deterministic, no server, no database, no upstream) and its fault handling. The cases are read at runtime from
// docs/office/g5g6g7/holdout; nothing of a case is copied here (holdout.test.mjs would fail the leak check).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseMechanicalTable } from '../instruction-pack-tools.mjs';
import { ANSWER_MARKER, deriveAnswer, parseReport, reportingFooter } from './holdout-answer.mjs';
import {
  TOOL_OPS, createBackend, modulesOfCase, offeredTools, opsOfTool, toolCatalogue, unobtainableOps,
} from './holdout-backend.mjs';
import {
  DEFAULT_CASES_DIR, DEFAULT_OUT_DIR, MAX_STEPS, buildAsks, createServerSession, createUsageReader, firstMessages, httpTransport,
  parseArgs, runHoldout,
} from './holdout-run.mjs';
import { OPERATIONS, loadCases } from './holdout-score.mjs';
import { readWorkbook } from './holdout-xlsx-truth.mjs';
import { referenceLine, scriptedModel, startStubFacade } from './holdout-stub-facade.helper.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { cases } = loadCases(DEFAULT_CASES_DIR);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g712-run-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const needsReviewer = (c) => c.oracle.type === 'rubric' || c.expected.structural.some((s) => s.kind === 'caveat');
const fixtureSha = '0'.repeat(64);

/** A minimal valid case over a real fixture; the content is neutral test text, not a holdout case. */
function synthCase(over = {}) {
  const base = {
    id: 'HO-TEST-001', format: 'xlsx', category: 'compute',
    query: { vi: 'test question vi alpha', en: 'test question en alpha' },
    fixtures: [{ id: 'fx-xlsx-revenue-xyz', sha256: fixtureSha, version: 'v1' }],
    host: ['web'], role: 'editor', sourceAnchors: ['Sheet!A1'],
    tools: { allowed: ['read_range', 'compute'], required: ['compute'] },
    expected: { numeric: [{ name: 'figure_a', value: 31337, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
    oracle: { type: 'deterministic', source: 'test' },
    referenceAnswer: { numeric: { figure_a: 31337 }, structural: [], writes: 0, text: 'test reference' },
  };
  return { ...base, ...over };
}

const reportFor = (report) => `reply text\n${ANSWER_MARKER} ${JSON.stringify(report)}`;

describe('tool catalogue', () => {
  it('names only tools of docs/office/g5g6g7/genoffice-tools.md and only operations the scorer knows', () => {
    const { byModule } = parseMechanicalTable(fs.readFileSync(path.join(repoRoot, 'docs/office/g5g6g7/genoffice-tools.md'), 'utf8'));
    for (const [module, tools] of Object.entries(TOOL_OPS)) {
      assert.ok(byModule.has(module), `module ${module}`);
      for (const [name, ops] of Object.entries(tools)) {
        assert.ok(byModule.get(module).has(name), `${module}.${name} is not a genoffice tool`);
        for (const op of ops) assert.ok(OPERATIONS.includes(op), `${op} is not an abstract operation`);
      }
    }
  });

  it('offers every case a tool set where each required operation has a tool (refuse and compute-by-reply aside)', () => {
    const catalogue = toolCatalogue();
    for (const c of cases) {
      const tools = offeredTools(c, catalogue);
      assert.ok(tools.length > 0 || c.tools.required.every((op) => op === 'refuse'), `${c.id} has no tool`);
      assert.deepEqual(unobtainableOps(c, tools), [], `${c.id} needs an operation no offered tool serves`);
      const modules = modulesOfCase(c);
      for (const t of tools) {
        const ops = opsOfTool(modules, t.function.name);
        assert.ok(ops.some((op) => c.tools.allowed.includes(op)), `${c.id} is offered ${t.function.name} outside its allowlist`);
      }
    }
  });
});

describe('fixture backend', () => {
  const sheet = readWorkbook(path.join(repoRoot, 'docs/office/g5g6g7/fixtures/fx-xlsx-revenue-xyz.xlsx'));
  const firstSheet = Object.keys(sheet)[0];
  const column = (name, skipHidden) => Object.entries(sheet[firstSheet].cells)
    .filter(([ref, cell]) => /^D\d+$/.test(ref) && Number(ref.slice(1)) >= 2 && Number(ref.slice(1)) <= 7 && typeof cell.v === 'number' && !(skipHidden && sheet[firstSheet].hiddenRows.has(Number(ref.slice(1)))))
    .reduce((n, [, cell]) => n + cell.v, 0);

  it('aggregates a range from the workbook and skips hidden rows on request', () => {
    const backend = createBackend(synthCase());
    const all = backend.execute('aggregate_range', { range: 'D2:D7', sheetId: firstSheet });
    const visible = backend.execute('aggregate_range', { range: 'D2:D7', sheetId: firstSheet, skipHiddenRows: true });
    assert.equal(all.sum, column('D', false));
    assert.equal(visible.sum, column('D', true));
    assert.ok(visible.sum < all.sum, 'the fixture has a hidden row with a quantity');
    const read = backend.execute('read_range', { range: 'A1:G8', sheetId: firstSheet });
    assert.ok(read.rows.some((r) => r.hidden), 'hidden rows are flagged');
  });

  it('applies the setup to a copy: overlay and removeCells never reach the next session', () => {
    const c = synthCase({ setup: { overlay: [{ fixtureId: 'fx-xlsx-revenue-xyz', op: 'set_cell', sheet: firstSheet, cell: 'A1', value: 'note alpha' }], removeCells: [`${firstSheet}!B2`] } });
    const read = (backend) => backend.execute('read_cells', { addresses: ['A1', 'B2'], sheetId: firstSheet }).cells;
    const edited = read(createBackend(c));
    assert.equal(edited.A1, 'note alpha');
    assert.equal(edited.B2, null);
    const clean = read(createBackend(synthCase()));
    assert.notEqual(clean.A1, 'note alpha');
    assert.notEqual(clean.B2, null);
  });

  it('counts a write once, treats an apply_ops dry run as a read and never counts a refused write', () => {
    const docx = (over) => synthCase({
      format: 'docx', fixtures: [{ id: 'fx-docx-report-vi', sha256: fixtureSha, version: 'v1' }],
      tools: { allowed: ['read_document', 'edit_paragraph'], required: ['read_document'] }, ...over,
    });
    const open = createBackend(docx());
    open.execute('replace_blocks', { startBlockIndex: 1, endBlockIndex: 1, html: 'x' });
    open.execute('apply_ops', { ops: [], dryRun: true });
    assert.equal(open.writes(), 1);
    const viewer = createBackend(docx({ role: 'viewer' }));
    assert.equal(viewer.execute('replace_blocks', {}).error, 'permission_denied');
    assert.equal(viewer.writes(), 0);
    const stale = createBackend(docx({ setup: { serverVersionAhead: true } }));
    assert.equal(stale.execute('replace_blocks', {}).error, 'version_conflict');
    assert.equal(stale.writes(), 0);
    assert.deepEqual(stale.denied().map((d) => d.reason), ['version_conflict']);
    const revoked = createBackend(docx({ setup: { revokeAfterTool: 1 } }));
    assert.ok(!revoked.execute('get_document_context', {}).error);
    assert.equal(revoked.execute('replace_blocks', {}).error, 'permission_denied');
    assert.equal(revoked.writes(), 0);
  });

  it('opens every fixture of a multi-document case and routes a tool to the first module that has it', () => {
    const c = synthCase({
      format: 'cross', fixtures: [{ id: 'fx-md-notes-vi', sha256: fixtureSha, version: 'v1' }, { id: 'fx-xlsx-revenue-xyz', sha256: fixtureSha, version: 'v1' }],
      tools: { allowed: ['read_table', 'read_range', 'ask_clarification'], required: ['read_table', 'read_range'] },
    });
    assert.deepEqual(modulesOfCase(c), ['markdown', 'sheets']);
    const backend = createBackend(c);
    assert.ok(backend.execute('read_blocks', {}).lines.length > 0, 'the markdown notes');
    assert.ok(backend.execute('read_range', { range: 'A1:B2', sheetId: firstSheet }).rows.length > 0, 'the workbook');
  });
});

describe('answer adapter', () => {
  it('parses the reporting line and tells a missing one from an invalid one', () => {
    assert.equal(parseReport('only text').status, 'missing');
    assert.equal(parseReport(`text ${ANSWER_MARKER} {oops`).status, 'invalid');
    const ok = parseReport(`text\n\`\`\`\n${ANSWER_MARKER} {"numbers":[1]}\n\`\`\``);
    assert.equal(ok.status, 'ok');
    assert.deepEqual(ok.report.numbers, [1]);
    assert.equal(ok.text, 'text');
  });

  it('matches figures to expected numbers by tolerance and rounding; an extra figure is a failure unless lenient', () => {
    const c = synthCase({ expected: { ...synthCase().expected, numeric: [{ name: 'figure_a', value: 10, tolerance: 0, rounding: '0dp', unit: 'count' }] } });
    const ask = (figures) => ({ reply: reportFor({ numbers: figures }), calls: [], writes: 0, dropped: [], modules: ['sheets'] });
    assert.equal(deriveAnswer(c, ask([10.4])).answer.numeric.figure_a, 10.4);
    const strict = deriveAnswer(c, ask([99, 10]));
    assert.equal(strict.answer.numeric.figure_a, 10);
    assert.equal(strict.answer.numeric.extra_figure_1, 99);
    assert.equal(deriveAnswer(c, ask([99, 10]), { numbers: 'lenient' }).answer.numeric.extra_figure_1, undefined);
    assert.equal(deriveAnswer(c, ask([])).answer.numeric.figure_a, undefined);
  });

  it('derives behaviour items from what was observed and never from the case text', () => {
    const c = synthCase({
      tools: { allowed: ['read_range', 'ask_clarification', 'refuse'], required: ['ask_clarification'] },
      expected: { numeric: [], structural: [
        { kind: 'clarification', anchor: 'anchor one', value: 'reference text one' },
        { kind: 'refusal', anchor: 'anchor two', value: 'reference text two' },
        { kind: 'not_found', anchor: 'anchor three', value: 'reference text three' },
        { kind: 'caveat', anchor: 'anchor four', value: 'reference text four' },
      ], writes: 0, mustNotContain: [] },
    });
    const base = { calls: [], writes: 0, dropped: [], modules: ['sheets'] };
    const none = deriveAnswer(c, { ...base, reply: reportFor({}) });
    assert.deepEqual(none.answer.structural, []);
    const all = deriveAnswer(c, { ...base, calls: [{ name: 'ask_clarification' }], reply: reportFor({ refused: true, not_found: true, caveats: ['limit'] }) });
    assert.deepEqual(all.answer.structural.map((s) => s.kind), ['clarification', 'refusal', 'not_found', 'caveat']);
    assert.ok(all.answer.structural.every((s) => s.value === 'observed'), 'no reference text is copied into an answer');
    assert.deepEqual([...all.answer.tools.used].sort(), ['ask_clarification', 'refuse']);
  });

  it('keeps `refuse` out of the used list when the case does not allow it, and counts compute by reply outside sheets', () => {
    const c = synthCase({ tools: { allowed: ['read_range', 'compute'], required: ['compute'] } });
    const refused = deriveAnswer(c, { reply: reportFor({ refused: true }), calls: [], writes: 0, dropped: [], modules: ['sheets'] });
    assert.deepEqual(refused.answer.tools.used, []);
    const docs = (computeByReply) => deriveAnswer(c, { reply: reportFor({ numbers: [1] }), calls: [], writes: 0, dropped: [], modules: ['docs'] }, { computeByReply }).answer.tools.used;
    assert.deepEqual(docs(true), ['compute']);
    assert.deepEqual(docs(false), []);
    const sheets = deriveAnswer(c, { reply: reportFor({ numbers: [1] }), calls: [], writes: 0, dropped: [], modules: ['sheets'] });
    assert.deepEqual(sheets.answer.tools.used, [], 'in sheets compute needs the tool');
  });

  it('matches cell/count items by value, flags a value found at another anchor, and reports unmatched tools by name', () => {
    const c = synthCase({
      tools: { allowed: ['read_range'], required: ['read_range'] },
      expected: { numeric: [], structural: [{ kind: 'cell', anchor: 'Sheet!A1', value: 'wanted value' }], writes: 0, mustNotContain: [] },
    });
    const out = deriveAnswer(c, {
      reply: reportFor({ items: [{ kind: 'cell', anchor: 'Sheet!Z9', value: 'wanted value' }] }),
      calls: [{ name: 'read_range' }, { name: 'made_up_tool' }], writes: 0, dropped: ['dropped_tool'], modules: ['sheets'],
    });
    assert.equal(out.adapter.anchorLenient, 1);
    assert.deepEqual(out.answer.structural[0], { kind: 'cell', anchor: 'Sheet!A1', value: 'wanted value' });
    assert.deepEqual([...out.answer.tools.used].sort(), ['dropped_tool', 'made_up_tool', 'read_range']);
  });

  it('adds one fixed reporting footer to the question and nothing a case could give away', () => {
    const footer = reportingFooter();
    for (const c of cases) {
      for (const lang of ['vi', 'en']) {
        const content = firstMessages(c, lang).at(-1).content;
        assert.ok(content.endsWith(footer), `${c.id} ${lang}`);
        assert.ok(content.includes(c.query[lang]));
      }
      const hints = [...c.expected.structural.flatMap((s) => [s.anchor, String(s.value)]), ...c.expected.numeric.flatMap((n) => [n.name, String(n.value)]), ...c.expected.mustNotContain];
      // A plain word ("figure") is vocabulary the footer may share; the check is for names, values, anchors and markers.
      for (const hint of hints.filter((h) => h.length >= 5 && !/^\p{L}+$/u.test(h))) assert.ok(!footer.includes(hint), `${c.id}: the footer contains ${hint}`);
    }
  });
});

const usageReader = async (ids) => new Map(ids.map((id, i) => [id, { promptId: 'office_uniwork_ai@test', provider: 'fake', model: 'stub-resolved', status: 'succeeded', latencyMs: 100 + (i % 7), inputTokens: 5, outputTokens: 2 }]));
const noSleep = async () => {};

async function runWith({ model, onlyIds = null, runs = 1, threads = 2, hooks, delayMs = 0, opts = {}, usage = usageReader, subset = null }, dirName) {
  const facade = await startStubFacade({ model: model ?? scriptedModel(cases), hooks, delayMs });
  const session = await createServerSession({ serverUrl: facade.url });
  const mounts = [];
  const wrapped = { ...session, mount: (id, o) => { mounts.push({ id, ...o }); return session.mount(id, o); } };
  const outDir = path.join(tmpRoot, dirName);
  try {
    const files = await runHoldout({
      cases: subset ?? cases, runs, threads, outDir, transport: httpTransport(facade.url), session: wrapped, usageReader: usage, redis: 'off',
      onlyIds, opts: { sleep: noSleep, ...opts },
    });
    return { files, docs: files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))), facade, mounts, outDir };
  } finally {
    await facade.close();
  }
}

describe('runner against a stub façade', () => {
  let ref;
  before(async () => { ref = await runWith({ delayMs: 4, runs: 2 }, 'reference'); });

  it('asks every case in vi and en, in a fixed order, two at a time at most', () => {
    const [run1] = ref.docs;
    assert.equal(run1.asks.length, cases.length * 2);
    assert.deepEqual(run1.asks.map((a) => `${a.id}/${a.lang}`), buildAsks(cases).map((a) => `${a.caseDoc.id}/${a.lang}`));
    assert.ok(run1.asks.every((a) => a.group && a.category && a.calls.length > 0));
    assert.equal(ref.facade.stats.maxInflight, 2);
  });

  it('grades the reference model: nothing fails, exactly the reviewer cases wait, no run is marked best', () => {
    for (const doc of ref.docs) {
      assert.equal(doc.asks.filter((a) => a.status === 'fail').length, 0, doc.asks.filter((a) => a.status === 'fail').map((a) => `${a.id}/${a.lang}: ${a.checks.filter((c) => c.status === 'fail').map((c) => c.id).join(',')}`).join(' | '));
      const waiting = new Set(doc.asks.filter((a) => a.status === 'needs_reviewer').map((a) => a.id));
      assert.deepEqual([...waiting].sort(), cases.filter(needsReviewer).map((c) => c.id).sort());
      assert.equal(doc.status, 'completed');
      assert.equal(doc.partial, false);
    }
    assert.deepEqual(ref.docs.map((d) => d.asks.map((a) => a.status)), ref.docs.map(() => ref.docs[0].asks.map((a) => a.status)), 'two runs of a deterministic model agree');
    assert.ok(ref.docs.every((d) => !('best' in d) && !('selected' in d)));
  });

  it('writes one file per run and records the release tuple as observed', () => {
    assert.deepEqual(ref.files.map((f) => path.basename(f)), ['run-01.json', 'run-02.json']);
    const { tuple, config } = ref.docs[0];
    assert.match(tuple.dSha, /^[0-9a-f]{40}$/);
    assert.equal(typeof tuple.dirty, 'boolean');
    assert.ok(tuple.framePin.length > 0);
    assert.deepEqual(tuple.promptIds, ['office_uniwork_ai@test']);
    assert.deepEqual(tuple.providers, ['fake']);
    assert.deepEqual(tuple.resolvedModels, ['stub-model', 'stub-resolved']);
    assert.equal(tuple.redis, 'off');
    assert.equal(config.threads, 2);
    assert.equal(config.casesRead, cases.length);
  });

  it('records per ask: calls with latency, tool calls, counts and tokens from the usage rows', () => {
    const ask = ref.docs[0].asks.find((a) => a.id === cases.find((c) => c.format === 'xlsx' && c.tools.required.includes('compute')).id);
    assert.ok(ask.modelTurns >= 2);
    assert.ok(ask.toolCalls.length >= 1);
    assert.ok(ask.calls.every((c) => c.status === 200 && c.traceId && c.clientMs >= 0 && c.usage.latencyMs >= 100));
    assert.deepEqual(ask.counts, { rateLimited: 0, serverErrors: 0, retries: 0, remounts: 0 });
    assert.equal(ask.tokens.source, 'ai_usage_events');
    assert.equal(ask.tokens.input, 5 * ask.calls.length);
    assert.equal(ask.answer.tools.used.includes('compute'), true);
  });

  it('keeps run files free of the upstream: no host, ip, port or key', () => {
    for (const file of ref.files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /(\d{1,3}\.){3}\d{1,3}|https?:\/\/[^\s"]+:\d+|sk-[A-Za-z0-9]{8,}/);
  });
});

describe('runner faults and failures', () => {
  const pick = (pred) => cases.find(pred);
  const readOnlyNumeric = pick((c) => c.format === 'xlsx' && c.expected.numeric.length === 1 && c.expected.writes === 0 && c.oracle.type === 'deterministic' && c.expected.structural.length === 0 && c.expected.mustNotContain.length === 0 && !c.setup);
  const oneWrite = pick((c) => c.expected.writes === 1 && c.tools.required.some((op) => op === 'write_range') && c.oracle.type === 'deterministic' && Object.keys(c.setup ?? {}).every((k) => k === 'selection'));
  const only = (c) => ({ onlyIds: [c.id], subset: cases });
  const mutate = (fn) => { const base = scriptedModel(cases); return (ctx) => fn(base(ctx), ctx); };
  const verdicts = (doc) => doc.asks.map((a) => a.status);

  it('flags a partial run (--only) so the report never counts it as complete', async () => {
    const { docs } = await runWith({ ...only(readOnlyNumeric) }, 'partial');
    assert.equal(docs[0].partial, true);
    assert.equal(docs[0].asks.length, 2);
    assert.deepEqual(verdicts(docs[0]), ['pass', 'pass']);
  });

  it('fails a wrong number, and a reply without the reporting line fails closed with its own marker', async () => {
    const wrong = await runWith({ ...only(readOnlyNumeric), model: mutate((r) => (r.content ? { content: r.content.replace(/"numbers":\[[^\]]*\]/, '"numbers":[1]') } : r)) }, 'wrong');
    assert.deepEqual(verdicts(wrong.docs[0]), ['fail', 'fail']);
    assert.ok(wrong.docs[0].asks[0].checks.some((c) => c.id.startsWith('numeric:') && c.status === 'fail'));
    const bare = await runWith({ ...only(readOnlyNumeric), model: mutate((r) => (r.content ? { content: 'a plain reply' } : r)) }, 'bare');
    assert.deepEqual(verdicts(bare.docs[0]), ['fail', 'fail']);
    assert.equal(bare.docs[0].asks[0].adapter.reportStatus, 'missing');
  });

  it('counts a tool outside the allowlist, even one the façade would drop, without executing it', async () => {
    const { docs } = await runWith({ ...only(readOnlyNumeric), model: mutate((r, ctx) => (r.toolCalls && ctx.state.step === 0 ? { toolCalls: [...r.toolCalls, { id: 'call_x', type: 'function', function: { name: 'propose_operations', arguments: '{}' } }, { id: 'call_y', type: 'function', function: { name: 'web_search', arguments: '{}' } }] } : r)) }, 'outside');
    const ask = docs[0].asks[0];
    assert.equal(ask.status, 'fail');
    assert.deepEqual([...ask.outsideAllowlist].sort(), ['web_search', 'write_range']);
    assert.equal(ask.writes, 0, 'a tool that was not offered is not executed');
  });

  it('fails a write above the ceiling of the case', async () => {
    const twice = mutate((r, ctx) => {
      if (!r.toolCalls || ctx.state.step !== 0) return r;
      const write = r.toolCalls.find((t) => t.function.name === 'propose_operations');
      return write ? { toolCalls: [...r.toolCalls, { ...write, id: 'call_w2' }] } : r;
    });
    const { docs } = await runWith({ ...only(oneWrite), model: twice }, 'write');
    const ask = docs[0].asks[0];
    assert.equal(ask.writes, 2);
    assert.equal(ask.status, 'fail');
    assert.ok(ask.checks.some((c) => c.id === 'writes' && c.status === 'fail'));
  });

  it('retries a 429 after Retry-After and a 5xx, and records every attempt and count', async () => {
    const waits = [];
    const { docs } = await runWith({
      ...only(readOnlyNumeric), threads: 1, opts: { sleep: async (ms) => { waits.push(ms); } },
      hooks: { before: (i) => (i === 0 || i === 1 ? { status: 429, headers: { 'Retry-After': '2' } } : i === 2 ? { status: 503 } : null) },
    }, 'retry');
    const ask = docs[0].asks[0];
    assert.equal(ask.status, 'pass');
    assert.deepEqual(ask.counts, { rateLimited: 2, serverErrors: 1, retries: 3, remounts: 0 });
    assert.deepEqual(ask.calls.slice(0, 3).map((c) => c.status), [429, 429, 503]);
    assert.deepEqual(waits.slice(0, 2), [2000, 2000]);
    assert.equal(ask.modelTurns, ask.calls.filter((c) => c.status === 200).length);
  });

  it('gives up after the retry budget: the ask is an error and fails, never skipped or passed', async () => {
    const { docs } = await runWith({ ...only(readOnlyNumeric), opts: { maxRetries: 2 }, hooks: { before: () => ({ status: 429 }) }, subset: cases }, 'giveup');
    const [ask] = docs[0].asks;
    assert.equal(ask.errored, true);
    assert.equal(ask.status, 'fail');
    assert.match(ask.error, /gave up after 3 attempts/);
    assert.equal(ask.counts.retries, 2);
    assert.equal(ask.modelTurns, 0);
  });

  it('mints a fresh frame token once after a 401 and carries on', async () => {
    const { docs, mounts } = await runWith({ ...only(readOnlyNumeric), hooks: { before: (i) => (i === 0 ? { status: 401 } : null) } }, 'remount');
    assert.equal(docs[0].asks[0].counts.remounts, 1);
    assert.equal(docs[0].asks[0].status, 'pass');
    assert.ok(mounts.some((m) => m.fresh === true));
  });

  it('stops a run that never answers at the façade limit of model calls', async () => {
    const forever = mutate((r, ctx) => ({ toolCalls: [{ id: `call_${ctx.state.step}`, type: 'function', function: { name: 'read_range', arguments: '{}' } }] }));
    const { docs } = await runWith({ ...only(readOnlyNumeric), model: forever }, 'limit');
    const [ask] = docs[0].asks;
    assert.equal(ask.modelTurns, MAX_STEPS);
    assert.match(ask.error, /run_limit_reached/);
    assert.equal(ask.status, 'fail');
  });

  it('replays setup.history before the question and runs the case through the same path', async () => {
    const withHistory = pick((c) => c.setup?.history);
    const { docs, facade } = await runWith({ ...only(withHistory) }, 'history');
    const first = facade.requests[0].body.messages;
    assert.equal(first.length, withHistory.setup.history.length + 1);
    withHistory.setup.history.forEach((turn, i) => assert.ok(first[i].content.includes(turn.text)));
    assert.ok(first.at(-1).content.includes(withHistory.query.vi));
    assert.notEqual(docs[0].asks[0].status, undefined);
  });

  it('sends the open document and never an upstream address; tools are the case allowlist only', async () => {
    const { facade } = await runWith({ ...only(readOnlyNumeric) }, 'tools');
    const request = facade.requests[0];
    assert.match(request.authorization, /^Bearer stub-frame-/);
    assert.equal(request.body.model, 'uniwork');
    assert.equal(request.body.stream, true);
    const ops = request.body.tools.flatMap((t) => opsOfTool(modulesOfCase(readOnlyNumeric), t.function.name));
    assert.ok(ops.every((op) => readOnlyNumeric.tools.allowed.includes(op)));
  });

  it('refuses to write a run whose output looks like a secret', async () => {
    const leak = mutate((r) => (r.content ? { content: r.content.replace('UNIWORK_ANSWER', 'reach me at 10.20.30.40\nUNIWORK_ANSWER') } : r));
    await assert.rejects(runWith({ ...only(readOnlyNumeric), model: leak }, 'secret'), /secret-looking/);
  });

  it('turns a transport that always throws into error asks, not a crash', async () => {
    const dir = path.join(tmpRoot, 'throws');
    const facade = await startStubFacade({ model: scriptedModel(cases) });
    const session = await createServerSession({ serverUrl: facade.url });
    try {
      const files = await runHoldout({
        cases, runs: 3, threads: 1, outDir: dir, session, redis: 'off', onlyIds: [readOnlyNumeric.id],
        transport: { chat: async () => { throw new Error('boom'); } }, opts: { sleep: noSleep, maxRetries: 0 },
      });
      const doc = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      assert.equal(files.length, 3, 'a failed ask is an error ask, the run itself completes');
      assert.ok(doc.asks.every((a) => a.errored && a.status === 'fail'));
    } finally {
      await facade.close();
    }
  });

  it('marks a run that dies mid-way as aborted, keeps what it has and does not start the next run', async () => {
    const dir = path.join(tmpRoot, 'aborted');
    const facade = await startStubFacade({ model: scriptedModel(cases) });
    const session = await createServerSession({ serverUrl: facade.url });
    try {
      const files = await runHoldout({
        cases, runs: 3, threads: 1, outDir: dir, session, redis: 'off', onlyIds: [readOnlyNumeric.id], transport: httpTransport(facade.url),
        opts: { sleep: noSleep, backendFactory: () => { throw new Error('backend exploded'); } },
      });
      assert.equal(files.length, 1);
      const doc = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      assert.equal(doc.status, 'aborted');
      assert.match(doc.reason, /backend exploded/);
    } finally {
      await facade.close();
    }
  });
});

describe('usage rows and arguments', () => {
  it('reads usage rows by trace id through the injected sql runner, and is null without a database', async () => {
    assert.equal(createUsageReader({ dbUrl: '' }), null);
    const seen = [];
    const reader = createUsageReader({ dbUrl: 'postgres://x', sleep: noSleep, tries: 2, sql: (url, args) => { seen.push(args.at(-1)); return 'trace-1|office_uniwork_ai@2|prov|model-x|succeeded|1234|50|7\n'; } });
    const rows = await reader(['trace-1', 'trace-2']);
    assert.deepEqual(rows.get('trace-1'), { promptId: 'office_uniwork_ai@2', provider: 'prov', model: 'model-x', status: 'succeeded', latencyMs: 1234, inputTokens: 50, outputTokens: 7 });
    assert.equal(seen.length, 2, 'it retries while rows are missing');
    assert.ok(seen[0].includes("'trace-1','trace-2'"));
    const unsafe = await createUsageReader({ dbUrl: 'postgres://x', sleep: noSleep, tries: 1, sql: (u, a) => { seen.push(a.at(-1)); return ''; } })(["x'; drop table users; --"]);
    assert.equal(unsafe.size, 0);
    assert.ok(!seen.at(-1).includes('drop table'), 'an id that is not a plain token never reaches the SQL');
  });

  it('defaults to 3 runs on 2 threads outside the repo, and rejects what the sign-off profile forbids', () => {
    const args = parseArgs(['--server-url', 'http://localhost:1/']);
    assert.equal(args.runs, 3);
    assert.equal(args.threads, 2);
    assert.equal(args.out, DEFAULT_OUT_DIR);
    assert.ok(path.relative(repoRoot, DEFAULT_OUT_DIR).startsWith('..'));
    assert.throws(() => parseArgs(['--server-url', 'http://localhost:1', '--threads', '3']), /--threads must be 1 or 2/);
    assert.throws(() => parseArgs(['--server-url', 'http://localhost:1', '--runs', '0']), /--runs/);
    assert.throws(() => parseArgs(['--runs', '3']), /--server-url is required/);
    assert.throws(() => parseArgs(['--server-url', 'http://localhost:1', '--out', path.join(repoRoot, 'docs/x')]), /inside the repo/);
    assert.equal(parseArgs(['--server-url', 'http://localhost:1', '--out', path.join(repoRoot, 'docs/x'), '--allow-in-repo']).allowInRepo, true);
    assert.throws(() => parseArgs(['--server-url', 'http://localhost:1', '--redis', 'maybe']), /--redis/);
  });

  it('keeps the reference line helper in step with the reporting format', () => {
    const c = cases.find((x) => x.expected.numeric.length > 0);
    const { status, report } = parseReport(referenceLine(c));
    assert.equal(status, 'ok');
    assert.deepEqual(report.numbers, Object.values(c.referenceAnswer.numeric));
  });
});
