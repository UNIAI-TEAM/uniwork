import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-953 item 9: the ribbon's Undo/Redo read the grid's stack sizes from
// Univer's undoRedoStatus$ through watchUndoHistory.
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const bundled = await build({
  stdin: { contents: `export * from './history';`, resolveDir: renderer, loader: 'ts' },
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
const { watchUndoHistory, watchRendererHistory } = mod.exports;

/** A BehaviorSubject-like status stream: subscribing replays the current value. */
function statusStream(initial) {
  let current = initial;
  const subscribers = new Set();
  return {
    undoRedoStatus$: {
      subscribe(next) {
        subscribers.add(next);
        next(current);
        return { unsubscribe: () => subscribers.delete(next) };
      },
    },
    emit(status) { current = status; for (const next of subscribers) next(status); },
    get subscribers() { return subscribers.size; },
  };
}

test('mirrors the stack sizes and notifies on every change, not on repeats', () => {
  const source = statusStream({ undos: 0, redos: 0 });
  const watch = watchUndoHistory(source);
  const seen = [];
  watch.subscribe((state) => seen.push(state));
  assert.deepEqual(watch.get(), { undos: 0, redos: 0 });
  source.emit({ undos: 1, redos: 0 });
  source.emit({ undos: 1, redos: 0 });
  source.emit({ undos: 0, redos: 1 });
  assert.deepEqual(seen, [{ undos: 1, redos: 0 }, { undos: 0, redos: 1 }]);
  assert.deepEqual(watch.get(), { undos: 0, redos: 1 });
});

test('reads the current status at once, tolerates a malformed one, and unsubscribes on dispose', () => {
  const source = statusStream({ undos: 3, redos: 2 });
  const watch = watchUndoHistory(source);
  assert.deepEqual(watch.get(), { undos: 3, redos: 2 });
  source.emit({ undos: 'x', redos: -4 });
  assert.deepEqual(watch.get(), { undos: 0, redos: 0 });
  const off = watch.subscribe(() => assert.fail('removed listener'));
  off();
  source.emit({ undos: 1, redos: 0 });
  watch.dispose();
  assert.equal(source.subscribers, 0);
});

test('a runtime without the status stream reads as unknown (null), never as an empty stack', () => {
  assert.equal(watchUndoHistory(null).get(), null);
  assert.equal(watchUndoHistory({}).get(), null);
  const throwing = watchRendererHistory({ get: () => { throw new Error('no service'); } });
  assert.equal(throwing.get(), null);
  throwing.dispose();
});

test('watchRendererHistory resolves the undo/redo service from the injector', () => {
  const source = statusStream({ undos: 1, redos: 0 });
  const watch = watchRendererHistory({ get: (id) => { assert.equal(id, 'undo-redo'); return source; } });
  assert.deepEqual(watch.get(), { undos: 1, redos: 0 });
  watch.dispose();
});
