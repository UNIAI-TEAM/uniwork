import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const upstream = path.join(REPO_ROOT, 'packages/office-upstream/upstream');
const bundled = await build({
  stdin: {
    contents: `export * from './edits'; export * from './command-policy'; export * from './cell-input';
      export {createEditJournal, recordSetRangeValues} from '../../upstream/apps/sheets/src/renderer/edit-journal';`,
    resolveDir: renderer, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'journal-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const CellValueType={STRING:1,NUMBER:2,BOOLEAN:3}; export const CommandType={COMMAND:0,OPERATION:1,MUTATION:2};',
      }));
      // The shim's locale seam resolves to the host i18next at build time; the
      // test bundle returns the key itself so assertions can pin message ids.
      builder.onResolve({ filter: /^\.\/locale$/ }, () => ({ path: 'locale', namespace: 'test-locale' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-locale' }, () => ({ contents: 'export const t = (key) => key;' }));
      builder.onResolve({ filter: /^@genoffice\/xlsx-gateway\// }, (args) => ({
        path: path.join(upstream, 'packages/xlsx-gateway/src', args.path.split('/').slice(2).join('/')) + '.ts',
      }));
      builder.onResolve({ filter: /selection-format$/ }, () => ({ path: 'indent', namespace: 'test-indent' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-indent' }, () => ({ contents: 'export const INDENT_STEP_PX=9;' }));
    },
  }],
});
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { createEditJournal, ingestCellMutation, ingestStructuralMutation, ingestSheetMutation, ingestFilterMutation,
  snapshotSheetFilter, applyColumnDefaultWidth, applyOutlineAction, outlineLevels, outlineHistoryItem, outlineDetailSpan, seedColumnOutline, seedRowOutline, liveSessionSheets,
  sheetNameShapeOK, canExecuteCommand, canEditRange, parseCellText, ingestTableMutation,
  sessionTableIdForName, ingestSortMutation, recordSetRangeValues, createValidatedWriteGate, observeValidationVerdicts, editorCommitCell } = module.exports;
const cellRange = (row = 0, column = 0) => ({ startRow: row, endRow: row, startColumn: column, endColumn: column });
function state() {
  return {
    file: { sessionId: 'book', sha256: 'sha', sheets: [{ id: 's1', name: 'Data', hidden: false, rowCount: 20, columnCount: 10, pivotRanges: [] }] },
    editJournal: createEditJournal(),
    loadedRanges: new Map([['s1', { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 }]]),
    flags: { preloadComplete: false },
    closure: { pinned: new Map() },
    outline: new Map(),
    filterOrigins: new Map(),
  };
}
/** A fake Univer worksheet surface the filter snapshot reads. */
function filterWorksheet(filter) {
  return { getFilter: () => filter };
}
function filterModel(range, criteriaByColumn = {}, filteredOut = []) {
  return {
    getRange: () => ({ getRange: () => range }),
    getColumnFilterCriteria: (column) => criteriaByColumn[column] ?? null,
    getFilteredOutRows: () => filteredOut,
  };
}
const filterEvent = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
/** Two-sheet state for the sheet-op tests (a removal needs a survivor). */
function sheetState() {
  const model = state();
  model.file.sheets.push({ id: 's2', name: 'PhuLuc', hidden: false, rowCount: 20, columnCount: 10, pivotRanges: [] });
  model.loadedRanges.set('s2', { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 });
  return model;
}
const mutation = (cellValue, extra = {}) => ({
  id: 'sheet.mutation.set-range-values', type: 2,
  params: { unitId: 'file-sha', subUnitId: 's1', cellValue }, ...extra,
});

test('only the pinned cell editor commit/cancel keyboard operations pass the edit gate', () => {
  const model = state();
  const operation = { id: 'sheet.operation.editor-__INTERNAL_EDITOR__DOCS_NORMAL-keyboard-PX-v',
    type: 1, params: { keyCode: 13 } };
  for (const keyCode of [13, 9, 27]) {
    const event = { ...operation, params: { keyCode } };
    assert.equal(canExecuteCommand(event, model, false), true);
    assert.equal(canExecuteCommand(event, model, true), false);
    assert.equal(canExecuteCommand(event, null, false), false);
  }
  for (const event of [
    { ...operation, id: operation.id.replace('DOCS_NORMAL', 'ARBITRARY') },
    { ...operation, params: { keyCode: 65 } },
    { ...operation, params: { keyCode: 13, metaKey: 4096 } },
    { ...operation, type: 2 },
    { ...operation, params: undefined },
  ]) assert.equal(canExecuteCommand(event, model, false), false);
});

test('bound grid mutations emit typed values and formulas through the vendored journal', () => {
  const model = state();
  const edits = ingestCellMutation(model, mutation({ 0: {
    0: { v: 'hello', f: null }, 1: { v: 12 }, 2: { v: 1, t: 3 },
    3: { f: 'SUM(A1:B1)', v: 99 }, 4: null,
  } }));
  assert.deepEqual(edits, [
    { sheetId: 's1', row: 0, column: 0, writeValue: true, value: 'hello' },
    { sheetId: 's1', row: 0, column: 1, writeValue: true, value: 12 },
    { sheetId: 's1', row: 0, column: 2, writeValue: true, value: true },
    { sheetId: 's1', row: 0, column: 3, writeValue: true, value: null, formula: '=SUM(A1:B1)' },
    { sheetId: 's1', row: 0, column: 4, writeValue: true, value: null, styleReset: true },
  ]);
});

/** The editor commit as the controller drives it: begin before the write,
 *  capture every ingest, settle with the validation verdict. */
function validatedCommit(model, gate, cellValue, verdict) {
  gate.begin(model, 's1');
  const emitted = gate.capture(ingestCellMutation(model, mutation(cellValue), gate.isRollback('s1')));
  gate.awaitVerdict()(verdict);
  return emitted;
}

test('a data-validation refusal journals and emits nothing, not even the rollback that follows', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  // The refused cell already carries a session style; the other cell an edit.
  ingestCellMutation(model, mutation({ 0: { 0: { s: { bl: 1 } }, 1: { v: 5 } } }));
  const journaled = JSON.stringify([...model.editJournal.cells.get('s1')]);
  assert.deepEqual(validatedCommit(model, gate, { 0: { 0: { v: 'Xyz' } } }, false), []);
  assert.equal(gate.isRollback('s1'), true);
  // Univer rolls the refused write back with {value: null, s: null}.
  const rollback = ingestCellMutation(model, mutation({ 0: { 0: { v: null, s: null } } }), gate.isRollback('s1'));
  assert.deepEqual(rollback, []);
  assert.deepEqual(emitted, []);
  assert.equal(JSON.stringify([...model.editJournal.cells.get('s1')]), journaled);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gate.isRollback('s1'), false);
});

test('a refusal on a sheet with no earlier edit leaves its journal untouched', () => {
  const model = state();
  const gate = createValidatedWriteGate(() => assert.fail('nothing may be emitted'));
  validatedCommit(model, gate, { 0: { 0: { v: 'Xyz' } } }, false);
  assert.equal(model.editJournal.cells.has('s1'), false);
});

test('an accepted validated commit emits its edits at the verdict and a later undo still journals', () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  assert.deepEqual(validatedCommit(model, gate, { 0: { 0: { v: 'Mot' } } }, true), []);
  assert.deepEqual(emitted, [{ sheetId: 's1', row: 0, column: 0, writeValue: true, value: 'Mot' }]);
  assert.equal(gate.isRollback('s1'), false);
  const undo = ingestCellMutation(model, mutation({ 0: { 0: { v: null, s: null } } }), gate.isRollback('s1'));
  assert.equal(undo.length, 1);
  assert.equal(undo[0].value, null);
  assert.equal(undo[0].styleReset, true);
});

test('a commit whose verdict never comes, or a newer commit, releases the held edits as accepted', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  gate.begin(model, 's1');
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 0: { v: 1 } } }))), []);
  await Promise.resolve();
  assert.equal(emitted.length, 1);
  gate.begin(model, 's1');
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 1: { v: 2 } } }))), []);
  gate.awaitVerdict();
  gate.begin(model, 's1');
  assert.deepEqual(emitted.map((edit) => edit.column), [0, 1]);
  assert.equal(gate.awaitVerdict() !== null, true);
});

/** Univer's flat composeInterceptors + an async DV-like handler: the handler
 *  calls next only after awaits, so a later interceptor never runs. The
 *  editor's _submitEdit awaits onValidateCell, then rolls back on false. */
function editorFlow(gate, verdict, steps) {
  const service = {
    onValidateCell() {
      return (async () => { for (let i = 0; i < steps; i += 1) await null; return verdict; })();
    },
  };
  observeValidationVerdicts(service, gate);
  return service;
}

test('the verdict is observed from onValidateCell although the async DV handler answers many ticks later', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  ingestCellMutation(model, mutation({ 0: { 0: { s: { bl: 1 } } } }));
  const journaled = JSON.stringify([...model.editJournal.cells.get('s1')]);
  const service = editorFlow(gate, false, 6);
  // _submitEdit: write (begin + capture), then await onValidateCell, then rollback.
  gate.begin(model, 's1');
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 0: { v: 'Xyz' } } }))), []);
  const accepted = await service.onValidateCell();
  assert.equal(accepted, false);
  const rollback = ingestCellMutation(model, mutation({ 0: { 0: { v: null, s: null } } }), gate.isRollback('s1'));
  assert.deepEqual(rollback, []);
  assert.deepEqual(emitted, []);
  assert.equal(JSON.stringify([...model.editJournal.cells.get('s1')]), journaled);
});

test('an accepted verdict observed from onValidateCell emits the held edits once', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  const service = editorFlow(gate, true, 6);
  gate.begin(model, 's1');
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 0: { v: 'Mot' } } }))), []);
  assert.equal(await service.onValidateCell(), true);
  assert.deepEqual(emitted, [{ sheetId: 's1', row: 0, column: 0, writeValue: true, value: 'Mot' }]);
});

