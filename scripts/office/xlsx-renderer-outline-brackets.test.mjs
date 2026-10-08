import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-964: Excel's per-group outline brackets (outline-brackets.ts + outline-gutter.ts).
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const upstream = path.join(REPO_ROOT, 'packages/office-upstream/upstream');
const bundled = await build({
  stdin: {
    contents: `export * from './outline-brackets'; export * from './outline-gutter'; export * from './outline-levels';
      export { createOutlineLevelBar } from './outline-bar';
      export { applyOutlineAction, applyOutlineCollapse, seedRowOutline, ingestStructuralMutation, canExecuteCommand, createEditJournal } from './index-test';
      export { rendererEditsToOperations } from '../../../views/office/xlsx/xlsx-edit-bridge';`,
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
const { outlineGroups, groupCollapsed, planOutlineGroup, runOutlineGroup, layoutOutlineBrackets, createOutlineGutters,
  outlineGutterExtent, columnName, createOutlineLevelBar, applyOutlineAction, applyOutlineCollapse, seedRowOutline,
  ingestStructuralMutation, canExecuteCommand, createEditJournal, rendererEditsToOperations } = loaded.exports;

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
const entries = (levels, collapsed = []) =>
  new Map(Object.entries(levels).map(([line, level]) => [Number(line), { level, collapsed: collapsed.includes(Number(line)) }]));

test('groups are maximal runs per depth, outer first, with the summary line after them', () => {
  assert.deepEqual(outlineGroups(undefined, 'rows'), []);
  // Rows 1-5 level 1, 2-3 level 2, row 3 level 3; a gap, then 8-9 level 1; row 11 level 0.
  assert.deepEqual(outlineGroups(entries({ 1: 1, 2: 2, 3: 3, 4: 1, 5: 1, 8: 1, 9: 1, 11: 0 }), 'rows'), [
    { start: 1, end: 5, depth: 1, summary: 6 },
    { start: 2, end: 3, depth: 2, summary: 4 },
    { start: 3, end: 3, depth: 3, summary: 4 },
    { start: 8, end: 9, depth: 1, summary: 10 },
  ]);
  // Levels past 7 clamp; a group at the last column has no summary line.
  assert.deepEqual(outlineGroups(entries({ 16_383: 9 }), 'cols').map((group) => [group.depth, group.summary]),
    [[1, null], [2, null], [3, null], [4, null], [5, null], [6, null], [7, null]]);
  // Two groups at the same depth separated by a shallower line are two groups.
  assert.deepEqual(outlineGroups(entries({ 1: 2, 2: 1, 3: 2 }), 'rows').map((group) => [group.start, group.end, group.depth]),
    [[1, 3, 1], [1, 1, 2], [3, 3, 2]]);
});

test('collapse hides the whole group; expand keeps a nested group collapsed on its own (Excel)', () => {
  // Outer rows 1-6 (summary 7); inner rows 2-3 (summary 4, collapsed flag set); inner rows 5-6 shares summary 7.
  const lines = entries({ 1: 1, 2: 2, 3: 2, 4: 1, 5: 2, 6: 2 }, [4, 7]);
  const [outer, inner] = outlineGroups(lines, 'rows');
  const hidden = new Set([1, 2, 3, 4, 5, 6]);
  const isHidden = (line) => hidden.has(line);
  assert.equal(groupCollapsed(outer, isHidden), true);
  assert.deepEqual(planOutlineGroup(lines, outer, false, 'rows', isHidden), {
    hide: [], show: [{ start: 1, end: 1 }, { start: 4, end: 6 }], collapsed: [{ line: 7, collapsed: false }],
  });
  // Without the inner flag the whole group shows.
  const plain = entries({ 1: 1, 2: 2, 3: 2, 4: 1, 5: 2, 6: 2 });
  assert.deepEqual(planOutlineGroup(plain, outer, false, 'rows', isHidden).show, [{ start: 1, end: 6 }]);
  // Collapsing the inner group hides only its visible lines and flags its summary.
  hidden.clear();
  hidden.add(3);
  assert.equal(groupCollapsed(inner, isHidden), false);
  assert.deepEqual(planOutlineGroup(lines, inner, true, 'rows', isHidden), {
    hide: [{ start: 2, end: 2 }], show: [], collapsed: [{ line: 4, collapsed: true }],
  });
  // A group at the grid edge has no flag to write.
  const edge = outlineGroups(entries({ 16_383: 1 }), 'cols')[0];
  assert.deepEqual(planOutlineGroup(entries({ 16_383: 1 }), edge, true, 'cols', () => false).collapsed, []);
});

function host(model, hidden, overrides = {}) {
  const executed = [];
  const emitted = [];
  const undo = [];
  return {
    executed, emitted, undo,
    host: {
      state: model, unitId: 'file-sha',
      isHidden: (line) => hidden.has(line),
      execute: (id, params) => { executed.push({ id, params }); return true; },
      emit: (edits) => { emitted.push(...edits); return edits.length > 0; },
      pushUndo: (item) => undo.push(item),
      ...overrides,
    },
  };
}

test('runOutlineGroup toggles one group, journals its flag with one undo entry and refuses bad input', () => {
  const model = state();
  applyOutlineAction(model, 's1', 'rows', 1, 4, 'group');
  applyOutlineAction(model, 's1', 'rows', 2, 3, 'group');
  const run = host(model, new Set());
  assert.equal(runOutlineGroup(run.host, 's1', 'rows', 2, 2, true), true);
  assert.deepEqual(run.executed, [{ id: 'sheet.command.set-rows-hidden', params: {
    unitId: 'file-sha', subUnitId: 's1', ranges: [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 0, rangeType: 1 }],
  } }]);
  assert.deepEqual(run.emitted.map((edit) => edit.structural), [{ kind: 'set-rows-outline', start: 4, end: 4, level: 1, collapsed: true }]);
  assert.deepEqual(run.undo[0].undoMutations.map((step) => [step.id, step.params.start, step.params.collapsed]),
    [['uniwork.command.set-outline-collapsed', 4, false]]);
  // The parent stays expanded; expanding it later keeps the inner one collapsed.
  assert.equal(model.outline.get('s1').rows.get(5)?.collapsed ?? false, false);
  const reopened = host(model, new Set([1, 2, 3, 4]));
  assert.equal(runOutlineGroup(reopened.host, 's1', 'rows', 1, 1, false), true);
  assert.deepEqual(reopened.executed.map((step) => [step.id, step.params.ranges.map((range) => [range.startRow, range.endRow])]),
    [['sheet.command.set-specific-rows-visible', [[1, 1], [4, 4]]]]);
  // Columns run the column commands.
  applyOutlineAction(model, 's1', 'cols', 2, 3, 'group');
  const cols = host(model, new Set());
  assert.equal(runOutlineGroup(cols.host, 's1', 'cols', 2, 1, true), true);
  assert.equal(cols.executed[0].id, 'sheet.command.set-col-hidden');
  // A stale button (no such group) is a no-op; bad input and a refused command fail.
  const stale = host(model, new Set());
  assert.equal(runOutlineGroup(stale.host, 's1', 'rows', 7, 1, true), true);
  assert.deepEqual(stale.executed, []);
  for (const [start, depth] of [[-1, 1], [1.5, 1], [1, 0], [1, 8]]) assert.equal(runOutlineGroup(run.host, 's1', 'rows', start, depth, true), false);
  assert.equal(runOutlineGroup(run.host, 'ghost', 'rows', 1, 1, true), false);
  assert.equal(runOutlineGroup(host(model, new Set(), { execute: () => false }).host, 's1', 'rows', 1, 1, true), false);
});

test('the command policy allowlists set-outline-group with a strict axis, start, level and sheet', () => {
  const model = state();
  const allowed = (params) => canExecuteCommand({ id: 'uniwork.command.set-outline-group', params }, model, false);
  assert.equal(allowed({ axis: 'rows', start: 1, level: 1, collapse: true }), true);
  assert.equal(allowed({ axis: 'cols', start: 3, level: 7, collapse: false, subUnitId: 's1' }), true);
  for (const params of [
    { axis: 'diag', start: 1, level: 1, collapse: true }, { axis: 'rows', start: -1, level: 1, collapse: true },
    { axis: 'rows', start: 1, level: 0, collapse: true }, { axis: 'rows', start: 1, level: 8, collapse: true },
    { axis: 'rows', start: 1, level: 1, collapse: 'yes' }, { axis: 'rows', start: 1, level: 1, collapse: true, subUnitId: 'ghost' },
    { axis: 'rows', level: 1, collapse: true },
  ]) assert.equal(allowed(params), false, JSON.stringify(params));
  assert.equal(canExecuteCommand({ id: 'uniwork.command.set-outline-group', params: { axis: 'rows', start: 1, level: 1, collapse: true } }, model, true), false);
});

// A grid of 20px rows / 60px columns starting at (40, 30) in the container, rows from `top` on screen.
function measure({ hidden = new Set(), top = 0, rows = [{ start: 0, end: 19 }] } = {}) {
  return {
    box(axis, line) {
      const size = axis === 'rows' ? 20 : 60;
      let start = axis === 'rows' ? 30 - top * 20 : 40;
      for (let index = 0; index < line; index += 1) if (!hidden.has(index) || axis === 'cols') start += size;
      return { start, size: axis === 'rows' && hidden.has(line) ? 0 : size };
    },
    visible: (axis) => axis === 'rows' ? rows : [{ start: 0, end: 9 }],
    isHidden: (axis, line) => axis === 'rows' && hidden.has(line),
  };
}

test('layout: an expanded group draws its line to the toggle, a collapsed one only the toggle, clipped to the screen', () => {
  const model = state();
  applyOutlineAction(model, 's1', 'rows', 1, 4, 'group');
  applyOutlineAction(model, 's1', 'rows', 2, 3, 'group');
  const open = layoutOutlineBrackets(model, 's1', 'rows', measure());
  assert.deepEqual(open.map((bracket) => [bracket.key, bracket.collapsed, bracket.line, bracket.button]), [
    ['rows:1:1', false, { from: 50, to: 140 }, 140],
    ['rows:2:2', false, { from: 70, to: 120 }, 120],
  ]);
  // The inner group collapsed: no line, its toggle on row 4; the outer line still reaches row 5.
  const folded = layoutOutlineBrackets(model, 's1', 'rows', measure({ hidden: new Set([2, 3]) }));
  assert.deepEqual(folded.map((bracket) => [bracket.key, bracket.collapsed, bracket.line, bracket.button]), [
    ['rows:1:1', false, { from: 50, to: 100 }, 100],
    ['rows:2:2', true, null, 80],
  ]);
  // The outer collapsed: the inner toggle sits on a hidden row and is not drawn.
  const closed = layoutOutlineBrackets(model, 's1', 'rows', measure({ hidden: new Set([1, 2, 3, 4]) }));
  assert.deepEqual(closed.map((bracket) => [bracket.key, bracket.collapsed, bracket.line, bracket.button]), [['rows:1:1', true, null, 60]]);
  // Scrolled to row 3: the outer line starts at the first row on screen, the inner one is gone above it.
  const scrolled = layoutOutlineBrackets(model, 's1', 'rows', measure({ top: 3, rows: [{ start: 3, end: 19 }] }));
  assert.deepEqual(scrolled.map((bracket) => [bracket.key, bracket.line, bracket.button]), [
    ['rows:1:1', { from: 30, to: 80 }, 80],
    ['rows:2:2', { from: 30, to: 60 }, 60],
  ]);
  // Off screen, no outline, no sheet: nothing.
  assert.deepEqual(layoutOutlineBrackets(model, 's1', 'rows', measure({ rows: [{ start: 10, end: 19 }] })), []);
  assert.deepEqual(layoutOutlineBrackets(model, 's1', 'cols', measure()), []);
  assert.deepEqual(layoutOutlineBrackets(model, undefined, 'rows', measure()), []);
  // Columns measure along x.
  applyOutlineAction(model, 's1', 'cols', 1, 2, 'group');
  assert.deepEqual(layoutOutlineBrackets(model, 's1', 'cols', measure()).map((bracket) => [bracket.line, bracket.button]),
    [[{ from: 100, to: 250 }, 250]]);
});

function fakeDocument() {
  const byId = new Map();
  const document = { activeElement: null };
  const element = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], attributes: new Map(), style: {}, listeners: new Map(), hidden: false,
      textContent: '', title: '', type: '', id: '', className: '', parent: null, ownerDocument: document,
      setAttribute(key, value) { this.attributes.set(key, String(value)); },
      getAttribute(key) { return this.attributes.get(key) ?? null; },
      appendChild(child) { child.parent = this; this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
      insertBefore(child, before) { child.parent = this; this.children.splice(Math.max(0, this.children.indexOf(before)), 0, child); return child; },
      replaceChildren(...nodes) {
        if (nodes.includes(document.activeElement) || this.children.includes(document.activeElement)) document.activeElement = null;
        this.children = [];
        for (const child of nodes) this.appendChild(child);
      },
      addEventListener(type, handler) { this.listeners.set(type, handler); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; },
      click() { this.listeners.get('click')?.(); },
      focus() { document.activeElement = this; },
    };
    return node;
  };
  Object.assign(document, { createElement: element, head: element('head'), getElementById: (id) => byId.get(id) ?? null });
  return document;
}

