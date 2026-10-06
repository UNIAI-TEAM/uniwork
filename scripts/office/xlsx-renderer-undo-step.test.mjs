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
  assert.equal(ok, 2);
  assert.deepEqual(log, ['open:file-1', 'a', 'b', 'close']);
});

test('stops at the first refusal, still closing the batch, and says how many steps ran (F-P2)', async () => {
  const { log, injector: inj } = injector();
  const ran = await executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], async (step) => {
    log.push(step.id);
    return step.id !== 'b';
  });
  assert.equal(ran, 1);
  assert.deepEqual(log, ['open:file-1', 'a', 'b', 'close']);
  // A refusal at the first step wrote nothing.
  assert.equal(await executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }, { id: 'b' }], async () => false), 0);
});

test('closes the batch when a step throws', async () => {
  const { log, injector: inj } = injector();
  await assert.rejects(executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }], async () => { throw new Error('boom'); }));
  assert.deepEqual(log, ['open:file-1', 'close']);
});

test('refuses while another batch is open and skips an empty list', async () => {
  const { injector: inj } = injector();
  inj.get('undo-redo').__tempBatchingUndoRedo('file-1');
  assert.equal(await executeAsOneUndoStep(inj, 'file-1', [{ id: 'a' }], async () => true), 0);
  assert.equal(await executeAsOneUndoStep(inj, 'file-1', [], async () => { throw new Error('never'); }), 0);
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
  assert.equal(ok, 2);
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

// review dvcf F1: an atomic batch (a DV rule edit) takes back what ran when a
// later step is refused; the default keeps it (a paste).
test('rollback: a refused later step takes back the batched entry; the default keeps it', async () => {
  const make = () => {
    const stack = [{ unitID: 'file-1', undoMutations: [] }];
    const rolled = [];
    const service = {
      __tempBatchingUndoRedo: () => ({ dispose() {} }),
      pitchTopUndoElement: () => stack[stack.length - 1] ?? null,
      rollback(id, unitId) {
        const top = stack[stack.length - 1];
        if (top?.id === id) { stack.pop(); rolled.push(unitId); }
      },
    };
    const run = (steps, options) => executeAsOneUndoStep({ get: () => service }, 'file-1', steps, async (step) => {
      if (step.id === 'refused') return false;
      stack.push({ unitID: 'file-1', undoMutations: [step.id] });
      return true;
    }, options);
    return { stack, rolled, run };
  };
  const atomic = make();
  assert.equal(await atomic.run([{ id: 'a' }, { id: 'refused' }], { rollback: true }), 0);
  assert.deepEqual(atomic.rolled, ['file-1']);
  assert.equal(atomic.stack.length, 1);
  // Nothing ran: nothing to take back, the earlier entry stays.
  assert.equal(await atomic.run([{ id: 'refused' }], { rollback: true }), 0);
  assert.deepEqual(atomic.rolled, ['file-1']);
  // All ran: kept.
  assert.equal(await atomic.run([{ id: 'a' }], { rollback: true }), 1);
  assert.equal(atomic.stack.length, 2);
  const kept = make();
  assert.equal(await kept.run([{ id: 'a' }, { id: 'refused' }]), 1);
  assert.deepEqual(kept.rolled, []);
  assert.equal(kept.stack.length, 2);
});

test('real Univer: an atomic batch refused at a later step leaves the model and the undo stack as they were', async () => {
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
  const cell = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const write = (v) => ({ id: 'sheet.command.set-range-values', params: { unitId: 'u1', subUnitId: 's1', range: cell, value: { 0: { 0: { v } } } } });
  assert.equal(await commands.executeCommand(write('before').id, write('before').params), true);
  const earlier = undoRedo._undoStacks.get('u1').at(-1);
  const sheet = workbook.getSheetBySheetId('s1');
  const ran = await realMod.exports.executeAsOneUndoStep(injector, 'u1', [write('half'), { id: 'refused' }],
    (step) => (step.id === 'refused' ? Promise.resolve(false) : commands.executeCommand(step.id, step.params)), { rollback: true });
  assert.equal(ran, 0);
  assert.equal(sheet.getCellRaw(0, 0).v, 'before');
  assert.equal(undoRedo._undoStacks.get('u1').length, 1);
  assert.equal(undoRedo._undoStacks.get('u1').at(-1), earlier);
  // The earlier entry still undoes normally.
  await commands.executeCommand(core.UndoCommand.id);
  assert.equal(sheet.getCellRaw(0, 0).v, 'old');
  univer.dispose();
});

// Univer folds a batched push by appending undo mutations in RUN order; one
// undo must replay them newest first, or a bottom-up run of row inserts
// removes the wrong rows and deletes data (design worker, Subtotal).
test('real Univer: one undo of a bottom-up multi-insert batch restores every row exactly', async () => {
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
  const rows = ['Ten', 'An', 'an', 'Binh', null, 'below'];
  const cellData = Object.fromEntries(rows.flatMap((v, row) => (v === null ? [] : [[row, { 0: { v } }]])));
  const workbook = univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, {
    id: 'u1', sheetOrder: ['s1'], sheets: { s1: { id: 's1', rowCount: 20, columnCount: 5, cellData } },
  });
  const injector = univer.__getInjector();
  injector.get(core.IUniverInstanceService).focusUnit('u1');
  injector.get(core.IContextService).setContextValue(core.FOCUSING_SHEET, true);
  const commands = injector.get(core.ICommandService);
  const undoRedo = injector.get(core.IUndoRedoService);
  const sheet = workbook.getSheetBySheetId('s1');
  const column = () => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((row) => sheet.getCellRaw(row, 0)?.v ?? null);
  const insert = (row) => ({ id: 'sheet.command.insert-row', params: {
    unitId: 'u1', subUnitId: 's1', direction: 2,
    range: { startRow: row, endRow: row, startColumn: 0, endColumn: 4, rangeType: 1 },
  } });
  const before = column();
  const ran = await realMod.exports.executeAsOneUndoStep(injector, 'u1', [insert(4), insert(4), insert(3)],
    (step) => commands.executeCommand(step.id, step.params));
  assert.equal(ran, 3);
  assert.deepEqual(column(), ['Ten', 'An', 'an', null, 'Binh', null, null, null, 'below']);
  assert.equal(undoRedo._undoStacks.get('u1').length, 1);
  await commands.executeCommand(core.UndoCommand.id);
  assert.deepEqual(column(), before);
  // Redo replays in run order and lands the same rows again.
  await commands.executeCommand(core.RedoCommand.id);
  assert.deepEqual(column(), ['Ten', 'An', 'an', null, 'Binh', null, null, null, 'below']);
  univer.dispose();
});

/** A stand-in for the pinned LocalUndoRedoService: per-unit stacks, the
 *  batch folds every later push into the first, rollback pops a tagged top. */
function localUndoRedo() {
  const undo = new Map();
  const redo = new Map();
  const batching = new Map();
  const replayed = [];
  const stack = (map, unit) => { if (!map.has(unit)) map.set(unit, []); return map.get(unit); };
  const service = {
    _redoStacks: redo,
    _pitchUndoElement: (unit) => stack(undo, unit).at(-1) ?? null,
    pushUndoRedo(item) {
      stack(redo, item.unitID).length = 0;
      const top = stack(undo, item.unitID).at(-1);
      if (batching.has(item.unitID) && batching.get(item.unitID) === 1 && top) {
        top.undoMutations.push(...item.undoMutations);
        top.redoMutations.push(...item.redoMutations);
      } else {
        stack(undo, item.unitID).push(item);
        if (batching.has(item.unitID)) batching.set(item.unitID, 1);
      }
    },
    rollback(id, unit) {
      const top = stack(undo, unit).at(-1);
      if (top?.id === id) { stack(undo, unit).pop(); replayed.push(...top.undoMutations); }
    },
    __tempBatchingUndoRedo(unit) {
      batching.set(unit, 0);
      return { dispose: () => batching.delete(unit) };
    },
  };
  const push = (...undoMutations) => service.pushUndoRedo({ unitID: 'file-1', undoMutations, redoMutations: undoMutations.map((m) => `re-${m}`) });
  return { service, injector: { get: () => service }, undo: (unit = 'file-1') => stack(undo, unit), redo: (unit = 'file-1') => stack(redo, unit), replayed, push };
}

// review-delta D3: a step whose command pushes several undo items must also
// undo them newest first, like the separate entries they would be unbatched.
test('one step pushing several undo items undoes them newest first (D3)', async () => {
  const fake = localUndoRedo();
  const original = fake.service.pushUndoRedo;
  const ran = await executeAsOneUndoStep(fake.injector, 'file-1', [{ id: 'a' }, { id: 'b' }], async (step) => {
    if (step.id === 'a') { fake.push('undo-a1'); fake.push('undo-a2'); } else fake.push('undo-b');
    return true;
  });
  assert.equal(ran, 2);
  assert.equal(fake.undo().length, 1);
  assert.deepEqual(fake.undo()[0].undoMutations, ['undo-b', 'undo-a2', 'undo-a1']);
  assert.deepEqual(fake.undo()[0].redoMutations, ['re-undo-a1', 're-undo-a2', 're-undo-b']);
  // The service's own push is back once the batch closes.
  assert.equal(fake.service.pushUndoRedo, original);
  assert.equal(Object.prototype.hasOwnProperty.call(fake.service, 'pushUndoRedo'), true);
});

// review-delta D5: under rollback a step that throws is a refusal: what ran
// (its own partial push included) is taken back and the batch answers 0.
test('rollback: a step that throws takes back what ran and answers 0; the default rethrows (D5)', async () => {
  const atomic = localUndoRedo();
  const ran = await executeAsOneUndoStep(atomic.injector, 'file-1', [{ id: 'a' }, { id: 'b' }], async (step) => {
    atomic.push(`undo-${step.id}`);
    if (step.id === 'b') throw new Error('boom');
    return true;
  }, { rollback: true });
  assert.equal(ran, 0);
  assert.equal(atomic.undo().length, 0);
  assert.deepEqual(atomic.replayed, ['undo-b', 'undo-a']);
  // A first step that pushed and then refused is taken back too.
  const first = localUndoRedo();
  assert.equal(await executeAsOneUndoStep(first.injector, 'file-1', [{ id: 'a' }, { id: 'b' }], async () => {
    first.push('undo-a');
    return false;
  }, { rollback: true }), 0);
  assert.equal(first.undo().length, 0);
  const kept = localUndoRedo();
  await assert.rejects(executeAsOneUndoStep(kept.injector, 'file-1', [{ id: 'a' }, { id: 'b' }], async (step) => {
    kept.push(`undo-${step.id}`);
    if (step.id === 'b') throw new Error('boom');
    return true;
  }), /boom/);
  assert.equal(kept.undo().length, 1);
});

// review-delta D1: Univer's first batched push clears the unit's redo stack;
// a rolled-back batch changed nothing, so the redo history comes back.
test('real Univer: a rolled-back atomic batch keeps the redo history (D1)', async () => {
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
  const cell = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const write = (v) => ({ id: 'sheet.command.set-range-values', params: { unitId: 'u1', subUnitId: 's1', range: cell, value: { 0: { 0: { v } } } } });
  const sheet = workbook.getSheetBySheetId('s1');
  assert.equal(await commands.executeCommand(write('typed').id, write('typed').params), true);
  await commands.executeCommand(core.UndoCommand.id);
  assert.equal(sheet.getCellRaw(0, 0).v, 'old');
  assert.equal(undoRedo._redoStacks.get('u1').length, 1);
  const ran = await realMod.exports.executeAsOneUndoStep(injector, 'u1', [write('half'), { id: 'refused' }],
    (step) => (step.id === 'refused' ? Promise.resolve(false) : commands.executeCommand(step.id, step.params)), { rollback: true });
  assert.equal(ran, 0);
  assert.equal(sheet.getCellRaw(0, 0).v, 'old');
  assert.equal(undoRedo._redoStacks.get('u1').length, 1);
  await commands.executeCommand(core.RedoCommand.id);
  assert.equal(sheet.getCellRaw(0, 0).v, 'typed');
  univer.dispose();
});
