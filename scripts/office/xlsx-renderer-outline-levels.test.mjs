import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-953: Excel's outline level buttons (outline-levels.ts + outline-bar.ts).
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const upstream = path.join(REPO_ROOT, 'packages/office-upstream/upstream');
const bundled = await build({
  stdin: {
    contents: `export * from './outline-levels'; export * from './outline-bar';
      export { applyOutlineAction, applyOutlineCollapse, canExecuteCommand, createEditJournal } from './index-test';`,
    resolveDir: renderer, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'outline-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/index-test$/ }, () => ({ path: 'index-test', namespace: 'index-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'index-test' }, () => ({
        contents: `export * from './edits'; export * from './command-policy';
          export {createEditJournal} from '../../upstream/apps/sheets/src/renderer/edit-journal';`,
        resolveDir: renderer, loader: 'ts',
      }));
      builder.onResolve({ filter: /^@univerjs\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const CellValueType={STRING:1,NUMBER:2,BOOLEAN:3}; export const CommandType={COMMAND:0,OPERATION:1,MUTATION:2};',
      }));
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
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
const { outlineMaxLevel, outlineMaxLevels, planOutlineLevel, runOutlineLevel, createOutlineLevelBar,
  applyOutlineAction, applyOutlineCollapse, canExecuteCommand, createEditJournal } = loaded.exports;

function state() {
  return {
    file: { sessionId: 'book', sha256: 'sha', sheets: [{ id: 's1', name: 'Data', hidden: false, rowCount: 20, columnCount: 10, pivotRanges: [] }] },
    editJournal: createEditJournal(),
    loadedRanges: new Map([['s1', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 9 }]]),
    flags: { preloadComplete: false },
    closure: { pinned: new Map() },
    outline: new Map(),
    filterOrigins: new Map(),
  };
}
const entries = (levels) => new Map(Object.entries(levels).map(([line, level]) => [Number(line), { level, collapsed: false }]));

test('max level and the per-sheet levels the bar reads', () => {
  assert.equal(outlineMaxLevel(undefined), 0);
  assert.equal(outlineMaxLevel(entries({ 1: 0, 2: 0 })), 0);
  assert.equal(outlineMaxLevel(entries({ 1: 1, 2: 3, 3: 2 })), 3);
  const model = state();
  applyOutlineAction(model, 's1', 'rows', 1, 3, 'group');
  applyOutlineAction(model, 's1', 'rows', 2, 2, 'group');
  applyOutlineAction(model, 's1', 'cols', 4, 5, 'group');
  assert.deepEqual(outlineMaxLevels(model, 's1'), { rows: 2, cols: 1 });
  assert.deepEqual(outlineMaxLevels(model, 'ghost'), { rows: 0, cols: 0 });
  assert.deepEqual(outlineMaxLevels(model, undefined), { rows: 0, cols: 0 });
  applyOutlineAction(model, 's1', 'cols', 4, 5, 'clear');
  assert.deepEqual(outlineMaxLevels(model, 's1'), { rows: 2, cols: 0 });
});

test('a level hides every deeper grouped line, shows the rest and sets each group summary flag', () => {
  // Rows 1-3 level 1 with row 2 at level 2 (summary rows 3 and 4), rows 6-7 level 1 (summary 8).
  const lines = entries({ 1: 1, 2: 2, 3: 1, 6: 1, 7: 1, 9: 0 });
  const none = () => false;
  assert.deepEqual(planOutlineLevel(lines, 1, 'rows', none), {
    hide: [{ start: 1, end: 3 }, { start: 6, end: 7 }], show: [],
    collapsed: [{ line: 3, collapsed: true }, { line: 4, collapsed: true }, { line: 8, collapsed: true }],
  });
  assert.deepEqual(planOutlineLevel(lines, 2, 'rows', none), {
    hide: [{ start: 2, end: 2 }], show: [],
    collapsed: [{ line: 3, collapsed: true }, { line: 4, collapsed: false }, { line: 8, collapsed: false }],
  });
  // Only lines whose state changes run: everything hidden, level 3 shows all of it.
  assert.deepEqual(planOutlineLevel(lines, 3, 'rows', () => true), {
    hide: [], show: [{ start: 1, end: 3 }, { start: 6, end: 7 }],
    collapsed: [{ line: 3, collapsed: false }, { line: 4, collapsed: false }, { line: 8, collapsed: false }],
  });
  // Nested groups closing on the same line: the outermost one's flag (the button Excel draws there).
  assert.deepEqual(planOutlineLevel(entries({ 1: 1, 2: 2 }), 2, 'rows', none).collapsed, [{ line: 3, collapsed: false }]);
  // A group at the last column has no summary line.
  assert.deepEqual(planOutlineLevel(entries({ 16_383: 1 }), 1, 'cols', none).collapsed, []);
});

