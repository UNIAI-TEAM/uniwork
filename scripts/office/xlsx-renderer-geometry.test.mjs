import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const bundled = await build({
  stdin: { contents: `export * from './geometry';`, resolveDir: renderer, loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'render-stub',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/engine-render$/ }, () => ({ path: 'render', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const IRenderManagerService = "render-manager"; export const SHEET_VIEWPORT_KEY = { VIEW_MAIN: "main" };',
      }));
    },
  }],
});
const mod = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(mod, mod.exports);
const { createGridGeometry, commandMovesCells } = mod.exports;

const HEADER_X = 40;
const HEADER_Y = 20;
const ROW = 20;
const COL = 100;

/** A 20px-row / 100px-column sheet; hidden rows/columns have no extent in the
 *  scene but the raw size accessors still report the default (as Univer does). */
function fixture({ scroll = { x: 0, y: 0 }, zoom = 1, hiddenRows = [], hiddenColumns = [], freeze, counts, visible = { startRow: 0, startColumn: 0 } } = {}) {
  const rowH = (r) => (hiddenRows.includes(r) ? 0 : ROW);
  const colW = (c) => (hiddenColumns.includes(c) ? 0 : COL);
  const sum = (n, f) => { let t = 0; for (let i = 0; i < n; i++) t += f(i); return t; };
  const worksheet = {
    getSheetId: () => 's1',
    getZoom: () => zoom,
    getVisibleRange: () => visible,
    getColumnWidth: () => COL,
    getRowHeight: () => ROW,
    getSheet: () => ({ getRowVisible: (r) => !hiddenRows.includes(r), getColVisible: (c) => !hiddenColumns.includes(c) }),
    getRange: (row, column) => ({
      getCellRect: () => ({ x: HEADER_X + sum(column, colW), y: HEADER_Y + sum(row, rowH), width: colW(column), height: rowH(row) }),
    }),
  };
  if (freeze) worksheet.getFreeze = () => freeze;
  if (counts) {
    worksheet.getFrozenRows = () => counts.rows;
    worksheet.getFrozenColumns = () => counts.columns;
  }
  const runtime = {
    univerAPI: { getActiveWorkbook: () => ({ getId: () => 'wb', getActiveSheet: () => worksheet }) },
    univer: { __getInjector: () => ({ get: () => ({ getRenderById: () => ({ scene: { getViewport: () => ({ viewportScrollX: scroll.x, viewportScrollY: scroll.y }) } }) }) }) },
  };
  const rect = (x, y, width, height) => ({ x, y, width, height });
  const container = {
    getBoundingClientRect: () => rect(0, 0, 1000, 800),
    querySelectorAll: () => [{ getBoundingClientRect: () => rect(0, 0, 1000, 800) }],
  };
  return createGridGeometry(runtime, container);
}

test('without freeze a cell box subtracts the scroll and applies zoom', () => {
  const geometry = fixture({ scroll: { x: 30, y: 10 }, zoom: 2 });
  assert.deepEqual(geometry.getCellBox('s1', 2, 1), { x: (HEADER_X + COL - 30) * 2, y: (HEADER_Y + 2 * ROW - 10) * 2, width: COL * 2, height: ROW * 2, zoom: 2 });
});

test('cells inside frozen rows ignore the vertical scroll, frozen columns the horizontal one', () => {
  const geometry = fixture({ scroll: { x: 50, y: 60 }, freeze: { xSplit: 1, ySplit: 2, startRow: 2, startColumn: 1 } });
  const corner = geometry.getCellBox('s1', 1, 0);
  assert.equal(corner.x, HEADER_X);
  assert.equal(corner.y, HEADER_Y + ROW);
  const frozenRow = geometry.getCellBox('s1', 0, 3);
  assert.equal(frozenRow.y, HEADER_Y);
  assert.equal(frozenRow.x, HEADER_X + 3 * COL - 50);
  const frozenColumn = geometry.getCellBox('s1', 5, 0);
  assert.equal(frozenColumn.x, HEADER_X);
  assert.equal(frozenColumn.y, HEADER_Y + 5 * ROW - 60);
  const scrolling = geometry.getCellBox('s1', 5, 3);
  assert.equal(scrolling.x, HEADER_X + 3 * COL - 50);
  assert.equal(scrolling.y, HEADER_Y + 5 * ROW - 60);
});

test('frozen counts fall back to getFrozenRows/getFrozenColumns when getFreeze is absent', () => {
  const geometry = fixture({ scroll: { x: 50, y: 60 }, counts: { rows: 1, columns: 0 } });
  assert.equal(geometry.getCellBox('s1', 0, 2).y, HEADER_Y);
  assert.equal(geometry.getCellBox('s1', 1, 2).y, HEADER_Y + ROW - 60);
  assert.equal(geometry.getCellBox('s1', 0, 0).x, HEADER_X - 50);
});

