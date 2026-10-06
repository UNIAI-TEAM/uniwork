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
    contents: `export * from './edits'; export * from './command-policy'; export * from './cell-input'; export * from './undo-step';
      export {createEditJournal, recordSetRangeValues} from '../../upstream/apps/sheets/src/renderer/edit-journal';`,
    resolveDir: renderer, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'journal-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const CellValueType={STRING:1,NUMBER:2,BOOLEAN:3}; export const CommandType={COMMAND:0,OPERATION:1,MUTATION:2}; export const IUndoRedoService="undo-redo";',
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
const { createEditJournal, ingestCellMutation, ingestStructuralMutation, canExecuteCommand,
  applyOutlineAction, outlineLevels, outlineHistoryItem, executeAsOneUndoStep, runOutlineCommand } = module.exports;

/** Registers the controller's REAL group/ungroup/clear command (runOutlineCommand
 *  over the same journal state), so a refusal inside a Data-tool batch is the one
 *  the grid produces. */
function registerRealOutlineCommand(injector, ICommandService, undoRedo, model, outlineEdits, notices) {
  return injector.get(ICommandService).registerCommand({
    id: 'uniwork.command.set-rows-outline', type: 0,
    handler: (_accessor, p) => runOutlineCommand({
      state: model,
      unitId: 'file-sha',
      emit: (applied) => { outlineEdits.push(...applied); return applied.length > 0; },
      pushUndo: (item) => undoRedo.pushUndoRedo(item),
      notice: (key) => notices.push(key),
    }, p.subUnitId, 'rows', p.start, p.end, p.action, p.history !== false),
  });
}

// Design review X1/X3 Data tools (UNI-953): the toolbar rewrites a range with
// ONE sheet.command.set-range-values inside one undo step. These payloads are
// the ones packages/views/office/xlsx/toolbar/data-tools/*.test.tsx and
// cell-styles pin; here they run through the real pinned Univer, the command
// policy and the vendored journal that feeds the save.
const STRING = 1;
const NUMBER = 2;
const cleared = { f: null, p: null, si: null };
const text = (v) => ({ ...cleared, v, t: STRING });
const num = (v) => ({ ...cleared, v, t: NUMBER });
const empty = { ...cleared, v: null };

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