test('runOutlineLevel runs hide then show, journals changed flags once and refuses bad input', () => {
  const model = state();
  applyOutlineAction(model, 's1', 'rows', 1, 3, 'group');
  applyOutlineAction(model, 's1', 'rows', 2, 2, 'group');
  applyOutlineCollapse(model, 's1', 'rows', 4, true);
  const hidden = new Set([1, 2, 3]);
  const executed = [];
  const emitted = [];
  const undo = [];
  const host = {
    state: model, unitId: 'file-sha',
    isHidden: (line) => hidden.has(line),
    execute: (id, params) => { executed.push({ id, params }); return true; },
    emit: (edits) => { emitted.push(...edits); return edits.length > 0; },
    pushUndo: (item) => undo.push(item),
  };
  assert.equal(runOutlineLevel(host, 's1', 'rows', 2), true);
  assert.deepEqual(executed, [{ id: 'sheet.command.set-specific-rows-visible', params: {
    unitId: 'file-sha', subUnitId: 's1', ranges: [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 0, rangeType: 1 }, { startRow: 3, endRow: 3, startColumn: 0, endColumn: 0, rangeType: 1 }],
  } }]);
  // Row 3 closes the level-2 group (collapsed), row 4 the level-1 one (expanded).
  assert.deepEqual(emitted.map((edit) => edit.structural), [
    { kind: 'set-rows-outline', start: 3, end: 3, level: 1, collapsed: true },
    { kind: 'set-rows-outline', start: 4, end: 4, level: 0, collapsed: false },
  ]);
  assert.equal(undo.length, 1);
  assert.deepEqual(undo[0].undoMutations.map((step) => [step.params.start, step.params.collapsed, step.params.history]), [[3, false, false], [4, true, false]]);
  assert.deepEqual(undo[0].redoMutations.map((step) => [step.id, step.params.start, step.params.collapsed]), [
    ['uniwork.command.set-outline-collapsed', 3, true], ['uniwork.command.set-outline-collapsed', 4, false],
  ]);
  // Columns hide through the column command.
  applyOutlineAction(model, 's1', 'cols', 2, 3, 'group');
  executed.length = 0;
  assert.equal(runOutlineLevel({ ...host, isHidden: () => false }, 's1', 'cols', 1), true);
  assert.deepEqual(executed.map((step) => [step.id, step.params.ranges]), [
    ['sheet.command.set-col-hidden', [{ startRow: 0, endRow: 0, startColumn: 2, endColumn: 3, rangeType: 2 }]],
  ]);
  // A refused hidden/visible command fails the click; a level past the last button clamps; no outline is a no-op.
  assert.equal(runOutlineLevel({ ...host, isHidden: () => false, execute: () => false }, 's1', 'cols', 1), false);
  executed.length = 0;
  assert.equal(runOutlineLevel({ ...host, isHidden: () => true }, 's1', 'cols', 8), true);
  assert.equal(executed[0].id, 'sheet.command.set-col-visible-on-cols');
  const flat = state();
  assert.equal(runOutlineLevel({ ...host, state: flat }, 's1', 'rows', 1), true);
  for (const level of [0, 9, 1.5, Number.NaN]) assert.equal(runOutlineLevel(host, 's1', 'rows', level), false);
  assert.equal(runOutlineLevel(host, 'ghost', 'rows', 1), false);
});

