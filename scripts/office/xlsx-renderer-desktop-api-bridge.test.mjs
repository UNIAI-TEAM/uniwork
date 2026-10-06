// UNI-957 (review r1 m5): two workbooks mounted in one renderer page must each
// reach their own host through the single global `window.desktopApi` the
// vendored sheets loaders call. The old bridge was "last mount wins".
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const bundled = await build({
  entryPoints: [path.join(renderer, 'desktop-api-bridge.ts')],
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
});
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { registerDesktopApiSession } = module.exports;

function host(name) {
  const calls = [];
  return {
    calls,
    readRange: async (input) => { calls.push(['range', input.sessionId]); return { from: name }; },
    readFormulas: async (input) => { calls.push(['formulas', input.sessionId]); return { from: name }; },
    recalcWorkbook: async (input) => { calls.push(['recalc', input.sessionId]); return { from: name }; },
  };
}

const range = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 };

test('routes every call to the host of the session that asked, whatever mounted last', async () => {
  const original = { owner: 'desktop-shell' };
  globalThis.desktopApi = original;
  const a = host('a');
  const b = host('b');
  const releaseA = registerDesktopApiSession('session-a', a);
  const releaseB = registerDesktopApiSession('session-b', b);
  const api = globalThis.desktopApi;
  assert.notEqual(api, original);
  assert.deepEqual(await api.readWorkbookRange({ sessionId: 'session-a', sheetId: 's1', range }), { from: 'a' });
  assert.deepEqual(await api.readWorkbookFormulas({ sessionId: 'session-a', sheetId: 's1' }), { from: 'a' });
  assert.deepEqual(await api.recalcWorkbook({ sessionId: 'session-b' }), { from: 'b' });
  assert.deepEqual(a.calls, [['range', 'session-a'], ['formulas', 'session-a']]);
  assert.deepEqual(b.calls, [['recalc', 'session-b']]);

  // The FIRST mount closes first: the survivor keeps the bridge (the old
  // restore handed the global back to a dead or foreign api here).
  releaseA();
  assert.equal(globalThis.desktopApi, api);
  await assert.rejects(api.readWorkbookRange({ sessionId: 'session-a', sheetId: 's1', range }), /xlsx_renderer_session_unbound:session-a/);
  assert.deepEqual(await api.readWorkbookRange({ sessionId: 'session-b', sheetId: 's1', range }), { from: 'b' });

  releaseB();
  assert.equal(globalThis.desktopApi, original);
  releaseB();
  assert.equal(globalThis.desktopApi, original);
  delete globalThis.desktopApi;
});

test('answers the empty shapes when a host lacks the optional reads', async () => {
  const release = registerDesktopApiSession('session-c', { readRange: async () => ({}) });
  const api = globalThis.desktopApi;
  assert.deepEqual(await api.readWorkbookFormulas({ sessionId: 'session-c', sheetId: 's1' }), { cells: [] });
  assert.deepEqual(await api.recalcWorkbook({ sessionId: 'session-c' }), { cells: [], cached: false });
  release();
  assert.equal(globalThis.desktopApi, undefined);
});