test('a validation of another sheet does not settle the pending write (review-session n-1)', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  const sheet = (id) => ({ getSheetId: () => id });
  const service = { onValidateCell(_workbook, worksheet) { return Promise.resolve(worksheet.getSheetId() === 's1'); } };
  observeValidationVerdicts(service, gate);
  gate.begin(model, 's1');
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 0: { v: 'Mot' } } }))), []);
  // Another sheet's refusal in the same tick is not this write's verdict:
  // without the sheet check it would take the settle and roll s1 back.
  const other = service.onValidateCell({}, sheet('s2'), 0, 0);
  const own = service.onValidateCell({}, sheet('s1'), 0, 0);
  assert.equal(await other, false);
  assert.equal(await own, true);
  assert.equal(gate.isRollback('s1'), false);
  assert.deepEqual(emitted, [{ sheetId: 's1', row: 0, column: 0, writeValue: true, value: 'Mot' }]);
});

test('a validation of another cell of the same sheet does not settle the pending write (review-delta-r2 X2)', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  const sheet = { getSheetId: () => 's1' };
  // A paste or an autofill validates several cells of one sheet in one tick;
  // only the committed cell A1 (0, 0) is refused here as the pending write's.
  const service = { onValidateCell(_workbook, _worksheet, row, column) { return Promise.resolve(!(row === 5 && column === 5)); } };
  observeValidationVerdicts(service, gate);
  gate.begin(model, 's1', { row: 0, column: 0 });
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 0: { v: 'Mot' } } }))), []);
  const other = service.onValidateCell({}, sheet, 5, 5);
  const own = service.onValidateCell({}, sheet, 0, 0);
  assert.equal(await other, false);
  assert.equal(await own, true);
  assert.equal(gate.isRollback('s1'), false);
  assert.deepEqual(emitted, [{ sheetId: 's1', row: 0, column: 0, writeValue: true, value: 'Mot' }]);
});

test('an editor commit names its cell only when its range is exactly one cell (review-delta-r2 X2)', () => {
  assert.deepEqual(editorCommitCell({ startRow: 3, endRow: 3, startColumn: 4, endColumn: 4 }), { row: 3, column: 4 });
  assert.equal(editorCommitCell({ startRow: 3, endRow: 4, startColumn: 4, endColumn: 4 }), undefined);
  assert.equal(editorCommitCell({ startRow: 3, endRow: 3 }), undefined);
  assert.equal(editorCommitCell(undefined), undefined);
  assert.equal(editorCommitCell('A1'), undefined);
});

test('a pending write without a known cell keeps taking the first verdict of its sheet (review-delta-r2 X2)', async () => {
  const model = state();
  const emitted = [];
  const gate = createValidatedWriteGate((edits) => emitted.push(...edits));
  const service = { onValidateCell() { return Promise.resolve(true); } };
  observeValidationVerdicts(service, gate);
  gate.begin(model, 's1');
  assert.deepEqual(gate.capture(ingestCellMutation(model, mutation({ 0: { 0: { v: 'Mot' } } }))), []);
  await service.onValidateCell({}, { getSheetId: () => 's1' }, 4, 4);
  assert.equal(emitted.length, 1);
});

test('observeValidationVerdicts leaves a validation with no pending commit alone and restores on dispose', async () => {
  const model = state();
  const gate = createValidatedWriteGate(() => assert.fail('nothing to emit'));
  const calls = [];
  const service = { onValidateCell(...args) { calls.push(args); return Promise.resolve(true); } };
  const original = service.onValidateCell;
  const handle = observeValidationVerdicts(service, gate);
  assert.equal(await service.onValidateCell('a'), true);
  assert.deepEqual(calls, [['a']]);
  handle.dispose();
  assert.equal(service.onValidateCell, original);
});

test('viewport, selection, load, calculation, other workbooks and no-op writes emit no edits', () => {
  const model = state();
  for (const id of ['sheet.operation.set-scroll', 'sheet.operation.set-selections', 'sheet.command.set-range-values']) {
    assert.deepEqual(ingestCellMutation(model, { id, params: mutation({ 0: { 0: { v: 1 } } }).params }), []);
  }
  assert.deepEqual(ingestCellMutation(model, mutation({ 0: { 0: { v: 1 } } }), true), []);
  assert.deepEqual(ingestCellMutation(model, mutation({ 0: { 0: { v: 1 } } }, { options: { fromFormula: true } })), []);
  assert.deepEqual(ingestCellMutation(model, mutation({ 0: { 0: { v: 1 } } }, { params: { unitId: 'other', subUnitId: 's1', cellValue: { 0: { 0: { v: 1 } } } } })), []);
  assert.equal(model.editJournal.cells.size, 0);
  ingestCellMutation(model, mutation({ 0: { 0: { v: 1 } } }));
  assert.deepEqual(ingestCellMutation(model, mutation({ 0: { 0: { t: 2 } } })), []);
  assert.deepEqual(ingestCellMutation(model, mutation({ 0: { 0: { v: 1 } } })), []);
});

test('undo and redo mutations restore content, formulas and number formats', () => {
  const model = state();
  ingestCellMutation(model, mutation({ 0: { 0: { f: '=A2', v: null } } }));
  assert.equal(ingestCellMutation(model, mutation({ 0: { 0: { v: 'original', f: null } } }))[0].value, 'original');
  assert.equal(ingestCellMutation(model, mutation({ 0: { 0: { f: '=A2', v: null } } }))[0].formula, '=A2');
  const format = { id: 'sheet.mutation.set.numfmt', params: {
    unitId: 'file-sha', subUnitId: 's1', refMap: { a: { pattern: '0.00' } }, values: { a: { ranges: [cellRange(1)] } },
  } };
  assert.deepEqual(ingestCellMutation(model, format), [
    { sheetId: 's1', row: 1, column: 0, writeValue: false, value: null, style: { numberFormat: '0.00' } },
  ]);
  const remove = { id: 'sheet.mutation.remove.numfmt', params: { unitId: 'file-sha', subUnitId: 's1', ranges: [cellRange(1)] } };
  assert.equal(ingestCellMutation(model, remove)[0].style.numberFormat, 'General');
  assert.equal(ingestCellMutation(model, format)[0].style.numberFormat, '0.00');
});

test('style edits, resets and undo clearing a font attribute restore savable styles', () => {
  const model = state();
  assert.deepEqual(ingestCellMutation(model, mutation({ 0: { 0: { s: { bl: 1, bg: { rgb: '#ff0000' } } } } }))[0].style,
    { bold: true, fillColor: '#FF0000' });
  assert.equal(ingestCellMutation(model, mutation({ 0: { 0: { s: null } } }))[0].styleReset, true);
  ingestCellMutation(model, mutation({ 1: { 0: { s: { fs: 20 } } } }));
  const restored = ingestCellMutation(model, mutation({ 1: { 0: { s: { fs: null } } } }), false, undefined, () => ({ bl: 1 }))[0];
  assert.deepEqual(restored, { sheetId: 's1', row: 1, column: 0, writeValue: false, value: null, style: { bold: true }, styleReset: true });
});

test('shared formula followers are materialized before cached result mutations', () => {
  const model = state();
  const edits = ingestCellMutation(model, mutation({ 1: { 0: { si: 'group', v: 12 } } }), false, () => '=B2*2');
  assert.equal(edits[0].formula, '=B2*2');
  assert.deepEqual(ingestCellMutation(model, mutation({ 1: { 0: { v: null } } }, { options: { fromFormula: true } })), []);
});

test('readonly gates mutations, editor activation, shortcuts, undo/redo and paste', () => {
  const model = state();
  for (const id of ['sheet.mutation.set-range-values', 'sheet.mutation.set.numfmt', 'sheet.mutation.remove.numfmt',
    'sheet.command.set-range-values', 'sheet.command.set-bold', 'sheet.operation.set-cell-edit-visible',
    'univer.command.undo', 'univer.command.redo', 'univer.command.cut', 'univer.command.paste', 'doc.command.insert-text']) {
    assert.equal(canExecuteCommand({ ...mutation({ 0: { 0: { v: 1 } } }), id }, model, true), false, id);
  }
  for (const id of ['sheet.operation.set-scroll', 'sheet.operation.set-selections', 'sheet.command.set-worksheet-activate', 'univer.command.copy']) {
    assert.equal(canExecuteCommand({ id }, model, true), true, id);
  }
  assert.equal(canExecuteCommand(mutation({ 0: { 0: { v: 1 } } }, { options: { fromFormula: true } }), model, true), true);
});

test('structural, sheet, chart, filter and untranslatable command surfaces are refused', () => {
  const model = state();
  // Unbound surfaces — and bound ones missing their required params — stay
  // refused (default deny). The filter commands/mutations are bound in B4;
  // their paramless shape is refused here and their bound shape is covered by
  // the filter policy test below.
  // Tab colour stays refused on purpose: the vendored gateway has no tabColor
  // write path, so the colour is shown read-only (B3 report: pending gateway).
  for (const id of ['sheet.command.set-tab-color', 'sheet.mutation.set-tab-color',
    'sheet.command.set-frozen', 'sheet.command.move-range',
    'sheet.mutation.move-range', 'sheet.command.paste-col-width', 'sheet.command.set-row-height', 'sheet.mutation.set-worksheet-row-height',
    'sheet.command.set-auto-filter', 'sheet.mutation.set-filter-range', 'drawing.mutation.insert-drawing',
    'base-ui.operation.toggle-shortcut-panel', 'ui-sheet.command.show-menu-list', 'sheet.operation.rename-sheet',
    'sheet.command.remove-sheet-confirm']) {
    assert.equal(canExecuteCommand({ id, type: 2 }, model, false), false, id);
    assert.equal(canExecuteCommand({ id, type: 2, options: { fromFormula: true } }, model, false), false, `${id} fromFormula`);
  }
  assert.equal(canExecuteCommand(mutation({ 0: { 0: { v: 1 } } }), model, false), true);
  assert.equal(canExecuteCommand({ id: 'univer.command.paste' }, model, false), false);
  const paste = { id: 'sheet.command.paste-by-short-key', params: { textContent: '42\tTRUE' } };
  assert.equal(canExecuteCommand(paste, model, false), true);
  assert.equal(canExecuteCommand({ ...paste, params: { ...paste.params, htmlContent: '<table></table>' } }, model, false), false);
  assert.equal(canExecuteCommand({ ...paste, params: { ...paste.params, files: [{}] } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'formula.mutation.insert-worksheet' }, model, false), false);
});