test('the command policy allowlists set-outline-level with a strict axis, level and sheet', () => {
  const model = state();
  const allowed = (params) => canExecuteCommand({ id: 'uniwork.command.set-outline-level', params }, model, false);
  assert.equal(allowed({ axis: 'rows', level: 1 }), true);
  assert.equal(allowed({ axis: 'cols', level: 8, subUnitId: 's1' }), true);
  assert.equal(allowed({ axis: 'diag', level: 1 }), false);
  assert.equal(allowed({ axis: 'rows', level: 0 }), false);
  assert.equal(allowed({ axis: 'rows', level: 9 }), false);
  assert.equal(allowed({ axis: 'rows', level: '2' }), false);
  assert.equal(allowed({ axis: 'rows', level: 2, subUnitId: 'ghost' }), false);
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-outline-level', params: { axis: 'rows', level: 1 } }, model, true), false);
});

function fakeDocument() {
  const byId = new Map();
  const element = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], attributes: new Map(), style: {}, listeners: new Map(), hidden: false,
      textContent: '', title: '', type: '', id: '', className: '', parent: null,
      setAttribute(key, value) { this.attributes.set(key, String(value)); },
      getAttribute(key) { return this.attributes.get(key) ?? null; },
      appendChild(child) { child.parent = this; this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
      insertBefore(child, before) { child.parent = this; this.children.splice(Math.max(0, this.children.indexOf(before)), 0, child); return child; },
      replaceChildren(...nodes) { this.children = []; for (const child of nodes) this.appendChild(child); },
      addEventListener(type, handler) { this.listeners.set(type, handler); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; },
      click() { this.listeners.get('click')?.(); },
    };
    return node;
  };
  const document = { createElement: element, head: element('head'), getElementById: (id) => byId.get(id) ?? null };
  return document;
}

test('the level bar shows 1..max+1 buttons per outlined axis, labels them and shrinks the grid', () => {
  const document = fakeDocument();
  const container = document.createElement('div');
  container.ownerDocument = document;
  const grid = container.appendChild(document.createElement('div'));
  grid.style.height = '100%';
  const clicks = [];
  let lang = 'en';
  const label = (key, params) => `${lang}:${key}${params ? `:${params.level}` : ''}`;
  const bar = createOutlineLevelBar({ container, grid, label, onLevel: (axis, level) => clicks.push([axis, level]) });
  bar.update({ rows: 0, cols: 0 });
  assert.equal(container.children.length, 1, 'no outline: no strip');
  bar.update({ rows: 2, cols: 1 });
  const strip = container.children[0];
  assert.equal(container.children[1], grid, 'the strip sits above the grid');
  assert.equal(strip.hidden, false);
  assert.equal(strip.getAttribute('aria-label'), 'en:outlineLevelsBar');
  assert.equal(grid.style.height, 'calc(100% - var(--uniwork-outline-bar-height) - calc(1 * var(--uniwork-outline-level-width) + 4px))');
  assert.ok(document.getElementById('uniwork-xlsx-outline-levels-style').textContent.includes('var(--color-border)'));
  const [rows, cols] = strip.children;
  assert.equal(rows.getAttribute('aria-label'), 'en:outlineLevelsRows');
  const rowButtons = rows.children.filter((child) => child.tagName === 'BUTTON');
  assert.deepEqual(rowButtons.map((button) => button.textContent), ['1', '2', '3']);
  assert.equal(rowButtons[0].type, 'button');
  assert.equal(rowButtons[1].getAttribute('aria-label'), 'en:outlineLevelShowRows:2');
  assert.equal(cols.children.filter((child) => child.tagName === 'BUTTON').length, 2);
  rowButtons[1].click();
  cols.children.at(-1).click();
  assert.deepEqual(clicks, [['rows', 2], ['cols', 2]]);
  // Same levels and copy: nothing rebuilt (keyboard focus stays on the button).
  bar.update({ rows: 2, cols: 1 });
  assert.equal(strip.children[0], rows);
  // A language switch relabels; a sheet without an outline hides the strip.
  lang = 'vi';
  bar.update({ rows: 2, cols: 0 });
  assert.equal(strip.children.length, 1);
  assert.equal(strip.children[0].getAttribute('aria-label'), 'vi:outlineLevelsRows');
  bar.update({ rows: 0, cols: 0 });
  assert.equal(strip.hidden, true);
  assert.equal(grid.style.height, '100%');
  bar.update({ rows: 1, cols: 0 });
  assert.equal(strip.hidden, false);
  bar.dispose();
  assert.deepEqual(container.children, [grid]);
  assert.equal(grid.style.height, '100%');
});

