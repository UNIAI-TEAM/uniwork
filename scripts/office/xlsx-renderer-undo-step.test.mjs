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