async function withSheet(cellData, run) {
  const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
  const { Univer, LogLevel, IUniverInstanceService } = require('@univerjs/core');
  const { UniverSheetsPlugin } = require('@univerjs/sheets');
  const { FUniver } = require('@univerjs/core/facade');
  require('@univerjs/sheets/facade');
  const univer = new Univer({ logLevel: LogLevel.ERROR, locale: 'enUS', locales: { enUS: {} } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const model = state();
  const edits = [];
  const structural = [];
  const refused = [];
  const workbook = api.createWorkbook({ id: 'file-sha', sheetOrder: ['s1'], sheets: {
    s1: { id: 's1', name: 'Data', rowCount: 20, columnCount: 10, cellData },
  } });
  const worksheet = workbook.getActiveSheet();
  univer.__getInjector().get(IUniverInstanceService).focusUnit(workbook.getId());
  const subscriptions = [
    api.addEvent(api.Event.BeforeCommandExecute, (event) => {
      if (!canExecuteCommand(event, model, false)) {
        refused.push(event.id);
        event.cancel = true;
      }
    }),
    api.addEvent(api.Event.CommandExecuted, (event) => {
      edits.push(...ingestCellMutation(model, event, false, undefined,
        (row, column) => workbook.getWorkbook().getStyles().getStyleByCell(worksheet.getSheet().getCellRaw(row, column))));
      structural.push(...ingestStructuralMutation(model, event, false));
    }),
  ];
  try {
    await run({ api, univer, model, worksheet, edits, structural, refused });
  } finally {
    subscriptions.forEach((subscription) => subscription.dispose());
    univer.dispose();
  }
}

const valueAt = (worksheet, row, column) => worksheet.getRange(row, column).getValue();

test('Remove Duplicates: one set-range-values moves the kept rows up, empties the rest, journals every cell and undoes in one step', async () => {
  await withSheet({
    0: { 0: { v: 'Ten' }, 1: { v: 'SL' } },
    1: { 0: { v: 'An' }, 1: { v: 1 } },
    2: { 0: { v: 'An' }, 1: { v: 1 } },
    3: { 0: { v: 'Chi' }, 1: { v: 3 } },
  }, async ({ api, worksheet, edits, refused }) => {
    const ran = await api.executeCommand('sheet.command.set-range-values', {
      unitId: 'file-sha', subUnitId: 's1',
      range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
      value: { 0: { 0: text('Ten'), 1: text('SL') }, 1: { 0: text('An'), 1: num(1) }, 2: { 0: text('Chi'), 1: num(3) }, 3: { 0: empty, 1: empty } },
    });
    assert.equal(ran, true, JSON.stringify(refused));
    assert.deepEqual([0, 1, 2, 3].map((row) => [valueAt(worksheet, row, 0), valueAt(worksheet, row, 1)]),
      [['Ten', 'SL'], ['An', 1], ['Chi', 3], [null, null]]);
    const byCell = new Map(edits.map((edit) => [`${edit.row}:${edit.column}`, edit]));
    assert.equal(byCell.get('2:0').value, 'Chi');
    assert.equal(byCell.get('2:1').value, 3);
    assert.equal(byCell.get('3:0').value, null);
    assert.equal(byCell.get('3:1').value, null);
    await api.undo();
    assert.deepEqual([valueAt(worksheet, 2, 0), valueAt(worksheet, 3, 0), valueAt(worksheet, 3, 1)], ['An', 'Chi', 3]);
  });
});

test('a cell-style preset is a style-only write: values stay, the fill and colour journal as style', async () => {
  await withSheet({ 0: { 0: { v: 42 }, 1: { v: 'x' } } }, async ({ api, worksheet, edits, refused }) => {
    const style = { bg: { rgb: '#C6EFCE' }, cl: { rgb: '#006100' } };
    const ran = await api.executeCommand('sheet.command.set-range-values', {
      unitId: 'file-sha', subUnitId: 's1',
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      value: { 0: { 0: { s: style }, 1: { s: style } } },
    });
    assert.equal(ran, true, JSON.stringify(refused));
    assert.equal(valueAt(worksheet, 0, 0), 42);
    assert.equal(valueAt(worksheet, 0, 1), 'x');
    const edit = edits.find((candidate) => candidate.row === 0 && candidate.column === 0);
    assert.ok(edit?.style, JSON.stringify(edits));
    assert.equal(JSON.stringify(edit.style).includes('C6EFCE'), true, JSON.stringify(edit.style));
  });
});

test('Text to Columns: typed pieces land right of the source, an empty {} hole keeps its cell', async () => {
  await withSheet({
    0: { 0: { v: 'a,12' }, 2: { v: 'keep' } },
    1: { 0: { v: 'b,3,c' } },
  }, async ({ api, worksheet, edits, refused }) => {
    const ran = await api.executeCommand('sheet.command.set-range-values', {
      unitId: 'file-sha', subUnitId: 's1',
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 },
      value: { 0: { 0: text('a'), 1: num(12), 2: {} }, 1: { 0: text('b'), 1: num(3), 2: text('c') } },
    });
    assert.equal(ran, true, JSON.stringify(refused));
    assert.deepEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]].map(([row, column]) => valueAt(worksheet, row, column)),
      ['a', 12, 'keep', 'b', 3, 'c']);
    const hole = edits.find((edit) => edit.row === 0 && edit.column === 2);
    assert.ok(hole === undefined || hole.value === 'keep', JSON.stringify(hole));
    assert.equal(edits.find((edit) => edit.row === 0 && edit.column === 1).value, 12);
    await api.undo();
    assert.deepEqual([valueAt(worksheet, 0, 0), valueAt(worksheet, 0, 1), valueAt(worksheet, 1, 2)], ['a,12', null, null]);
  });
});

