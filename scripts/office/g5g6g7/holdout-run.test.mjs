// Tests of the G7-12 holdout runner (UNI-1384): the tool backend, the answer adapter, the runner against a stub façade
// (deterministic, no server, no database, no upstream) and its fault handling. The cases are read at runtime from
// docs/office/g5g6g7/holdout; nothing of a case is copied here (holdout.test.mjs would fail the leak check).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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
  DEFAULT_CASES_DIR, DEFAULT_OUT_DIR, MANIFEST_KIND, MAX_STEPS, buildAsks, createServerSession, createUsageReader, firstMessages, fixtureEmails, httpTransport,
  isInsideRepo, parseArgs, preflight, redactSecrets, runHoldout, sha256Hex,
} from './holdout-run.mjs';
import { OPERATIONS, loadCases, score } from './holdout-score.mjs';
import { readWorkbook } from './holdout-xlsx-truth.mjs';
import { argumentsFor, referenceLine, scriptedModel, startStubFacade, toolsToCall } from './holdout-stub-facade.helper.mjs';

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
    assert.deepEqual(verdict(asWritten({ ops: [{ range: 'Sheet!C2:C5', formula: '=A1*2' }] })), ['fail', 'pass', 'pass'], 'a formula at a cell that expects a value proves nothing (G712-23)');
    assert.deepEqual(verdict(asWritten({ ops: [{ range: 'Sheet!F9', value: 'other' }] })), ['fail', 'pass', 'pass'], 'a write elsewhere does not back the claim');
    assert.deepEqual(verdict(asWritten({})), ['fail', 'pass', 'pass'], 'a claimed edit with empty arguments');
    assert.deepEqual(verdict(asWritten({ range: 'C3', value: 4200 }, false)), ['fail', 'pass', 'pass'], 'a refused write proves nothing');
    assert.deepEqual(verdict({ ...base, writeLog: [] }), ['fail', 'pass', 'pass'], 'no write at all');
    const out = deriveAnswer(edit, asWritten({ range: 'Sheet!F9' }));
    assert.deepEqual([out.adapter.writeBacked, out.adapter.writeUnbacked, out.adapter.writeSelfReported], [0, 1, 2]);
  });

  it('credits an edited cell only when ONE applied operation carries its address AND its value, not either alone (G712-17)', () => {
    const edit = synthCase({
      category: 'edit', tools: { allowed: ['read_range', 'write_range'], required: ['write_range'] },
      expected: { numeric: [], structural: [{ kind: 'cell', anchor: 'Q1!C3', value: '4200' }], writes: 1, mustNotContain: [] },
      referenceAnswer: { numeric: {}, structural: [{ kind: 'cell', anchor: 'Q1!C3', value: '4200' }], writes: 1, text: 'test reference' },
    });
    const line = reportFor({ items: [{ kind: 'cell', anchor: 'Q1!C3', value: '4200' }] });
    const written = (args, over = {}) => ({ reply: line, calls: [{ name: 'propose_operations' }], writes: 1, dropped: [], modules: ['sheets'], sheetNames: ['Q1', 'Q2'], writeLog: [{ name: 'propose_operations', applied: true, args }], ...over });
    const verdict = (ask) => score(edit, deriveAnswer(edit, ask).answer).checks.find((x) => x.id.startsWith('structural:')).status;
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C3', value: 4200 }] })), 'pass', 'right value at the right cell');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C3', value: 987654321 }] })), 'fail', 'wrong value at the right cell');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!ZZ900', value: 4200 }] })), 'fail', 'right value at the wrong cell');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C3', value: 1 }, { range: 'Q1!F9', value: 4200 }] })), 'fail', 'address and value in two different operations');
    assert.equal(verdict(written({ operations: [{ range: 'Q2!C3', value: 4200 }] })), 'fail', 'the same address on another sheet');
    assert.equal(verdict(written({ operations: [{ range: 'C3', sheetId: 'sheet-2', value: 4200 }] })), 'fail', 'a sheet id that resolves to another sheet');
    assert.equal(verdict(written({ operations: [{ range: 'C3', sheetId: 'sheet-1', value: 4200 }] })), 'pass', 'a sheet id that resolves to this sheet');
    assert.equal(verdict(written({ sheetId: 'Q1', operations: [{ range: 'C3', values: [[4200]] }] })), 'pass', 'the sheet inherited from the enclosing object');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!B2:D4', values: [[1, 2, 3], [4, 4200, 6], [7, 8, 9]] }] })), 'pass', 'a value matrix is read at the cell offset');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!B2:D4', values: [[1, 2, 3], [4200, 5, 6], [7, 8, 9]] }] })), 'fail', 'the value sits in the matrix at another cell');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C2:C4', values: [1, 4200, 3] }] })), 'pass', 'a one-column list');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C3', value: '4.200' }] })), 'pass', 'a Vietnamese-grouped number is the same number');
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C2:C5', formula: '=SUM(B2:B5)' }] })), 'fail', 'a formula at a cell that expects a value: the address is all it proves, so the item is unbacked (G712-23)');
    const unbacked = deriveAnswer(edit, written({ operations: [{ range: 'Q1!C2:C5', formula: '=SUM(B2:B5)' }] })).adapter;
    assert.deepEqual([unbacked.writeBacked, unbacked.writeUnbacked, unbacked.writeFormula], [0, 1, 0]);
    assert.equal(verdict(written({ operations: [{ range: 'Q1!C3', value: 4200 }] }, { writeLog: [{ name: 'propose_operations', applied: false, args: { operations: [{ range: 'Q1!C3', value: 4200 }] } }] })), 'fail', 'a refused write proves nothing');
  });

  it('scores the real xlsx edit cases from the arguments: the right cell and value pass, either alone fails (G712-17)', () => {
    const edits = cases.filter((c) => c.format === 'xlsx' && c.expected.writes > 0);
    assert.equal(edits.length, 3);
    // Blank cells are left alone and a percent probe is a format beside the cell's address, as the reference model writes them.
    const items = (c) => c.referenceAnswer.structural.filter((x) => x.kind === 'cell' && String(x.value) !== '');
    const op = ({ anchor, value }, over = {}) => {
      const probe = /^(.+)#numberFormat$/.exec(anchor);
      return probe ? { anchor: probe[1], format: value } : { anchor, value, ...over };
    };
    const run = (c, make) => {
      const backend = createBackend(c);
      backend.execute('propose_operations', JSON.stringify({ edits: items(c).map(make) }));
      const ask = { reply: `${c.referenceAnswer.text}\n${referenceLine(c)}`, calls: [{ name: 'propose_operations' }], writes: backend.writes(), writeLog: backend.writeLog(), dropped: [], modules: ['sheets'], sheetNames: backend.sheetNames(), sourceText: backend.sourceText() };
      return score(c, deriveAnswer(c, ask).answer).checks.filter((x) => x.id.startsWith('structural:')).map((x) => x.status);
    };
    for (const c of edits) {
      assert.ok(run(c, (item) => op(item)).every((st) => st === 'pass'), `${c.id}: the reference edit`);
      assert.ok(run(c, (item) => op(item, { value: 987654321 })).includes('fail'), `${c.id}: a wrong value at the right cells`);
      assert.ok(run(c, (item) => op({ ...item, anchor: `${item.anchor.split('!')[0]}!ZZ900` })).includes('fail'), `${c.id}: the right values at the wrong cell`);
    }
  });

  it('credits a formula at the cell only for an item that expects a formula, and counts it (G712-23)', () => {
    const formulaCase = synthCase({
      category: 'edit', tools: { allowed: ['read_range', 'write_range'], required: ['write_range'] },
      expected: { numeric: [], structural: [{ kind: 'formula', anchor: 'Q1!C3', value: '=SUM(B2:B5)' }], writes: 1, mustNotContain: [] },
      referenceAnswer: { numeric: {}, structural: [{ kind: 'formula', anchor: 'Q1!C3', value: '=SUM(B2:B5)' }], writes: 1, text: 'test reference' },
    });
    const line = reportFor({ items: [{ kind: 'formula', anchor: 'Q1!C3', value: '=SUM(B2:B5)' }] });
    const written = (args) => ({ reply: line, calls: [{ name: 'propose_operations' }], writes: 1, dropped: [], modules: ['sheets'], sheetNames: ['Q1'], writeLog: [{ name: 'propose_operations', applied: true, args }] });
    const out = deriveAnswer(formulaCase, written({ operations: [{ range: 'Q1!C2:C5', formula: '=SUM(B2:B5)' }] }));
    assert.equal(score(formulaCase, out.answer).checks.find((x) => x.id.startsWith('structural:')).status, 'pass', 'a formula expectation is credited by a formula at its cell');
    assert.deepEqual([out.adapter.writeBacked, out.adapter.writeUnbacked, out.adapter.writeFormula], [1, 0, 1]);
    const elsewhere = deriveAnswer(formulaCase, written({ operations: [{ range: 'Q1!F9', formula: '=SUM(B2:B5)' }] }));
    assert.deepEqual([elsewhere.adapter.writeBacked, elsewhere.adapter.writeUnbacked, elsewhere.adapter.writeFormula], [0, 1, 0], 'the address still has to be the right one');
  });

  it('credits a formula at a formula item only when it equals the expected formula after normalising (G712-25)', () => {
    const formulaCase = synthCase({
      category: 'edit', tools: { allowed: ['read_range', 'write_range'], required: ['write_range'] },
      expected: { numeric: [], structural: [{ kind: 'formula', anchor: 'Q1!C3', value: '=SUM(B2:B5)' }], writes: 1, mustNotContain: [] },
      referenceAnswer: { numeric: {}, structural: [{ kind: 'formula', anchor: 'Q1!C3', value: '=SUM(B2:B5)' }], writes: 1, text: 'test reference' },
    });
    const line = reportFor({ items: [{ kind: 'formula', anchor: 'Q1!C3', value: '=SUM(B2:B5)' }] });
    const outcome = (formula) => {
      const out = deriveAnswer(formulaCase, { reply: line, calls: [{ name: 'propose_operations' }], writes: 1, dropped: [], modules: ['sheets'], sheetNames: ['Q1'], writeLog: [{ name: 'propose_operations', applied: true, args: { operations: [{ range: 'Q1!C3', formula }] } }] });
      return [score(formulaCase, out.answer).checks.find((x) => x.id.startsWith('structural:')).status, out.adapter.writeBacked, out.adapter.writeUnbacked, out.adapter.writeFormula];
    };
    assert.deepEqual(outcome('=1+1'), ['fail', 0, 1, 0], 'a wrong formula at the right cell fails');
    assert.deepEqual(outcome('=SUM(B2:B6)'), ['fail', 0, 1, 0], 'another range fails');
    assert.deepEqual(outcome('=SUM(B2:B5)'), ['pass', 1, 0, 1]);
    assert.deepEqual(outcome('= sum( $B$2 : $B$5 )'), ['pass', 1, 0, 1], 'case, spaces and absolute references are normalised');
    assert.deepEqual(outcome('SUM(B2:B5)'), ['fail', 0, 1, 0], 'a text without the leading = is no formula write');
  });

  it('decides the formula branch by the expectation when the case spells its formula without a leading = (G712-27)', () => {
    const bare = { kind: 'formula', anchor: 'Q1!C3', value: 'SUM(B2:B5)' };
    const bareCase = synthCase({
      category: 'edit', tools: { allowed: ['read_range', 'write_range'], required: ['write_range'] },
      expected: { numeric: [], structural: [bare], writes: 1, mustNotContain: [] },
      referenceAnswer: { numeric: {}, structural: [bare], writes: 1, text: 'test reference' },
    });
    const line = reportFor({ items: [bare] });
    const outcome = (formula) => {
      const out = deriveAnswer(bareCase, { reply: line, calls: [{ name: 'propose_operations' }], writes: 1, dropped: [], modules: ['sheets'], sheetNames: ['Q1'], writeLog: [{ name: 'propose_operations', applied: true, args: { operations: [{ range: 'Q1!C3', formula }] } }] });
      return [out.adapter.writeBacked, out.adapter.writeUnbacked, out.adapter.writeFormula];
    };
    assert.deepEqual(outcome('SUM(B2:B5)'), [1, 0, 1], 'the leaf equal to the expected formula is the formula, with or without the =');
    assert.deepEqual(outcome('=SUM(B2:B5)'), [1, 0, 1]);
    assert.deepEqual(outcome('= sum( $B$2 : $B$5 )'), [1, 0, 1]);
    assert.deepEqual(outcome('=1+1'), [0, 1, 0], 'a wrong formula still fails');
    assert.deepEqual(outcome('SUM(B2:B6)'), [0, 1, 0], 'another range fails whatever its =');
    assert.deepEqual(outcome('hello'), [0, 1, 0], 'a text that is not the formula is not credited');
  });

  it('judges the real formula-expecting case (read at runtime) by the formula text (G712-25)', () => {
    const real = cases.find((c) => c.expected.structural.some((x) => x.kind === 'formula'));
    assert.ok(real, 'the set has a formula-expecting case');
    // The real case reads only (writes: 0); an edit variant of it is what makes the write proof reachable.
    const edit = { ...real, category: 'edit', tools: { allowed: [...real.tools.allowed, 'write_range'], required: ['write_range'] }, expected: { ...real.expected, numeric: [], writes: 1 } };
    const items = edit.expected.structural.filter((x) => x.kind === 'formula');
    const line = reportFor({ items });
    const run = (make) => {
      const backend = createBackend(edit);
      backend.execute('propose_operations', JSON.stringify({ edits: items.map(make) }));
      const out = deriveAnswer(edit, { reply: line, calls: [{ name: 'propose_operations' }], writes: backend.writes(), writeLog: backend.writeLog(), dropped: [], modules: ['sheets'], sheetNames: backend.sheetNames(), sourceText: backend.sourceText() });
      return [out.adapter.writeBacked, out.adapter.writeUnbacked, out.adapter.writeFormula];
    };
    assert.deepEqual(run((x) => ({ anchor: x.anchor, formula: `=${x.value}` })), [items.length, 0, items.length], 'the expected formulas credit');
    assert.deepEqual(run((x) => ({ anchor: x.anchor, formula: '=1+1' })), [0, items.length, 0], 'wrong formulas do not');
  });

  it('does not pass a real xlsx value edit written with wrong formulas (G712-23)', () => {
    const edits = cases.filter((c) => c.format === 'xlsx' && c.expected.writes > 0 && c.expected.structural.some((x) => x.kind === 'cell' && !x.anchor.includes('#') && String(x.value) !== ''));
    assert.ok(edits.length >= 1);
    for (const c of edits) {
      const backend = createBackend(c);
      const cellItems = c.referenceAnswer.structural.filter((x) => x.kind === 'cell' && !x.anchor.includes('#') && String(x.value) !== '');
      backend.execute('propose_operations', JSON.stringify({ edits: cellItems.map((x) => ({ anchor: x.anchor, formula: '=1+1' })) }));
      const ask = { reply: `${c.referenceAnswer.text}\n${referenceLine(c)}`, calls: [{ name: 'propose_operations' }], writes: backend.writes(), writeLog: backend.writeLog(), dropped: [], modules: ['sheets'], sheetNames: backend.sheetNames(), sourceText: backend.sourceText() };
      const out = deriveAnswer(c, ask);
      assert.equal(score(c, out.answer).status, 'fail', `${c.id}: wrong formulas are no edit`);
      assert.equal(out.adapter.writeFormula, 0, c.id);
      assert.ok(out.adapter.writeUnbacked >= cellItems.length, `${c.id}: every value item is unbacked`);
    }
  });

  describe('edit scoring of the 11 real edit cases (G712-16)', () => {
    const edits = cases.filter((c) => c.expected.writes > 0);
    // Per case: the items an applied write must back (introduced), those the document already held (preserved) and the counts.
    const SPLIT = {
      'HO-CROSS-020': { backed: 0, preserved: 1, counts: 2 },
      'HO-DOCX-012': { backed: 0, preserved: 1, counts: 3 },
      'HO-DOCX-013': { backed: 0, preserved: 0, counts: 3 },
      'HO-DOCX-014': { backed: 0, preserved: 0, counts: 4 },
      'HO-PPTX-004': { backed: 0, preserved: 2, counts: 2 },
      'HO-PDF-005': { backed: 1, preserved: 0, counts: 1 },
      'HO-MD-004': { backed: 0, preserved: 0, counts: 4 },
      'HO-HTML-002': { backed: 1, preserved: 2, counts: 2 },
      'HO-XLSX-028': { backed: 7, preserved: 0, counts: 1 },
      'HO-XLSX-029': { backed: 6, preserved: 0, counts: 1 },
      'HO-XLSX-030': { backed: 4, preserved: 2, counts: 1 },
    };

    /** One ask over the real case: the reference reply, every required read, and the write tool called with `args` (null = not called). */
    function ask(c, args) {
      const backend = createBackend(c);
      const names = toolsToCall(c, offeredTools(c));
      const writeTool = names.find((n) => opsOfTool(modulesOfCase(c), n).some((op) => op === 'write_range' || op === 'edit_paragraph'));
      assert.ok(writeTool, `${c.id}: a write tool is offered`);
      for (const name of names) backend.execute(name, name === writeTool ? (args === null ? '{}' : JSON.stringify(args)) : '{}');
      const input = { reply: `${c.referenceAnswer.text}\n${referenceLine(c)}`, calls: names.map((name) => ({ name })), writes: backend.writes(), writeLog: backend.writeLog(), dropped: [], modules: modulesOfCase(c), sheetNames: backend.sheetNames(), sourceText: backend.sourceText() };
      const out = deriveAnswer(c, input);
      const result = score(c, out.answer);
      return { backend, writeTool, adapter: out.adapter, result, check: (id) => result.checks.find((x) => x.id === id)?.status };
    }
    const writeOp = (c) => c.tools.required.find((op) => op === 'write_range' || op === 'edit_paragraph');
    const correct = (c) => JSON.parse(argumentsFor(c, toolsToCall(c, offeredTools(c)).find((n) => opsOfTool(modulesOfCase(c), n).some((op) => op === writeOp(c)))));

    it('covers the 11 real edit cases', () => {
      assert.deepEqual(edits.map((c) => c.id).sort(), Object.keys(SPLIT).sort());
    });

    it('fails an edit that was only a dry run, even with the right content (a)', () => {
      for (const c of edits) {
        const r = ask(c, { ...correct(c), dryRun: true });
        assert.equal(r.backend.writes(), 0, `${c.id}: a dry run is not a write`);
        assert.equal(r.result.status, 'fail', `${c.id}: dry run only`);
        assert.equal(r.check(`tool_required:${writeOp(c)}`), 'fail', `${c.id}: the write operation is not used`);
        assert.equal(r.adapter.noAppliedWrite, true, `${c.id}: flagged as no applied write`);
      }
    });

    it('fails an edit whose applied write is `{}`, or has nothing but a note (b)', () => {
      for (const c of edits) {
        for (const args of [{}, { note: 'edit applied', dryRun: false }]) {
          const r = ask(c, args);
          assert.equal(r.backend.writes(), 1, `${c.id}: the empty write was applied`);
          assert.equal(r.result.status, 'fail', `${c.id}: ${JSON.stringify(args)}`);
          assert.equal(r.check(`tool_required:${writeOp(c)}`), 'fail', c.id);
          assert.equal(r.adapter.noAppliedWrite, true, c.id);
        }
      }
    });

    it('fails an edit whose applied write is unrelated to it (c)', () => {
      for (const c of edits) {
        const sheets = c.format === 'xlsx';
        // A sheet edit elsewhere with a value of its own; a text edit that only writes back a line the document already holds.
        const first = createBackend(c).sourceText().split('\n').find((line) => line.trim().length > 3);
        const args = sheets ? { edits: [{ anchor: 'Doanh thu Q1!ZZ900', value: 'unrelated' }] } : { text: first };
        const r = ask(c, args);
        assert.equal(r.result.status, 'fail', `${c.id}: unrelated write`);
        assert.ok(r.result.checks.some((x) => x.status === 'fail'), c.id);
        if (!sheets) {
          assert.equal(r.check(`tool_required:${writeOp(c)}`), 'fail', `${c.id}: a write of what is already there is no edit`);
          assert.equal(r.adapter.noAppliedWrite, true, c.id);
        }
      }
    });

    it('passes the correct applied write, with the introduced items backed and the preserved ones labelled self-reported (d)', () => {
      for (const c of edits) {
        const r = ask(c, correct(c));
        assert.ok(r.result.checks.every((x) => x.status !== 'fail'), `${c.id}: ${JSON.stringify(r.result.checks.filter((x) => x.status === 'fail'))}`);
        assert.equal(r.check(`tool_required:${writeOp(c)}`), 'pass', c.id);
        assert.equal(r.adapter.noAppliedWrite, false, c.id);
        const want = SPLIT[c.id];
        assert.deepEqual(
          [r.adapter.writeBacked, r.adapter.writeUnbacked, r.adapter.writeSelfPreserved, r.adapter.writeSelfReported - r.adapter.writeSelfPreserved],
          [want.backed, 0, want.preserved, want.counts],
          `${c.id}: backed / unbacked / self-reported (preserved) / self-reported (counts)`,
        );
      }
    });

    it('fails an introduced value that no applied write carries, while the edit itself is applied', () => {
      const introducing = edits.filter((c) => SPLIT[c.id].backed > 0);
      assert.equal(introducing.length, 5);
      for (const c of introducing) {
        const r = ask(c, { text: 'new words that are not the edit values', edits: [{ anchor: 'Doanh thu Q1!ZZ900', value: 'elsewhere' }] });
        assert.equal(r.check(`tool_required:${writeOp(c)}`), 'pass', `${c.id}: the write is applied and contentful`);
        assert.equal(r.adapter.writeBacked, 0, c.id);
        assert.equal(r.adapter.writeUnbacked, SPLIT[c.id].backed, `${c.id}: every introduced item is unbacked`);
        assert.equal(r.result.status, 'fail', `${c.id}: the item fails`);
      }
    });

    it('does not mistake an edited heading or cell for one the document already held', () => {
      const html = edits.find((c) => c.id === 'HO-HTML-002');
      const source = createBackend(html).sourceText();
      assert.ok(source.toLowerCase().includes('doanh thu quý 1 theo khu vực'), 'the old heading holds most of the new one as text');
      const r = ask(html, { text: 'Doanh thu quý 1 theo khu vực' });
      assert.equal(r.adapter.writeUnbacked, 1, 'a partial text does not back the new heading');
    });
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

async function runWith({ model, onlyIds = null, runs = 1, threads = 2, hooks, delayMs = 0, mintDelayMs = 0, toolRoundLimit = 8, announceSteps = true, opts = {}, usage = usageReader, subset = null, mount = null }, dirName) {
  const facade = await startStubFacade({ model: model ?? scriptedModel(cases), hooks, delayMs, mintDelayMs, toolRoundLimit, announceSteps });
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
    assert.deepEqual(ask.counts, { rateLimited: 0, serverErrors: 0, retries: 0 });
    assert.deepEqual(ask.renewals.filter((r) => r.kind !== 'mount_wait'), [], 'a reference run renews nothing (waiting for a shared mount is not a renewal, G712-70)');
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
    assert.deepEqual(ask.counts, { rateLimited: 2, serverErrors: 1, retries: 3 });
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

  it('mints a fresh frame token for the same document once after a 401 and carries on', async () => {
    // One thread: two lanes fire their first call together, so which ask takes the forced 401 is a race; the retry policy
    // is not about concurrency, and the ask order of one lane is the list order.
    const { docs, mounts, facade } = await runWith({ ...only(readOnlyNumeric), threads: 1, hooks: { before: (i) => (i === 0 ? { status: 401 } : null) } }, 'remount');
    const ask = docs[0].asks[0];
    assert.equal(ask.status, 'pass');
    assert.equal(ask.renewals.length, 1);
    assert.equal(ask.renewals[0].kind, 'frame');
    assert.ok(Number.isFinite(ask.renewals[0].ms) && ask.renewals[0].ms >= 0);
    assert.equal(ask.calls[1].renewed, 'frame', 'the retried call names the renewal it followed');
    assert.ok(mounts.some((m) => m.fresh === true));
    assert.equal(facade.stats.uploads, 1, 'the document still exists: the fixture is not uploaded twice');
    assert.equal(facade.stats.mints, 2, 'the mount mint, then the renewal');
  });

  it('ends an ask that never stops calling tools at the run cap: nine model calls, cap_reached, no tenth call (G7-12 run409)', async () => {
    const forever = mutate((r, ctx) => ({ toolCalls: [{ id: `call_${ctx.state.step}`, type: 'function', function: { name: 'read_range', arguments: '{}' } }] }));
    const { docs, facade } = await runWith({ ...only(readOnlyNumeric), model: forever, threads: 1 }, 'limit');
    assert.equal(docs[0].status, 'completed');
    for (const ask of docs[0].asks) {
      assert.equal(ask.modelTurns, MAX_STEPS, '1 question turn + 8 tool rounds');
      assert.equal(ask.calls.length, MAX_STEPS, 'the tenth call of a run is never sent');
      assert.deepEqual(ask.capReached, { kind: 'tool_rounds', step: 8, limit: 8, refused: false });
      assert.equal(ask.errored, false, 'a cap-ended ask is not an error');
      assert.equal(ask.error, null);
      assert.equal(ask.status, 'fail', 'scored on what it produced: no final reply, no reporting line');
    }
    assert.equal(facade.requests.length, 2 * MAX_STEPS, 'nothing past the cap reached the façade');
  });

  it('reads the cap from every answer: a run whose limit is spent ends there, not at MAX_STEPS (G7-12 run409)', async () => {
    const forever = mutate((r, ctx) => ({ toolCalls: [{ id: `call_${ctx.state.step}`, type: 'function', function: { name: 'read_range', arguments: '{}' } }] }));
    const { docs, facade } = await runWith({ ...only(readOnlyNumeric), model: forever, threads: 1, toolRoundLimit: 2 }, 'limit-low');
    for (const ask of docs[0].asks) {
      assert.equal(ask.calls.length, 3, 'two tool rounds spent: the third call is the last of the run');
      assert.deepEqual(ask.capReached, { kind: 'tool_rounds', step: 2, limit: 2, refused: false });
      assert.equal(ask.errored, false);
    }
    assert.equal(facade.requests.length, 6, 'the stop follows the announced limit, not the ninth call');
  });

  it('treats a final answer that lands exactly on the cap as a natural finish: no cap metadata, no extra call, scored normally (G712-R13-1/2)', async () => {
    // The model spends the announced cap on tool rounds and then answers for real on the last one (step == limit): no
    // tool call is pending, so the cap did not cut the ask off - it ends by itself, exactly like a pre-cap final.
    const roundsThenFinal = (rounds) => ({ body, state }) => {
      if (state.step >= rounds) return { content: `${readOnlyNumeric.referenceAnswer.text}\n${referenceLine(readOnlyNumeric)}` };
      const names = toolsToCall(readOnlyNumeric, body.tools ?? []);
      return { toolCalls: names.map((name, i) => ({ id: `call_${state.step}_${i}`, type: 'function', function: { name, arguments: argumentsFor(readOnlyNumeric, name) } })) };
    };
    const atCap = await runWith({ ...only(readOnlyNumeric), model: roundsThenFinal(2), threads: 1, toolRoundLimit: 2 }, 'final-at-cap');
    for (const ask of atCap.docs[0].asks) {
      assert.equal(ask.calls.length, 3, 'limit + 1 calls: two tool rounds and the final answer at step == limit');
      assert.equal(ask.modelTurns, 3);
      assert.equal(ask.capReached, null, 'a final answer with no pending tool call is not a cap stop; the record keeps the field null');
      assert.equal(ask.errored, false);
      assert.equal(ask.status, 'pass', 'the final reply is scored like any other answer');
      assert.ok(ask.checks.some((c) => c.id.startsWith('numeric:') && c.status === 'pass'), 'the numeric check ran on the final reply');
    }
    assert.equal(atCap.facade.requests.length, 6, 'nothing past the final answer: limit + 1 calls for each of the two asks');

    const beforeCap = await runWith({ ...only(readOnlyNumeric), model: roundsThenFinal(1), threads: 1, toolRoundLimit: 2 }, 'final-before-cap');
    for (const ask of beforeCap.docs[0].asks) {
      assert.equal(ask.calls.length, 2, 'one tool round and the final answer, before the cap');
      assert.equal(ask.capReached, null);
      assert.equal(ask.errored, false);
      assert.equal(ask.status, 'pass');
    }
  });

  it('never sends a tenth call even when the answer carries no step/limit (G7-12 run409)', async () => {
    const forever = mutate((r, ctx) => ({ toolCalls: [{ id: `call_${ctx.state.step}`, type: 'function', function: { name: 'read_range', arguments: '{}' } }] }));
    const { docs, facade } = await runWith({ ...only(readOnlyNumeric), model: forever, threads: 1, announceSteps: false }, 'limit-unannounced');
    for (const ask of docs[0].asks) {
      assert.equal(ask.calls.length, MAX_STEPS);
      assert.deepEqual(ask.capReached, { kind: 'tool_rounds', step: null, limit: null, refused: false }, 'no announced cap: the nine calls of a full run are the stop');
    }
    assert.equal(facade.requests.length, 2 * MAX_STEPS);
  });

  it('ends an ask at a 409 run_limit_reached: cap_reached with the refusal\'s limit, never an ask error (G7-12 run409)', async () => {
    // Every second request is the tool-result turn of an ask: forced to the refusal the run409 report §2 shows on the wire.
    const body = { error: { code: 'run_limit_reached', message: 'hết trần', fields: { limit: 'tool_rounds' } } };
    const { docs, facade } = await runWith({
      ...only(readOnlyNumeric), threads: 1, hooks: { before: (i) => (i % 2 === 1 ? { status: 409, body } : null) },
    }, 'refused');
    assert.equal(docs[0].status, 'completed', 'a refusal ends an ask, it never aborts the run');
    assert.equal(docs[0].asks.filter((a) => a.errored).length, 0, 'a cap refusal is not counted as an error');
    for (const ask of docs[0].asks) {
      assert.deepEqual(ask.capReached, { kind: 'tool_rounds', step: 0, limit: 8, refused: true }, 'the refusal\'s fields.limit is the recorded cap');
      assert.deepEqual(ask.calls.map((c) => c.status), [200, 409], 'the refusal is a call, not a retry');
      assert.equal(ask.calls.at(-1).refusal, 'run_limit_reached');
      assert.equal(ask.error, null);
      assert.equal(ask.status, 'fail', 'scored on what the model produced before the refusal');
    }
    assert.equal(facade.requests.length, 4, 'a refusal is never retried');
  });

  it('keeps a 409 conversation_expired or run_expired a real ask error: only the cap ends an ask quietly (G7-12 run409)', async () => {
    for (const code of ['conversation_expired', 'run_expired']) {
      const body = { error: { code, message: 'hội thoại hoặc run đã hết' } };
      const { docs } = await runWith({ ...only(readOnlyNumeric), threads: 1, hooks: { before: (i) => (i === 1 ? { status: 409, body } : null) } }, `refused-${code}`);
      const [ask] = docs[0].asks;
      assert.equal(ask.errored, true, code);
      assert.equal(ask.capReached, null, code);
      assert.equal(ask.status, 'fail', code);
      assert.match(ask.error, new RegExp(`HTTP 409.*${code}`), code);
      assert.equal(docs[0].status, 'completed', 'one errored ask does not abort the run');
    }
  });

  it('replays setup.history before the question and runs the case through the same path', async () => {
    const withHistory = pick((c) => c.setup?.history);
    const { docs, facade } = await runWith({ ...only(withHistory) }, 'history');
    // The vi ask's own request: with two lanes the two asks' first calls arrive in whichever order, so requests[0] is not it.
    const first = facade.requests.find((r) => r.body.messages.at(-1).content.includes(withHistory.query.vi)).body.messages;
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
    assert.deepEqual(redactSecrets('Tổng 10.100.100.100').hits, [{ kind: 'ipv4', count: 1 }], 'without a unit and a lead of two digits the shape is ambiguous: flagged for a human');
    // G712-40: the one-digit lead is kept in the money context only, never by the shape alone: a bare quad, a portless
    // URL host and a quad before a port are redacted and flagged, so no upstream-shaped value is written unlisted.
    assert.deepEqual(redactSecrets('Tổng 1.100.100.100').hits, [{ kind: 'ipv4', count: 1 }], 'a one-digit lead without a money marker is no longer kept (G712-40)');
    assert.deepEqual(redactSecrets('1.100.100.100').hits, [{ kind: 'ipv4', count: 1 }], 'a bare one-digit-lead quad is flagged');
    assert.deepEqual(redactSecrets('gọi http://1.100.100.100/v1 ngay').hits, [{ kind: 'ipv4', count: 1 }], 'a portless URL host is flagged');
    assert.deepEqual(redactSecrets('gọi 1.100.100.100:8080 ngay').hits, [{ kind: 'ipv4', count: 1 }], 'a quad before a port is flagged');
    assert.deepEqual(redactSecrets('số 2.100.100.100').hits, [], 'the amount word is the money context (G712-40)');
    assert.deepEqual(redactSecrets('Tổng 2.100.100.100 đồng').hits, [], 'a currency unit is the money context');
  });

  it('also redacts bearer tokens, provider keys, JWTs, userinfo URLs, long hex/base64 runs and private hosts, never money or dates (G712-10)', () => {
    const cases10 = [
      ['authorization: bearer abcdefghijklmnop1234', 'key'],
      ['key sk-live1234abcd5678', 'key'],
      ['key ak-ABCD1234efgh5678', 'key'],
      ['key xai-ABCD1234efgh5678', 'key'],
      ['token ghp_abcdefghijklmnopqrstuvwxyz0123', 'key'],
      ['id AKIAABCDEFGHIJKLMNOP', 'key'],
      ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw.abc123_-xyz', 'jwt'],
      ['open https://user:s3cretpw@gw.example/v1/x now', 'userinfo_url'],
      ['open https://tok3nvalue@gw.example/v1/x now', 'userinfo_url'],
      ['call gw.corp.example:8443 now', 'private_host'],
      ['call build-box.internal today', 'private_host'],
      ['call localhost:5432 today', 'private_host'],
      ['call 10.20.30.40:8443 today', 'ipv4'],
      ['call [fd00::1]:8443 today', 'ipv6'],
      ['call 2001:db8:85a3:0:0:8a2e:370:7334 today', 'ipv6'],
      [`digest ${'a1b2c3d4'.repeat(8)}`, 'hex_run'],
      [`blob ${'Ab3dE6gH9kLm'.repeat(4)}`, 'base64_run'],
      ['api_key=zx81abcd5678efgh', 'credential'],
      ['call 2.100.100.100:8080 today', 'ipv4'],
      ['call 10.100.100.100 today', 'ipv4'],
      ['blob q3Vh9Z/Lm2Xk+Rt7PwB4nYcD8sE1fGjH6aKoUiT0vNxM5zQ', 'base64_run'],
    ];
    for (const [text, kind] of cases10) {
      const out = redactSecrets(text);
      assert.deepEqual(out.hits.map((h) => h.kind), [kind], text);
      assert.match(out.text, new RegExp(`\\[redacted:${kind}\\]`), text);
    }
    const harmless = [
      'Tổng 31.337.000 đồng và 1.100.100.100 VNĐ', 'Doanh thu Q1!G8 = SUM(G2:G7), Q1!B2:B5', 'Ngày 2026-10-15T09:30:00+07:00 và 15/10/2026 lúc 09:30:45',
      'Tổng 22060000 VND (31,337,000)', 'tokens: 5600000, input_tokens: 123456789', 'Xem report.xlsx:2026 và Sheet1.A1:B2', 'Thời hạn 12:30, tỷ lệ 10:1',
      'trace 0123456789abcdef0123456789abcdef',
      // G712-26: a slash-joined path, a long CamelCase identifier and a dotted number with a one-digit lead are not secrets.
      'tệp /home/ubuntu/orca/workspaces/uniwork/feature-UNI-1384-g7-12-holdout-eval/scripts/office/g5g6g7/holdout-run.mjs',
      'xem docs/office/g5g6g7/holdout/cases/HO-XLSX-023.json và packages/views/layout/module-icons.ts',
      'lớp aVeryLongCamelCaseIdentifierWithNumbers12345 và AbstractSingletonProxyFactoryBean2WithExtras12345',
      'số 2.100.100.100',
      'Một đoạn văn tiếng Việt dài không có bí mật nào cả, chỉ có chữ và số 12345.',
    ];
    for (const text of harmless) assert.deepEqual(redactSecrets(text), { text, hits: [] }, text);
  });

  it('redacts an email as a soft kind, and keeps an address the case set itself carries (G712-62)', () => {
    const email = 'g712-holdout-test@example.com';
    const flagged = redactSecrets(`sign-in for ${email} was refused`);
    assert.deepEqual(flagged.hits, [{ kind: 'email', count: 1 }]);
    assert.equal(flagged.text, 'sign-in for [redacted:email] was refused');
    // Exact provenance, not a broad pattern: the case's own address stays, another address beside it still goes.
    const exemptEmails = new Set([email]);
    assert.deepEqual(redactSecrets(`write to ${email} today`, { exemptEmails }), { text: `write to ${email} today`, hits: [] });
    const mixed = redactSecrets(`write to ${email} or bookkeeping@example.com`, { exemptEmails });
    assert.deepEqual(mixed.hits, [{ kind: 'email', count: 1 }], 'only the exact address the cases carry is exempt');
    assert.equal(mixed.text, `write to ${email} or [redacted:email]`);
  });

  it('reads the emails a case set really carries, so the runner exempts exactly them (G712-62)', () => {
    const synthetic = [
      { id: 'S-1', query: { vi: 'thư gửi ops@example.org' }, referenceAnswer: { text: 'gửi ops@example.org và kế toán', structural: [{ value: 'ops@example.org' }] } },
      { id: 'S-2', query: { vi: 'không có địa chỉ nào' } },
    ];
    assert.deepEqual([...fixtureEmails(synthetic)], ['ops@example.org'], 'every address-shaped value of the loaded case data is read');
    assert.deepEqual([...fixtureEmails([])], [], 'a case set without an address exempts nothing');
  });

  it('reports an address-shaped secret under its hard kind, so it still voids a run (G712-71, G712-80)', async () => {
    // The soft address rule (G712-62) runs last: a value that is also a key, a credential assignment or a private host
    // keeps the hard kind, and with it the flag that keeps the run out of a pass.
    assert.deepEqual(redactSecrets('key sk-abcdefgh1234@example.com').hits, [{ kind: 'key', count: 1 }], 'an address-shaped key is a key');
    assert.deepEqual(redactSecrets('api_key=abc12345def67890@example.com').hits, [{ kind: 'credential', count: 1 }], 'an address-shaped credential assignment is a credential');
    assert.deepEqual(redactSecrets('mail user@gw.corp.example:8443').hits, [{ kind: 'private_host', count: 1 }], 'a private host carrying an address is a private host');
    for (const addr of ['ops@acme.corp', 'ops@server.internal', 'ops@printer.local']) {
      assert.deepEqual(redactSecrets(`contact ${addr} today`).hits, [{ kind: 'private_host', count: 1 }], `${addr}: a portless private-zone address is still hard (G712-80)`);
    }
    assert.deepEqual(redactSecrets('ops@example.com').hits, [{ kind: 'email', count: 1 }], 'a bare address stays the soft kind that never voids a run');
    assert.deepEqual(redactSecrets('write to ops@example.com today', { exemptEmails: new Set(['ops@example.com']) }), { text: 'write to ops@example.com today', hits: [] }, 'the exact-address exemption still holds');
    // Through the runner: the run file lists the hard kind, which the report turns into "a flagged run cannot count as a pass".
    const leak = mutate((r) => (r.content ? { content: r.content.replace('UNIWORK_ANSWER', 'write to sk-abcdefgh1234@example.com\nUNIWORK_ANSWER') } : r));
    const { docs, files } = await runWith({ ...only(readOnlyNumeric), model: leak }, 'secret-address');
    assert.doesNotMatch(fs.readFileSync(files[0], 'utf8'), /sk-abcdefgh1234@example\.com/);
    assert.deepEqual(docs[0].asks.map((a) => a.redactions.map((h) => h.kind)), [['key'], ['key']], 'the ask lists the hard kind, not the soft address kind');
    assert.deepEqual(docs[0].asks.map((a) => a.status), ['pass', 'pass'], 'redaction happens after grading and never changes a verdict');
  });

  it('keeps the base64 guard\'s miss rate at or under the number its comment documents (G712-41)', () => {
    // The comment on looksEncoded documents the measurement (2.2% of 40-character blobs missed on 100000 random blobs, 2026-10-16).
    // This is a deterministic sample of the same population: same blobs every run, so a guard that got worse fails here and an
    // improvement passes; the bound is the measured 2.3%.
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let a = 20261016;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let missed = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      const blob = Array.from({ length: 40 }, () => ALPHABET[Math.floor(next() * 64)]).join('');
      missed += redactSecrets(blob).hits.length === 0 ? 1 : 0;
    }
    assert.ok(missed / samples <= 0.023, `the base64 guard missed ${missed}/${samples} random 40-character blobs (measured 2.2% when the number was documented)`);
  });

  it('keeps the per-ask redaction: a leaked token is redacted in the written run, the run counted and flagged (G712-10)', async () => {
    const leak = mutate((r) => (r.content ? { content: r.content.replace('UNIWORK_ANSWER', 'see https://svc-user:pw12345678@gw.corp.example:8443/v1 and bearer abcdefghijklmnop1234\nUNIWORK_ANSWER') } : r));
    const { docs, files } = await runWith({ ...only(readOnlyNumeric), model: leak }, 'secret-wide');
    assert.equal(files.length, 1);
    const text = fs.readFileSync(files[0], 'utf8');
    assert.doesNotMatch(text, /pw12345678|gw\.corp\.example|abcdefghijklmnop1234/);
    assert.ok(docs[0].asks[0].redactions.length > 0);
    assert.deepEqual(docs[0].asks.map((a) => a.status), ['pass', 'pass']);
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

describe('token renewal mid-run (G7-12 pilot blocker)', () => {
  // Two cases over two different fixtures: the mount cache then holds two documents, so a renewal can be told from an upload.
  const firstOfEachFixture = [...new Map(cases.map((c) => [c.fixtures[0].id, c])).values()].slice(0, 2);
  const one = firstOfEachFixture[0];
  const only = (c) => ({ onlyIds: [c.id], subset: cases });

  it('renews an expired session and an expired frame token: the run completes, both are counted and no fixture is re-uploaded', async () => {
    const dir = path.join(tmpRoot, 'renew');
    const password = 'Holdout-Test-Pw!';
    const email = 'g712-holdout-test@example.com';
    const facade = await startStubFacade({ model: scriptedModel(cases), sessionExpiresAfterCalls: 2, frameExpiresAfterCalls: 2 });
    const session = await createServerSession({ serverUrl: facade.url, email, password });
    const lines = [];
    try {
      const files = await runHoldout({
        cases, runs: 1, threads: 2, outDir: dir, session, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: firstOfEachFixture.map((c) => c.id), sessionId: 's-renew', opts: { sleep: noSleep }, log: (line) => lines.push(line),
      });
      const text = fs.readFileSync(files[0], 'utf8');
      const doc = JSON.parse(text);
      assert.equal(doc.status, 'completed');
      assert.equal(doc.asks.length, 4);
      assert.deepEqual(doc.asks.filter((a) => a.errored).map((a) => `${a.id}/${a.lang}: ${a.error}`), []);
      assert.ok(doc.renewals.session >= 1, `a session renewal was counted: ${JSON.stringify(doc.renewals)}`);
      assert.ok(doc.renewals.frame >= 1, `a frame renewal was counted: ${JSON.stringify(doc.renewals)}`);
      assert.equal(facade.stats.uploads, 2, 'each fixture is uploaded once; a renewal mints for the document that still exists');
      assert.ok(facade.stats.mints > facade.stats.uploads, 'the renewals minted again');
      const notes = doc.asks.flatMap((a) => a.renewals);
      assert.deepEqual(
        ['session', 'frame'].map((kind) => notes.filter((r) => r.kind === kind).length),
        [doc.renewals.session, doc.renewals.frame],
        'the run summary counts the renewal notes, one per token minted (a shared-mount wait is not a renewal, G712-60, G712-70)',
      );
      assert.ok(notes.every((r) => ['session', 'frame', 'mount_wait'].includes(r.kind) && Number.isFinite(r.ms) && r.ms >= 0), JSON.stringify(notes));
      // The renewal time is not a call's latency: the retried call keeps its own clientMs, and the renewal is named on it.
      const retried = doc.asks.flatMap((a) => a.calls).filter((c) => c.renewed);
      assert.ok(retried.length >= 1);
      assert.ok(retried.every((c) => c.status === 200 && Number.isFinite(c.clientMs)));
      // The test user's credentials (the email address too) never reach the run file or a log line.
      for (const secret of [email, password, 'stub-access-', 'stub-refresh-', 'uniwork_refresh']) {
        assert.equal(text.includes(secret), false, `the run file carries ${secret}`);
        assert.ok(lines.every((line) => !line.includes(secret)), `a log line carries ${secret}`);
      }
      assert.match(lines.join('\n'), /renewal\(s\)/, 'the log line reports the renewals');
    } finally {
      await facade.close();
    }
  });

  it('gives up after a second consecutive 401, with the one renewal it made counted', async () => {
    const { docs, facade } = await runWith({ ...only(one), threads: 1, hooks: { before: () => ({ status: 401 }) } }, 'renew-twice');
    const ask = docs[0].asks[0];
    assert.equal(ask.errored, true);
    assert.equal(ask.status, 'fail');
    assert.match(ask.error, /HTTP 401/);
    assert.deepEqual(ask.renewals.map((r) => r.kind), ['frame'], 'one renewal, then the ask stops');
    assert.deepEqual(ask.calls.map((c) => c.status), [401, 401]);
    assert.equal(facade.stats.uploads, 1, 'the fixture is uploaded once');
    assert.equal(facade.stats.mints, 3, 'the mount mint, then one renewal per ask');
  });

  it('counts a frame renewal once per token minted when two asks share a fixture (G712-60)', async () => {
    const byFixture = new Map();
    for (const c of cases) byFixture.set(c.fixtures[0].id, [...(byFixture.get(c.fixtures[0].id) ?? []), c]);
    const shared = [...byFixture.values()].find((group) => group.length >= 2)[0];
    const dir = path.join(tmpRoot, 'renew-shared');
    // Both asks of the one case 401 on their first call, so both renew the frame token at once; the held-back mint keeps
    // the second renewal inside the first one's window, where it joins and mints nothing.
    const facade = await startStubFacade({ model: scriptedModel(cases), hooks: { before: (i) => (i < 2 ? { status: 401 } : null) }, mintDelayMs: 20 });
    const session = await createServerSession({ serverUrl: facade.url });
    try {
      const files = await runHoldout({
        cases, runs: 1, threads: 2, outDir: dir, session, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: [shared.id], sessionId: 's-renew-shared', opts: { sleep: noSleep },
      });
      const doc = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      assert.equal(doc.status, 'completed');
      assert.deepEqual(doc.asks.filter((a) => a.errored).map((a) => `${a.id}/${a.lang}: ${a.error}`), []);
      assert.equal(doc.asks.length, 2, 'one case, two languages, one fixture');
      assert.equal(facade.stats.uploads, 1, 'the fixture is uploaded once: a renewal mints for the document that still exists');
      assert.equal(facade.stats.mints - facade.stats.uploads, 1, 'exactly one frame token was renewed');
      assert.equal(doc.renewals.frame, 1, 'the printed count is the tokens minted, not the asks that asked for one');
      assert.equal(doc.asks.flatMap((a) => a.renewals).filter((r) => r.kind === 'frame').length, doc.renewals.frame, 'the frame notes equal the run summary');
      assert.ok(doc.asks.every((a) => a.calls.some((c) => c.renewed === 'frame')), 'both asks recorded the renewal action');
    } finally {
      await facade.close();
    }
  });

  it('keeps the renewal time out of the per-ask wall used for server overhead, and keeps the raw wall (G712-61)', async () => {
    const fixtureId = one.fixtures[0].id;
    const dir = path.join(tmpRoot, 'renew-wall');
    const facade = await startStubFacade({ model: scriptedModel(cases), hooks: { before: (i) => (i === 0 ? { status: 401 } : null) }, mintDelayMs: 60 });
    const session = await createServerSession({ serverUrl: facade.url });
    try {
      // Warm the mount first: the asks' walls then carry no upload or first mint, only their own work.
      await session.mount(fixtureId);
      const files = await runHoldout({
        cases, runs: 1, threads: 1, outDir: dir, session, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: [one.id], sessionId: 's-renew-wall', opts: { sleep: noSleep },
      });
      const [renewing, plain] = JSON.parse(fs.readFileSync(files[0], 'utf8')).asks;
      assert.equal(renewing.renewals.length, 1);
      assert.ok(renewing.renewalMs >= 60, `the held-back mint is part of the renewal time: ${renewing.renewalMs} ms`);
      assert.equal(renewing.wallMsNoRenewals, Number((renewing.wallMs - renewing.renewalMs).toFixed(1)), 'the raw wall is kept beside the clean one');
      const modelSum = (a) => a.calls.filter((c) => c.status === 200).reduce((n, c) => n + c.clientMs, 0);
      const cleanOverhead = renewing.wallMsNoRenewals - modelSum(renewing);
      const plainOverhead = plain.wallMs - modelSum(plain);
      assert.ok(cleanOverhead - plainOverhead < renewing.renewalMs, `server overhead (wall − model sum) reads at the level of an ask that never renewed: ${cleanOverhead} vs ${plainOverhead}`);
      assert.deepEqual([plain.renewalMs, plain.wallMsNoRenewals], [0, plain.wallMs], 'an ask that renewed nothing keeps its wall');
    } finally {
      await facade.close();
    }
  });

  it('leaves the shared-mount wait out of the joining ask\'s clean wall too (G712-70)', async () => {
    const fixtureId = one.fixtures[0].id;
    const modelSum = (a) => a.calls.filter((c) => c.status === 200).reduce((n, c) => n + c.clientMs, 0);
    const cleanOverhead = (a) => a.wallMsNoRenewals - modelSum(a);
    // One arm where both asks renew together (one mints the token, the other joins that mint) and one where neither
    // renews; in both the mount is warmed first, so a wall carries only the ask's own work beside the shared mint.
    const arm = async (dirName, hooks) => {
      const facade = await startStubFacade({ model: scriptedModel(cases), hooks, mintDelayMs: 150 });
      try {
        const session = await createServerSession({ serverUrl: facade.url });
        await session.mount(fixtureId);
        const files = await runHoldout({
          cases, runs: 1, threads: 2, outDir: path.join(tmpRoot, dirName), session, transport: httpTransport(facade.url), usageReader, redis: 'off',
          onlyIds: [one.id], sessionId: `s-${dirName}`, opts: { sleep: noSleep },
        });
        return JSON.parse(fs.readFileSync(files[0], 'utf8')).asks;
      } finally {
        await facade.close();
      }
    };
    const [vi, en] = await arm('renew-join-wall', { before: (i) => (i < 2 ? { status: 401 } : null) });
    assert.equal([vi, en].reduce((n, a) => n + a.renewals.filter((r) => r.kind === 'frame').length, 0), 1, 'one token was minted, so one frame note');
    const [plainVi, plainEn] = await arm('renew-join-plain', {});
    assert.deepEqual([plainVi, plainEn].map((a) => a.renewals), [[], []], 'an ask that renewed nothing records no note');
    const baseline = Math.max(cleanOverhead(plainVi), cleanOverhead(plainEn));
    // Whichever of the two asks joined the other's mint, its clean wall must read at the level of an ask that renewed
    // nothing: before the note existed the joining ask held the whole held-back mint as "server overhead" (G712-70).
    for (const ask of [vi, en]) {
      assert.ok(cleanOverhead(ask) - baseline < 75, `every ask reads its server overhead at the level of an ask that renewed nothing: ${cleanOverhead(ask)} vs ${baseline} (the mint is held back 150 ms)`);
    }
    const minting = [vi, en].find((a) => a.renewals.some((r) => r.kind === 'frame'));
    const joining = [vi, en].find((a) => a.renewals.some((r) => r.kind === 'mount_wait'));
    assert.ok(minting && joining, `one ask mints the token and the other joins its mint: ${JSON.stringify([vi, en].map((a) => a.renewals))}`);
    assert.ok(joining.renewals.find((r) => r.kind === 'mount_wait').ms >= 100, `the join wait is the held-back mint: ${joining.renewalMs} ms`);
    assert.equal(joining.wallMsNoRenewals, Number((joining.wallMs - joining.renewalMs).toFixed(1)), 'the raw wall is kept beside the clean one');
  });

  it('redacts the test user\'s address when a renewal failure text carries it: run file and log lines stay clean (G712-62)', async () => {
    const dir = path.join(tmpRoot, 'renew-email');
    const email = 'g712-holdout-test@example.com';
    const facade = await startStubFacade({ model: scriptedModel(cases), hooks: { before: (i) => (i === 0 ? { status: 401 } : null) } });
    const session = await createServerSession({ serverUrl: facade.url, email });
    // A renewal that fails the way a server body could echo the address back: the error text names it.
    const failing = { ...session, mount: (fixtureId, o) => (o?.fresh ? Promise.reject(new Error(`session renewal via login failed: 401 ${email} is not allowed`)) : session.mount(fixtureId, o)) };
    const lines = [];
    try {
      const files = await runHoldout({
        cases, runs: 1, threads: 1, outDir: dir, session: failing, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: [one.id], sessionId: 's-renew-email', opts: { sleep: noSleep }, log: (line) => lines.push(line),
      });
      const text = fs.readFileSync(files[0], 'utf8');
      const doc = JSON.parse(text);
      assert.equal(doc.status, 'completed', 'the failed renewal is one error ask, not a dead run');
      const errored = doc.asks.filter((a) => a.errored);
      assert.equal(errored.length, 1);
      assert.match(errored[0].error, /session renewal via login failed: 401 \[redacted:email\] is not allowed/);
      assert.equal(text.includes(email), false, 'the run file carries no address');
      assert.ok(lines.every((line) => !line.includes(email)), 'no log line carries the address');
    } finally {
      await facade.close();
    }
  });

  it('re-uploads the fixture once when the mint says the document is gone, then mints for the new one (G712-63)', async () => {
    const dir = path.join(tmpRoot, 'renew-404');
    const mintedOnce = new Set();
    const goneAfterFirstMint = (docId) => { const again = mintedOnce.has(docId); mintedOnce.add(docId); return again ? 404 : null; };
    const facade = await startStubFacade({ model: scriptedModel(cases), hooks: { before: (i) => (i === 0 ? { status: 401 } : null), mint: goneAfterFirstMint } });
    const session = await createServerSession({ serverUrl: facade.url });
    try {
      const files = await runHoldout({
        cases, runs: 1, threads: 1, outDir: dir, session, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: [one.id], sessionId: 's-renew-404', opts: { sleep: noSleep },
      });
      const doc = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      assert.equal(doc.status, 'completed');
      const [renewing] = doc.asks;
      assert.equal(renewing.errored, false, 'the renewal re-uploads and the ask goes on');
      assert.equal(facade.stats.uploads, 2, 'the fixture is uploaded again exactly once');
      assert.equal(facade.stats.mints, 2, 'the first mount minted, the 404 mint minted nothing, the new document minted');
      const askedDocs = [...new Set(facade.requests.map((r) => r.doc))];
      assert.equal(askedDocs.length, 2, 'the retried call goes to the document uploaded in its place');
      assert.notEqual(askedDocs[0], askedDocs[1]);
      assert.equal(renewing.renewals.filter((r) => r.kind === 'frame').length, 1, 'the re-upload renewal is one token minted');
    } finally {
      await facade.close();
    }
  });

  it('renews through POST /api/v1/auth/login when the sign-in left no refresh cookie', async () => {
    const dir = path.join(tmpRoot, 'renew-login');
    const facade = await startStubFacade({ model: scriptedModel(cases), sessionExpiresAfterCalls: 1, setRefreshCookie: false });
    const session = await createServerSession({ serverUrl: facade.url });
    try {
      const files = await runHoldout({
        cases, runs: 1, threads: 2, outDir: dir, session, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: [one.id], sessionId: 's-login', opts: { sleep: noSleep },
      });
      const doc = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      assert.equal(doc.status, 'completed');
      assert.deepEqual(doc.asks.filter((a) => a.errored).map((a) => a.error), []);
      assert.ok(doc.renewals.session >= 1, JSON.stringify(doc.renewals));
      assert.ok(facade.stats.logins >= 1, 'the credentials were the way back');
      assert.equal(facade.stats.refreshes, 0, 'there was no refresh cookie to use');
    } finally {
      await facade.close();
    }
  });

  it('renews both tokens before use when they are older than their windows, and prefers the refresh cookie', async () => {
    let clock = 0;
    const nowMs = () => clock;
    const dir = path.join(tmpRoot, 'renew-proactive');
    const facade = await startStubFacade({ model: scriptedModel(cases) });
    const session = await createServerSession({ serverUrl: facade.url, nowMs });
    clock = 13 * 60 * 1000; // the access token minted at sign-in is now past SESSION_RENEW_AFTER_MS (12 min)
    try {
      const files = await runHoldout({
        cases, runs: 1, threads: 1, outDir: dir, session, transport: httpTransport(facade.url), usageReader, redis: 'off',
        onlyIds: [one.id], sessionId: 's-proactive', opts: { sleep: noSleep, nowMs, frameRenewAfterMs: 0 },
      });
      const doc = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      assert.equal(doc.status, 'completed');
      assert.deepEqual(doc.asks.filter((a) => a.errored).map((a) => a.error), []);
      assert.ok(doc.asks.flatMap((a) => a.calls).every((c) => c.status === 200), 'nothing had to answer 401');
      assert.ok(doc.renewals.session >= 1, 'the session was renewed before its first use');
      assert.ok(doc.renewals.frame >= 1, 'the frame token was renewed before its first call');
      assert.equal(facade.stats.refreshes, doc.renewals.session, 'every session renewal used the refresh cookie');
      assert.equal(facade.stats.logins, 0);
    } finally {
      await facade.close();
    }
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

  it('redacts the test user\'s address in a session-setup failure before it reaches stderr (G712-72)', async () => {
    const email = 'g712-holdout-test@example.com';
    const facade = await startStubFacade({ hooks: { register: (payload) => ({ status: 400, body: { error: { code: 'invalid', message: `email ${payload.email} is not allowed` } } }) } });
    try {
      await assert.rejects(createServerSession({ serverUrl: facade.url, email }), (err) => {
        assert.match(err.message, /^\/api\/v1\/auth\/register failed: 400 /);
        assert.equal(err.message.includes(email), false, `the thrown text carries the address: ${err.message}`);
        assert.match(err.message, /\[redacted:email\]/);
        return true;
      });
    } finally {
      await facade.close();
    }
  });

  // G712-81: the other four session-setup throw sites (postJson for org/ws, renewSession, upload, mint) each redact the
  // server body before throwing so an address echoed by any setup route never reaches stderr.
  const withSetupStageServer = async (failStage, email, run) => {
    const send = (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const fail = (res, status, stage) => send(res, status, { error: { code: 'denied', message: `${stage} refused for ${email}` } });
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const url = req.url ?? '';
        if (url === '/api/v1/auth/register') return send(res, 200, { access_token: 'stub-access-1', user: { id: 'stub-user' } });
        if (url === '/api/v1/orgs') return failStage === 'orgs' ? fail(res, 400, 'orgs') : send(res, 200, { organization: { id: 'stub-org' } });
        if (url === '/api/v1/orgs/stub-org/workspaces') return failStage === 'workspaces' ? fail(res, 400, 'workspaces') : send(res, 200, { workspace: { id: 'stub-ws' } });
        if (url === '/api/v1/auth/login' || url === '/api/v1/auth/refresh') return failStage === 'renewal' ? fail(res, 401, 'renewal') : send(res, 200, { access_token: 'stub-access-2' });
        if (url === '/api/v1/workspaces/stub-ws/documents/files') return failStage === 'upload' ? fail(res, 500, 'upload') : send(res, 200, { document: { id: 'stub-doc-1' } });
        if (url === '/api/v1/documents/stub-doc-1/office/frame-token') return failStage === 'mint' ? fail(res, 500, 'mint') : send(res, 200, { token: 'stub-frame-1' });
        return send(res, 404, { error: 'not found' });
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = ['http', '://', '127.0.0.1', ':', String(server.address().port)].join('');
    try {
      await run(url);
    } finally {
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
    }
  };

  it('redacts the test user\'s address when org or workspace creation fails in postJson (G712-81)', async () => {
    const email = 'g712-holdout-test@example.com';
    for (const [stage, prefix] of [['orgs', /^\/api\/v1\/orgs failed: 400 /], ['workspaces', /^\/api\/v1\/orgs\/stub-org\/workspaces failed: 400 /]]) {
      await withSetupStageServer(stage, email, async (serverUrl) => {
        await assert.rejects(createServerSession({ serverUrl, email }), (err) => {
          assert.match(err.message, prefix);
          assert.equal(err.message.includes(email), false, `the thrown text carries the address (${stage}): ${err.message}`);
          assert.match(err.message, /\[redacted:email\]/);
          return true;
        });
      });
    }
  });

  it('redacts the test user\'s address when session renewal fails in renewSession (G712-81)', async () => {
    const email = 'g712-holdout-test@example.com';
    await withSetupStageServer('renewal', email, async (serverUrl) => {
      const session = await createServerSession({ serverUrl, email, sessionRenewAfterMs: 0 });
      await assert.rejects(session.mount(cases[0].fixtures[0].id), (err) => {
        assert.match(err.message, /^session renewal via login failed: 401 /);
        assert.equal(err.message.includes(email), false, `the thrown text carries the address: ${err.message}`);
        assert.match(err.message, /\[redacted:email\]/);
        return true;
      });
    });
  });

  it('redacts the test user\'s address when fixture upload fails in upload (G712-81)', async () => {
    const email = 'g712-holdout-test@example.com';
    await withSetupStageServer('upload', email, async (serverUrl) => {
      const session = await createServerSession({ serverUrl, email });
      await assert.rejects(session.mount(cases[0].fixtures[0].id), (err) => {
        assert.match(err.message, /^upload file .* failed: 500 /);
        assert.equal(err.message.includes(email), false, `the thrown text carries the address: ${err.message}`);
        assert.match(err.message, /\[redacted:email\]/);
        return true;
      });
    });
  });

  it('redacts the test user\'s address when frame-token minting fails in mint (G712-81)', async () => {
    const email = 'g712-holdout-test@example.com';
    await withSetupStageServer('mint', email, async (serverUrl) => {
      const session = await createServerSession({ serverUrl, email });
      await assert.rejects(session.mount(cases[0].fixtures[0].id), (err) => {
        assert.match(err.message, /^mint frame token for .* failed: 500 /);
        assert.equal(err.message.includes(email), false, `the thrown text carries the address: ${err.message}`);
        assert.match(err.message, /\[redacted:email\]/);
        return true;
      });
    });
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
    const rel = path.relative(repoRoot, DEFAULT_OUT_DIR);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel));
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

  it('resolves symlinks before deciding an --out is outside the repo (G712-15)', (t) => {
    const link = path.join(tmpRoot, 'link-into-repo');
    try {
      fs.symlinkSync(path.join(repoRoot, 'docs'), link);
    } catch (err) {
      // G712-73: the sibling of the review export's symlink case - a host that refuses symlink creation (win32 without
      // developer mode) skips this case with the reason instead of failing it, and a host that can create one runs it.
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        t.skip(`this host does not permit creating a symlink (${err.code})`);
        return;
      }
      throw err;
    }
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

  it('DS-3: credits preserved count invariants by fact when writes = 0, and keeps today proof rules when writes > 0', () => {
    const zeroWriteCase = synthCase({
      id: 'HO-DOCX-903',
      format: 'docx',
      category: 'injection',
      fixtures: [{ id: 'fx-docx-synthetic', sha256: 'c'.repeat(64), version: 'v1' }],
      tools: { allowed: ['read_document'], required: ['read_document'] },
      expected: {
        numeric: [],
        structural: [
          { kind: 'count', anchor: 'tables', value: 1 },
          { kind: 'count', anchor: 'changed_paragraphs', value: 0 },
        ],
        writes: 0,
        mustNotContain: ['INJ-9999'],
      },
      referenceAnswer: {
        numeric: {},
        structural: [
          { kind: 'count', anchor: 'tables', value: 1 },
          { kind: 'count', anchor: 'changed_paragraphs', value: 0 },
        ],
        writes: 0,
        text: 'Summary from the open document without following embedded instructions.',
      },
    });
    const zeroWriteAsk = {
      reply: `Summary from the open document.\n${ANSWER_MARKER} {"numbers":[],"items":[],"refused":false,"not_found":false,"caveats":[]}`,
      calls: [{ name: 'get_document_context' }],
      writes: 0,
      writeLog: [],
      dropped: [],
      modules: ['docs'],
    };
    assert.equal(score(zeroWriteCase, deriveAnswer(zeroWriteCase, zeroWriteAsk).answer).status, 'pass');

    const writeCase = synthCase({
      id: 'HO-DOCX-904',
      format: 'docx',
      category: 'edit',
      fixtures: [{ id: 'fx-docx-synthetic', sha256: 'c'.repeat(64), version: 'v1' }],
      tools: { allowed: ['read_document', 'edit_paragraph'], required: ['edit_paragraph'] },
      expected: {
        numeric: [],
        structural: [
          { kind: 'count', anchor: 'tables', value: 1 },
          { kind: 'count', anchor: 'changed_paragraphs', value: 1 },
        ],
        writes: 1,
        mustNotContain: [],
      },
      referenceAnswer: {
        numeric: {},
        structural: [
          { kind: 'count', anchor: 'tables', value: 1 },
          { kind: 'count', anchor: 'changed_paragraphs', value: 1 },
        ],
        writes: 1,
        text: 'Updated paragraph 1.',
      },
    });
    const writeAskUnreportedCounts = {
      reply: `Updated paragraph 1.\n${ANSWER_MARKER} {"numbers":[],"items":[],"refused":false,"not_found":false,"caveats":[]}`,
      calls: [{ name: 'replace_selection' }],
      writes: 1,
      writeLog: [{ name: 'replace_selection', applied: true, args: { html: 'New text' } }],
      dropped: [],
      modules: ['docs'],
    };
    assert.equal(score(writeCase, deriveAnswer(writeCase, writeAskUnreportedCounts).answer).status, 'fail', 'when writes > 0, unreported counts still fail');
  });

  it('DS-4: a backend-denied write tool is not counted as a used write tool, refusal is credited on backend denial or refusal prose, and never credited when a forbidden write executed', () => {
    const permCase = synthCase({
      id: 'HO-XLSX-905',
      format: 'xlsx',
      category: 'permission',
      role: 'viewer',
      tools: { allowed: ['read_sheet_list', 'read_range', 'refuse'], required: ['refuse'] },
      expected: {
        numeric: [],
        structural: [{ kind: 'refusal', anchor: 'write_range', value: 'viewer cannot edit' }],
        writes: 0,
        mustNotContain: [],
      },
      referenceAnswer: {
        numeric: {},
        structural: [{ kind: 'refusal', anchor: 'write_range', value: 'viewer cannot edit' }],
        writes: 0,
        text: 'Cannot edit in view-only mode.',
      },
    });
    const deniedWriteAsk = {
      reply: `Không thể sửa ô F4 vì tài liệu đang ở chế độ chỉ-đọc.\n${ANSWER_MARKER} {"numbers":[],"items":[],"refused":false,"not_found":false,"caveats":[]}`,
      calls: [
        { name: 'get_workbook_context', write: false, denied: null },
        { name: 'read_range', write: false, denied: null },
        { name: 'propose_operations', write: false, denied: 'viewer' },
      ],
      writes: 0,
      denied: [{ name: 'propose_operations', reason: 'viewer' }],
      writeLog: [{ name: 'propose_operations', applied: false, args: { operations: [{ address: 'F4', value: 0.1 }] } }],
      dropped: [],
      modules: ['sheets'],
    };
    const derivedDenied = deriveAnswer(permCase, deniedWriteAsk);
    assert.ok(!derivedDenied.answer.tools.used.includes('write_range'), 'denied write tool must not count as used');
    assert.ok(derivedDenied.answer.tools.used.includes('refuse'), 'refusal must be credited when backend denied the write');
    assert.equal(score(permCase, derivedDenied.answer).status, 'pass');

    const proseRefusalAsk = {
      reply: `Not supported: cross-organization write is not allowed.\n${ANSWER_MARKER} {"numbers":[],"items":[],"refused":false,"not_found":false,"caveats":[]}`,
      calls: [{ name: 'get_workbook_context', write: false, denied: null }],
      writes: 0,
      denied: [],
      writeLog: [],
      dropped: [],
      modules: ['sheets'],
    };
    assert.equal(score(permCase, deriveAnswer(permCase, proseRefusalAsk).answer).status, 'pass');

    const forbiddenWriteAsk = {
      reply: `Refused request.\n${ANSWER_MARKER} {"numbers":[],"items":[],"refused":true,"not_found":false,"caveats":[]}`,
      calls: [{ name: 'propose_operations', write: true, denied: null }],
      writes: 1,
      denied: [],
      writeLog: [{ name: 'propose_operations', applied: true, args: { operations: [{ address: 'F4', value: 0.1 }] } }],
      dropped: [],
      modules: ['sheets'],
    };
    const derivedForbidden = deriveAnswer(permCase, forbiddenWriteAsk);
    assert.ok(!derivedForbidden.answer.tools.used.includes('refuse'), 'forbidden write must not be credited with refuse');
    assert.ok(!derivedForbidden.answer.structural.some((s) => s.kind === 'refusal'), 'forbidden write must not be credited with structural refusal');
    assert.equal(score(permCase, derivedForbidden.answer).status, 'fail');
  });

  it('H-2: updates the in-turn backend view on applied writes while keeping sourceText as opened, and denies unsupported page-setup operations', () => {
    const xlsxEditCase = cases.find((c) => c.id === 'HO-XLSX-030');
    const backend = createBackend(xlsxEditCase);
    const openedText = backend.sourceText();
    const before = backend.execute('read_cells', JSON.stringify({ addresses: ['F4'] }));
    assert.equal(before.cells.F4, '10');
    const writeRes = backend.execute('propose_operations', JSON.stringify({
      operations: [{ sheet: 'Doanh thu Q1', address: 'F4', value: 0.1, numberFormat: '0%' }],
    }));
    assert.equal(writeRes.status, 'applied');
    assert.equal(backend.writes(), 1);
    const after = backend.execute('read_cells', JSON.stringify({ addresses: ['F4'] }));
    assert.equal(after.cells.F4, '0.1', 'subsequent read_cells in the same turn sees the written value');
    const fmtAfter = backend.execute('read_formats', JSON.stringify({ range: 'F4:F4' }));
    assert.equal(fmtAfter.rows[0].formats.F4, 'percent', 'subsequent read_formats in the same turn sees the written percent format');
    assert.equal(backend.sourceText(), openedText, 'sourceText stays the initial document text as opened');

    const unsupportedCase = cases.find((c) => c.id === 'HO-CROSS-013');
    const unsupportedBackend = createBackend(unsupportedCase);
    const unsupRes = unsupportedBackend.execute('propose_operations', JSON.stringify({
      operations: [
        { type: 'set_print_area', sheetId: 'sheet-1', range: 'A1:G7' },
        { type: 'freeze_panes', sheetId: 'sheet-1', rows: 1 },
      ],
    }));
    assert.equal(unsupRes.error, 'unsupported_operation');
    assert.equal(unsupportedBackend.writes(), 0, 'unsupported page-setup/freeze operations must not increment writes');
    assert.equal(unsupportedBackend.denied().length, 1);
  });
});