test('real Univer: a level click hides and shows by level, flags the summaries, and undoes in one step', async () => {
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
  const sheet = workbook.getSheetBySheetId('s1').getSheet();
  // The controller's two handlers (controller.ts), over the same shim helpers.
  const commands = injector.get(ICommandService);
  const registrations = [
    commands.registerCommand({ id: 'uniwork.command.set-outline-level', type: 0, handler: (_accessor, p) => {
      const batch = undoRedo.__tempBatchingUndoRedo('file-sha');
      try {
        return runOutlineLevel({
          state: model, unitId: 'file-sha',
          isHidden: (line) => !sheet.getRowRawVisible(line),
          execute: (id, params) => api.syncExecuteCommand(id, params) === true,
          emit: (edits) => { emitted.push(...edits); return edits.length > 0; },
          pushUndo: (item) => undoRedo.pushUndoRedo(item),
        }, p.subUnitId, p.axis, p.level);
      } finally { batch.dispose(); }
    } }),
    commands.registerCommand({ id: 'uniwork.command.set-outline-collapsed', type: 0, handler: (_accessor, p) => {
      emitted.push(...applyOutlineCollapse(model, p.subUnitId, p.axis, p.start, p.collapsed));
      return true;
    } }),
  ];
  const gate = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
    if (!canExecuteCommand(event, model, false)) {
      refused.push(event.id);
      event.cancel = true;
    }
  });
  const hiddenRows = () => Array.from({ length: 10 }, (_, row) => row).filter((row) => !sheet.getRowRawVisible(row));
  const flags = () => [3, 4, 8].map((line) => model.outline.get('s1').rows.get(line)?.collapsed ?? false);
  const level = (value) => api.executeCommand('uniwork.command.set-outline-level', { unitId: 'file-sha', subUnitId: 's1', axis: 'rows', level: value });
  try {
    applyOutlineAction(model, 's1', 'rows', 1, 3, 'group');
    applyOutlineAction(model, 's1', 'rows', 2, 2, 'group');
    applyOutlineAction(model, 's1', 'rows', 6, 7, 'group');
    const entriesBefore = undoRedo.getUndoRedoStatus?.('file-sha')?.undos?.length;
    assert.equal(await level(1), true, JSON.stringify(refused));
    assert.deepEqual(hiddenRows(), [1, 2, 3, 6, 7]);
    assert.deepEqual(flags(), [true, true, true]);
    assert.equal(await level(2), true);
    assert.deepEqual(hiddenRows(), [2]);
    assert.deepEqual(flags(), [true, false, false]);
    assert.equal(await level(3), true);
    assert.deepEqual(hiddenRows(), []);
    assert.deepEqual(flags(), [false, false, false]);
    assert.equal(await level(1), true);
    assert.deepEqual(hiddenRows(), [1, 2, 3, 6, 7]);
    if (entriesBefore !== undefined) {
      assert.equal(undoRedo.getUndoRedoStatus('file-sha').undos.length, entriesBefore + 4, 'one undo entry per click');
    }
    // One undo takes the whole last click back: rows visible, flags cleared.
    await api.undo();
    assert.deepEqual(hiddenRows(), []);
    assert.deepEqual(flags(), [false, false, false]);
    await api.redo();
    assert.deepEqual(hiddenRows(), [1, 2, 3, 6, 7]);
    assert.deepEqual(flags(), [true, true, true]);
    // The hidden flags journal through the mutation channel the controller ingests;
    // the summary flags journalled as outline ops.
    assert.ok(emitted.some((edit) => edit.structural?.kind === 'set-rows-outline' && edit.structural.collapsed === true));
    assert.deepEqual(refused, []);
  } finally {
    gate.dispose();
    for (const registration of registrations) registration.dispose();
    univer.dispose();
  }
});