test('Subtotal: inserts, one sparse write and the outline run as ONE undo step that lands, journals and undoes as planned', async () => {
  await withSheet({
    0: { 0: { v: 'Ten' }, 1: { v: 'SL' } },
    1: { 0: { v: 'An' }, 1: { v: 1 } },
    2: { 0: { v: 'an' }, 1: { v: 2 } },
    3: { 0: { v: 'Binh' }, 1: { v: 3 } },
    5: { 0: { v: 'below' } },
  }, async ({ api, univer, model, worksheet, edits, structural, refused }) => {
    const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
    const { ICommandService, IUndoRedoService } = require('@univerjs/core');
    const injector = univer.__getInjector();
    const undoRedo = injector.get(IUndoRedoService);
    // The controller's own outline command (runOutlineCommand, edits.ts).
    const outlineEdits = [];
    const registration = registerRealOutlineCommand(injector, ICommandService, undoRedo, model, outlineEdits, []);
    // The planSubtotal payloads (data-tools/subtotal.test.tsx) for A1:B4 summed
    // into B: grand total, Binh, An inserted bottom-up with Direction.DOWN (2)
    // and rangeType ROW (1), one sparse write, then the two outline levels.
    const insert = (row) => ({ id: 'sheet.command.insert-row', params: {
      unitId: 'file-sha', subUnitId: 's1', direction: 2,
      range: { startRow: row, endRow: row, startColumn: 0, endColumn: 1, rangeType: 1 },
    } });
    const outline = (start, end) => ({ id: 'uniwork.command.set-rows-outline', params: { subUnitId: 's1', start, end, action: 'group' } });
    const formula = (f) => ({ f, v: null, p: null, si: null });
    const steps = [insert(4), insert(4), insert(3), { id: 'sheet.command.set-range-values', params: {
      unitId: 'file-sha', subUnitId: 's1',
      range: { startRow: 3, endRow: 6, startColumn: 0, endColumn: 1 },
      value: {
        3: { 0: text('Sum An'), 1: formula('=SUBTOTAL(9,B2:B3)') },
        5: { 0: text('Sum Binh'), 1: formula('=SUBTOTAL(9,B5:B5)') },
        6: { 0: text('Grand Sum'), 1: formula('=SUBTOTAL(9,B2:B6)') },
      },
    } }, outline(1, 5), outline(1, 2), outline(4, 4)];
    try {
      // The controller's executeCommandsAsOneStep path (undo-step.ts).
      const ran = await executeAsOneUndoStep({ get: () => undoRedo }, 'file-sha', steps,
        (step) => api.executeCommand(step.id, step.params));
      assert.equal(ran, steps.length, JSON.stringify(refused));
      assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((row) => valueAt(worksheet, row, 0)),
        ['Ten', 'An', 'an', 'Sum An', 'Binh', 'Sum Binh', 'Grand Sum', null, 'below']);
      assert.deepEqual([1, 2, 4].map((row) => valueAt(worksheet, row, 1)), [1, 2, 3]);
      assert.deepEqual([3, 5, 6].map((row) => worksheet.getRange(row, 1).getFormula()),
        ['=SUBTOTAL(9,B2:B3)', '=SUBTOTAL(9,B5:B5)', '=SUBTOTAL(9,B2:B6)']);
      assert.deepEqual(structural.map((edit) => edit.structural),
        [{ kind: 'insert-rows', index: 4, count: 1 }, { kind: 'insert-rows', index: 4, count: 1 }, { kind: 'insert-rows', index: 3, count: 1 }]);
      const byCell = new Map(edits.map((edit) => [`${edit.row}:${edit.column}`, edit]));
      assert.equal(byCell.get('3:1')?.formula, '=SUBTOTAL(9,B2:B3)', JSON.stringify(edits));
      assert.equal(byCell.get('6:1')?.formula, '=SUBTOTAL(9,B2:B6)');
      assert.equal(byCell.get('5:0')?.value, 'Sum Binh');
      // Detail rows at level 2, subtotal rows at 1, header and grand total at 0.
      assert.deepEqual(outlineLevels(model, 's1', 'rows', 0, 6), [0, 2, 2, 1, 2, 1, 0]);
      assert.ok(model.editJournal.structuralOps.get('s1').some((op) => op.kind === 'set-rows-outline' && op.level === 2));
      // One Ctrl+Z takes back the outline, the write and the inserts, newest first.
      outlineEdits.length = 0;
      await api.undo();
      assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((row) => valueAt(worksheet, row, 0)), ['Ten', 'An', 'an', 'Binh', null, 'below', null]);
      assert.deepEqual([1, 2, 3].map((row) => valueAt(worksheet, row, 1)), [1, 2, 3]);
      assert.deepEqual(outlineLevels(model, 's1', 'rows', 0, 6), [0, 0, 0, 0, 0, 0, 0]);
      assert.ok(outlineEdits.length > 0 && outlineEdits.every((edit) => edit.structural.kind === 'set-rows-outline'));
      assert.deepEqual(structural.slice(3).map((edit) => edit.structural.kind), ['remove-rows', 'remove-rows', 'remove-rows']);
      assert.deepEqual(refused, []);
    } finally {
      registration.dispose();
    }
  });
});

