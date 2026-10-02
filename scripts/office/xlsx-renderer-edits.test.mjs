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
const { createEditJournal, ingestCellMutation, canExecuteCommand, canEditRange, parseCellText } = module.exports;
const cellRange = (row = 0, column = 0) => ({ startRow: row, endRow: row, startColumn: column, endColumn: column });
function state() {
  return {
    file: { sessionId: 'book', sha256: 'sha', sheets: [{ id: 's1', rowCount: 20, columnCount: 10, pivotRanges: [] }] },
    editJournal: createEditJournal(),
    loadedRanges: new Map([['s1', { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 }]]),
    flags: { preloadComplete: false },
    closure: { pinned: new Map() },
  };
}
const mutation = (cellValue, extra = {}) => ({
  id: 'sheet.mutation.set-range-values', type: 2,
  params: { unitId: 'file-sha', subUnitId: 's1', cellValue }, ...extra,
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
  for (const id of ['sheet.command.insert-row-before', 'sheet.mutation.insert-row', 'sheet.command.set-worksheet-name',
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