test('row/column structure commands and mutations pass only with a bounded span', () => {
  const model = state();
  const range = (startRow, endRow, startColumn = 0, endColumn = 0) => ({ startRow, endRow, startColumn, endColumn });
  const mutationEvent = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });

  // Commands the toolbar wires.
  assert.equal(canExecuteCommand({ id: 'sheet.command.insert-row-before', params: { value: 2 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.insert-row-before', params: { value: 0 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.insert-row-before', params: { value: 1.5 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.insert-row-after' }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.insert-col-before', params: { value: 3 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.insert-col-after' }, model, false), true);
  // Multi-after: the count is required and bounded (the command reads it unguarded).
  for (const id of ['sheet.command.insert-multi-rows-after', 'sheet.command.insert-multi-cols-right']) {
    assert.equal(canExecuteCommand({ id, params: { value: 3 } }, model, false), true, `${id} count`);
    assert.equal(canExecuteCommand({ id, params: { value: 10_000 } }, model, false), true, `${id} ceiling`);
    assert.equal(canExecuteCommand({ id }, model, false), false, `${id} no count`);
    assert.equal(canExecuteCommand({ id, params: { value: 0 } }, model, false), false, `${id} zero`);
    assert.equal(canExecuteCommand({ id, params: { value: 10_001 } }, model, false), false, `${id} over ceiling`);
    assert.equal(canExecuteCommand({ id, params: { value: 1.5 } }, model, false), false, `${id} fraction`);
    assert.equal(canExecuteCommand({ id, params: { value: 2 } }, model, true), false, `${id} readOnly`);
  }
  // X04: the insert commands above delegate to these inner commands, which
  // fire the same gate again; a refusal here made every insert a silent no-op.
  for (const [id, axis] of [['sheet.command.insert-row', 'row'], ['sheet.command.insert-row-by-range', 'row'],
    ['sheet.command.insert-col', 'column'], ['sheet.command.insert-col-by-range', 'column']]) {
    const span = (start, end) => (axis === 'row' ? range(start, end) : range(0, 0, start, end));
    const inner = (params) => ({ id, params: { unitId: 'file-sha', subUnitId: 's1', direction: 0, ...params } });
    assert.equal(canExecuteCommand(inner({ range: span(2, 4) }), model, false), true, `${id} span`);
    assert.equal(canExecuteCommand({ id, params: { range: span(2, 4) } }, model, false), true, `${id} no unit/sheet`);
    assert.equal(canExecuteCommand(inner({ range: span(2, 4) }), model, true), false, `${id} readOnly`);
    assert.equal(canExecuteCommand({ id }, model, false), false, `${id} no params`);
    assert.equal(canExecuteCommand(inner({ range: span(4, 2) }), model, false), false, `${id} reversed`);
    assert.equal(canExecuteCommand(inner({ range: span(0, 100_000) }), model, false), false, `${id} over ceiling`);
    assert.equal(canExecuteCommand(inner({ range: 'x' }), model, false), false, `${id} bad range`);
    assert.equal(canExecuteCommand(inner({ range: span(2, 4), unitId: 'other' }), model, false), false, `${id} other unit`);
    assert.equal(canExecuteCommand(inner({ range: span(2, 4), subUnitId: 'ghost' }), model, false), false, `${id} ghost sheet`);
  }
  assert.equal(canExecuteCommand({ id: 'sheet.command.remove-row', params: { range: range(1, 2) } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.remove-row', params: { range: range(2, 1) } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.remove-col' }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-height', params: { value: 20 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-height', params: { value: 0 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-height' }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-worksheet-col-width', params: { value: 84 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-worksheet-col-width', params: { value: 5000 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-is-auto-height' }, model, false), true);
  // The pinned set-col-is-auto-width emits no mutation in this build: the
  // allowlist entry is gone and the UniWork reset command carries the route.
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-col-is-auto-width', params: { ranges: [range(0, 0, 1, 2)] } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-rows-hidden', params: { ranges: [range(1, 3)] } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-rows-hidden', params: { ranges: [] } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-col-hidden', params: { ranges: [range(0, 0, 1, 2)] } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-specific-rows-visible', params: { ranges: [range(1, 3)] } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-col-visible-on-cols', params: { ranges: [range(0, 0, 1, 2)] } }, model, false), true);

  // The registered outline commands.
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 2, action: 'group' } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 2, action: 'ungroup' } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-outline', params: { start: 1, end: 1, action: 'clear', subUnitId: 's1' } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 2, action: 'nope' } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 3, end: 2, action: 'group' } }, model, false), false);
  // The row axis ceiling is the wire's span bound: end - start < 100_000, so
  // end 99_999 is still inside it and only 100_000 is refused.
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 99999, action: 'group' } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 100000, action: 'group' } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 2, action: 'group', subUnitId: 'ghost' } }, model, false), false);
  // Show / Hide Detail: axis enum, boolean hide, an in-grid span, a known sheet.
  const detail = (params) => canExecuteCommand({ id: 'uniwork.command.set-outline-detail', params }, model, false);
  assert.equal(detail({ axis: 'rows', start: 2, end: 2, hide: true }), true);
  assert.equal(detail({ axis: 'cols', start: 1, end: 3, hide: false, subUnitId: 's1' }), true);
  assert.equal(detail({ axis: 'sheet', start: 2, end: 2, hide: true }), false);
  assert.equal(detail({ start: 2, end: 2, hide: true }), false);
  assert.equal(detail({ axis: 'rows', start: 2, end: 2, hide: 'yes' }), false);
  assert.equal(detail({ axis: 'rows', start: 2, end: 2 }), false);
  assert.equal(detail({ axis: 'rows', start: -1, end: 2, hide: true }), false);
  assert.equal(detail({ axis: 'rows', start: 1.5, end: 2, hide: true }), false);
  assert.equal(detail({ axis: 'rows', start: 3, end: 2, hide: true }), false);
  assert.equal(detail({ axis: 'cols', start: 0, end: 16384, hide: true }), false);
  assert.equal(detail({ axis: 'rows', start: 0, end: 1_048_576, hide: true }), false);
  assert.equal(detail({ axis: 'rows', start: 2, end: 2, hide: true, subUnitId: 'ghost' }), false);
  assert.equal(detail(undefined), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-outline-detail', params: { axis: 'rows', start: 2, end: 2, hide: true } }, model, true), false);
  // The summary line's collapsed flag (Hide Detail and its undo): axis enum, boolean flag, one in-grid line, a known sheet.
  const collapsed = (params, readOnly = false) => canExecuteCommand({ id: 'uniwork.command.set-outline-collapsed', params }, model, readOnly);
  assert.equal(collapsed({ axis: 'rows', start: 5, end: 5, collapsed: true }), true);
  assert.equal(collapsed({ axis: 'cols', start: 3, end: 3, collapsed: false, subUnitId: 's1', history: false }), true);
  assert.equal(collapsed({ axis: 'rows', start: 5, end: 5 }), false);
  assert.equal(collapsed({ axis: 'rows', start: 5, end: 5, collapsed: 1 }), false);
  assert.equal(collapsed({ axis: 'sheet', start: 5, end: 5, collapsed: true }), false);
  assert.equal(collapsed({ axis: 'cols', start: 16384, end: 16384, collapsed: true }), false);
  assert.equal(collapsed({ axis: 'rows', start: 5, end: 5, collapsed: true, subUnitId: 'ghost' }), false);
  assert.equal(collapsed({ axis: 'rows', start: 5, end: 5, collapsed: true }, true), false);
  assert.equal(collapsed(undefined), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-default-width', params: { start: 1, end: 2 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-default-width', params: { start: 1, end: 2, subUnitId: 's1' } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-default-width', params: { start: 2, end: 1 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-default-width', params: { start: 0, end: 99999 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-default-width' }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-cols-default-width', params: { start: 1, end: 2, subUnitId: 'ghost' } }, model, false), false);

  // The mutations the commands dispatch (undo replays them too).
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(2, 4) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-rows', { range: range(0, 1) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-col', { range: range(0, 0, 2, 4) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-col', { range: range(0, 0, 0, 0) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', {}), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(3, 2) }), model, false), false);
  // A shift mutation bounds the axis it shifts; the fixture must put the
  // over-ceiling value on that axis (endRow), not on the untouched columns.
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(0, 100000) }), model, false), false);
  assert.equal(canExecuteCommand({ ...mutationEvent('sheet.mutation.insert-row', { range: range(0, 0) }), params: { unitId: 'other', subUnitId: 's1', range: range(0, 0) } }, model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(0, 0), subUnitId: 'ghost' }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-row-height', { ranges: [range(1, 2)], rowHeight: 30 }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-row-height', { ranges: [range(1, 2)], rowHeight: 9000 }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-row-height', { ranges: [range(1, 2)], rowHeight: { 1: 30, 2: 40 } }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-col-width', { ranges: [range(0, 0, 1, 2)], colWidth: 84 }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-row-is-auto-height', { ranges: [range(1, 2)], autoHeightInfo: 1 }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-row-is-auto-height', { ranges: [range(1, 2)], autoHeightInfo: 2 }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-row-hidden', { ranges: [range(1, 2)] }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-row-visible', { ranges: [range(1, 2)] }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-col-hidden', { ranges: [range(0, 0, 1, 2)] }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-col-visible', { ranges: [range(0, 0, 1, 2)] }), model, false), true);

  for (const id of ['sheet.command.insert-row-before', 'sheet.command.remove-row', 'sheet.command.set-rows-hidden',
    'uniwork.command.set-rows-outline', 'uniwork.command.set-cols-default-width']) {
    assert.equal(canExecuteCommand({ id, type: id.startsWith('uniwork') ? 0 : 1, params: { value: 1, start: 0, end: 0, action: 'group' } }, model, true), false, `${id} readOnly`);
  }
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(0, 0) }), model, true), false);
});

test('editing guards refuse unseen and pivot cells but permit loaded or genuinely empty cells', () => {
  const model = state();
  assert.equal(canEditRange(model, 's1', cellRange()), true);
  assert.equal(canEditRange(model, 's1', cellRange(15)), false);
  assert.equal(canEditRange(model, 's1', cellRange(20)), true);
  assert.equal(canEditRange(model, 'missing', cellRange()), false);
  assert.equal(canExecuteCommand(mutation({ 15: { 0: { v: 1 } } }), model, false), false);
  assert.equal(canExecuteCommand(mutation({ 0: { 0: { v: 1 }, 1: { custom: { x: 1 } } } }), model, false), false);
  model.file.sheets[0].pivotRanges = [cellRange()];
  assert.equal(canEditRange(model, 's1', cellRange()), false);
  model.flags.preloadComplete = true;
  assert.equal(canEditRange(model, 's1', cellRange(15)), true);
  assert.equal(canEditRange(model, 's1', cellRange()), false);
});

