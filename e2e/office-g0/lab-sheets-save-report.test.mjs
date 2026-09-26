// UNI-667/668 correction FOUR (r5): the lab sheets save must report the ACTUAL published
// native output of THIS view and refuse anything that is not inside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLabServer } from './lab-server.mjs';
import { sha256 } from './lab-storage.mjs';
import { createXlsxEngineHandlers } from '../../scripts/office-g0/run-xlsx-cycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));   // e2e/office-g0
const REPO_ROOT = dirname(dirname(HERE));               // the lane root
const FIXTURE_PATH = join(REPO_ROOT, 'lab', 'fixtures', 'g0-compatibility-edit.xlsx');
const FIXTURE_SHA = 'a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85';
const FIXTURE_BYTES = 3161;
const PUBLISHED_BYTES = Buffer.from('PK\u0003\u0004lab-published-xlsx-bytes', 'latin1');

/** The workspace holding .uniwork-dev; every scratch write stays inside it. */
function workspaceRoot() {
  for (let dir = REPO_ROOT; ; ) {
    if (existsSync(join(dir, '.uniwork-dev'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('lab-sheets-save-report: no .uniwork-dev above ' + REPO_ROOT);
    dir = parent;
  }
}

/** A fresh scratch dir under the configured test tmp or the workspace default. */
function scratchRoot(prefix) {
  const parent = process.env.OFFICE_G0_TEST_TMP ?? join(workspaceRoot(), '.uniwork-dev', 'office-g0', 'tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

const saveBody = (viewId) => ({
  viewId,
  sessionId: 'session-1',
  mode: 'save',
  name: 'edited.xlsx',
  edits: [{ sheetId: 'sheet-1', row: 0, column: 0, writeValue: true, value: 'lab edit' }],
  formulaValues: [],
  structuralOps: [],
});

/**
 * A real lab + real files. saveFor decides where the bounded fake engine publishes;
 * bytes null means it publishes nothing, Buffer.alloc(0) an existing empty file.
 */
async function startLab(t, { port, previewPort, saveFor, bytes = PUBLISHED_BYTES }) {
  const root = scratchRoot('lab-save-report-');
  const lab = join(root, 'lab');
  mkdirSync(join(root, 'builds'), { recursive: true });
  mkdirSync(join(lab, 'in'), { recursive: true });
  const input = join(lab, 'in', 'g0-compatibility-edit.xlsx');
  const authored = readFileSync(FIXTURE_PATH);
  assert.equal(authored.length, FIXTURE_BYTES, 'fixture byte length');
  assert.equal(sha256(authored), FIXTURE_SHA, 'fixture sha256 (lowercase hex)');
  writeFileSync(input, authored);
  const calls = [];
  const server = createLabServer({
    buildsDir: join(root, 'builds'), labDir: lab, fixturesDir: null, sourceDir: null,
    port, previewPort,
    engineHandlers: {
      'xlsx-save': async (engineInput, { viewId }) => {
        calls.push({ engineInput, viewId });
        const path = saveFor(lab, viewId);
        if (bytes !== null) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes);   // the engine's own publication, never the server
        }
        return {
          canceled: false, touchedEntries: ['xl/worksheets/sheet1.xml'],
          saved: {
            path, bytes: bytes === null ? 0 : bytes.length, touched: ['xl/worksheets/sheet1.xml'],
            sha256: bytes === null ? '' : sha256(bytes), reopenedSheets: ['Data'], formulaCells: 0,
          },
          file: {
            sessionId: 'session-1', name: 'edited.xlsx', path, sha256: FIXTURE_SHA,
            fileBytes: FIXTURE_BYTES, readOnly: false, entryCount: 0,
            sheets: [{ id: 'sheet-1', name: 'Data' }], activeTab: 0, viewId,
          },
        };
      },
      'xlsx-open': async (_input, { viewId }) => ({
        viewId,
        workbook: {
          sessionId: 'session-2', name: 'edited.xlsx', path: 'published', sha256: FIXTURE_SHA,
          fileBytes: FIXTURE_BYTES, readOnly: false, entryCount: 0,
          sheets: [{ id: 'sheet-1', name: 'Data' }], activeTab: 0, viewId,
        },
      }),
      // The REAL close route shape: it retires the view's workbook state and answers a boolean.
      'xlsx-close': async (engineInput, { viewId }) => {
        calls.push({ engineInput, viewId });
        return { closed: true, sessionId: 'session-2' };
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
  /** Observable side effects a refused save must not produce. */
  const sideEffects = (viewId) => {
    const session = server.sessions.requireView(viewId);
    return {
      savePath: session.savePath,
      output: session.output,
      records: server.records().filter((e) => e.view === viewId).length,
      savedEvents: server.events.peek(viewId).filter((e) => e.type === 'saved').length,
    };
  };
  return { root, lab, input, server, calls, post, open, sideEffects };
}

test('S1 the engine receives the flat route payload with the server-owned viewId', async (t) => {
  const lab = await startLab(t, {
    port: 5492, previewPort: 5493,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(result.body.result.status, 'ok', JSON.stringify(result.body));
  assert.equal(lab.calls.length, 1);
  const input = lab.calls[0].engineInput;
  assert.equal('request' in input, false, 'the route does not read input.request');
  assert.equal('targetPath' in input, false, 'the route does not read targetPath');
  assert.equal(input.viewId, viewId, 'the exact server-owned view id');
  assert.equal(input.sessionId, 'session-1');
  assert.equal(input.mode, 'save');
  assert.equal(input.name, 'edited.xlsx');
  assert.deepEqual(input.edits, saveBody(viewId).edits);
  assert.deepEqual(input.formulaValues, []);
  assert.deepEqual(input.structuralOps, []);
});

test('S2 the report is the published output by path, bytes and sha256', async (t) => {
  const lab = await startLab(t, {
    port: 5490, previewPort: 5491,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  const workingPath = lab.server.sessions.requireView(viewId).workingPath;
  const before = readFileSync(workingPath);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(result.body.result.status, 'ok', JSON.stringify(result.body));
  const value = result.body.result;
  const expected = join(lab.lab, 'out', viewId, 'edited.xlsx');
  assert.equal(value.savedPath, expected);
  assert.notEqual(value.savedPath, workingPath);
  assert.equal(value.savedPath.startsWith(join(lab.lab, 'views') + sep), false);
  assert.equal(value.bytes, PUBLISHED_BYTES.length);
  assert.equal(value.sha256, sha256(PUBLISHED_BYTES));
  assert.deepEqual(readFileSync(workingPath), before, 'the working copy is never replaced');
  assert.equal(lab.server.records().some((e) => e.view === viewId && e.op === 'sheets-save'), true);
});

test('S3 a stale report of the pre-save working path is refused, nothing mutated', async (t) => {
  const lab = await startLab(t, {
    port: 5494, previewPort: 5495,
    saveFor: (labDir, viewId) => join(labDir, 'views', viewId, 'input', 'g0-compatibility-edit.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  const before = lab.sideEffects(viewId);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(result.body.result.status, 'error', JSON.stringify(result.body));
  assert.equal(result.body.result.reason, 'save-not-published');
  assert.equal('savedPath' in result.body.result, false);
  assert.deepEqual(lab.sideEffects(viewId), before, 'a refusal leaves state and events untouched');
});

test('S4 the view ordinary views/<id>/out is refused as a publication target', async (t) => {
  const lab = await startLab(t, {
    port: 5496, previewPort: 5497,
    saveFor: (labDir, viewId) => join(labDir, 'views', viewId, 'out', 'edited.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  const before = lab.sideEffects(viewId);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(result.body.result.status, 'error', JSON.stringify(result.body));
  assert.equal(result.body.result.reason, 'save-not-published');
  assert.deepEqual(lab.sideEffects(viewId), before);
});

test('S5 another view, outside the lab, and a junction escape are all refused', async (t) => {
  // (a) another view's native output
  let other = null;
  const a = await startLab(t, {
    port: 5498, previewPort: 5499,
    saveFor: (labDir, viewId) => join(labDir, 'out', other ?? viewId, 'edited.xlsx'),
  });
  const viewA = await a.open('sheets', a.input);
  other = await a.open('sheets', a.input);
  assert.notEqual(other, viewA);
  const beforeA = a.sideEffects(viewA);
  const rA = await a.post('host:sheets-save-edits', saveBody(viewA));
  assert.equal(rA.body.result.status, 'error', JSON.stringify(rA.body));
  assert.equal(rA.body.result.reason, 'save-not-published');
  assert.equal(rA.body.result.error, 'not_native_output');
  assert.deepEqual(a.sideEffects(viewA), beforeA);

  // (b) outside the lab entirely (the fake engine wrote it; the SERVER must not adopt it)
  const outsideRoot = scratchRoot('lab-save-outside-');
  const outside = join(outsideRoot, 'outside', 'edited.xlsx');
  const b = await startLab(t, { port: 5500, previewPort: 5501, saveFor: () => outside });
  const viewB = await b.open('sheets', b.input);
  const beforeB = b.sideEffects(viewB);
  const rB = await b.post('host:sheets-save-edits', saveBody(viewB));
  assert.equal(rB.body.result.status, 'error', JSON.stringify(rB.body));
  assert.equal(rB.body.result.reason, 'save-not-published');
  assert.equal('savedPath' in rB.body.result, false);
  assert.equal('bytes' in rB.body.result, false);
  assert.deepEqual(b.sideEffects(viewB), beforeB);
  rmSync(outsideRoot, { recursive: true, force: true });

  // (c) a junction inside the native dir that resolves outside it
  const linkRoot = scratchRoot('lab-save-junction-');
  const outsideDir = join(linkRoot, 'outside');
  mkdirSync(outsideDir, { recursive: true });
  let link = null;
  const c = await startLab(t, {
    port: 5502, previewPort: 5503,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'link', 'edited.xlsx'),
  });
  const viewC = await c.open('sheets', c.input);
  link = join(c.lab, 'out', viewC, 'link');
  mkdirSync(join(c.lab, 'out', viewC), { recursive: true });
  try {
    symlinkSync(outsideDir, link, 'junction');
  } catch (error) {
    assert.fail('S5c prerequisite unmet: this platform refused a junction: ' + error.message);
  }
  const beforeC = c.sideEffects(viewC);
  const rC = await c.post('host:sheets-save-edits', saveBody(viewC));
  assert.equal(rC.body.result.status, 'error', JSON.stringify(rC.body));
  assert.equal(rC.body.result.reason, 'save-not-published');
  assert.deepEqual(c.sideEffects(viewC), beforeC);
  rmSync(linkRoot, { recursive: true, force: true });
});

test('S6 a missing published file is refused (distinct from a zero-byte one)', async (t) => {
  const lab = await startLab(t, {
    port: 5506, previewPort: 5507,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
    bytes: null,                        // the engine publishes NOTHING at all
  });
  const viewId = await lab.open('sheets', lab.input);
  const expected = join(lab.lab, 'out', viewId, 'edited.xlsx');
  const before = lab.sideEffects(viewId);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(existsSync(expected), false, 'the fake engine genuinely created no file');
  assert.equal(result.body.result.status, 'error', JSON.stringify(result.body));
  assert.equal(result.body.result.reason, 'save-not-published');
  assert.equal(result.body.result.error, 'path_not_found');
  assert.equal('savedPath' in result.body.result, false);
  assert.deepEqual(lab.sideEffects(viewId), before);
});

test('S7 an existing zero-byte published file is refused as empty_output_refused', async (t) => {
  const lab = await startLab(t, {
    port: 5508, previewPort: 5509,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
    bytes: Buffer.alloc(0),             // the engine publishes a file that EXISTS and is empty
  });
  const viewId = await lab.open('sheets', lab.input);
  const expected = join(lab.lab, 'out', viewId, 'edited.xlsx');
  // The engine creates the file only DURING the save, so snapshot the session state BEFORE the
  // call and assert the on-disk fact only AFTER it (r4 asserted existence first - defect D1).
  const before = lab.sideEffects(viewId);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(existsSync(expected), true, 'the zero-byte file really exists after the engine call');
  assert.equal(readFileSync(expected).length, 0, 'and it is genuinely empty');
  assert.equal(result.body.result.status, 'error', JSON.stringify(result.body));
  assert.equal(result.body.result.reason, 'save-not-published');
  assert.equal(result.body.result.error, 'empty_output_refused');
  assert.equal('savedPath' in result.body.result, false);
  assert.deepEqual(lab.sideEffects(viewId), before);
});

test('S8 a fresh view reopens the published output through its own directory grant', async (t) => {
  const lab = await startLab(t, {
    port: 5504, previewPort: 5505,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  const saved = await lab.post('host:sheets-save-edits', saveBody(viewId));
  assert.equal(saved.body.result.status, 'ok', JSON.stringify(saved.body));
  const published = saved.body.result.savedPath;
  assert.equal(basename(published), 'edited.xlsx');
  const second = await lab.open('sheets', published);
  assert.notEqual(second, viewId);
  const session = lab.server.sessions.requireView(second);
  assert.equal(session.sourcePath, published);
  assert.equal(session.sourceDir, join(lab.lab, 'out', viewId));
  const selected = await lab.post('host:sheets-select-workbook', { viewId: second, path: published });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.result.workbook.path, 'published');
  // Another view's native output stays unreadable for that fresh session.
  assert.throws(() => lab.server.sessions.requireReadGrant(second, join(lab.lab, 'out', 'someone-else', 'x.xlsx')));
});

test('S9 a junction at the WHOLE nativeOutDir to another view is refused', async (t) => {
  // The redirect target is another view's nativeOutDir inside the same lab/out. The engine
  // reports a path under THIS view's nativeOutDir, but that directory is a junction into the
  // other view, so a root-resolving proof would re-bless it and the ordinary grant would then
  // report a foreign file as this view's publication (defect D2).
  const lab = await startLab(t, {
    port: 5540, previewPort: 5541,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
  });
  const viewA = await lab.open('sheets', lab.input);
  const viewB = await lab.open('sheets', lab.input);
  assert.notEqual(viewA, viewB);
  const nativeA = join(lab.lab, 'out', viewA);
  const nativeB = join(lab.lab, 'out', viewB);
  mkdirSync(nativeB, { recursive: true });
  rmSync(nativeA, { recursive: true, force: true });
  try {
    symlinkSync(nativeB, nativeA, 'junction');
  } catch (error) {
    assert.fail('S9 prerequisite unmet: this platform refused a junction: ' + error.message);
  }
  const before = lab.sideEffects(viewA);
  const result = await lab.post('host:sheets-save-edits', saveBody(viewA));
  assert.equal(result.body.result.status, 'error', JSON.stringify(result.body));
  assert.equal(result.body.result.reason, 'save-not-published');
  assert.equal(result.body.result.error, 'not_native_output');
  assert.equal('savedPath' in result.body.result, false);
  assert.deepEqual(lab.sideEffects(viewA), before);
});

// --- UNI-667 read bridge: the real handlers traverse the real channels -------------

/**
 * A real lab whose engineHandlers are the REAL createXlsxEngineHandlers, with a fetch that
 * records the engine route it was asked to call and answers the route-shaped envelope. This is
 * the boundary the browser actually crosses: host:sheets-read-range/formulas -> lab proxy ->
 * real bridge handler -> /engine/xlsx-read-range|/engine/xlsx-read-formulas.
 */
async function startReadLab(t, { port, previewPort }) {
  const root = scratchRoot('lab-sheets-read-');
  const lab = join(root, 'lab');
  mkdirSync(lab, { recursive: true });
  const engineCalls = [];
  const handlers = createXlsxEngineHandlers({
    baseUrl: 'http://127.0.0.1:5462',
    fetchImpl: async (url, init) => {
      const route = String(url).slice(String(url).indexOf('/engine/'));
      engineCalls.push({ route, body: JSON.parse(init.body) });
      if (route === '/engine/xlsx-read-range') {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { result: { cells: [{ row: 0, column: 0, value: 'H1' }], rows: [], merges: [], hyperlinks: [], conditionalRules: [], autoFilter: null, autoFilterColumns: [], dataValidations: [], indexingComplete: true, indexedThroughRow: 0 } } }) };
      }
      if (route === '/engine/xlsx-read-formulas') {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { cells: [{ row: 0, column: 1, formula: '=A1' }], indexingComplete: true, truncated: false } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { viewId: 'x', workbook: { sessionId: 's', name: 'b.xlsx', path: 'p', sha256: FIXTURE_SHA, fileBytes: FIXTURE_BYTES, readOnly: false, entryCount: 0, sheets: [{ id: 'sheet-1', name: 'Data' }], activeTab: 0 } } }) };
    },
  });
  const server = createLabServer({
    buildsDir: join(root, 'builds'), labDir: lab, fixturesDir: null, sourceDir: null,
    port, previewPort, engineBaseUrl: 'http://127.0.0.1:5462', engineHandlers: handlers,
  });
  t.after(async () => { await server.close(); rmSync(root, { recursive: true, force: true }); });
  const { app } = await server.listen();
  const post = async (channel, body) => {
    const response = await fetch(app + '/lab/' + channel, {
      method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const open = async () => {
    const result = await post('lab:session-open', { app: 'sheets', path: null });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.result.viewId;
  };
  return { server, engineCalls, post, open };
}

test('R1 read-range traverses the real bridge and answers the RangeResult, not the route envelope', async (t) => {
  const lab = await startReadLab(t, { port: 5542, previewPort: 5543 });
  const viewId = await lab.open();
  const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const result = await lab.post('host:sheets-read-range', { viewId, sessionId: 'session-1', sheetId: 'sheet-1', range });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  // The channel answers the RangeResult itself; a { result } envelope would fail the renderer schema.
  assert.deepEqual(result.body.result.cells, [{ row: 0, column: 0, value: 'H1' }]);
  assert.equal('result' in result.body.result, false, 'the route envelope is unwrapped');
  const call = lab.engineCalls.find((entry) => entry.route === '/engine/xlsx-read-range');
  assert.ok(call, 'the real bridge called the read-range engine route');
  assert.equal(call.body.viewId, viewId, 'the server-owned view id reaches the engine route');
  assert.equal(call.body.sessionId, 'session-1');
  assert.equal(call.body.sheetId, 'sheet-1');
  assert.deepEqual(call.body.range, range);
});

test('R2 read-formulas traverses the real bridge and a smuggled viewId cannot retarget the session', async (t) => {
  const lab = await startReadLab(t, { port: 5544, previewPort: 5545 });
  const viewId = await lab.open();
  const served = await lab.post('host:sheets-read-formulas', { viewId, sheetId: 'sheet-1' });
  assert.equal(served.status, 200, JSON.stringify(served.body));
  assert.equal(served.body.result.indexingComplete, true);
  assert.deepEqual(served.body.result.cells, [{ row: 0, column: 1, formula: '=A1' }]);
  const call = lab.engineCalls.find((entry) => entry.route === '/engine/xlsx-read-formulas');
  assert.ok(call, 'the real bridge called the read-formulas engine route');
  assert.equal(call.body.viewId, viewId, 'the server-owned view id, never a caller-supplied one');
  assert.equal(call.body.sheetId, 'sheet-1');
  // A body that tries to retarget another view is refused by the transport BEFORE any engine call:
  // the session id belongs to the transport, so a caller cannot name a different view at all.
  const before = lab.engineCalls.length;
  const foreign = await lab.post('host:sheets-read-formulas', { viewId: 'someone-elses-view', sheetId: 'sheet-1' });
  assert.notEqual(foreign.status, 200, 'a foreign view id must not be served');
  assert.equal(foreign.body.error, 'unknown_view');
  assert.equal(lab.engineCalls.length, before, 'the refused retarget never reached the engine');
  // A payload that smuggles a viewId alongside the real one is refused at the adapter, and even a
  // direct handler call with a spoofed input.viewId keeps the server-owned id (see run-xlsx-cycle
  // handler tests) - so the engine only ever sees the transport identity.
  const smuggled = await lab.post('host:sheets-read-formulas', { viewId, sheetId: 'sheet-1', request: { viewId: 'attacker' } });
  assert.equal(smuggled.status, 200, JSON.stringify(smuggled.body));
  const last = lab.engineCalls[lab.engineCalls.length - 1];
  assert.equal(last.body.viewId, viewId, 'a smuggled inner viewId cannot retarget the session');
});

test('C1 host:sheets-close retains the session guard under the server viewId', async (t) => {
  const lab = await startLab(t, {
    port: 5548, previewPort: 5549,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  // The channel was the browser's second real 501 (host:sheets-close was bound to an engine
  // operation the bridge never carried). It now reaches the route and reports the REAL outcome,
  // while the body's sessionId guards against closing a newer saved session.
  const result = await lab.post('host:sheets-close', { viewId, sessionId: 'attacker-session' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.result, { ok: true, viewId, closed: true });
  const call = lab.calls[lab.calls.length - 1];
  assert.deepEqual(call.engineInput, { viewId, sessionId: 'attacker-session' }, 'close retains the guard without changing view authority');
  assert.equal(call.viewId, viewId);
  const recorded = lab.server.records().filter((entry) => entry.view === viewId && entry.op === 'sheets-close');
  assert.deepEqual(recorded.map((entry) => entry.closed), [true], 'the real close outcome is recorded');
});

test('C2 a close reply that is not a boolean outcome is a NAMED refusal, never an unverified close', async (t) => {
  // A route that answers a shapeless close must not be reported as a close that happened. The
  // lab refuses it by name; the renderer's own unmount command is not turned into a fake success.
  const root = scratchRoot('lab-sheets-close-shape-');
  mkdirSync(root, { recursive: true });
  const server = createLabServer({
    buildsDir: join(root, 'builds'), labDir: join(root, 'lab'), fixturesDir: null, sourceDir: null,
    port: 5550, previewPort: 5551,
    engineHandlers: { 'xlsx-close': async () => ({ sessionId: 'session-2' }) },
  });
  t.after(async () => { await server.close(); rmSync(root, { recursive: true, force: true }); });
  const { app } = await server.listen();
  const opened = await fetch(app + '/lab/lab:session-open', {
    method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ app: 'sheets', path: null }),
  });
  const viewId = (await opened.json()).result.viewId;
  const response = await fetch(app + '/lab/host:sheets-close', {
    method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ viewId }),
  });
  const body = await response.json();
  assert.equal(response.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'engine_invalid_response');
  assert.equal(body.result, undefined, 'a shapeless close never answers a fabricated result');
  assert.equal(
    server.records().filter((entry) => entry.op === 'sheets-close').length, 0,
    'an unverified close is not recorded as one that happened',
  );
});

test('P1 host:pending-edits records the badge count for its own view and refuses a malformed one', async (t) => {
  const lab = await startLab(t, {
    port: 5552, previewPort: 5553,
    saveFor: (labDir, viewId) => join(labDir, 'out', viewId, 'edited.xlsx'),
  });
  const viewId = await lab.open('sheets', lab.input);
  // The renderer feeds this on every edit (App.tsx:505-507) and the channel used to be a 404.
  const ok = await lab.post('host:pending-edits', { viewId, count: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.result, { ok: true, viewId, pendingEdits: 3 });
  assert.equal(lab.server.sessions.requireView(viewId).pendingEdits, 3);
  assert.deepEqual(
    lab.server.records().filter((entry) => entry.op === 'pending-edits').map(({ view, count }) => ({ view, count })),
    [{ view: viewId, count: 3 }],
  );
  // 0 is a real state (no pending edits), and the preload floors a fractional count.
  const zero = await lab.post('host:pending-edits', { viewId, count: 0 });
  assert.deepEqual(zero.body.result, { ok: true, viewId, pendingEdits: 0 });
  const floored = await lab.post('host:pending-edits', { viewId, count: 2.9 });
  assert.deepEqual(floored.body.result, { ok: true, viewId, pendingEdits: 2 });
  const count = lab.server.records().length;
  for (const bad of [undefined, null, -1, '3', true, {}, []]) {
    const refused = await lab.post('host:pending-edits', { viewId, count: bad });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.error, 'invalid_input');
  }
  assert.equal(lab.server.records().length, count, 'a refused count changes neither state nor the record log');
  // A forged or closed view is refused by the ordinary view resolution, before any mutation.
  const forged = await lab.post('host:pending-edits', { viewId: 'forged-view', count: 1 });
  assert.equal(forged.status, 404);
  assert.equal(forged.body.error, 'unknown_view');
});

test('R3 a read is never a fabricated success: unbound is engine_unsupported, unlisted is unknown_engine_operation', async (t) => {
  // The failure the browser actually hit before the fix: read-range was not on the shared
  // allowlist, so the lab answered 501 unknown_engine_operation. Now the name IS allowlisted, so
  // a lab that binds no read handler answers its own named 501 engine_unsupported. Either way the
  // refusal is NAMED and carries no result - never an empty range that would look like a real read.
  const root = scratchRoot('lab-sheets-unbound-');
  mkdirSync(root, { recursive: true });
  const server = createLabServer({
    buildsDir: join(root, 'builds'), labDir: join(root, 'lab'), fixturesDir: null, sourceDir: null,
    port: 5546, previewPort: 5547, engineHandlers: { 'xlsx-open': async () => ({ viewId: 'x' }) },
  });
  t.after(async () => { await server.close(); rmSync(root, { recursive: true, force: true }); });
  const { app } = await server.listen();
  const post = async (channel, body) => {
    const response = await fetch(app + '/lab/' + channel, {
      method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const opened = await post('lab:session-open', { app: 'sheets', path: null });
  const viewId = opened.body.result.viewId;
  const result = await post('host:sheets-read-range', { viewId, sheetId: 'sheet-1', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } });
  assert.equal(result.status, 501, JSON.stringify(result.body));
  assert.equal(result.body.error, 'engine_unsupported');
  assert.equal(result.body.result, undefined, 'a refused read never answers a fabricated result');
  // A name the shared allowlist does not carry stays the ORIGINAL unknown_engine_operation refusal,
  // so widening the read bindings did not widen what the transport will attempt to forward.
  await assert.rejects(
    () => server.engine.call('xlsx-not-a-real-operation', {}, { viewId }),
    (error) => error.code === 'unknown_engine_operation',
    'a name outside ENGINE_OPERATIONS is refused by the transport',
  );
});
