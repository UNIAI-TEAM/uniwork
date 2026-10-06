import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-953: a rich paste runs values, formats and merges as separate commands;
// executeAsOneUndoStep folds them into one Univer undo entry.
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const bundled = await build({
  stdin: { contents: `export * from './undo-step';`, resolveDir: renderer, loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'core-stub',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/core$/ }, () => ({ path: 'core', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const IUndoRedoService = "undo-redo";' }));
    },
  }],
});
const mod = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(mod, mod.exports);
const { executeAsOneUndoStep } = mod.exports;

function injector() {
  const log = [];
  let open = false;
  const service = {
    __tempBatchingUndoRedo(unitId) {
      if (open) throw new Error('nested');
      open = true;
      log.push(`open:${unitId}`);
      return { dispose() { open = false; log.push('close'); } };
    },
  };
  return { log, injector: { get: (id) => { assert.equal(id, 'undo-redo'); return service; } } };
}

test('runs every step inside one batch and closes it', async () => {
  const { log, injector: inj } = injector();
  const ok = await executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }, { id: 'b', params: { x: 1 } }], async (step) => {
    log.push(step.id);
    return true;
  });
  assert.equal(ok, true);
  assert.deepEqual(log, ['open:file-1', 'a', 'b', 'close']);
});

test('stops at the first refusal, still closing the batch', async () => {
  const { log, injector: inj } = injector();
  const ok = await executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], async (step) => {
    log.push(step.id);
    return step.id !== 'b';
  });
  assert.equal(ok, false);
  assert.deepEqual(log, ['open:file-1', 'a', 'b', 'close']);
});

test('closes the batch when a step throws', async () => {
  const { log, injector: inj } = injector();
  await assert.rejects(executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }], async () => { throw new Error('boom'); }));
  assert.deepEqual(log, ['open:file-1', 'close']);
});

test('refuses while another batch is open and skips an empty list', async () => {
  const { injector: inj } = injector();
  inj.get('undo-redo').__tempBatchingUndoRedo('file-1');
  assert.equal(await executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }], async () => true), false);
  assert.equal(await executeAsOneUndoStep(inj, 'file-1', [], async () => { throw new Error('never'); }), true);
});

// The real pinned Univer (no stub): a paste's set-range-values (value, style
// with the number format) and its merge land as ONE undo entry, and one undo
// restores the whole range.
test('real Univer: values, formats and a merge undo in one step', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
  const real = await build({
    stdin: { contents: `export * from './undo-step';`, resolveDir: renderer, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', external: ['@univerjs/core'],
  });
  const realMod = { exports: {} };
  new Function('module', 'exports', 'require', real.outputFiles[0].text)(realMod, realMod.exports, require);
  const core = require('@univerjs/core');
  const sheets = require('@univerjs/sheets');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: {} } });
  univer.registerPlugin(sheets.UniverSheetsPlugin);
  const workbook = univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, {
    id: 'u1', sheetOrder: ['s1'], sheets: { s1: { id: 's1', cellData: { 0: { 0: { v: 'old' } } } } },
  });
  const injector = univer.__getInjector();
  injector.get(core.IUniverInstanceService).focusUnit('u1');
  injector.get(core.IContextService).setContextValue(core.FOCUSING_SHEET, true);
  const commands = injector.get(core.ICommandService);
  const undoRedo = injector.get(core.IUndoRedoService);
  const area = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 };
  const ok = await realMod.exports.executeAsOneUndoStep(injector, 'u1', [
    { id: 'sheet.command.set-range-values', params: { unitId: 'u1', subUnitId: 's1', range: area, value: { 0: { 0: { v: 0.5, t: 2, s: { bl: 1, n: { pattern: '0.00%' } } }, 1: { v: null } } } } },
    { id: 'sheet.command.add-worksheet-merge', params: { unitId: 'u1', subUnitId: 's1', selections: [area], defaultMerge: true } },
  ], (step) => commands.executeCommand(step.id, step.params));
  assert.equal(ok, true);
  const sheet = workbook.getSheetBySheetId('s1');
  assert.deepEqual(workbook.getStyles().getStyleByCell(sheet.getCellRaw(0, 0)), { bl: 1, n: { pattern: '0.00%' } });
  assert.deepEqual(sheet.getMergeData(), [area]);
  assert.equal(undoRedo._undoStacks.get('u1').length, 1);
  await commands.executeCommand(core.UndoCommand.id);
  assert.equal(sheet.getCellRaw(0, 0).v, 'old');
  assert.equal(workbook.getStyles().getStyleByCell(sheet.getCellRaw(0, 0)), undefined);
  assert.deepEqual(sheet.getMergeData(), []);
  univer.dispose();
});