test('derived auto-height is allowed only inside supported cell commands and stays out of the journal', () => {
  const model = state();
  const event = { id: 'sheet.mutation.set-worksheet-row-auto-height', params: {
    unitId: 'file-sha', subUnitId: 's1', trigger: 'sheet.command.set-range-values', rowsAutoHeightInfo: [{ row: 0, autoHeight: 40 }],
  } };
  assert.equal(canExecuteCommand(event, model, false), true);
  assert.deepEqual(ingestCellMutation(model, event), []);
  for (const trigger of [undefined, 'sheet.command.set-row-height', 'sheet.command.insert-row-before']) {
    assert.equal(canExecuteCommand({ ...event, params: { ...event.params, trigger } }, model, false), false);
  }
  assert.equal(canExecuteCommand(event, model, true), false);
  const content = mutation({ 0: { 0: { v: 'edited' } } });
  ingestCellMutation(model, content);
  model.loadedRanges.clear();
  assert.equal(canExecuteCommand(content, model, false), false);
  content.params.trigger = 'univer.command.undo';
  assert.equal(canExecuteCommand(content, model, false), true);
});

test('conditional formula dirty bookkeeping is local, bound and derived even for readonly', () => {
  const model = state();
  const event = {id:'sheet.mutation.data-validation-formula-mark-dirty',type:2,options:{onlyLocal:true},
    params:{'file-sha':{s1:{'formula.file-sha_s1_cf_rule_random':true}}}};
  assert.equal(canExecuteCommand(event,model,false),true);
  assert.equal(canExecuteCommand(event,model,true),true);
  assert.deepEqual(ingestCellMutation(model,event),[]);
  for (const params of [{}, {'file-other':event.params['file-sha']}, {'file-sha':{missing:{}}},
    {'file-sha':{s1:{'formula.file-sha_s1_cf_rule_random':false}}},
    {'file-sha':{s1:{'formula.file-sha_s1_dv_rule_random':true}}}]) {
    assert.equal(canExecuteCommand({...event,params},model,false),false);
  }
  assert.equal(canExecuteCommand({...event,options:{}},model,false),false);
  assert.equal(canExecuteCommand({...event,type:0},model,false),false);
  assert.equal(canExecuteCommand(event,null,false),false);
});

test('real Univer commands and undo/redo emit journal restorations and obey the mutation gate', async () => {
  const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
  const { Univer, LogLevel, ICommandService, IUniverInstanceService } = require('@univerjs/core');
  const { UniverSheetsPlugin, SheetInterceptorService } = require('@univerjs/sheets');
  const { FUniver } = require('@univerjs/core/facade');
  require('@univerjs/sheets/facade');
  const presetRequire = createRequire(require.resolve('@univerjs/preset-sheets-core'));
  const { UniverSheetsNumfmtPlugin } = presetRequire('@univerjs/sheets-numfmt');
  presetRequire('@univerjs/sheets-numfmt/facade');
  const univer = new Univer({ logLevel: LogLevel.ERROR, locale: 'enUS', locales: { enUS: {} } });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  const api = FUniver.newAPI(univer);
  const model = state();
  const edits = [];
  const commands = [];
  const refused = [];
  let readOnly = false;
  const workbook = api.createWorkbook({ id: 'file-sha', sheetOrder: ['s1'], sheets: {
    s1: { id: 's1', name: 'Sheet1', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { v: 'original' } } } },
  } });
  const worksheet = workbook.getActiveSheet();
  univer.__getInjector().get(IUniverInstanceService).focusUnit(workbook.getId());
  const autoHeight = univer.__getInjector().get(SheetInterceptorService).interceptAutoHeight({
    getMutations: () => ({
      redos: [{ id: 'sheet.mutation.set-worksheet-row-auto-height', params: {
        unitId: 'file-sha', subUnitId: 's1', rowsAutoHeightInfo: [{ row: 0, autoHeight: 40 }],
      } }],
      undos: [{ id: 'sheet.mutation.set-worksheet-row-auto-height', params: {
        unitId: 'file-sha', subUnitId: 's1', rowsAutoHeightInfo: [{ row: 0, autoHeight: 20 }],
      } }],
    }),
  });
  const subscriptions = [
    api.addEvent(api.Event.BeforeCommandExecute, (event) => {
      if (!canExecuteCommand(event, model, readOnly)) {
        refused.push({ id: event.id, params: event.params });
        event.cancel = true;
      }
    }),
    api.addEvent(api.Event.CommandExecuted, (event) => {
      commands.push({ id: event.id, params: event.params, options: event.options });
      edits.push(...ingestCellMutation(model, event, false, undefined,
        (row, column) => workbook.getWorkbook().getStyles().getStyleByCell(worksheet.getSheet().getCellRaw(row, column))));
    }),
  ];
  try {
    worksheet.getRange(0, 0).setValue('=B1*2');
    assert.equal(edits.at(-1).formula, '=B1*2');
    await api.undo();
    assert.equal(edits.at(-1).value, 'original', JSON.stringify({ commands, refused, edits, cell: worksheet.getRange(0, 0).getCellData() }));
    assert.equal(edits.at(-1).formula, undefined);
    await api.redo();
    assert.equal(edits.at(-1).formula, '=B1*2');
    assert.ok(commands.some((command) => command.id === 'sheet.mutation.set-worksheet-row-auto-height'));
    worksheet.getRange(1, 0).setNumberFormat('0.00');
    assert.equal(edits.at(-1).style.numberFormat, '0.00');
    await api.undo();
    assert.equal(edits.at(-1).style.numberFormat, 'General');
    await api.redo();
    assert.equal(edits.at(-1).style.numberFormat, '0.00');
    worksheet.getRange(1, 1).setFontSize(20);
    assert.equal(edits.at(-1).style.fontSize, 20);
    await api.undo();
    assert.equal(edits.at(-1).styleReset, true);
    assert.equal(edits.at(-1).style?.fontSize, undefined);
    for (const [text, expected] of [['42', 42], ['TRUE', true], ['FALSE', false], ['', null], ['text', 'text']]) {
      worksheet.getRange(0, 0).setValue(parseCellText(text));
      assert.equal(edits.at(-1).value, expected);
    }
    worksheet.getRange(0, 0).setValue(parseCellText('=B1*2'));
    const finalCount = edits.length;
    readOnly = true;
    worksheet.getRange(0, 0).setValue('forbidden');
    assert.equal(univer.__getInjector().get(ICommandService).syncExecuteCommand('sheet.mutation.insert-row', {
      unitId: 'file-sha', subUnitId: 's1', range: cellRange(),
    }), false);
    assert.equal(edits.length, finalCount);
    assert.equal(worksheet.getRange(0, 0).getFormula(), '=B1*2');
  } finally {
    subscriptions.forEach((subscription) => subscription.dispose());
    autoHeight.dispose();
    univer.dispose();
  }
});

test('structural mutations journal their op and emit it on the edit channel', () => {
  const model = state();
  const structural = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });

  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.insert-row', {
    range: { startRow: 2, endRow: 4, startColumn: 0, endColumn: 0 },
  })), [{ sheetId: 's1', structural: { kind: 'insert-rows', index: 2, count: 3 } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.remove-rows', {
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
  })), [{ sheetId: 's1', structural: { kind: 'remove-rows', index: 0, count: 1 } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.insert-col', {
    range: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 3 },
  })), [{ sheetId: 's1', structural: { kind: 'insert-cols', index: 1, count: 3 } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.remove-col', {
    range: { startRow: 0, endRow: 0, startColumn: 2, endColumn: 2 },
  })), [{ sheetId: 's1', structural: { kind: "remove-cols", index: 2, count: 1 } }]);
  assert.deepEqual(model.editJournal.structuralOps.get('s1'), [
    { kind: 'insert-rows', index: 2, count: 3 },
    { kind: 'remove-rows', index: 0, count: 1 },
    { kind: 'insert-cols', index: 1, count: 3 },
    { kind: "remove-cols", index: 2, count: 1 },
  ]);

  // A cell edit recorded before a shift is moved into post-operation space.
  const cell = state();
  ingestCellMutation(cell, mutation({ 0: { 0: { v: 'kept' } } }));
  ingestStructuralMutation(cell, structural('sheet.mutation.insert-row', {
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
  }));
  assert.deepEqual([...cell.editJournal.cells.get('s1').values()].map((entry) => [entry.row, entry.value]), [[2, 'kept']]);

  // Ignored shapes emit nothing.
  for (const event of [
    structural('sheet.mutation.insert-row', {}),
    structural('sheet.mutation.insert-row', { range: { startRow: 3, endRow: 2, startColumn: 0, endColumn: 0 } }),
    structural('sheet.mutation.insert-row', { range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, subUnitId: 'ghost' }),
    { id: 'sheet.mutation.insert-row', type: 2, params: { unitId: 'other', subUnitId: 's1', range: cellRange() } },
    { id: 'sheet.mutation.set-range-values', type: 2, params: { unitId: 'file-sha', subUnitId: 's1' } },
  ]) {
    assert.deepEqual(ingestStructuralMutation(model, event), [], JSON.stringify(event));
  }
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.insert-row', { range: cellRange() }), true), []);
  assert.deepEqual(ingestStructuralMutation(model, { ...structural('sheet.mutation.insert-row', { range: cellRange() }), options: { fromFormula: true } }), []);
  assert.deepEqual(ingestStructuralMutation(null, structural('sheet.mutation.insert-row', { range: cellRange() })), []);
});