test('a point in the frozen row band resolves from row 0 with no scroll; below it the scrolled rows resolve', () => {
  // Scrolled 60px (three rows); the visible range starts at row 5.
  const geometry = fixture({ scroll: { x: 0, y: 60 }, freeze: { xSplit: 0, ySplit: 2, startRow: 2, startColumn: 0 }, visible: { startRow: 5, startColumn: 0 } });
  const inBand = geometry.cellAtPoint('s1', HEADER_X + 10, HEADER_Y + ROW + 5);
  assert.equal(inBand.row, 1);
  assert.equal(inBand.offsetY, 5);
  assert.equal(geometry.cellAtPoint('s1', HEADER_X + 10, HEADER_Y + 2).row, 0);
  const below = geometry.cellAtPoint('s1', HEADER_X + 10, HEADER_Y + 2 * ROW + 3);
  assert.equal(below.row, 5);
  assert.equal(below.offsetY, 3);
});

test('a point in the frozen column band resolves from column 0 with no scroll', () => {
  const geometry = fixture({ scroll: { x: 200, y: 0 }, freeze: { xSplit: 1, ySplit: 0, startRow: 0, startColumn: 1 }, visible: { startRow: 0, startColumn: 3 } });
  const inBand = geometry.cellAtPoint('s1', HEADER_X + 30, HEADER_Y + 1);
  assert.equal(inBand.column, 0);
  assert.equal(inBand.offsetX, 30);
  assert.equal(geometry.cellAtPoint('s1', HEADER_X + COL + 10, HEADER_Y + 1).column, 3);
});

test('a freeze set while scrolled keeps its band at [startRow - ySplit, startRow)', () => {
  const geometry = fixture({ scroll: { x: 0, y: 60 }, freeze: { xSplit: 0, ySplit: 2, startRow: 5, startColumn: 0 }, visible: { startRow: 5, startColumn: 0 } });
  assert.equal(geometry.getCellBox('s1', 3, 0).y, HEADER_Y);
  assert.equal(geometry.getCellBox('s1', 4, 0).y, HEADER_Y + ROW);
  // Scrolling rows keep cell.y - scroll.y exactly.
  assert.equal(geometry.getCellBox('s1', 6, 0).y, HEADER_Y + 6 * ROW - 60);
  const first = geometry.cellAtPoint('s1', HEADER_X + 10, HEADER_Y + 5);
  assert.equal(first.row, 3);
  assert.equal(first.offsetY, 5);
  assert.equal(geometry.cellAtPoint('s1', HEADER_X + 10, HEADER_Y + ROW + 2).row, 4);
  const below = geometry.cellAtPoint('s1', HEADER_X + 10, HEADER_Y + 2 * ROW + 3);
  assert.equal(below.row, 5);
  assert.equal(below.offsetY, 3);
});

test('a freeze set while scrolled keeps its column band at [startColumn - xSplit, startColumn)', () => {
  const geometry = fixture({ scroll: { x: 300, y: 0 }, freeze: { xSplit: 1, ySplit: 0, startRow: 0, startColumn: 4 }, visible: { startRow: 0, startColumn: 4 } });
  assert.equal(geometry.getCellBox('s1', 0, 3).x, HEADER_X);
  assert.equal(geometry.getCellBox('s1', 0, 5).x, HEADER_X + 5 * COL - 300);
  const hit = geometry.cellAtPoint('s1', HEADER_X + 30, HEADER_Y + 1);
  assert.equal(hit.column, 3);
  assert.equal(hit.offsetX, 30);
  assert.equal(geometry.cellAtPoint('s1', HEADER_X + COL + 10, HEADER_Y + 1).column, 4);
});

test('hidden rows and columns take no room in cellAtPoint', () => {
  const geometry = fixture({ hiddenRows: [1, 2], hiddenColumns: [1] });
  const hit = geometry.cellAtPoint('s1', HEADER_X + COL + 5, HEADER_Y + ROW + 5);
  assert.equal(hit.row, 3);
  assert.equal(hit.column, 2);
  assert.equal(hit.offsetX, 5);
  assert.equal(hit.offsetY, 5);
});

test('a long hidden run terminates the walk and is skipped', () => {
  const hidden = Array.from({ length: 2000 }, (_, i) => i + 10);
  const geometry = fixture({ hiddenRows: hidden });
  const hit = geometry.cellAtPoint('s1', HEADER_X + 1, HEADER_Y + 50 * ROW);
  assert.equal(hit.row, 2010 + 40);
});

test('commandMovesCells keeps scroll/zoom/size/freeze/structural ids and drops the rest', () => {
  for (const id of ['sheet.operation.set-scroll', 'sheet.command.set-zoom-ratio', 'sheet.operation.set-worksheet-active',
    'sheet.command.set-row-height', 'sheet.command.set-worksheet-col-width', 'sheet.command.set-rows-hidden',
    'sheet.command.set-col-frozen', 'sheet.command.insert-row-before', 'sheet.command.remove-col-by-range',
    'sheet.command.move-selection', 'sheet.future.custom-scroll-thing', 'ui.future.Zoom-fit', 'sheet.command.set-frozen-x']) {
    assert.equal(commandMovesCells(id), true, id);
  }
  for (const id of ['sheet.operation.set-selections', 'sheet.mutation.set-range-values', 'sheet.command.set-range-values',
    'doc.command.input', undefined, 5, '']) {
    assert.equal(commandMovesCells(id), false, String(id));
  }
});
