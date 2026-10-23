// DOC-003 (UNI-667) PPTX lab-channel tests (correction ONE/r2). Real server, bounded fake engine.
// Pins: the two PPTX channels exist and are callable for a slides view (H3/H4); isDirty reaches the
// real 'pptx-is-dirty' operation with a boolean contract; editText forwards the op and unwraps the
// engine envelope to the RenderSlide commitEdit (App.tsx:2337) inserts, keeping a refused edit a
// named refusal; the live missing layout operation is exposed by name, never faked.
//   node --test e2e/office-g0/pptx-channels.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { allowedAppsFor, createLabServer } from './lab-server.mjs';
import { ENGINE_OPERATIONS } from './lab-engine.mjs';

const PPTX_CHANNELS = ['host:autosave-pref', 'host:slides-edit-text', 'host:slides-is-dirty', 'host:slides-layouts'];

async function withLab(t, port, engineHandlers = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pptx-channels-'));
  const builds = join(root, 'builds');
  const fixtures = join(root, 'fixtures');
  mkdirSync(builds, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, 'g0-slides.pptx'), Buffer.alloc(0));
  const server = createLabServer({
    buildsDir: builds,
    labDir: join(root, 'lab'),
    fixturesDir: fixtures,
    port,
    previewPort: port + 1,
    engineHandlers,
  });
  t.after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const { app } = await server.listen();
  const post = async (channel, body) => {
    const response = await fetch(app + '/lab/' + channel, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const openSlides = async () => {
    const result = await post('lab:session-open', { app: 'slides', path: join(fixtures, 'g0-slides.pptx') });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.result.viewId;
  };
  return { server, post, openSlides };
}

const openOnly = { 'pptx-open': async () => ({ ok: true }) };
test('the picture channels are slides-scoped: a docs view cannot reach them', async (t) => {
  // host:slides-pick-picture-file and host:slides-replace-picture-bytes are the two channels the
  // image cycle really uses, and neither is in SHARED_CHANNELS. Without this case only the
  // autosave channel proved the slides scoping of the family, so a latent cross-app caller
  // reaching the picker/replace surface was untested.
  const PICTURE_CHANNELS = ['host:slides-pick-picture-file', 'host:slides-replace-picture-bytes'];
  const { post, openSlides } = await withLab(t, 5613, { ...openOnly });
  for (const channel of PICTURE_CHANNELS) {
    assert.deepEqual(allowedAppsFor(channel), ['slides'], channel + ' must be slides-scoped');
  }
  const viewId = await openSlides();
  // Armed with no pick path the picker is the documented cancel, never a fabricated image.
  const cancelled = await post('host:slides-pick-picture-file', { viewId });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.result, null, 'an unarmed picker answers null, not invented bytes');

  const docs = await post('lab:session-open', { app: 'docs', path: null });
  assert.equal(docs.status, 200, JSON.stringify(docs.body));
  for (const channel of PICTURE_CHANNELS) {
    const refused = await post(channel, { viewId: docs.body.result.viewId, path: null, base64: 'AA==' });
    assert.notEqual(refused.status, 200, channel + ' must not run for a docs view');
    assert.equal(refused.body.ok, false, channel + ' refusal must be an explicit failure');
    assert.equal(refused.body.error, 'wrong_view');
    assert.equal(refused.body.result, undefined, channel + ' must answer no value on refusal');
  }
});


test('the allowlist and channel table expose the PPTX edit/dirty names (H3/H4/H5)', async (t) => {
  const { server, post, openSlides } = await withLab(t, 5601, { ...openOnly });
  for (const operation of ['pptx-edit-text', 'pptx-is-dirty']) {
    assert.ok(server.engine.operations().includes(operation), 'ENGINE_OPERATIONS must include ' + operation);
    assert.ok(ENGINE_OPERATIONS.includes(operation));
  }
  for (const channel of PPTX_CHANNELS) {
    assert.ok(server.channels().includes(channel), 'lab server must implement ' + channel);
  }
  const viewId = await openSlides();
  for (const channel of PPTX_CHANNELS) {
    const result = await post(channel, { viewId });
    assert.notEqual(result.body.error, 'unknown_channel', channel + ' must be a real channel');
  }
});

test('isDirty reaches the real pptx-is-dirty operation and answers a boolean', async (t) => {
  const seen = [];
  const { post, openSlides } = await withLab(t, 5603, {
    ...openOnly,
    'pptx-is-dirty': async (input, meta) => {
      seen.push({ input, meta });
      return { dirty: true };
    },
  });
  const viewId = await openSlides();
  const result = await post('host:slides-is-dirty', { viewId });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.result, { dirty: true });
  assert.equal(seen.length, 1, 'the real operation must be reached exactly once');
  assert.equal(seen[0].meta.viewId, viewId, 'the engine identity is the server-minted view id');
});