test('size, hidden and auto-size mutations convert to file units before journalling', () => {
  const model = state();
  const structural = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });

  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-worksheet-row-height', {
    ranges: [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 }], rowHeight: 40,
  })), [{ sheetId: 's1', structural: { kind: 'set-row-size', start: 1, end: 1, size: 30 } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-worksheet-row-height', {
    ranges: [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 }], rowHeight: { 2: 30, 3: 45 },
  })), [
    { sheetId: 's1', structural: { kind: 'set-row-size', start: 2, end: 2, size: 22.5 } },
    { sheetId: 's1', structural: { kind: 'set-row-size', start: 3, end: 3, size: 33.75 } },
  ]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-worksheet-col-width', {
    ranges: [{ startRow: 0, endRow: 0, startColumn: 1, endColumn: 2 }], colWidth: 84,
  })), [{ sheetId: 's1', structural: { kind: 'set-col-size', start: 1, end: 2, size: 12 } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-worksheet-row-is-auto-height', {
    ranges: [{ startRow: 4, endRow: 4, startColumn: 0, endColumn: 0 }], autoHeightInfo: 1,
  })), [{ sheetId: 's1', structural: { kind: 'set-row-size', start: 4, end: 4, size: null } }]);
  // Auto OFF (0) is the echo of an explicit height, never a reset.
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-worksheet-row-is-auto-height', {
    ranges: [{ startRow: 4, endRow: 4, startColumn: 0, endColumn: 0 }], autoHeightInfo: 0,
  })), []);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-row-hidden', {
    ranges: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 }],
  })), [{ sheetId: 's1', structural: { kind: 'set-rows-hidden', start: 5, end: 5, hidden: true } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-row-visible', {
    ranges: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 }],
  })), [{ sheetId: 's1', structural: { kind: 'set-rows-hidden', start: 5, end: 5, hidden: false } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-col-hidden', {
    ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
  })), [{ sheetId: 's1', structural: { kind: 'set-cols-hidden', start: 0, end: 1, hidden: true } }]);
  assert.deepEqual(ingestStructuralMutation(model, structural('sheet.mutation.set-col-visible', {
    ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
  })), [{ sheetId: 's1', structural: { kind: 'set-cols-hidden', start: 0, end: 1, hidden: false } }]);
});

test('outline actions shift runs of levels, clamp at the bounds and clear', () => {
  const model = state();
  const rows = (action, from, to) => applyOutlineAction(model, 's1', 'rows', from, to, action);

  assert.deepEqual(rows('group', 2, 4), [{ sheetId: 's1', structural: { kind: 'set-rows-outline', start: 2, end: 4, level: 1 } }]);
  assert.deepEqual(rows('group', 6, 7), [{ sheetId: 's1', structural: { kind: 'set-rows-outline', start: 6, end: 7, level: 1 } }]);
  // One op per contiguous run of equal levels: rows 2-4 and 6-7 sit at level
  // 1, row 5 at 0, so the whole span raises in three runs.
  assert.deepEqual(rows('group', 2, 7), [
    { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 2, end: 4, level: 2 } },
    { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 5, end: 5, level: 1 } },
    { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 6, end: 7, level: 2 } },
  ]);
  assert.deepEqual(rows('ungroup', 2, 7), [
    { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 2, end: 4, level: 1 } },
    { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 5, end: 5, level: 0 } },
    { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 6, end: 7, level: 1 } },
  ]);
  // The same run keeps rising one level at a time, clamped at 7.
  for (let level = 2; level <= 7; level += 1) {
    assert.deepEqual(rows('group', 2, 4), [{ sheetId: 's1', structural: { kind: 'set-rows-outline', start: 2, end: 4, level } }]);
  }
  assert.deepEqual(rows('group', 2, 4), []);
  assert.deepEqual(rows('clear', 0, 1), [{ sheetId: 's1', structural: { kind: 'set-rows-outline', start: 0, end: 1, level: 0 } }]);
  assert.deepEqual(applyOutlineAction(model, 's1', 'cols', 1, 2, 'group'), [
    { sheetId: 's1', structural: { kind: 'set-cols-outline', start: 1, end: 2, level: 1 } },
  ]);
  // Out-of-grid or unknown-sheet spans are refused with no journal entry.
  assert.deepEqual(applyOutlineAction(model, 's1', 'rows', 3, 2, 'group'), []);
  assert.deepEqual(applyOutlineAction(model, 'ghost', 'rows', 0, 1, 'group'), []);
  assert.deepEqual(applyOutlineAction(null, 's1', 'rows', 0, 1, 'group'), []);
});

test('Show / Hide Detail targets the outline group of a line or the group a summary line closes', () => {
  const model = state();
  // Rows 1-3 at level 1 with rows 2-3 at level 2; row 4 is the level-1 summary
  // (level 0 below a group); row 6 is a lone level-1 line.
  applyOutlineAction(model, 's1', 'rows', 1, 3, 'group');
  applyOutlineAction(model, 's1', 'rows', 2, 3, 'group');
  applyOutlineAction(model, 's1', 'rows', 6, 6, 'group');
  // A detail line: the run around it at or below its own level.
  assert.deepEqual(outlineDetailSpan(model, 's1', 'rows', 1), { start: 1, end: 3 });
  assert.deepEqual(outlineDetailSpan(model, 's1', 'rows', 3), { start: 2, end: 3 });
  assert.deepEqual(outlineDetailSpan(model, 's1', 'rows', 6), { start: 6, end: 6 });
  // A summary line (summary below detail, the Excel default) closes the group above it.
  assert.deepEqual(outlineDetailSpan(model, 's1', 'rows', 4), { start: 1, end: 3 });
  assert.deepEqual(outlineDetailSpan(model, 's1', 'rows', 7), { start: 6, end: 6 });
  // Not grouped at all, an unknown sheet, an axis without levels: no group.
  assert.equal(outlineDetailSpan(model, 's1', 'rows', 0), null);
  assert.equal(outlineDetailSpan(model, 's1', 'rows', 9), null);
  assert.equal(outlineDetailSpan(model, 'ghost', 'rows', 1), null);
  assert.equal(outlineDetailSpan(model, 's1', 'cols', 1), null);
  assert.equal(outlineDetailSpan(model, 's1', 'rows', -1), null);
  assert.equal(outlineDetailSpan(null, 's1', 'rows', 1), null);
});

test('outline levels follow their rows and columns through inserts and removals', () => {
  const model = state();
  const structural = (id, range) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', range } });
  const rows = () => outlineLevels(model, 's1', 'rows', 0, 8);
  applyOutlineAction(model, 's1', 'rows', 2, 4, 'group');
  applyOutlineAction(model, 's1', 'rows', 3, 3, 'group');
  applyOutlineAction(model, 's1', 'rows', 6, 6, 'group');
  assert.deepEqual(rows(), [0, 0, 1, 2, 1, 0, 1, 0, 0]);
  // Two rows inserted at 3: the grouped rows below move down, the new rows sit at 0.
  ingestStructuralMutation(model, structural('sheet.mutation.insert-row', { startRow: 3, endRow: 4, startColumn: 0, endColumn: 9 }));
  assert.deepEqual(rows(), [0, 0, 1, 0, 0, 2, 1, 0, 1]);
  // Removing rows 2-3 drops their levels and pulls the rest up.
  ingestStructuralMutation(model, structural('sheet.mutation.remove-rows', { startRow: 2, endRow: 3, startColumn: 0, endColumn: 9 }));
  assert.deepEqual(rows(), [0, 0, 0, 2, 1, 0, 1, 0, 0]);
  // Columns shift on their own axis only.
  applyOutlineAction(model, 's1', 'cols', 1, 1, 'group');
  ingestStructuralMutation(model, structural('sheet.mutation.insert-col', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 0 }));
  assert.deepEqual(outlineLevels(model, 's1', 'cols', 0, 3), [0, 0, 1, 0]);
  ingestStructuralMutation(model, structural('sheet.mutation.remove-col', { startRow: 0, endRow: 19, startColumn: 2, endColumn: 2 }));
  assert.deepEqual(outlineLevels(model, 's1', 'cols', 0, 3), [0, 0, 0, 0]);
  assert.deepEqual(rows(), [0, 0, 0, 2, 1, 0, 1, 0, 0]);
  // A seeded file level never lands on an inserted column.
  model.file.sheets[0].columnWidths = [{ startColumn: 5, endColumn: 5, hidden: false, outlineLevel: 3 }];
  ingestStructuralMutation(model, structural('sheet.mutation.insert-col', { startRow: 0, endRow: 19, startColumn: 5, endColumn: 5 }));
  seedColumnOutline(model);
  assert.equal(outlineLevels(model, 's1', 'cols', 5, 5)[0], 0);
  assert.deepEqual(outlineLevels(model, 's1', 'rows', 3, 2), []);
});

test('an outline history entry restores the previous levels with allowed outline commands', () => {
  const step = (start, end, action) => ({
    id: 'uniwork.command.set-rows-outline', params: { subUnitId: 's1', start, end, action, history: false },
  });
  assert.deepEqual(outlineHistoryItem('file-sha', 's1', 'rows', 1, 5, 'group', [0, 1, 2, 1, 0]), {
    unitID: 'file-sha',
    undoMutations: [step(1, 5, 'clear'), step(2, 4, 'group'), step(3, 3, 'group')],
    redoMutations: [step(1, 5, 'group')],
  });
  const cols = outlineHistoryItem('file-sha', 's1', 'cols', 0, 1, 'ungroup', [1, 1]);
  assert.equal(cols.undoMutations[0].id, 'uniwork.command.set-cols-outline');
  assert.deepEqual(cols.undoMutations.map((entry) => [entry.params.start, entry.params.end, entry.params.action]), [[0, 1, 'clear'], [0, 1, 'group']]);
  // Every replayed step passes the command policy.
  const model = state();
  for (const entry of [...cols.undoMutations, ...cols.redoMutations]) {
    assert.equal(canExecuteCommand({ id: entry.id, type: 0, params: entry.params }, model, false), true);
  }
});

