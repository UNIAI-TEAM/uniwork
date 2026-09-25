// UNI-667 PDF native save/publication slice r1 (Terra TEXT). Ports 5560-5579.
// Baseline-loadable node:test: real lab server, real routes, real per-view grants, real files.
// ONLY the engine operation 'pdf-save' is a bounded in-process handler via the existing
// createLabServer engineHandlers seam. No native engine runs here.
// RED on the unchanged lab-server.mjs is behavioural: host:pdf-save reports the pre-save working
// copy as savedPath and forwards the dead sourcePath/targetPath fields.
// Shared prerequisite (Main applies, not this lane): the sole native publication grant
// ViewSessions.requireNativeOutput(viewId, publishedPath) from XLSX correction FOUR/r5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLabServer } from './lab-server.mjs';
import { sha256 } from './lab-storage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(HERE));
const FIXTURE_PATH = join(REPO_ROOT, 'lab', 'fixtures', 'g0-text.pdf');
const FIXTURE_SHA = '30860ead33d51b02e451c101f9c34f2ca644a135d578292533374cd5f8d82592';
const FIXTURE_BYTES = 1232;
const PUBLISHED_BYTES = Buffer.from('%PDF-1.7\nlab published native pdf bytes\n', 'latin1');

/** The workspace holding .uniwork-dev; every scratch write stays inside it. */
function workspaceRoot() {
  for (let dir = REPO_ROOT; ; ) {
    if (existsSync(join(dir, '.uniwork-dev'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('pdf-save-report: no .uniwork-dev above ' + REPO_ROOT);
    dir = parent;
  }
}

/** A fresh scratch dir under the workspace tmp; the parent is created first. */
function scratchRoot(prefix) {
  const parent = process.env.OFFICE_G0_TEST_TMP;
  if (!parent) throw new Error('OFFICE_G0_TEST_TMP must point inside the owned package');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

/** The real SavePdfRequest the renderer sends, with a real text edit and a real image edit. */
const saveBody = (viewId, path) => ({
  viewId, path,
  markups: [], annotDeletes: [], drawings: [], noteEdits: [], formValues: [], stamps: [],
  textEdits: [{ pageIndex: 0, rect: [60, 600, 260, 660], oldText: 'g0 editable text', newText: 'lab edited', fontSize: 12 }],
  textInserts: [],
  imageEdits: [{ kind: 'replaceImage', pageIndex: 0, rect: [60, 600, 260, 660], image: 'data:image/png;base64,iVBORw0KGgo=' }],
  staticFormFills: [], rotations: [], deletedPages: [], pageOrder: [], metadata: {},
});

/** Real lab + files. saveFor decides where the fake engine publishes; bytes null means it publishes
 * nothing, Buffer.alloc(0) an existing empty file. The fake claims bogus bytes/sha256 on purpose, so a
 * handler that trusts the engine instead of the file fails S1. */
async function startLab(t, { port, previewPort, saveFor, bytes = PUBLISHED_BYTES }) {
  const root = scratchRoot('pdf-save-report-');
  const lab = join(root, 'lab');
  mkdirSync(join(root, 'builds'), { recursive: true });
  mkdirSync(join(lab, 'in'), { recursive: true });
  const input = join(lab, 'in', 'g0-text.pdf');
  const authored = readFileSync(FIXTURE_PATH);
  assert.equal(authored.length, FIXTURE_BYTES, 'fixture byte length');
  assert.equal(sha256(authored), FIXTURE_SHA, 'fixture sha256 (lowercase hex)');
  writeFileSync(input, authored);
  const calls = [];
  const state = {};
  const server = createLabServer({
    buildsDir: join(root, 'builds'), labDir: lab, fixturesDir: null, sourceDir: null,
    port, previewPort,
    engineHandlers: {
      'pdf-save': async (engineInput, { viewId }) => {
        calls.push({ engineInput, viewId });
        const path = saveFor(lab, viewId, state);
        if (bytes !== null) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes);
        }
        return {
          ok: true, path, bytes: 4242, sha256: 'engine-claimed-hash',
          imageEditsApplied: 1, skippedTextEdits: [], skippedTextInserts: [], skippedImageEdits: [],
          inBytes: FIXTURE_BYTES, inHash: FIXTURE_SHA,
        };
      },
    },
  });
  t.after(async () => { await server.close(); rmSync(root, { recursive: true, force: true }); });
  const { app } = await server.listen();
  const post = async (channel, body) => {
    const response = await fetch(app + '/lab/' + channel, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const open = async (appName, path = null) => {
    const result = await post('lab:session-open', { app: appName, path });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.result.viewId;
  };
  /** Observable state a refused save must not move. */
  const sideEffects = (viewId) => {
    const session = server.sessions.requireView(viewId);
    return {
      savePath: session.savePath,
      output: session.output,
      readGrants: [...session.readGrants].sort(),
      records: server.records().filter((e) => e.view === viewId).length,
      savedEvents: server.events.peek(viewId).filter((e) => e.type === 'saved').length,
    };
  };
  return { root, lab, input, state, server, calls, post, open, sideEffects };
}

/** A refusal must be exact and side-effect free and must report no saved path or bytes. */
async function expectRefused(lab, viewId, expectedErrors) {
  const session = lab.server.sessions.requireView(viewId);
  const before = lab.sideEffects(viewId);
  const wasSavePath = session.savePath;
  const result = await lab.post('host:pdf-save', saveBody(viewId, session.workingPath));
  const value = result.body.result;
  assert.equal(value.status, 'error', JSON.stringify(result.body));
  assert.equal(value.reason, 'save-not-published');
  assert.equal('savedPath' in value, false);
  assert.equal('bytes' in value, false);
  if (expectedErrors) assert.ok(expectedErrors.includes(value.error), 'unexpected code ' + value.error);
  assert.deepEqual(lab.sideEffects(viewId), before, 'a refusal leaves state and events untouched');
  assert.equal(session.output, null, 'no output was recorded');
  assert.equal(session.savePath, wasSavePath, 'the save target did not move');
  return value;
}

test('S1 flat engine payload with the server-owned viewId and a verified same-view publication', async (t) => {
  const lab = await startLab(t, {
    port: 5560, previewPort: 5561,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'g0-text.pdf'),
  });
  const viewId = await lab.open('pdf', lab.input);
  const working = lab.server.sessions.requireView(viewId).workingPath;
  const before = readFileSync(working);
  const body = saveBody(viewId, working);
  const result = await lab.post('host:pdf-save', body);
  assert.equal(result.body.result.status, 'ok', JSON.stringify(result.body));
  assert.equal(lab.calls.length, 1);
  const input = lab.calls[0].engineInput;
  assert.equal(lab.calls[0].viewId, viewId, 'the engine sees the server-owned view id');
  assert.equal(input.viewId, viewId);
  assert.equal(input.path, working, 'the engine snapshots the granted source');
  assert.equal('sourcePath' in input, false, 'the engine route has no sourcePath field');
  assert.equal('targetPath' in input, false, 'the engine publishes under outDir(viewId) itself');
  assert.deepEqual(input.request.textEdits, body.textEdits, 'the real text edits are sent');
  assert.deepEqual(input.request.imageEdits, body.imageEdits, 'the real image edits are sent');
  assert.equal(input.request.path, working);
  const expected = join(lab.lab, 'out', viewId, 'g0-text.pdf');
  const value = result.body.result;
  assert.equal(value.savedPath, expected);
  assert.notEqual(value.savedPath, working);
  assert.equal(value.savedPath.startsWith(join(lab.lab, 'views') + sep), false);
  assert.equal(value.bytes, PUBLISHED_BYTES.length);
  assert.equal(value.sha256, sha256(PUBLISHED_BYTES), 'the on-disk hash, not the engine claim');
  assert.deepEqual(readFileSync(working), before, 'the working copy is never replaced');
  assert.deepEqual(readFileSync(expected), PUBLISHED_BYTES);
  assert.equal(lab.server.records().some((e) => e.view === viewId && e.op === 'pdf-save'), true);
  assert.equal(lab.server.events.peek(viewId).some((e) => e.type === 'saved'), true);
});

test('F1 the validated PDF publication is readable and reusable only by its saving view', async (t) => {
  const lab = await startLab(t, {
    port: 5560, previewPort: 5561,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'g0-text.pdf'),
  });
  const viewId = await lab.open('pdf', lab.input);
  const otherView = await lab.open('pdf', lab.input);
  const session = lab.server.sessions.requireView(viewId);
  const saved = await lab.post('host:pdf-save', saveBody(viewId, session.workingPath));
  const savedPath = saved.body.result.savedPath;
  const read = await lab.post('host:pdf-read-file', { viewId, path: savedPath });
  assert.equal(read.status, 200, 'the renderer can reload its confirmed output');
  assert.deepEqual(Buffer.from(read.body.result.base64, 'base64'), PUBLISHED_BYTES);
  const again = await lab.post('host:pdf-save', saveBody(viewId, savedPath));
  assert.equal(again.body.result.ok, true, 'another edit can use the saved output as its source');
  assert.equal(lab.calls[1].engineInput.path, savedPath);
  const sibling = join(dirname(savedPath), 'unpublished.pdf');
  writeFileSync(sibling, PUBLISHED_BYTES);
  for (const [reader, target] of [[viewId, sibling], [otherView, savedPath]]) {
    const denied = await lab.post('host:pdf-read-file', { viewId: reader, path: target });
    assert.equal(denied.status, 403, 'publication grants only the exact file to its own view');
  }
});

test('S2 the pre-save working copy and the ordinary views/<id>/out are refused as publications', async (t) => {
  const stale = await startLab(t, {
    port: 5562, previewPort: 5563,
    saveFor: (labDir, viewId) => join(labDir, 'views', viewId, 'input', 'g0-text.pdf'),
  });
  const staleView = await stale.open('pdf', stale.input);
  await expectRefused(stale, staleView, ['not_native_output']);

  const outDir = await startLab(t, {
    port: 5564, previewPort: 5565,
    saveFor: (labDir, viewId) => join(labDir, 'views', viewId, 'out', 'g0-text.pdf'),
  });
  const outView = await outDir.open('pdf', outDir.input);
  await expectRefused(outDir, outView, ['not_native_output']);
});

test('S3 another view native output is refused as a publication target', async (t) => {
  const lab = await startLab(t, {
    port: 5566, previewPort: 5567,
    saveFor: (labDir, viewId, state) => join(labDir, 'out', state.other ?? viewId, 'g0-text.pdf'),
  });
  const viewA = await lab.open('pdf', lab.input);
  lab.state.other = await lab.open('pdf', lab.input);
  assert.notEqual(lab.state.other, viewA);
  const foreign = await expectRefused(lab, viewA, ['not_native_output', 'wrong_view']);
  assert.notEqual(foreign.status, 'ok');
});

test('S4 a file outside the lab is never adopted as a publication', async (t) => {
  const outsideRoot = scratchRoot('pdf-save-outside-');
  const outside = join(outsideRoot, 'outside', 'g0-text.pdf');
  const lab = await startLab(t, { port: 5568, previewPort: 5569, saveFor: () => outside });
  const viewId = await lab.open('pdf', lab.input);
  await expectRefused(lab, viewId, ['path_outside_lab']);
  rmSync(outsideRoot, { recursive: true, force: true });
});

test('S5 a junction inside the native dir that resolves into another view is refused', async (t) => {
  const lab = await startLab(t, {
    port: 5570, previewPort: 5571,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'link', 'g0-text.pdf'),
  });
  const viewA = await lab.open('pdf', lab.input);
  const viewB = await lab.open('pdf', lab.input);
  // nativeOutDir (<lab>/out/<viewId>) is not created by open(); S5 needs both the junction parent
  // (viewA) and its target (viewB) to exist or Windows refuses to create the junction.
  mkdirSync(join(lab.lab, 'out', viewA), { recursive: true });
  mkdirSync(join(lab.lab, 'out', viewB), { recursive: true });
  try {
    symlinkSync(join(lab.lab, 'out', viewB), join(lab.lab, 'out', viewA, 'link'), 'junction');
  } catch (error) {
    assert.fail('S5 prerequisite unmet: this platform refused a junction: ' + error.message);
  }
  await expectRefused(lab, viewA, ['not_native_output', 'path_outside_lab', 'wrong_view']);
});

test('S6 a missing published file is refused (distinct from a zero-byte one)', async (t) => {
  const lab = await startLab(t, {
    port: 5572, previewPort: 5573,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'g0-text.pdf'),
    bytes: null,
  });
  const viewId = await lab.open('pdf', lab.input);
  assert.equal(existsSync(join(lab.lab, 'out', viewId, 'g0-text.pdf')), false, 'the fake engine made no file');
  await expectRefused(lab, viewId, ['path_not_found']);
});

