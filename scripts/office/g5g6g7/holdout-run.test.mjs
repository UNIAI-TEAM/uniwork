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
  TOOL_OPS, createBackend, frameToolCounts, modulesOfCase, offeredTools, opsOfTool, toolCatalogue, toolSurface, unobtainableOps,
} from './holdout-backend.mjs';
import {
  DEFAULT_CASES_DIR, DEFAULT_OUT_DIR, MANIFEST_KIND, MAX_STEPS, buildAsks, createServerSession, createUsageReader, firstMessages, httpTransport,
  isInsideRepo, parseArgs, preflight, redactSecrets, runHoldout, sha256Hex,
} from './holdout-run.mjs';
import { OPERATIONS, loadCases, score } from './holdout-score.mjs';
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

  it('offers every case of a module the same tools, whatever the case expects (G712-1)', () => {
    const catalogue = toolCatalogue();
    const names = (c) => offeredTools(c, catalogue).map((t) => t.function.name);
    const byModules = new Map();
    for (const c of cases) {
      const key = modulesOfCase(c).join('+');
      byModules.set(key, [...(byModules.get(key) ?? []), c]);
    }
    for (const [key, group] of byModules) {
      const first = names(group[0]);
      assert.ok(first.length > 0, key);
      for (const c of group) assert.deepEqual(names(c), first, `${c.id} (${key}) is offered a different tool list than ${group[0].id}`);
    }
    for (const c of cases) {
      const modules = modulesOfCase(c);
      const offered = new Set(names(c));
      for (const module of modules) for (const tool of Object.keys(TOOL_OPS[module])) assert.ok(offered.has(tool), `${c.id} is not offered ${module}.${tool}`);
      assert.deepEqual(unobtainableOps(c, offeredTools(c, catalogue)), [], `${c.id} needs an operation no offered tool serves`);
    }
  });

  it('offers the write tools to cases that expect no write: injection, viewer and refusal cases included', () => {
    const catalogue = toolCatalogue();
    const writeTools = (c) => offeredTools(c, catalogue).filter((t) => opsOfTool(modulesOfCase(c), t.function.name).some((op) => op === 'write_range' || op === 'edit_paragraph'));
    const injection = cases.filter((c) => c.category === 'injection');
    const viewers = cases.filter((c) => c.role === 'viewer');
    const readOnly = cases.filter((c) => c.expected.writes === 0 && !c.tools.allowed.some((op) => op === 'write_range' || op === 'edit_paragraph'));
    assert.ok(injection.length > 0 && viewers.length > 0 && readOnly.length > 0);
    for (const c of [...injection, ...viewers, ...readOnly]) assert.ok(writeTools(c).length > 0, `${c.id} is offered no write tool`);
  });

  it('records where every module\'s schemas came from, and the strictest source wins', () => {
    const surface = toolSurface(toolCatalogue());
    assert.equal(surface.sheets.source, 'devset');
    assert.equal(surface.docs.source, 'devset');
    for (const module of ['slides', 'pdf', 'markdown', 'html']) assert.equal(surface[module].source, 'name-only', module);
    assert.deepEqual(surface.sheets.tools, Object.keys(TOOL_OPS.sheets).sort());
    assert.match(surface.sheets.schemasSha256, /^[0-9a-f]{64}$/);
    const real = (name) => ({ type: 'function', function: { name, description: 'real', parameters: { type: 'object', properties: { x: { type: 'string' } } } } });
    const filled = toolSurface(toolCatalogue({ slides: Object.keys(TOOL_OPS.slides).map(real) }), { fileSha256: 'f'.repeat(64) });
    assert.equal(filled.slides.source, `file:${'f'.repeat(64)}`);
    assert.equal(filled.pdf.source, 'name-only');
    const partial = toolSurface(toolCatalogue({ slides: [real('read_slide')] }), { fileSha256: 'f'.repeat(64) });
    assert.equal(partial.slides.source, 'name-only', 'a module with any hollow tool is name-only');
    assert.notEqual(filled.slides.schemasSha256, surface.slides.schemasSha256);
  });

  it('records how much of the frame\'s tool table is offered per module, and what a --tool-schemas file cannot widen (G712-20)', () => {
    const { byModule } = parseMechanicalTable(fs.readFileSync(path.join(repoRoot, 'docs/office/g5g6g7/genoffice-tools.md'), 'utf8'));
    const counts = frameToolCounts();
    assert.deepEqual(Object.fromEntries(Object.keys(TOOL_OPS).map((m) => [m, counts[m]])), Object.fromEntries(Object.keys(TOOL_OPS).map((m) => [m, byModule.get(m).size])));
    const surface = toolSurface(toolCatalogue());
    for (const module of Object.keys(TOOL_OPS)) {
      assert.equal(surface[module].offered, Object.keys(TOOL_OPS[module]).length, module);
      assert.equal(surface[module].frameTotal, byModule.get(module).size, module);
      assert.ok(surface[module].offered < surface[module].frameTotal, `${module}: the harness offers a subset of the frame's tools, and the record says so`);
      assert.deepEqual(surface[module].droppedFromFile, []);
    }
    // A file that describes a tool the harness does not map: it is not offered, and the record names it.
    const real = (name) => ({ type: 'function', function: { name, description: 'real', parameters: { type: 'object', properties: {} } } });
    const extra = [...Object.keys(TOOL_OPS.sheets), 'zz_unmapped_b', 'zz_unmapped_a'].map(real);
    const catalogue = toolCatalogue({ sheets: extra });
    const widened = toolSurface(catalogue, { fileSha256: 'f'.repeat(64) });
    assert.ok(!widened.sheets.tools.includes('zz_unmapped_a'), 'an unmapped tool is never offered');
    assert.equal(widened.sheets.offered, Object.keys(TOOL_OPS.sheets).length);
    assert.deepEqual(widened.sheets.droppedFromFile, ['zz_unmapped_a', 'zz_unmapped_b']);
    assert.equal(widened.sheets.source, `file:${'f'.repeat(64)}`);
    assert.deepEqual(widened.docs.droppedFromFile, []);
    assert.deepEqual(toolSurface(catalogue, { frameTotals: null }).sheets.frameTotal, null, 'an unreadable table is recorded as unknown');
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

describe('fixture backend: arguments, write log and number formats', () => {
  const firstSheet = Object.keys(readWorkbook(path.join(repoRoot, 'docs/office/g5g6g7/fixtures/fx-xlsx-revenue-xyz.xlsx')))[0];
  const everyTool = [
    ['sheets', synthCase()],
    ['docs', synthCase({ format: 'docx', fixtures: [{ id: 'fx-docx-report-vi', sha256: fixtureSha, version: 'v1' }], tools: { allowed: ['read_document'], required: ['read_document'] } })],
    ['markdown', synthCase({ format: 'md', fixtures: [{ id: 'fx-md-notes-vi', sha256: fixtureSha, version: 'v1' }], tools: { allowed: ['read_document'], required: ['read_document'] } })],
  ];

  it('answers invalid_arguments for a malformed argument of every tool, never throws, and keeps the call out of the write count (G712-11)', () => {
    const bad = [5, true, '{oops', '[1,2]', '"text"', { addresses: 5 }, { addresses: {} }, { range: { a: 1 }, sheetId: [] }, { startBlockIndex: {}, endBlockIndex: [] }];
    for (const [module, c] of everyTool) {
      for (const name of Object.keys(TOOL_OPS[module])) {
        for (const args of bad) {
          const backend = createBackend(c);
          let result;
          assert.doesNotThrow(() => { result = backend.execute(name, args); }, `${module}.${name}(${JSON.stringify(args)})`);
          assert.ok(result && typeof result === 'object');
          if (['{oops', '[1,2]', '"text"', 5, true].includes(args)) {
            assert.equal(result.error, 'invalid_arguments', `${module}.${name}(${JSON.stringify(args)})`);
            assert.equal(backend.writes(), 0, `${module}.${name} counted a write for a malformed call`);
          }
        }
      }
    }
    const backend = createBackend(synthCase());
    assert.equal(backend.execute('read_cells', { addresses: 5, sheetId: firstSheet }).error, 'invalid_arguments');
    assert.deepEqual(backend.invalid().map((i) => i.name), ['read_cells']);
  });

  it('keeps the arguments of every write attempt, applied or refused, so an edit can be scored from them', () => {
    const docx = (over) => synthCase({ format: 'docx', fixtures: [{ id: 'fx-docx-report-vi', sha256: fixtureSha, version: 'v1' }], tools: { allowed: ['read_document', 'edit_paragraph'], required: ['edit_paragraph'] }, ...over });
    const open = createBackend(docx());
    open.execute('replace_blocks', { startBlockIndex: 1, html: 'new text' });
    open.execute('apply_ops', { ops: [], dryRun: true });
    assert.deepEqual(open.writeLog(), [{ name: 'replace_blocks', applied: true, args: { startBlockIndex: 1, html: 'new text' } }]);
    const viewer = createBackend(docx({ role: 'viewer' }));
    viewer.execute('replace_blocks', { html: 'x' });
    assert.deepEqual(viewer.writeLog().map((w) => w.applied), [false]);
  });

  it('reads the number format of a cell from the workbook, as the #numberFormat probe of the cases needs (G712-13)', () => {
    const probe = cases.find((c) => c.expected.structural.some((i) => i.anchor.includes('#numberFormat')));
    assert.ok(probe, 'the set has a #numberFormat case');
    const backend = createBackend(probe);
    const item = probe.expected.structural.find((i) => i.anchor.includes('#numberFormat'));
    const [sheet, cell] = item.anchor.replace(/#numberFormat$/, '').split('!');
    // The probe names the format AFTER the edit; before it the cell is a plain number, which read_formats must say.
    const before = backend.execute('read_formats', { sheetId: sheet, range: cell });
    assert.equal(before.rows[0].formats[cell], 'number');
    const seen = new Set();
    const wb = backend.execute('read_formats', { sheetId: sheet, range: 'A1:Z50' });
    for (const row of wb.rows) for (const f of Object.values(row.formats)) seen.add(f);
    for (const f of seen) assert.ok(['percent', 'number', 'text', 'currency', 'date'].includes(f), f);
    assert.ok(seen.has('percent') && seen.has('text'), 'the fixture has percent cells and text cells');
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

  it('fails a right value at another anchor by default and reports unmatched tools by name (G712-5)', () => {
    const c = synthCase({
      tools: { allowed: ['read_range'], required: ['read_range'] },
      expected: { numeric: [], structural: [{ kind: 'cell', anchor: 'Sheet!A1', value: 'wanted value' }], writes: 0, mustNotContain: [] },
    });
    const ask = {
      reply: reportFor({ items: [{ kind: 'cell', anchor: 'Sheet!Z9', value: 'wanted value' }] }),
      calls: [{ name: 'read_range' }, { name: 'made_up_tool' }], writes: 0, dropped: ['dropped_tool'], modules: ['sheets'],
    };
    const strict = deriveAnswer(c, ask);
    assert.equal(strict.adapter.anchorLenient, 0);
    assert.deepEqual(strict.answer.structural, [{ kind: 'cell', anchor: 'Sheet!Z9', value: 'wanted value' }], 'the model\'s own anchor is kept, never rewritten');
    assert.equal(score(c, { ...strict.answer, tools: { used: ['read_range'] } }).status, 'fail');
    assert.deepEqual([...strict.answer.tools.used].sort(), ['dropped_tool', 'made_up_tool', 'read_range']);
    const lenient = deriveAnswer(c, ask, { anchors: 'lenient' });
    assert.equal(lenient.adapter.anchorLenient, 1);
    assert.deepEqual(lenient.answer.structural[0], { kind: 'cell', anchor: 'Sheet!A1', value: 'wanted value' });
    const right = deriveAnswer(c, { ...ask, reply: reportFor({ items: [{ kind: 'cell', anchor: 'sheet!a1', value: 'wanted value' }] }) });
    assert.equal(right.adapter.anchorLenient, 0);
    assert.deepEqual(right.answer.structural[0], { kind: 'cell', anchor: 'Sheet!A1', value: 'wanted value' });
  });

  it('credits an edited cell only when an applied write carries its value or covers its address (G712-5)', () => {
    const edit = synthCase({
      category: 'edit', tools: { allowed: ['read_range', 'write_range'], required: ['write_range'] },
      expected: { numeric: [], structural: [{ kind: 'cell', anchor: 'Sheet!C3', value: '4200' }, { kind: 'cell', anchor: 'Sheet!C4', value: '' }, { kind: 'count', anchor: 'changed', value: '1' }], writes: 1, mustNotContain: [] },
      referenceAnswer: { numeric: {}, structural: [{ kind: 'cell', anchor: 'Sheet!C3', value: '4200' }, { kind: 'cell', anchor: 'Sheet!C4', value: '' }, { kind: 'count', anchor: 'changed', value: '1' }], writes: 1, text: 'test reference' },
    });
    const line = reportFor({ items: [{ kind: 'cell', anchor: 'Sheet!C3', value: '4200' }, { kind: 'cell', anchor: 'Sheet!C4', value: '' }, { kind: 'count', anchor: 'changed', value: '1' }] });
    const base = { reply: line, calls: [{ name: 'propose_operations' }], writes: 1, dropped: [], modules: ['sheets'] };
    const asWritten = (args, applied = true) => ({ ...base, writes: applied ? 1 : 0, writeLog: [{ name: 'propose_operations', applied, args }] });
    const verdict = (ask) => score(edit, deriveAnswer(edit, ask).answer).checks.filter((x) => x.id.startsWith('structural:')).map((x) => x.status);
    assert.deepEqual(verdict(asWritten({ ops: [{ range: 'Sheet!C3', value: 4200 }] })), ['pass', 'pass', 'pass'], 'the value is in the arguments');
    assert.deepEqual(verdict(asWritten({ ops: [{ range: 'Sheet!C2:C5', formula: '=A1*2' }] })), ['pass', 'pass', 'pass'], 'the range covers the cell (a formula result is not in the arguments)');
    assert.deepEqual(verdict(asWritten({ ops: [{ range: 'Sheet!F9', value: 'other' }] })), ['fail', 'pass', 'pass'], 'a write elsewhere does not back the claim');
    assert.deepEqual(verdict(asWritten({})), ['fail', 'pass', 'pass'], 'a claimed edit with empty arguments');
    assert.deepEqual(verdict(asWritten({ range: 'C3', value: 4200 }, false)), ['fail', 'pass', 'pass'], 'a refused write proves nothing');
    assert.deepEqual(verdict({ ...base, writeLog: [] }), ['fail', 'pass', 'pass'], 'no write at all');
    const out = deriveAnswer(edit, asWritten({ range: 'Sheet!F9' }));
    assert.deepEqual([out.adapter.writeBacked, out.adapter.writeUnbacked, out.adapter.writeSelfReported], [0, 1, 2]);
  });

  it('flags a figure of the reporting line that the prose never states, apart from rounding and grouping (G712-5)', () => {
    const c = synthCase();
    const ask = (text, figures) => ({ reply: `${text}\n${ANSWER_MARKER} ${JSON.stringify({ numbers: figures })}`, calls: [], writes: 0, dropped: [], modules: ['sheets'] });
    assert.equal(deriveAnswer(c, ask('The total is 31.337.000 dong.', [31337000])).adapter.proseFigureMismatch, 0);
    assert.equal(deriveAnswer(c, ask('The share is 12.5% of 8 orders.', [12.5])).adapter.proseFigureMismatch, 0);
    assert.equal(deriveAnswer(c, ask('The total is 31.337.000 dong.', [31337])).adapter.proseFigureMismatch, 1);
    assert.equal(deriveAnswer(c, ask('No digits here, only words.', [31337])).adapter.proseFigureMismatch, 0, 'prose with no figure states nothing to compare');
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

async function runWith({ model, onlyIds = null, runs = 1, threads = 2, hooks, delayMs = 0, opts = {}, usage = usageReader, subset = null, mount = null }, dirName) {
  const facade = await startStubFacade({ model: model ?? scriptedModel(cases), hooks, delayMs });
  const session = await createServerSession({ serverUrl: facade.url });
  const mounts = [];
  const wrapped = { ...session, mount: (id, o) => { mounts.push({ id, ...o }); return mount ? mount(id, o, session, mounts.length) : session.mount(id, o); } };
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

  it('counts a tool outside the allowlist, even one the façade would drop; an offered write tool is executed and counted', async () => {
    const { docs } = await runWith({ ...only(readOnlyNumeric), model: mutate((r, ctx) => (r.toolCalls && ctx.state.step === 0 ? { toolCalls: [...r.toolCalls, { id: 'call_x', type: 'function', function: { name: 'propose_operations', arguments: '{}' } }, { id: 'call_y', type: 'function', function: { name: 'web_search', arguments: '{}' } }] } : r)) }, 'outside');
    const ask = docs[0].asks[0];
    assert.equal(ask.status, 'fail');
    assert.deepEqual([...ask.outsideAllowlist].sort(), ['web_search', 'write_range']);
    assert.equal(ask.writes, 1, 'the write tool is offered to every case, so the call is executed and counted; a tool that was not offered is not');
    assert.ok(ask.checks.some((c) => c.id === 'writes' && c.status === 'fail'), 'a write above the ceiling of a read-only case fails');
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

  it('sends the open document and never an upstream address; every case of a module gets the same tools (G712-1)', async () => {
    const sheetCases = cases.filter((c) => modulesOfCase(c).join() === 'sheets' && c.id !== readOnlyNumeric.id);
    const other = sheetCases.find((c) => c.expected.writes > 0) ?? sheetCases[0];
    const { facade } = await runWith({ onlyIds: [readOnlyNumeric.id, other.id], subset: cases, threads: 1 }, 'tools');
    const request = facade.requests[0];
    assert.match(request.authorization, /^Bearer stub-frame-/);
    assert.equal(request.body.model, 'uniwork');
    assert.equal(request.body.stream, true);
    const first = (c) => facade.requests.find((r) => r.body.messages.at(-1).content.includes(c.query.vi))?.body.tools.map((t) => t.function.name);
    assert.deepEqual(first(readOnlyNumeric), first(other));
    assert.deepEqual(first(readOnlyNumeric), Object.keys(TOOL_OPS.sheets), 'the whole module list, write tool included');
  });

  it('counts a write an injection case is tempted into: the write tool is offered, the call is executed and graded', async () => {
    const injection = pick((c) => c.category === 'injection' && modulesOfCase(c).join() === 'sheets' && c.expected.writes === 0);
    assert.ok(injection, 'the set has a sheets injection case that expects no write');
    const tempt = mutate((r, ctx) => (r.toolCalls && ctx.state.step === 0 ? { toolCalls: [...r.toolCalls, { id: 'call_inj', type: 'function', function: { name: 'propose_operations', arguments: '{"note":"injected"}' } }] } : r));
    const { docs, facade } = await runWith({ ...only(injection), model: tempt }, 'injection');
    assert.ok(facade.requests[0].body.tools.some((t) => t.function.name === 'propose_operations'));
    const ask = docs[0].asks[0];
    assert.equal(ask.writes, 1);
    assert.equal(ask.status, 'fail');
    assert.ok(ask.outsideAllowlist.includes('write_range') || ask.checks.some((c) => c.id === 'writes' && c.status === 'fail'));
  });

  it('redacts a secret-looking value in the ask, still writes and counts the run, and flags it (G712-9)', async () => {
    const leak = mutate((r) => (r.content ? { content: r.content.replace('UNIWORK_ANSWER', 'reach me at 10.20.30.40 or http://gw.example:8443/v1 with sk-abcdefgh12345678\nUNIWORK_ANSWER') } : r));
    const { docs, files } = await runWith({ ...only(readOnlyNumeric), model: leak }, 'secret');
    assert.equal(files.length, 1, 'the run is written');
    assert.equal(docs[0].status, 'completed');
    const text = fs.readFileSync(files[0], 'utf8');
    assert.doesNotMatch(text, /10\.20\.30\.40|gw\.example|sk-abcdefgh/);
    assert.match(text, /\[redacted:ipv4\]/);
    assert.deepEqual(docs[0].asks[0].redactions.map((h) => h.kind).sort(), ['host_port_url', 'ipv4', 'key']);
    assert.deepEqual(docs[0].redactions.map((r) => r.ask), docs[0].asks.map((a) => `${a.id}/${a.lang}`));
    assert.deepEqual(docs[0].asks.map((a) => a.status), ['pass', 'pass'], 'redaction happens after grading and never changes a verdict');
  });

  it('does not flag Vietnamese money as an address, and flags a bare look-alike (G712-9)', () => {
    for (const text of ['Tổng 31.337.000 đồng', 'Tổng 31,337,000 VND', 'Tổng 1.100.100.100 đồng', '₫1.100.100.100', 'Tổng 1.100.100.100 VNĐ.']) {
      assert.deepEqual(redactSecrets(text).hits, [], text);
      assert.equal(redactSecrets(text).text, text);
    }
    assert.deepEqual(redactSecrets('host 10.20.30.40.').hits, [{ kind: 'ipv4', count: 1 }]);
    assert.deepEqual(redactSecrets('Bearer abcdefghijklmnopqrstuv').hits, [{ kind: 'key', count: 1 }]);
    assert.deepEqual(redactSecrets('Tổng 1.100.100.100').hits, [{ kind: 'ipv4', count: 1 }], 'without a unit the shape is ambiguous: flagged for a human');
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

  it('turns an exception inside an ask into an errored ask: the run completes and keeps every other ask (G712-11)', async () => {
    const pair = [readOnlyNumeric, oneWrite];
    let created = 0;
    const { docs } = await runWith({
      onlyIds: pair.map((c) => c.id), subset: cases, threads: 1,
      opts: { backendFactory: (c, o) => { if (c.id === pair[0].id) throw new Error('backend exploded'); created += 1; return createBackend(c, o); } },
    }, 'exception');
    assert.equal(docs[0].status, 'completed');
    assert.equal(docs[0].asks.length, 4);
    const broken = docs[0].asks.filter((a) => a.id === pair[0].id);
    assert.ok(broken.every((a) => a.errored && a.status === 'fail' && /backend exploded/.test(a.error)));
    assert.ok(docs[0].asks.filter((a) => a.id === pair[1].id).every((a) => a.status !== 'fail' && !a.errored));
    assert.equal(created, 2);
  });

  it('fails the ask, not the run, when the model gives a tool a malformed argument (G712-11)', async () => {
    const pair = [readOnlyNumeric, oneWrite];
    const breakFirst = mutate((r, ctx) => (r.toolCalls && ctx.state.caseDoc?.id === pair[0].id && ctx.state.step === 0 ? { toolCalls: [{ id: 'call_bad', type: 'function', function: { name: 'read_cells', arguments: '{"addresses":5}' } }, ...r.toolCalls] } : r));
    const { docs } = await runWith({ onlyIds: pair.map((c) => c.id), subset: cases, model: breakFirst }, 'malformed');
    assert.equal(docs[0].status, 'completed');
    assert.equal(docs[0].asks.length, 4);
    const bad = docs[0].asks.filter((a) => a.id === pair[0].id);
    assert.ok(bad.every((a) => a.errored && a.status === 'fail' && /invalid tool arguments: read_cells/.test(a.error) && a.invalidArguments.length === 1));
    assert.ok(docs[0].asks.filter((a) => a.id === pair[1].id).every((a) => a.status !== 'fail' && !a.errored));
  });

  it('stops a run only when the harness cannot mount a fixture, keeps the asks it finished and does not start the next run (G712-11)', async () => {
    const { files, docs } = await runWith({
      runs: 3, threads: 1, onlyIds: [readOnlyNumeric.id, oneWrite.id], subset: cases,
      mount: (id, o, session, calls) => (calls > 2 ? Promise.reject(new Error('upload failed')) : session.mount(id, o)),
    }, 'aborted');
    assert.equal(files.length, 1);
    assert.equal(docs[0].status, 'aborted');
    assert.match(docs[0].reason, /cannot mount fixture .*upload failed/);
    assert.ok(docs[0].asks.length >= 1 && docs[0].asks.every((a) => a.status !== 'fail'), 'what finished is kept');
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(files[0]), 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'aborted');
    assert.equal(manifest.runs.length, 1);
  });

  it('keeps the outside-allowlist evidence of an ask that then errored (G712-14)', async () => {
    const callOutside = mutate((r, ctx) => (r.toolCalls && ctx.state.step === 0 ? { toolCalls: [{ id: 'call_o', type: 'function', function: { name: 'web_search', arguments: '{}' } }] } : r));
    const { docs } = await runWith({ ...only(readOnlyNumeric), model: callOutside, opts: { maxRetries: 0 }, threads: 1, hooks: { before: (i) => (i % 2 === 1 ? { status: 503 } : null) } }, 'errored-outside');
    const ask = docs[0].asks[0];
    assert.equal(ask.errored, true);
    assert.deepEqual(ask.outsideAllowlist, ['web_search']);
  });

  it('proves an edit from the write arguments: a claim with empty write arguments fails (G712-5)', async () => {
    assert.ok(oneWrite.expected.structural.some((s) => s.kind === 'cell' && String(s.value).trim() && !s.anchor.includes('#')), 'the edit case has a provable cell');
    const empty = mutate((r) => (r.toolCalls ? { toolCalls: r.toolCalls.map((t) => ({ ...t, function: { ...t.function, arguments: '{}' } })) } : r));
    const { docs } = await runWith({ ...only(oneWrite), model: empty }, 'edit-empty');
    const ask = docs[0].asks[0];
    assert.equal(ask.status, 'fail');
    assert.ok(ask.adapter.writeUnbacked > 0);
    const { docs: ok } = await runWith({ ...only(oneWrite) }, 'edit-ok');
    assert.notEqual(ok[0].asks[0].status, 'fail');
    assert.ok(ok[0].asks[0].adapter.writeBacked > 0);
  });
});

describe('sessions, manifest and tool surface', () => {
  it('writes one session: ids, case-set hash, a manifest with the sha256 of every run file, and never overwrites (G712-2)', async () => {
    const dir = path.join(tmpRoot, 'session');
    const facade = await startStubFacade({ model: scriptedModel(cases) });
    const session = await createServerSession({ serverUrl: facade.url });
    const subset = cases.filter((c) => c.format === 'xlsx').slice(0, 2);
    const go = () => runHoldout({ cases: subset, runs: 2, threads: 2, outDir: dir, session, transport: httpTransport(facade.url), redis: 'off', sessionId: 's-test-1', opts: { sleep: noSleep } });
    try {
      const files = await go();
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.kind, MANIFEST_KIND);
      assert.equal(manifest.sessionId, 's-test-1');
      assert.deepEqual([manifest.runsPlanned, manifest.caseCount, manifest.asksPerRun, manifest.status, manifest.partial], [2, 2, 4, 'completed', false]);
      assert.match(manifest.caseSetSha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(manifest.runs.map((r) => r.file), ['run-01.json', 'run-02.json']);
      files.forEach((f, i) => assert.equal(manifest.runs[i].sha256, sha256Hex(fs.readFileSync(f))));
      const docs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
      assert.ok(docs.every((d) => d.sessionId === 's-test-1' && d.caseCount === 2 && d.caseSetSha256 === manifest.caseSetSha256));
      await assert.rejects(go(), /already holds manifest\.json, run-01\.json, run-02\.json/);
      assert.equal(JSON.parse(fs.readFileSync(files[0], 'utf8')).sessionId, 's-test-1', 'the refused run left the files alone');
    } finally {
      await facade.close();
    }
  });

  it('hashes the case set, not its content: a different set gives a different hash', async () => {
    const a = await runWith({ onlyIds: null, subset: cases.slice(0, 2), threads: 1 }, 'hash-a');
    const b = await runWith({ onlyIds: null, subset: cases.slice(0, 3), threads: 1 }, 'hash-b');
    assert.notEqual(a.docs[0].caseSetSha256, b.docs[0].caseSetSha256);
    assert.deepEqual([a.docs[0].caseCount, b.docs[0].caseCount], [2, 3]);
    assert.ok(!JSON.stringify(a.docs[0]).includes(`"${cases[0].query.en}"`), 'the run config carries no case text');
  });

  it('records the tool surface per module and the policy in the run config (G712-8, G712-7)', async () => {
    const { docs } = await runWith({ onlyIds: [cases[0].id], subset: cases }, 'surface');
    const { config } = docs[0];
    assert.equal(config.toolSurface.sheets.source, 'devset');
    assert.equal(config.toolSurface.slides.source, 'name-only');
    // The offered/total tool counts and the dropped file tools reach the run file, so the report can print them (G712-20).
    assert.equal(config.toolSurface.sheets.offered, Object.keys(TOOL_OPS.sheets).length);
    assert.equal(config.toolSurface.sheets.frameTotal, frameToolCounts().sheets);
    assert.deepEqual(config.toolSurface.sheets.droppedFromFile, []);
    assert.match(config.toolSurfaceSha256, /^[0-9a-f]{64}$/);
    assert.equal(config.footerSha256, sha256Hex(reportingFooter()));
    assert.deepEqual([config.numbers, config.anchors, config.computeByReply, config.maxRetries, config.answerProtocol], ['strict', 'strict', true, 3, 'v1']);
    assert.match(config.harness.backend, /emulated/);
    assert.equal(config.usageReader, 'ai_usage_events');
    assert.equal(config.usageReaderError, null);
    const real = (name) => ({ type: 'function', function: { name, description: 'real', parameters: { type: 'object', properties: {} } } });
    const withFile = await runWith({ onlyIds: [cases[0].id], subset: cases, opts: { toolSchemas: { slides: Object.keys(TOOL_OPS.slides).map(real) }, toolSchemasSha256: 'a'.repeat(64) } }, 'surface-file');
    assert.equal(withFile.docs[0].config.toolSurface.slides.source, `file:${'a'.repeat(64)}`);
  });

  it('refuses a real run without --redis on|off, and without tool schemas for every module unless --allow-name-only (G712-8)', () => {
    const hollow = toolCatalogue();
    assert.throws(() => preflight({ redis: 'unknown', catalogue: hollow, allowNameOnly: true }), /--redis on\|off is required/);
    assert.throws(() => preflight({ redis: 'on', catalogue: hollow }), /no real tool schemas for module\(s\) slides, pdf, markdown, html/);
    assert.doesNotThrow(() => preflight({ redis: 'on', catalogue: hollow, allowNameOnly: true }));
    const real = (name) => ({ type: 'function', function: { name, description: 'real', parameters: { type: 'object', properties: {} } } });
    const full = toolCatalogue(Object.fromEntries(['slides', 'pdf', 'markdown', 'html'].map((m) => [m, Object.keys(TOOL_OPS[m]).map(real)])));
    assert.doesNotThrow(() => preflight({ redis: 'off', catalogue: full }));
  });

  it('records a usage reader failure in the run instead of swallowing it, and the coverage of usage rows (G712-3, G712-15)', async () => {
    const boom = await runWith({ onlyIds: [cases[0].id], subset: cases, usage: async () => { throw new Error('psql exploded 10.20.30.40'); } }, 'reader-error');
    assert.equal(boom.docs[0].status, 'completed');
    assert.match(boom.docs[0].config.usageReaderError, /psql exploded \[redacted:ipv4\]/);
    assert.deepEqual(boom.docs[0].tuple.providers, ['unknown (no ai_usage_events rows)']);
    const everyOther = async (ids) => new Map(ids.filter((_, i) => i % 2 === 0).map((id) => [id, { promptId: 'p', provider: 'x', model: 'm', status: 'succeeded', latencyMs: 10, inputTokens: 5, outputTokens: 2 }]));
    const multi = cases.find((c) => c.expected.numeric.length > 0 && c.format === 'xlsx' && c.tools.required.includes('compute'));
    const part = await runWith({ onlyIds: [multi.id], subset: cases, usage: everyOther, threads: 1 }, 'coverage');
    const tokens = part.docs[0].asks[0].tokens;
    assert.equal(tokens.source, 'ai_usage_events');
    assert.ok(tokens.callsWithRow < tokens.calls && tokens.callsWithRow >= 1, JSON.stringify(tokens));
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
    assert.throws(() => parseArgs(['--server-url', 'http://localhost:1', '--anchors', 'sloppy']), /--anchors must be strict or lenient/);
    assert.equal(parseArgs(['--server-url', 'http://localhost:1']).anchors, 'strict');
    assert.equal(parseArgs(['--server-url', 'http://localhost:1', '--anchors', 'lenient']).anchors, 'lenient');
  });

  it('resolves symlinks before deciding an --out is outside the repo (G712-15)', () => {
    const link = path.join(tmpRoot, 'link-into-repo');
    fs.symlinkSync(path.join(repoRoot, 'docs'), link);
    assert.equal(isInsideRepo(path.join(link, 'runs')), true);
    assert.throws(() => parseArgs(['--server-url', 'http://localhost:1', '--out', path.join(link, 'runs')]), /inside the repo/);
    assert.equal(isInsideRepo(path.join(tmpRoot, 'plain', 'runs')), false);
  });

  it('keeps the reference line helper in step with the reporting format', () => {
    const c = cases.find((x) => x.expected.numeric.length > 0);
    const { status, report } = parseReport(referenceLine(c));
    assert.equal(status, 'ok');
    assert.deepEqual(report.numbers, Object.values(c.referenceAnswer.numeric));
  });
});