// review-design F1: the Data tools run atomic. A Subtotal whose last outline
// step is refused (rows already at the deepest level) takes the inserts, the
// write and the earlier outline back: the grid, the outline and the undo
// stack are as they were, and the journal nets out to no row change.
test('Subtotal refused at its last outline step leaves nothing behind (atomic)', async () => {
  await withSheet({
    0: { 0: { v: 'Ten' }, 1: { v: 'SL' } },
    1: { 0: { v: 'An' }, 1: { v: 1 } },
    2: { 0: { v: 'Binh' }, 1: { v: 2 } },
    4: { 0: { v: 'below' } },
  }, async ({ api, univer, model, worksheet, structural }) => {
    const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
    const { ICommandService, IUndoRedoService } = require('@univerjs/core');
    const injector = univer.__getInjector();
    const undoRedo = injector.get(IUndoRedoService);
    const notices = [];
    const registration = registerRealOutlineCommand(injector, ICommandService, undoRedo, model, [], notices);
    // Row 1 already sits at the deepest outline level (7): the last step's
    // Group over it cannot deepen anything, so the controller itself refuses.
    model.outline.set('s1', { rows: new Map([[1, { level: 7, collapsed: false }]]), cols: new Map() });
    const insert = (row) => ({ id: 'sheet.command.insert-row', params: {
      unitId: 'file-sha', subUnitId: 's1', direction: 2,
      range: { startRow: row, endRow: row, startColumn: 0, endColumn: 1, rangeType: 1 },
    } });
    const outline = (start, end) => ({ id: 'uniwork.command.set-rows-outline', params: { subUnitId: 's1', start, end, action: 'group' } });
    const steps = [insert(3), insert(3), insert(2), { id: 'sheet.command.set-range-values', params: {
      unitId: 'file-sha', subUnitId: 's1',
      range: { startRow: 2, endRow: 5, startColumn: 0, endColumn: 1 },
      value: { 2: { 0: text('Sum An') }, 4: { 0: text('Sum Binh') }, 5: { 0: text('Grand Sum') } },
    } }, outline(2, 4), outline(1, 1)];
    try {
      const column = () => [0, 1, 2, 3, 4, 5, 6, 7].map((row) => valueAt(worksheet, row, 0));
      const before = column();
      const stackBefore = undoRedo._undoStacks.get('file-sha')?.length ?? 0;
      const ran = await executeAsOneUndoStep({ get: () => undoRedo }, 'file-sha', steps,
        (step) => api.executeCommand(step.id, step.params), { rollback: true });
      assert.equal(ran, 0);
      assert.deepEqual(column(), before);
      assert.deepEqual(outlineLevels(model, 's1', 'rows', 0, 6), [0, 7, 0, 0, 0, 0, 0]);
      assert.deepEqual(notices, ['appOutlineMaxLevels'], 'the refusal says why');
      assert.equal(undoRedo._undoStacks.get('file-sha')?.length ?? 0, stackBefore);
      const kinds = structural.map((edit) => edit.structural.kind);
      assert.equal(kinds.filter((kind) => kind === 'insert-rows').length, 3);
      assert.equal(kinds.filter((kind) => kind === 'remove-rows').length, 3);
    } finally {
      registration.dispose();
    }
  });
});