test('real Univer undo/redo of an outline action restores the levels and journals the restoration', async () => {
  const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
  const { Univer, LogLevel, ICommandService, IUndoRedoService, IUniverInstanceService } = require('@univerjs/core');
  const { UniverSheetsPlugin } = require('@univerjs/sheets');
  const { FUniver } = require('@univerjs/core/facade');
  require('@univerjs/sheets/facade');
  const univer = new Univer({ logLevel: LogLevel.ERROR, locale: 'enUS', locales: { enUS: {} } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const model = state();
  const emitted = [];
  const refused = [];
  const workbook = api.createWorkbook({ id: 'file-sha', sheetOrder: ['s1'], sheets: { s1: { id: 's1', name: 'Data', rowCount: 20, columnCount: 10 } } });
  const injector = univer.__getInjector();
  injector.get(IUniverInstanceService).focusUnit(workbook.getId());
  const undoRedo = injector.get(IUndoRedoService);
  // The controller's runOutline (controller.ts), over the same edits.ts helpers.
  const registration = injector.get(ICommandService).registerCommand({
    id: 'uniwork.command.set-rows-outline', type: 0,
    handler: (_accessor, p) => {
      const before = outlineLevels(model, p.subUnitId, 'rows', p.start, p.end);
      const edits = applyOutlineAction(model, p.subUnitId, 'rows', p.start, p.end, p.action);
      emitted.push(...edits);
      if (edits.length > 0 && p.history !== false) {
        undoRedo.pushUndoRedo(outlineHistoryItem('file-sha', p.subUnitId, 'rows', p.start, p.end, p.action, before));
      }
      return edits.length > 0;
    },
  });
  const gate = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
    if (!canExecuteCommand(event, model, false)) {
      refused.push(event.id);
      event.cancel = true;
    }
  });
  const levels = () => outlineLevels(model, 's1', 'rows', 0, 4);
  try {
    assert.equal(await api.executeCommand('uniwork.command.set-rows-outline', { subUnitId: 's1', start: 1, end: 3, action: 'group' }), true);
    assert.equal(await api.executeCommand('uniwork.command.set-rows-outline', { subUnitId: 's1', start: 2, end: 2, action: 'group' }), true);
    assert.deepEqual(levels(), [0, 1, 2, 1, 0]);
    emitted.length = 0;
    await api.undo();
    assert.deepEqual(levels(), [0, 1, 1, 1, 0], JSON.stringify(refused));
    // The restoration is journalled: the span cleared, then regrouped to level 1.
    assert.deepEqual(emitted.map((edit) => edit.structural), [
      { kind: 'set-rows-outline', start: 2, end: 2, level: 0 },
      { kind: 'set-rows-outline', start: 2, end: 2, level: 1 },
    ]);
    assert.deepEqual(model.editJournal.structuralOps.get('s1').at(-1), { kind: 'set-rows-outline', start: 2, end: 2, level: 1 });
    await api.undo();
    assert.deepEqual(levels(), [0, 0, 0, 0, 0]);
    await api.redo();
    assert.deepEqual(levels(), [0, 1, 1, 1, 0]);
    await api.redo();
    assert.deepEqual(levels(), [0, 1, 2, 1, 0]);
    assert.deepEqual(refused, []);
  } finally {
    gate.dispose();
    registration.dispose();
    univer.dispose();
  }
});

test('default column width journals one null set-col-size op for the span', () => {
  const model = state();
  assert.deepEqual(applyColumnDefaultWidth(model, 's1', 1, 2), [
    { sheetId: 's1', structural: { kind: 'set-col-size', start: 1, end: 2, size: null } },
  ]);
  assert.deepEqual(model.editJournal.structuralOps.get('s1'), [
    { kind: 'set-col-size', start: 1, end: 2, size: null },
  ]);
  assert.deepEqual(applyColumnDefaultWidth(model, 's1', 2, 1), []);
  assert.deepEqual(applyColumnDefaultWidth(model, 'ghost', 0, 1), []);
  assert.deepEqual(applyColumnDefaultWidth(null, 's1', 0, 1), []);
  assert.equal(model.editJournal.structuralOps.get('s1').length, 1);
});

test('file row outline levels seed the outline map, clamp and stay below session edits', () => {
  const model = state();
  model.file.sheets[0].rowOutline = [
    { row: 2, outlineLevel: 1 }, { row: 3, outlineLevel: 9, collapsed: true }, { row: 5, collapsed: true },
    { row: 6, outlineLevel: 0 }, { row: -1, outlineLevel: 1 }, { row: 1.5, outlineLevel: 1 }, null,
  ];
  applyOutlineAction(model, 's1', 'rows', 2, 2, 'group');
  seedRowOutline(model);
  const rows = model.outline.get('s1').rows;
  // The session group on row 2 owns its entry; the file never overrides it.
  assert.deepEqual([...rows.entries()].sort(([a], [b]) => a - b), [
    [2, { level: 1, collapsed: false }],
    [3, { level: 7, collapsed: true }],
    [5, { level: 0, collapsed: true }],
  ]);
  seedRowOutline(null);
});

test('file column outline levels seed the outline map and stay below session edits', () => {
  const model = state();
  model.file.sheets[0].columnWidths = [
    { startColumn: 1, endColumn: 2, hidden: false, outlineLevel: 2, collapsed: true },
    { startColumn: 4, endColumn: 4, hidden: false },
  ];
  seedColumnOutline(model);
  const cols = model.outline.get('s1').cols;
  assert.deepEqual(cols.get(1), { level: 2, collapsed: true });
  assert.deepEqual(cols.get(2), { level: 2, collapsed: true });
  assert.equal(cols.has(4), false);
  // The seeded level is the base a session group raises from (2 -> 3).
  assert.deepEqual(applyOutlineAction(model, 's1', 'cols', 1, 2, 'group'), [
    { sheetId: 's1', structural: { kind: 'set-cols-outline', start: 1, end: 2, level: 3 } },
  ]);
  // A session edit owns the entry afterwards; another file read never resets it.
  seedColumnOutline(model);
  assert.deepEqual(cols.get(1), { level: 3, collapsed: true });
  assert.deepEqual(applyOutlineAction(model, 's1', 'cols', 1, 2, 'group'), [
    { sheetId: 's1', structural: { kind: 'set-cols-outline', start: 1, end: 2, level: 4 } },
  ]);
});

test('liveSessionSheets follows the journal through add, rename and remove', () => {
  const model = sheetState();
  assert.deepEqual(liveSessionSheets(model), [
    { id: 's1', name: 'Data' }, { id: 's2', name: 'PhuLuc' },
  ]);
  ingestSheetMutation(model, { id: 'sheet.mutation.insert-sheet', type: 2, params: {
    unitId: 'file-sha', index: 2, sheet: { id: 's3', name: 'Scratch' },
  } });
  assert.deepEqual(liveSessionSheets(model).map((sheet) => sheet.name), ['Data', 'PhuLuc', 'Scratch']);
  ingestSheetMutation(model, { id: 'sheet.mutation.set-worksheet-name', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's1', name: 'Budget',
  } });
  assert.deepEqual(liveSessionSheets(model).map((sheet) => sheet.name), ['Budget', 'PhuLuc', 'Scratch']);
  ingestSheetMutation(model, { id: 'sheet.mutation.remove-sheet', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's2', subUnitName: 'PhuLuc',
  } });
  assert.deepEqual(liveSessionSheets(model), [{ id: 's1', name: 'Budget' }, { id: 's3', name: 'Scratch' }]);
});

test('sheet mutations journal and emit one typed sheet edit each', () => {
  const model = sheetState();
  const event = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', ...params } });

  // Add: the new sheet's id/name/index ride the mutation.
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.insert-sheet', {
    index: 2, sheet: { id: 's3', name: 'Scratch' },
  })), [{ sheetId: 's3', sheetName: 'Scratch', sheetOp: { kind: 'add-sheet', index: 2 } }]);
  assert.equal(model.editJournal.sheets.added.get('s3').name, 'Scratch');

  // Duplicate: a copy context turns the same insert mutation into a copy.
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.insert-sheet', {
    index: 1, sheet: { id: 's4', name: 'Data copy' },
  }), false, { copy: { sourceSheetId: 's1', sourceName: 'Data' } }), [
    { sheetId: 's4', sheetName: 'Data copy', sheetOp: {
      kind: 'duplicate-sheet', sourceSheetId: 's1', sourceName: 'Data', index: 1,
    } },
  ]);
  assert.equal(model.editJournal.sheets.added.get('s4').sourceSheetId, 's1');

  // Rename: the live (pre-mutation) name is the target, the param the new one.
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.set-worksheet-name', {
    subUnitId: 's1', name: 'Budget',
  })), [{ sheetId: 's1', sheetName: 'Data', sheetOp: { kind: 'rename-sheet', newName: 'Budget' } }]);
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.set-worksheet-name', {
    subUnitId: 's1', name: 'Ngân sách',
  })), [{ sheetId: 's1', sheetName: 'Budget', sheetOp: { kind: 'rename-sheet', newName: 'Ngân sách' } }]);
  assert.equal(model.editJournal.sheets.renamed.get('s1'), 'Ngân sách');

  // Reorder and hide/unhide (Univer's BooleanNumber 0/1).
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.set-worksheet-order', {
    subUnitId: 's1', fromOrder: 0, toOrder: 2,
  })), [{ sheetId: 's1', sheetName: 'Ngân sách', sheetOp: { kind: 'reorder-sheet', index: 2 } }]);
  assert.equal(model.editJournal.sheets.orderDirty, true);
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.set-worksheet-hidden', {
    subUnitId: 's2', hidden: 1,
  })), [{ sheetId: 's2', sheetName: 'PhuLuc', sheetOp: { kind: 'set-sheet-hidden', hidden: true } }]);
  assert.equal(model.editJournal.sheets.hidden.get('s2'), true);
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.set-worksheet-hidden', {
    subUnitId: 's2', hidden: 0,
  })), [{ sheetId: 's2', sheetName: 'PhuLuc', sheetOp: { kind: 'set-sheet-hidden', hidden: false } }]);

  // Remove: the removed sheet's live name is captured before the journal mark.
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.remove-sheet', {
    subUnitId: 's2', subUnitName: 'PhuLuc',
  })), [{ sheetId: 's2', sheetName: 'PhuLuc', sheetOp: { kind: 'remove-sheet' } }]);
  assert.deepEqual(liveSessionSheets(model).map((sheet) => sheet.name), ['Ngân sách', 'Scratch', 'Data copy']);

  // Malformed shapes never emit: foreign unit, unknown sheet, bad name/index.
  for (const bad of [
    event('sheet.mutation.insert-sheet', { index: 9, sheet: { id: 's5', name: 'X' } }),
    event('sheet.mutation.insert-sheet', { index: 0, sheet: { id: '', name: 'X' } }),
    event('sheet.mutation.insert-sheet', { index: 0, sheet: { id: 's5', name: 'a/b' } }),
    event('sheet.mutation.set-worksheet-name', { subUnitId: 's1', name: 'x'.repeat(32) }),
    event('sheet.mutation.set-worksheet-name', { subUnitId: 's1' }),
    event('sheet.mutation.set-worksheet-name', { subUnitId: 'ghost', name: 'Y' }),
    event('sheet.mutation.set-worksheet-order', { subUnitId: 's1', fromOrder: 0, toOrder: 9 }),
    event('sheet.mutation.set-worksheet-hidden', { subUnitId: 's1', hidden: 2 }),
    event('sheet.mutation.set-worksheet-hidden', { subUnitId: 'ghost', hidden: 1 }),
    { id: 'sheet.mutation.set-worksheet-hidden', type: 2, params: { unitId: 'other', subUnitId: 's1', hidden: 1 } },
  ]) assert.deepEqual(ingestSheetMutation(model, bad), [], JSON.stringify(bad));
  assert.deepEqual(ingestSheetMutation(model, event('sheet.mutation.insert-sheet', {
    index: 0, sheet: { id: 's6', name: 'X' },
  }), true), []);
  assert.deepEqual(ingestSheetMutation(null, event('sheet.mutation.insert-sheet', {
    index: 0, sheet: { id: 's6', name: 'X' },
  })), []);
});