test('gutters: one labelled toggle per bracket with aria-expanded, kept across updates, hidden without levels', () => {
  const document = fakeDocument();
  const container = document.createElement('div');
  const toggles = [];
  let lang = 'en';
  const label = (key, params) => `${lang}:${key}${params ? `:${params.start}-${params.end}` : ''}`;
  const gutters = createOutlineGutters({ container, label, onToggle: (...args) => toggles.push(args) });
  const group = (start, end, depth) => ({ start, end, depth, summary: end + 1 });
  const layout = (rows, cols = []) => ({ rows: { levels: rows.length ? 2 : 0, brackets: rows }, cols: { levels: cols.length ? 1 : 0, brackets: cols } });
  const outer = { key: 'rows:1:1', group: group(1, 4, 1), collapsed: false, line: { from: 50, to: 140 }, button: 140 };
  const inner = { key: 'rows:2:2', group: group(2, 3, 2), collapsed: true, line: null, button: 80 };
  const column = { key: 'cols:1:1', group: group(1, 2, 1), collapsed: false, line: { from: 100, to: 250 }, button: 250 };
  gutters.update(layout([outer, inner], [column]));
  assert.ok(document.getElementById('uniwork-xlsx-outline-gutter-style').textContent.includes('var(--color-border)'));
  const [colGutter, rowGutter] = container.children;
  assert.equal(rowGutter.getAttribute('data-axis'), 'rows');
  assert.equal(rowGutter.getAttribute('aria-label'), 'en:outlineGroupsRows');
  assert.equal(colGutter.getAttribute('aria-label'), 'en:outlineGroupsCols');
  assert.equal(rowGutter.style.width, outlineGutterExtent(2));
  assert.equal(rowGutter.style.top, `calc(var(--uniwork-outline-bar-height) + ${outlineGutterExtent(1)})`);
  const buttons = rowGutter.children.filter((child) => child.tagName === 'BUTTON');
  assert.deepEqual(buttons.map((button) => [button.type, button.textContent, button.getAttribute('aria-expanded'), button.getAttribute('aria-label')]), [
    ['button', '−', 'true', 'en:outlineGroupCollapseRows:2-5'],
    ['button', '+', 'false', 'en:outlineGroupExpandRows:3-4'],
  ]);
  const lines = rowGutter.children.filter((child) => child.tagName === 'DIV');
  assert.equal(lines[0].hidden, false);
  assert.equal(lines[1].hidden, true, 'a collapsed group draws no line');
  assert.equal(lines[0].style.height, '90px');
  assert.ok(buttons[0].style.top.startsWith('calc(140px - ('));
  const colButton = colGutter.children.find((child) => child.tagName === 'BUTTON');
  assert.equal(colButton.getAttribute('aria-label'), 'en:outlineGroupCollapseCols:B-C');
  assert.ok(colButton.style.left.startsWith('calc(250px - ('));
  buttons[0].click();
  buttons[1].click();
  colButton.click();
  assert.deepEqual(toggles, [['rows', 1, 1, true], ['rows', 2, 2, false], ['cols', 1, 1, true]]);
  // The same brackets after a scroll: the same nodes, moved, focus kept; a language switch relabels.
  buttons[0].focus();
  lang = 'vi';
  gutters.update(layout([{ ...outer, line: { from: 30, to: 120 }, button: 120 }, inner], [column]));
  assert.equal(rowGutter.children.filter((child) => child.tagName === 'BUTTON')[0], buttons[0]);
  assert.ok(buttons[0].style.top.startsWith('calc(120px - ('));
  assert.equal(buttons[0].getAttribute('aria-label'), 'vi:outlineGroupCollapseRows:2-5');
  // A new bracket ahead of the focused one re-orders the nodes and refocuses it.
  gutters.update(layout([{ ...outer, key: 'rows:0:1', group: group(0, 0, 1) }, { ...outer, line: { from: 30, to: 120 }, button: 120 }, inner], [column]));
  assert.equal(document.activeElement, buttons[0]);
  // No column outline: its gutter hides; no outline at all: both hide; dispose removes them.
  gutters.update(layout([outer]));
  assert.equal(colGutter.hidden, true);
  assert.equal(colGutter.children.length, 0);
  gutters.update(layout([]));
  assert.equal(rowGutter.hidden, true);
  gutters.dispose();
  assert.deepEqual(container.children, []);
  assert.deepEqual([0, 25, 26, 701, 702, 16_383].map(columnName), ['A', 'Z', 'AA', 'ZZ', 'AAA', 'XFD']);
});

