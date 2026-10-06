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
  const source = statusStream({ undos: 0, redos: 0, dropped: 0 });
  const watch = watchUndoHistory(source);
  const seen = [];
  watch.subscribe((state) => seen.push(state));
  assert.deepEqual(watch.get(), { undos: 0, redos: 0, dropped: 0 });
  source.emit({ undos: 1, redos: 0, dropped: 0 });
  source.emit({ undos: 1, redos: 0, dropped: 0 });
  source.emit({ undos: 0, redos: 1, dropped: 0 });
  assert.deepEqual(seen, [{ undos: 1, redos: 0, dropped: 0 }, { undos: 0, redos: 1, dropped: 0 }]);
  assert.deepEqual(watch.get(), { undos: 0, redos: 1, dropped: 0 });
});

test('reads the current status at once, tolerates a malformed one, and unsubscribes on dispose', () => {
  const source = statusStream({ undos: 3, redos: 2, dropped: 0 });
  const watch = watchUndoHistory(source);
  assert.deepEqual(watch.get(), { undos: 3, redos: 2, dropped: 0 });
  source.emit({ undos: 'x', redos: -4 });
  assert.deepEqual(watch.get(), { undos: 0, redos: 0, dropped: 0 });
  const off = watch.subscribe(() => assert.fail('removed listener'));
  off();
  source.emit({ undos: 1, redos: 0, dropped: 0 });
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
  const source = statusStream({ undos: 1, redos: 0, dropped: 0 });
  const watch = watchRendererHistory({ get: (id) => { assert.equal(id, 'undo-redo'); return source; } });
  assert.deepEqual(watch.get(), { undos: 1, redos: 0, dropped: 0 });
  watch.dispose();
});

/** The pinned LocalUndoRedoService's shape: per-unit stacks, a cap, and a
 *  status that reports the FOCUSED unit (the cell editor's doc while editing). */
function undoService({ cap = 100 } = {}) {
  const source = statusStream({ undos: 0, redos: 0, dropped: 0 });
  const service = {
    ...source,
    _undoStacks: new Map(),
    _redoStacks: new Map(),
    focused: 'book',
    batching: false,
    stack(map, unit) { if (!map.has(unit)) map.set(unit, []); return map.get(unit); },
    pushUndoRedo(item) {
      const undo = this.stack(this._undoStacks, item.unitID);
      this.stack(this._redoStacks, item.unitID).length = 0;
      if (this.batching && undo.length > 0) undo.at(-1).merged = true;
      else { undo.push(item); if (undo.length > cap) undo.splice(0, 1); }
      this.update();
    },
    undo(unit) { const item = this.stack(this._undoStacks, unit).pop(); this.stack(this._redoStacks, unit).push(item); this.update(); },
    update() {
      source.emit({ undos: this._undoStacks.get(this.focused)?.length ?? 0, redos: this._redoStacks.get(this.focused)?.length ?? 0 });
    },
  };
  return service;
}

test('reports the workbook unit only: the cell editor document stack never shows (review r3 F3c)', () => {
  const service = undoService();
  const watch = watchUndoHistory(service, () => 'book');
  service.pushUndoRedo({ unitID: 'book' });
  service.focused = 'cell-editor';
  service.pushUndoRedo({ unitID: 'cell-editor' });
  service.pushUndoRedo({ unitID: 'cell-editor' });
  assert.deepEqual(watch.get(), { undos: 1, redos: 0, dropped: 0 });
  service.pushUndoRedo({ unitID: 'book' });
  assert.deepEqual(watch.get(), { undos: 2, redos: 0, dropped: 0 });
  watch.dispose();
});

test('counts the entries the capped stack drops from its bottom, never a batched merge (review r3 F3a)', () => {
  const service = undoService({ cap: 3 });
  const original = service.pushUndoRedo;
  const watch = watchUndoHistory(service, () => 'book');
  for (let i = 0; i < 3; i += 1) service.pushUndoRedo({ unitID: 'book' });
  assert.deepEqual(watch.get(), { undos: 3, redos: 0, dropped: 0 });
  service.pushUndoRedo({ unitID: 'book' });
  service.pushUndoRedo({ unitID: 'book' });
  assert.deepEqual(watch.get(), { undos: 3, redos: 0, dropped: 2 });
  service.batching = true;
  service.pushUndoRedo({ unitID: 'book' });
  service.batching = false;
  service.undo('book');
  assert.deepEqual(watch.get(), { undos: 2, redos: 1, dropped: 2 });
  // Dispose takes the push tap off the service again.
  watch.dispose();
  assert.equal(service.pushUndoRedo, original);
  service.pushUndoRedo({ unitID: 'book' });
  assert.deepEqual(watch.get(), { undos: 2, redos: 1, dropped: 2 });
});
