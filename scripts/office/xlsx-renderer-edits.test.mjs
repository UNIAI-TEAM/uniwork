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
      export {createEditJournal} from '../../upstream/apps/sheets/src/renderer/edit-journal';`,
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
const { createEditJournal, ingestCellMutation, ingestStructuralMutation, applyOutlineAction, canExecuteCommand, canEditRange, parseCellText } = module.exports;
const cellRange = (row = 0, column = 0) => ({ startRow: row, endRow: row, startColumn: column, endColumn: column });
function state() {
  return {
    file: { sessionId: 'book', sha256: 'sha', sheets: [{ id: 's1', rowCount: 20, columnCount: 10, pivotRanges: [] }] },
    editJournal: createEditJournal(),
    loadedRanges: new Map([['s1', { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 }]]),
    flags: { preloadComplete: false },
    closure: { pinned: new Map() },
    outline: new Map(),
  };
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
  for (const id of ['sheet.command.set-worksheet-name',
    'sheet.command.set-frozen', 'sheet.command.insert-sheet', 'sheet.mutation.insert-sheet', 'sheet.command.move-range',
    'sheet.mutation.move-range', 'sheet.command.paste-col-width', 'sheet.command.set-row-height', 'sheet.mutation.set-worksheet-row-height',
    'sheet.command.set-auto-filter', 'sheet.mutation.set-filter-range', 'drawing.mutation.insert-drawing',
    'base-ui.operation.toggle-shortcut-panel', 'ui-sheet.command.show-menu-list', 'sheet.operation.rename-sheet']) {
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
  assert.equal(canExecuteCommand({ id: 'sheet.command.remove-row', params: { range: range(1, 2) } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.remove-row', params: { range: range(2, 1) } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.remove-col' }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-height', params: { value: 20 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-height', params: { value: 0 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-height' }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-worksheet-col-width', params: { value: 84 } }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-worksheet-col-width', params: { value: 5000 } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-row-is-auto-height' }, model, false), true);
  assert.equal(canExecuteCommand({ id: 'sheet.command.set-col-is-auto-width', params: { ranges: [range(0, 0, 1, 2)] } }, model, false), true);
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
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 99999, action: 'group' } }, model, false), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-rows-outline', params: { start: 0, end: 2, action: 'group', subUnitId: 'ghost' } }, model, false), false);

  // The mutations the commands dispatch (undo replays them too).
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(2, 4) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-rows', { range: range(0, 1) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-col', { range: range(0, 0, 2, 4) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.remove-col', { range: range(0, 0, 0, 0) }), model, false), true);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', {}), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(3, 2) }), model, false), false);
  assert.equal(canExecuteCommand(mutationEvent('sheet.mutation.insert-row', { range: range(0, 0, 0, 99999) }), model, false), false);
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

  for (const id of ['sheet.command.insert-row-before', 'sheet.command.remove-row', 'sheet.command.set-rows-hidden', 'uniwork.command.set-rows-outline']) {
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