test('the level bar makes room for the gutters: the grid moves right of the row gutter and below the column gutter', () => {
  const document = fakeDocument();
  const container = document.createElement('div');
  container.ownerDocument = document;
  const grid = container.appendChild(document.createElement('div'));
  const bar = createOutlineLevelBar({ container, grid, label: (key) => key, onLevel: () => undefined });
  bar.update({ rows: 2, cols: 1 });
  assert.equal(grid.style.height, `calc(100% - var(--uniwork-outline-bar-height) - ${outlineGutterExtent(1)})`);
  assert.equal(grid.style.width, `calc(100% - ${outlineGutterExtent(2)})`);
  assert.equal(grid.style.marginLeft, outlineGutterExtent(2));
  assert.equal(grid.style.marginTop, outlineGutterExtent(1));
  assert.ok(document.getElementById('uniwork-xlsx-outline-levels-style').textContent.includes('--uniwork-outline-level-width'));
  bar.update({ rows: 0, cols: 0 });
  assert.deepEqual([grid.style.height, grid.style.width, grid.style.marginLeft, grid.style.marginTop], ['100%', '100%', '', '']);
});

test('real Univer: a bracket toggle hides one group, saves as hidden rows + the collapsed flag, and undoes in one step', async () => {
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
  const commands = injector.get(ICommandService);
  // The controller's handlers (controller.ts runOutlineClick), over the same shim helpers.
  const registrations = [
    commands.registerCommand({ id: 'uniwork.command.set-outline-group', type: 0, handler: (_accessor, p) => {
      const batch = undoRedo.__tempBatchingUndoRedo('file-sha');
      try {
        return runOutlineGroup({
          state: model, unitId: 'file-sha',
          isHidden: (line) => !sheet.getRowRawVisible(line),
          execute: (id, params) => api.syncExecuteCommand(id, params) === true,
          emit: (edits) => { emitted.push(...edits); return edits.length > 0; },
          pushUndo: (item) => undoRedo.pushUndoRedo(item),
        }, p.subUnitId, p.axis, p.start, p.level, p.collapse);
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
  // The hidden flags reach the journal through the mutation channel (controller.ts CommandExecuted).
  const ingest = api.addEvent(api.Event.CommandExecuted, (event) => emitted.push(...ingestStructuralMutation(model, event)));
  const hiddenRows = () => Array.from({ length: 10 }, (_, row) => row).filter((row) => !sheet.getRowRawVisible(row));
  const toggle = (start, level, collapse) =>
    api.executeCommand('uniwork.command.set-outline-group', { unitId: 'file-sha', subUnitId: 's1', axis: 'rows', start, level, collapse });
  try {
    applyOutlineAction(model, 's1', 'rows', 1, 6, 'group');
    applyOutlineAction(model, 's1', 'rows', 2, 3, 'group');
    assert.equal(await toggle(2, 2, true), true, JSON.stringify(refused));
    assert.deepEqual(hiddenRows(), [2, 3]);
    // Save: the ops the engine writes as hidden="1" rows and collapsed="1" on the
    // summary row (packages/office-engine/test/xlsx-structural.test.ts, Hide / Show Detail).
    const ops = rendererEditsToOperations([{ id: 's1', name: 'Data' }], emitted);
    assert.deepEqual(ops.map((op) => [op.op, op.attributes]), [
      ['set_rows_hidden', { start: 2, end: 3, hidden: true }],
      ['set_rows_outline', { start: 4, end: 4, level: 1, collapsed: true }],
    ]);
    // Collapse the outer group, then expand it: the inner group stays collapsed.
    assert.equal(await toggle(1, 1, true), true);
    assert.deepEqual(hiddenRows(), [1, 2, 3, 4, 5, 6]);
    assert.equal(await toggle(1, 1, false), true);
    assert.deepEqual(hiddenRows(), [2, 3]);
    assert.equal(model.outline.get('s1').rows.get(7).collapsed, false);
    // One undo takes the whole last toggle back.
    await api.undo();
    assert.deepEqual(hiddenRows(), [1, 2, 3, 4, 5, 6]);
    assert.equal(model.outline.get('s1').rows.get(7).collapsed, true);
    assert.deepEqual(refused, []);
  } finally {
    ingest.dispose();
    gate.dispose();
    for (const registration of registrations) registration.dispose();
    univer.dispose();
  }
});

test('reopen: a saved collapsed group reads collapsed from the file and draws "+" on its summary line', () => {
  const model = state();
  model.file.sheets[0].rowOutline = [
    { row: 1, outlineLevel: 1 }, { row: 2, outlineLevel: 1 }, { row: 3, outlineLevel: 1 }, { row: 4, outlineLevel: 0, collapsed: true },
  ];
  seedRowOutline(model);
  const [bracket] = layoutOutlineBrackets(model, 's1', 'rows', measure({ hidden: new Set([1, 2, 3]) }));
  assert.deepEqual([bracket.key, bracket.collapsed, bracket.line, bracket.button], ['rows:1:1', true, null, 60]);
  assert.equal(model.outline.get('s1').rows.get(4).collapsed, true);
});

test('controller: the gutters mount with an outline, set-outline-group runs through the policy, read-only mounts have none', async () => {
  const { mountController } = await import('./xlsx-renderer-controller-harness.mjs');
  const file = { sessionId: 'session', sha256: 'sha', styles: [], sheets: [
    { id: 's1', name: 'First', hidden: false, rowCount: 20, columnCount: 10, columnWidths: [],
      rowOutline: [{ row: 1, outlineLevel: 1 }, { row: 2, outlineLevel: 2 }, { row: 3, outlineLevel: 1 }] },
  ] };
  const edits = [];
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await mounted.handle.loadWorkbook(file);
    await settle();
    const gutter = mounted.h.appended?.find((child) => child.className === 'uniwork-xlsx-outline-gutter');
    assert.ok(gutter, 'the row gutter mounts for a sheet whose file carries a row outline');
    assert.equal(gutter.getAttribute('data-axis'), 'rows');
    assert.equal(gutter.hidden, false);
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-outline-group', { axis: 'rows', start: 2, level: 2, collapse: true }), true);
    const hide = mounted.events.find((event) => event.id === 'sheet.command.set-rows-hidden');
    assert.deepEqual(hide.params.ranges, [{ startRow: 2, endRow: 2, startColumn: 0, endColumn: 0, rangeType: 1 }]);
    assert.deepEqual(edits.map((edit) => edit.structural).filter(Boolean), [{ kind: 'set-rows-outline', start: 3, end: 3, level: 1, collapsed: true }]);
    for (const params of [{ axis: 'rows', start: 2, level: 2 }, { axis: 'diag', start: 2, level: 2, collapse: true }, { axis: 'rows', start: 2, level: 9, collapse: true }]) {
      assert.equal(await mounted.handle.executeCommand('uniwork.command.set-outline-group', params), false);
    }
  } finally { mounted.close(); }
  const readOnly = mountController({ readOnly: true });
  try {
    await readOnly.handle.loadWorkbook(file);
    await settle();
    assert.equal(readOnly.h.appended?.find((child) => child.className === 'uniwork-xlsx-outline-gutter'), undefined);
  } finally { readOnly.close(); }
});