test('slides autosave preference is a notification: served, and provably NOT stored', async (t) => {
  const { post, openSlides } = await withLab(t, 5604, { ...openOnly });
  assert.deepEqual(allowedAppsFor('host:autosave-pref'), ['slides']);
  const viewId = await openSlides();
  const result = await post('host:autosave-pref', { viewId, on: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  // Upstream answers nothing (ipcMain.on, no reply) and the renderer owns the preference, so the
  // channel must not echo a value that a reader could mistake for a durable write.
  assert.equal(result.body.ok, true);
  assert.equal(result.body.result, null, 'a one-way notification returns no stored value');

  // The scoping is real, not decorative: the SAME channel from a docs view is refused before the
  // handler runs, so a latent cross-app caller cannot silently write a slides preference.
  const docs = await post('lab:session-open', { app: 'docs', path: null });
  assert.equal(docs.status, 200, JSON.stringify(docs.body));
  const refused = await post('host:autosave-pref', { viewId: docs.body.result.viewId, on: true });
  assert.notEqual(refused.status, 200);
  assert.equal(refused.body.ok, false);
  assert.equal(refused.body.error, 'wrong_view');
  assert.equal(refused.body.result, undefined);
});

test('editText forwards the op and unwraps the engine envelope to a RenderSlide', async (t) => {
  const slide = { widthPx: 960, heightPx: 540, scale: 1, background: { kind: 'none' }, nodes: [] };
  const seen = [];
  const { post, openSlides } = await withLab(t, 5605, {
    ...openOnly,
    'pptx-edit-text': async (input) => {
      seen.push(input);
      return {
        ok: true,
        slideIndex: input.slideIndex,
        sourceId: 'sp_3',
        elementType: 'text',
        beforeText: 'edited-by-lab',
        afterText: 'x',
        applied: true,
        failures: [],
        slide,
      };
    },
  });
  const viewId = await openSlides();
  const result = await post('host:slides-edit-text', {
    viewId,
    slideIndex: 0,
    sourceId: 'sp_3',
    paragraphs: [{ runs: [{ text: 'x' }] }],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  // commitEdit (App.tsx:2337) assigns the resolved value into slides state: the channel must
  // answer the RenderSlide itself, never the whole envelope.
  assert.deepEqual(result.body.result, slide);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sourceId, 'sp_3');
  assert.deepEqual(seen[0].paragraphs, [{ runs: [{ text: 'x' }] }]);
});

test('a refused edit stays a named refusal, never a silent slide', async (t) => {
  const { post, openSlides } = await withLab(t, 5607, {
    ...openOnly,
    'pptx-edit-text': async () => ({ ok: true, applied: false, failures: ['no_such_element'], slide: null }),
  });
  const viewId = await openSlides();
  const result = await post('host:slides-edit-text', { viewId, slideIndex: 0, sourceId: 'nope', paragraphs: [] });
  assert.notEqual(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, 'edit_not_applied');
  assert.equal(result.body.result, undefined);
});

test('the layout path is a real operation: a bound catalog is served, an unbound one is named', async (t) => {
  // pptx-layouts is a real, allowlisted engine operation now (engine-pptx-routes.mts
  // /engine/pptx-layouts). With the operation bound, the lab serves the catalog verbatim; with no
  // binding the failure stays a NAMED unsupported refusal, never an invented catalog.
  const catalog = {
    layouts: [{
      path: 'ppt/slideLayouts/slideLayout1.xml',
      name: 'Title and Content',
      layoutType: 'obj',
      placeholders: [{ type: 'title', idx: '', x: 914400, y: 914400, cx: 7315200, cy: 1143000, hint: 'Click to add title' }],
    }],
    size: { cx: 9144000, cy: 5143500 },
  };
  const bound = await withLab(t, 5609, { ...openOnly, 'pptx-layouts': async () => catalog });
  const boundView = await bound.openSlides();
  const served = await bound.post('host:slides-layouts', { viewId: boundView });
  assert.equal(served.status, 200, JSON.stringify(served.body));
  assert.deepEqual(served.body.result, catalog);

  const unbound = await withLab(t, 5611, { ...openOnly });
  const viewId = await unbound.openSlides();
  const result = await unbound.post('host:slides-layouts', { viewId });
  assert.notEqual(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, 'engine_unsupported');
  assert.equal(result.body.result, undefined);
});