test('S7 an existing zero-byte published file is refused as empty_output_refused', async (t) => {
  const lab = await startLab(t, {
    port: 5574, previewPort: 5575,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'g0-text.pdf'),
    bytes: Buffer.alloc(0),
  });
  const viewId = await lab.open('pdf', lab.input);
  const published = join(lab.lab, 'out', viewId, 'g0-text.pdf');
  assert.equal(existsSync(published), false, 'the fake engine publishes only during the save');
  const refusal = await expectRefused(lab, viewId, ['empty_output_refused']);
  assert.equal(refusal.error, 'empty_output_refused', 'exact named refusal');
  assert.equal(existsSync(published), true, 'the zero-byte file exists after the save attempt');
  assert.equal(readFileSync(published).length, 0, 'the published file is exactly zero bytes');
});

test('S8 a fresh view reopens the published file through its own directory grant', async (t) => {
  const lab = await startLab(t, {
    port: 5578, previewPort: 5579,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'g0-text.pdf'),
  });
  const viewId = await lab.open('pdf', lab.input);
  const working = lab.server.sessions.requireView(viewId).workingPath;
  const saved = await lab.post('host:pdf-save', saveBody(viewId, working));
  assert.equal(saved.body.result.status, 'ok', JSON.stringify(saved.body));
  const published = saved.body.result.savedPath;
  assert.equal(published, join(lab.lab, 'out', viewId, 'g0-text.pdf'));
  assert.equal(published.startsWith(join(lab.lab, 'views') + sep), false);
  const second = await lab.open('pdf', published);
  assert.notEqual(second, viewId);
  const session = lab.server.sessions.requireView(second);
  assert.equal(session.sourcePath, published);
  assert.equal(session.sourceDir, join(lab.lab, 'out', viewId));
  assert.deepEqual(readFileSync(session.workingPath), PUBLISHED_BYTES, 'the reopened bytes are the published bytes');
  assert.throws(() => lab.server.sessions.requireReadGrant(second, join(lab.lab, 'out', 'someone-else', 'x.pdf')));
});