test('controller: the level bar appears with an outline, a click runs set-outline-level, read-only mounts have none', async () => {
  const { mountController } = await import('./xlsx-renderer-controller-harness.mjs');
  const file = { sessionId: 'session', sha256: 'sha', styles: [], sheets: [
    { id: 's1', name: 'First', hidden: false, rowCount: 20, columnCount: 10, columnWidths: [],
      rowOutline: [{ row: 1, outlineLevel: 1 }, { row: 2, outlineLevel: 2 }, { row: 3, outlineLevel: 1 }] },
    { id: 's2', name: 'Second', hidden: false, rowCount: 20, columnCount: 10, columnWidths: [] },
  ] };
  const edits = [];
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await mounted.handle.loadWorkbook(file);
    await settle();
    const bar = mounted.h.outlineBar;
    assert.ok(bar, 'the strip mounts for a sheet whose file carries a row outline');
    assert.equal(bar.hidden, false);
    const rowButtons = bar.children[0].children.filter((child) => child.tagName === 'BUTTON');
    assert.deepEqual(rowButtons.map((button) => button.textContent), ['1', '2', '3']);
    assert.equal(rowButtons[0].getAttribute('aria-label'), 'outlineLevelShowRows');
    // Clicking "1" runs the allowlisted command, which hides every grouped row and flags the summary.
    rowButtons[0].listeners.get('click')();
    await settle();
    const levelEvent = mounted.events.find((event) => event.id === 'uniwork.command.set-outline-level');
    assert.deepEqual({ axis: levelEvent.params.axis, level: levelEvent.params.level, subUnitId: levelEvent.params.subUnitId }, { axis: 'rows', level: 1, subUnitId: 's1' });
    const hide = mounted.events.find((event) => event.id === 'sheet.command.set-rows-hidden');
    assert.deepEqual(hide.params.ranges, [{ startRow: 1, endRow: 3, startColumn: 0, endColumn: 0, rangeType: 1 }]);
    assert.deepEqual(edits.map((edit) => edit.structural).filter(Boolean), [
      { kind: 'set-rows-outline', start: 3, end: 3, level: 1, collapsed: true },
      { kind: 'set-rows-outline', start: 4, end: 4, level: 0, collapsed: true },
    ]);
    // Grouping columns adds the column cluster; switching to a sheet without an outline hides the strip.
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-cols-outline', { start: 2, end: 3, action: 'group' }), true);
    await settle();
    assert.equal(bar.children.length, 2);
    assert.equal(bar.children[1].getAttribute('data-axis'), 'cols');
    mounted.workbook.setActiveSheet(mounted.workbook.getSheetBySheetId('s2'));
    await settle();
    assert.equal(bar.hidden, true);
    // Malformed params never run.
    for (const params of [{ axis: 'rows' }, { axis: 'diag', level: 1 }, { axis: 'rows', level: 9 }]) {
      assert.equal(await mounted.handle.executeCommand('uniwork.command.set-outline-level', params), false);
    }
  } finally { mounted.close(); }
  const readOnly = mountController({ readOnly: true });
  try {
    await readOnly.handle.loadWorkbook(file);
    await settle();
    assert.equal(readOnly.h.outlineBar, undefined, 'a read-only mount draws no level buttons');
  } finally { readOnly.close(); }
});