test('sheet commands and mutations pass the policy only with bound params', () => {
  const model = sheetState();
  const command = (id, params) => ({ id, type: 1, params });

  assert.equal(canExecuteCommand(command('sheet.command.insert-sheet', { sheet: { name: 'Scratch' } }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.insert-sheet', { index: 2, sheet: { id: 's3', name: 'Scratch' } }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.insert-sheet', { index: 3 }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.insert-sheet', { sheet: { name: 'a:b' } }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.copy-sheet', { subUnitId: 's1' }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.copy-sheet', { subUnitId: 'ghost' }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.remove-sheet', { subUnitId: 's2' }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-name', { subUnitId: 's1', name: 'Budget' }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-name', { subUnitId: 's1', name: '' }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-name', { subUnitId: 's1', name: "'q'" }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-order', { subUnitId: 's1', order: 1 }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-order', { subUnitId: 's1', order: 2 }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-hidden', { subUnitId: 's1' }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-worksheet-show', { subUnitId: 's1' }), model, false), true);

  const mutationEvent = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-sheet', {
    index: 2, sheet: { id: 's3', name: 'Scratch' },
  }), model, false), true);
  assert.equal(canExecuteCommand({ ...mutationEvent('sheet.mutation.insert-sheet', {
    index: 2, sheet: { id: 's3', name: 'Scratch' },
  }), params: { unitId: 'other', index: 2, sheet: { id: 's3', name: 'Scratch' } } }, model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-sheet', { subUnitName: 'Data' }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-name', { name: 'Budget' }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-order', { fromOrder: 0, toOrder: 1 }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-order', { fromOrder: 0, toOrder: 1.5 }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-hidden', { hidden: 1 }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-worksheet-hidden', { hidden: true }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.copy-worksheet-end', {}), model, false), true);
  // Read-only refuses every sheet command (the generic gate runs first).
  assert.equal(canExecuteCommand(command('sheet.command.insert-sheet', { sheet: { name: 'X' } }), model, true), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-sheet', { subUnitName: 'Data' }), model, true), false);

  // A removal needs a survivor: the single-sheet state refuses it.
  const single = state();
  assert.equal(canExecuteCommand({ id: 'sheet.mutation.remove-sheet', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's1', subUnitName: 'Data',
  } }, single, false), false);

  // Cells and structural ops on a sheet added this session stay editable.
  const added = sheetState();
  ingestSheetMutation(added, { id: 'sheet.mutation.insert-sheet', type: 2, params: {
    unitId: 'file-sha', index: 2, sheet: { id: 's3', name: 'Scratch' },
  } });
  assert.equal(canExecuteCommand({ id: 'sheet.mutation.set-range-values', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's3', cellValue: { 0: { 0: { v: 'x' } } },
  } }, added, false), true);
  assert.equal(canEditRange(added, 's3', cellRange()), true);
  assert.equal(canExecuteCommand({ id: 'sheet.mutation.insert-row', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's3', range: cellRange(),
  } }, added, false), true);
});

test('the pinned validateSheetName shape is enforced for names', () => {
  for (const name of ['Sheet1', 'Ngân sách', 'a'.repeat(31)]) assert.equal(sheetNameShapeOK(name), true, name);
  for (const name of ['', 'a'.repeat(32), 'a/b', 'a\\b', 'a?b', 'a*b', 'a[b', 'a]b', 'a:b', "'q'", "'a"]) {
    assert.equal(sheetNameShapeOK(name), false, name);
  }
});

test('filter mutations snapshot the live model into a whole-sheet edit', () => {
  const model = state();
  const range = { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 };
  const criteria = {
    0: { colId: 0, filters: { filters: ['alpha', 'beta'] } },
    1: { colId: 1, customFilters: { and: 1, customFilters: [{ val: 'x', operator: 'notEqual' }] } },
    2: { colId: 2, filters: { blank: true } },
  };
  const worksheet = filterWorksheet(filterModel(range, criteria, [2, 3]));
  const edits = ingestFilterMutation(
    model,
    filterEvent('sheet.mutation.set-filter-criteria', { col: 0, criteria: { colId: 0, filters: { filters: ['alpha'] } } }),
    () => worksheet,
  );
  assert.deepEqual(edits, [{
    sheetId: 's1',
    filter: {
      range,
      columns: [
        { colId: 0, values: ['alpha', 'beta'] },
        { colId: 1, customs: { and: true, filters: [{ val: 'x', operator: 'notEqual' }] } },
        { colId: 2, blank: true },
      ],
    },
    hiddenRows: [2, 3],
    visibilityRange: range,
  }]);
  assert.equal(model.editJournal.filterDirty.has('s1'), true);

  // The visibility span widens to the file origin's range when one exists.
  const native = state();
  native.filterOrigins.set('s1', { origin: 'worksheet', range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 } });
  const widened = ingestFilterMutation(
    native,
    filterEvent('sheet.mutation.set-filter-range', {}),
    () => filterWorksheet(filterModel(range, {}, [])),
  );
  assert.deepEqual(widened[0].visibilityRange, { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 });
});

test('a removed filter emits a clear with the origin or last-seen visibility range', () => {
  const model = state();
  const sessionRange = { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 };
  // A session-created filter first: the snapshot records its range...
  const created = ingestFilterMutation(
    model,
    filterEvent('sheet.mutation.set-filter-range', {}),
    () => filterWorksheet(filterModel(sessionRange, {}, [])),
  );
  assert.equal(created.length, 1);
  // ...so the later removal can still unhide what it was hiding without a file origin.
  const cleared = ingestFilterMutation(model, filterEvent('sheet.mutation.remove-filter', {}), () => filterWorksheet(null));
  assert.deepEqual(cleared, [{ sheetId: 's1', filter: null, hiddenRows: [], visibilityRange: sessionRange }]);

  // A file-native origin is used when the sheet never saw a session snapshot.
  const native = state();
  const origin = { startRow: 0, endRow: 6, startColumn: 0, endColumn: 2 };
  native.filterOrigins.set('s1', { origin: 'worksheet', range: origin });
  const nativeCleared = ingestFilterMutation(native, filterEvent('sheet.mutation.remove-filter', {}), () => filterWorksheet(null));
  assert.deepEqual(nativeCleared[0].visibilityRange, origin);

  // Nothing was ever filtered: no state to emit.
  assert.deepEqual(ingestFilterMutation(state(), filterEvent('sheet.mutation.remove-filter', {}), () => filterWorksheet(null)), []);
});

test('color criteria refuse the snapshot instead of silently dropping criteria', () => {
  const model = state();
  const worksheet = filterWorksheet(filterModel(
    { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
    { 0: { colId: 0, colorFilters: { cellFillColors: ['#ff0000'] } } },
  ));
  assert.throws(
    () => ingestFilterMutation(model, filterEvent('sheet.mutation.set-filter-criteria', { col: 0, criteria: {} }), () => worksheet),
    /appColorFiltersUnsaveable/,
  );
});

test('filter mutations ignore foreign workbooks, unknown sheets, suppression and other ids', () => {
  const model = state();
  const worksheet = () => filterWorksheet(filterModel({ startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 }, {}, []));
  for (const event of [
    { id: 'sheet.mutation.set-filter-criteria', type: 2, params: { unitId: 'other', subUnitId: 's1' } },
    filterEvent('sheet.mutation.set-filter-criteria', { subUnitId: 'ghost' }),
    filterEvent('sheet.mutation.set-range-values', {}),
  ]) {
    assert.deepEqual(ingestFilterMutation(model, event, worksheet), [], JSON.stringify(event));
  }
  assert.deepEqual(ingestFilterMutation(model, filterEvent('sheet.mutation.set-filter-criteria', {}), worksheet, true), []);
  assert.deepEqual(ingestFilterMutation(null, filterEvent('sheet.mutation.set-filter-criteria', {}), worksheet), []);
  assert.deepEqual(ingestFilterMutation(model, filterEvent('sheet.mutation.set-filter-criteria', {}), () => null), []);
});

test('filter commands and mutations pass the policy only with bounded params', () => {
  const model = state();
  const command = (id, params) => ({ id, type: 1, params });
  const mutationEvent = (id, params) => ({ id, type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  const range = { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 };

  assert.equal(canExecuteCommand(command('sheet.command.set-filter-range', { range }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-filter-range', { range: { ...range, startRow: 5 } }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.set-filter-range', { range: { ...range, endColumn: 16_384 } }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.smart-toggle-filter', { subUnitId: 's1' }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.smart-toggle-filter', {}), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.remove-sheet-filter', { subUnitId: 'ghost' }), model, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.clear-filter-criteria', {}), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.re-calc-filter', {}), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-filter-criteria', {
    col: 0, criteria: { colId: 0, filters: { filters: ['x'] } },
  }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-filter-criteria', {
    col: 0, criteria: { colId: 0, customFilters: { customFilters: [{ val: 5, operator: 'greaterThanOrEqual' }] } },
  }), model, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.set-filter-criteria', { col: 0, criteria: null }), model, false), true);
  // Color criteria pass (the pinned panel offers them; the snapshot refuses
  // them with a message rather than dropping criteria silently).
  assert.equal(canExecuteCommand(command('sheet.command.set-filter-criteria', {
    col: 0, criteria: { colId: 0, colorFilters: { cellFillColors: ['#fff'] } },
  }), model, false), true);
  for (const params of [
    { col: 16_384, criteria: { colId: 0, filters: { filters: ['x'] } } },
    { col: 0.5, criteria: { colId: 0, filters: { filters: ['x'] } } },
    { col: 0, criteria: { colId: 0, customFilters: { customFilters: [{ val: 1, operator: 'contains' }] } } },
    { col: 0, criteria: { colId: 0 } },
    { col: 0 },
    { col: 0, criteria: { colId: 0, filters: { filters: [7] } } },
  ]) {
    assert.equal(canExecuteCommand(command('sheet.command.set-filter-criteria', params), model, false), false, JSON.stringify(params));
  }

  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-filter-range', { range }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-filter-criteria', {
    col: 1, criteria: { colId: 1, filters: { blank: true } },
  }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-filter', {}), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.re-calc-filter', {}), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-filter-range', { range: { ...range, startColumn: 3, endColumn: 1 } }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-filter-criteria', {
    col: 16_384, criteria: { colId: 0, filters: { filters: [] } },
  }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-filter', { subUnitId: 'ghost' }), model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.mutation.set-filter-range', type: 2, params: { range } }, model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.set-filter-range', {}), model, false), false);

  // Read-only refuses every filter surface (the generic gate runs first).
  assert.equal(canExecuteCommand(command('sheet.command.smart-toggle-filter', {}), model, true), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-filter', {}), model, true), false);
});

test('sort commands and the reorder mutation pass only with a bounded range and keys', () => {
  const model = state();
  const range = { startRow: 0, endRow: 4, startColumn: 1, endColumn: 3 };
  const command = (params) => ({ id: 'sheet.command.sort-range', type: 0, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  const reorderCommand = (params) => ({ id: 'sheet.command.reorder-range', type: 0, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  const mutation = (params) => ({ id: 'sheet.mutation.reorder-range', type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });

  // The Data-tab group's single-key sort command.
  assert.equal(canExecuteCommand(command({ range, orderRules: [{ type: 'asc', colIndex: 1 }], hasTitle: true }), model, false), true);
  assert.equal(canExecuteCommand(command({ range, orderRules: [{ type: 'desc', colIndex: 3 }], hasTitle: false }), model, false), true);
  assert.equal(canExecuteCommand(command({ range, orderRules: [{ type: 'asc', colIndex: 1 }] }), model, false), true);
  // The internally re-dispatched reorder command + mutation (order map).
  assert.equal(canExecuteCommand(reorderCommand({ range, order: { 0: 2, 2: 0 } }), model, false), true);
  assert.equal(canExecuteCommand(mutation({ range, order: { 4: 0 } }), model, false), true);

  for (const params of [
    // Key outside the range, unknown direction, empty rules.
    { range, orderRules: [{ type: 'asc', colIndex: 0 }], hasTitle: false },
    { range, orderRules: [{ type: 'asc', colIndex: 4 }], hasTitle: false },
    { range, orderRules: [{ type: 'sideways', colIndex: 1 }], hasTitle: false },
    { range, orderRules: [], hasTitle: false },
    { range, orderRules: [{ type: 'asc', colIndex: 1.5 }], hasTitle: false },
    // Range outside the grid / inverted / over the span ceiling.
    { range: { ...range, startRow: 3, endRow: 1 }, orderRules: [{ type: 'asc', colIndex: 1 }] },
    { range: { ...range, endRow: 1_048_576 }, orderRules: [{ type: 'asc', colIndex: 1 }] },
    { range: { ...range, startRow: 0, endRow: 100_000 }, orderRules: [{ type: 'asc', colIndex: 1 }] },
    // Missing params.
    { orderRules: [{ type: 'asc', colIndex: 1 }] },
  ]) {
    assert.equal(canExecuteCommand(command(params), model, false), false, JSON.stringify(params));
  }

  // The reorder order map must keep every entry inside the range.
  for (const order of [
    { 0: 9 },
    { 0: -1 },
    { 0: 0.5 },
    { 0: 'x' },
    {},
    [],
  ]) {
    assert.equal(canExecuteCommand(mutation({ range, order }), model, false), false, JSON.stringify(order));
  }

  // Foreign workbook, ghost sheet, missing scope.
  assert.equal(canExecuteCommand({ id: 'sheet.command.sort-range', type: 0, params: { unitId: 'other', subUnitId: 's1', range, orderRules: [{ type: 'asc', colIndex: 1 }] } }, model, false), false);
  assert.equal(canExecuteCommand(mutation({ subUnitId: 'ghost', range, order: { 0: 1 } }), model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.sort-range', type: 0, range, orderRules: [{ type: 'asc', colIndex: 1 }] }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.mutation.reorder-range', type: 2, params: { range, order: { 0: 1 } } }, model, false), false);

  // Read-only refuses every sort surface (the generic gate runs first).
  assert.equal(canExecuteCommand(command({ range, orderRules: [{ type: 'asc', colIndex: 1 }] }), model, true), false);
  assert.equal(canExecuteCommand(mutation({ range, order: { 0: 1 } }), model, true), false);
});

test('table commands and mutations: add, delete by id or name, and undo without a subUnitId', () => {
  const model = state();
  const addCommand = (params) => ({ id: 'sheet.command.add-table', type: 0, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  const deleteCommand = (params) => ({ id: 'sheet.command.delete-table', type: 0, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  const addMutation = (params) => ({ id: 'sheet.mutation.add-table', type: 2, params: { unitId: 'file-sha', subUnitId: 's1', ...params } });
  const deleteMutation = (params) => ({ id: 'sheet.mutation.delete-table', type: 2, params: { unitId: 'file-sha', ...params } });

  const range = { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 };
  assert.equal(canExecuteCommand(addCommand({ range }), model, false), true);
  assert.equal(canExecuteCommand(addCommand({ range, name: 'Sales' }), model, false), true);
  assert.equal(canExecuteCommand(addCommand({ range, name: '1bad' }), model, false), false);
  assert.equal(canExecuteCommand(addCommand({}), model, false), false);

  // No session add yet: a delete (by id or by name) is refused.
  assert.equal(canExecuteCommand(deleteCommand({ tableId: 't1' }), model, false), false);
  assert.equal(canExecuteCommand(deleteCommand({ name: 'Sales' }), model, false), false);

  const [edit] = ingestTableMutation(model, addMutation({ tableId: 't1', name: 'Sales', range, header: ['Region', 'Q1'] }));
  assert.deepEqual(edit, {
    sheetId: 's1', name: 'Sales',
    table: { area: range, name: 'Sales', columnNames: ['Region', 'Q1'], bandedRows: true },
  });
  assert.equal(sessionTableIdForName('s1', 'sales'), 't1');

  // The toolbar's Remove carries a name; the pinned command carries the id.
  assert.equal(canExecuteCommand(deleteCommand({ name: 'Sales' }), model, false), true);
  assert.equal(canExecuteCommand(deleteCommand({ name: 'Missing' }), model, false), false);
  assert.equal(canExecuteCommand(deleteCommand({ tableId: 't1' }), model, false), true);
  assert.equal(canExecuteCommand(deleteCommand({ tableId: 'ghost' }), model, false), false);

  // Undo of the add: the mutation carries {tableId, unitId} and NO subUnitId.
  assert.equal(canExecuteCommand(deleteMutation({ tableId: 't1' }), model, false), true);
  assert.deepEqual(ingestTableMutation(model, deleteMutation({ tableId: 't1' })), [
    { sheetId: 's1', table: null, name: 'Sales' },
  ]);
  // The add is cancelled: the table is gone from the save request.
  assert.equal(model.editJournal.tableAdds.length, 0);

  // Read-only refuses both surfaces.
  assert.equal(canExecuteCommand(addCommand({ range }), model, true), false);
  assert.equal(canExecuteCommand(deleteCommand({ tableId: 't1' }), model, true), false);
});

// ── DEMO COVERAGE (UNI-926): sort a column persists through the journal ──────
// Demo step 3 is "sort a column". The dispatch is covered above (the pinned
// `sheet.command.sort-range` reaches `sheet.mutation.reorder-range` with a
// bounded range + keys). This pins the persistence half: the controller's
// CommandExecuted ingest now captures `sheet.mutation.reorder-range` through
// ingestSortMutation, which runs the vendored journalRangeSnapshot over the
// sorted range and surfaces the changed cells as set_cell edits, so a save
// writes the new row order instead of the unsorted rows.
//
// The capture is passed in (the controller injects the real vendored
// journalRangeSnapshot); the stub here mirrors it by journaling the sorted
// range through the same recordSetRangeValues write.
test('a reorder-range sort mutation journals the sorted rows as cell edits', () => {
  const model = state();
  const range = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 };
  const sortedRows = { 0: 'Ada', 1: 'Bo', 2: 'Cy' };
  const capture = (stateArg, sheetId, area) => {
    const cellValue = {};
    for (let row = area.startRow; row <= area.endRow; row += 1) {
      cellValue[row] = { [area.startColumn]: { v: sortedRows[row] } };
    }
    recordSetRangeValues(stateArg.editJournal, sheetId, cellValue);
  };
  const sortMutation = { id: 'sheet.mutation.reorder-range', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's1', range, order: { 0: 2, 1: 0, 2: 1 },
  } };
  assert.equal(canExecuteCommand(sortMutation, model, false), true, 'the sort mutation must pass the policy');

  const edits = ingestSortMutation(model, sortMutation, capture);
  assert.equal(edits.length, 3, 'the sort must emit one set_cell edit per sorted row');
  assert.deepEqual(edits.map((edit) => edit.row), [0, 1, 2]);
  assert.deepEqual(edits.map((edit) => edit.value), ['Ada', 'Bo', 'Cy']);
  assert.ok(edits.every((edit) => edit.sheetId === 's1' && edit.writeValue === true));

  // The journal now carries the sorted rows: a save would persist them.
  const journal = model.editJournal.cells.get('s1');
  assert.equal(journal.get('0:0').value, 'Ada');
  assert.equal(journal.get('1:0').value, 'Bo');
  assert.equal(journal.get('2:0').value, 'Cy');

  // Re-running over an unchanged journal emits nothing (no spurious dirty).
  assert.deepEqual(ingestSortMutation(model, sortMutation, capture), []);

  // Foreign workbook, a non-sort mutation id and a missing range stay untouched.
  assert.deepEqual(ingestSortMutation(model, { id: 'sheet.mutation.reorder-range', type: 2, params: {
    unitId: 'other', subUnitId: 's1', range, order: { 0: 1 },
  } }, capture), []);
  assert.deepEqual(ingestSortMutation(model, { id: 'sheet.mutation.set-range-values', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's1', range, order: { 0: 1 },
  } }, capture), []);
  assert.deepEqual(ingestSortMutation(model, { id: 'sheet.mutation.reorder-range', type: 2, params: {
    unitId: 'file-sha', subUnitId: 's1', order: { 0: 1 },
  } }, capture), []);
});
