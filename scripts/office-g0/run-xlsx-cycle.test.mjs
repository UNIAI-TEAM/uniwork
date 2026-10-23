// UNI-667 office-g0 xlsx runner: narrow input / manifest / evidence-boundary tests.
//
// Pure and import-safe: no server, no spawn, no browser, no network bind. Temp
// directories are used only for path-boundary cases. Run with the prepared Node22:
//   node --test scripts/office-g0/run-xlsx-cycle.test.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BUILD_PREREQUISITE,
  EXPECTED_PROJECTS,
  FIXTURE,
  PORTS,
  SOURCE_PIN,
  XLSX_APP,
  XLSX_SPEC,
  assertDistinctPorts,
  assertFreshEvidenceTargets,
  assertInsideWorkspace,
  assertManifest,
  assertReportProvesRealRun,
  createXlsxEngineHandlers,
  evidenceTargets,
  findWorkspaceRoot,
  assertDiscoveryComplete,
  createRunFinalizer,
  duplicateIdentities,
  finalizeOwnedChildren,
  latchSignalFailure,
  noteCleanupOutcome,
  ownedChildHooks,
  parseDiscoveryList,
  parseDiscoveryListReport,
  parseRunnerArgs,
  persistResultOnce,
  reconcileOk,
  requireExistingFile,
  resolveRunnerPlan,
  runOwnedChild,
  sha256Bytes,
  startOwnedEngineChild,
  stopOwnedChild,
  waitForEngineIdentity,
  summarizePlaywrightReport,
  testIdentity,
} from './run-xlsx-cycle.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'office-g0-xlsx-runner-'));
const write = (rel, bytes) => {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return full;
};
// Scoped stand-ins for the ref-counted process handle a REAL spawned child owns while it lives. A
// production run's deliberately unref'd deadline/cleanup timers still fire only because the live
// child keeps the event loop referenced; the injected EventEmitter fakes own no such handle, so
// without this the loop drains and node:test cancels a still-pending case. Each handle is released
// the moment its child exits (exactly when a real handle would drop) and swept once here, so this is
// a bounded, disposed ref - never a permanent keepalive.
const liveChildHandles = new Set();
const acquireChildHandle = () => {
  const handle = setInterval(() => {}, 1000);
  liveChildHandles.add(handle);
  return () => { clearInterval(handle); liveChildHandles.delete(handle); };
};
test.after(() => { for (const handle of liveChildHandles) clearInterval(handle); liveChildHandles.clear(); });
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const baseArgs = (overrides = {}) => Object.assign({
  mode: 'discovery',
  candidate: path.join(tmpRoot, 'candidate'),
  builds: path.join(tmpRoot, 'builds'),
  manifest: path.join(tmpRoot, 'builds', 'host-build-manifest.json'),
  source: path.join(tmpRoot, 'source'),
  fixtures: path.join(tmpRoot, 'fixtures'),
  prefix: path.join(tmpRoot, 'run-1'),
  expectedManifestSha256: 'a'.repeat(64),
  ports: Object.assign({}, PORTS),
}, overrides);

const manifestFor = (apps, pin = SOURCE_PIN, touched = true) => ({
  generator: 'scripts/office-g0/build-renderers.mjs',
  pinnedSourceCommit: pin,
  apps,
  sourceUntouched: touched,
  appSourcesUntouched: touched,
});

test('pinned constants match the wave2 contract', () => {
  assert.equal(SOURCE_PIN, '09485f884dc845cf3bf27fb7edfe489f9d457aad');
  assert.equal(XLSX_APP, 'sheets');
  assert.equal(XLSX_SPEC, 'xlsx-cycle.spec.ts');
  assert.equal(FIXTURE.name, 'g0-compatibility-edit.xlsx');
  assert.equal(FIXTURE.bytes, 3161);
  assert.equal(FIXTURE.sha256, 'a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85');
  assert.deepEqual(PORTS, { app: 5460, preview: 5461, engine: 5462 });
  assert.deepEqual(EXPECTED_PROJECTS, ['chrome', 'edge']);
  assert.ok(BUILD_PREREQUISITE.includes('build-renderers.mjs'));
  assert.ok(BUILD_PREREQUISITE.includes('--apps sheets'));
});

test('parseRunnerArgs fails on every missing input and defaults to discovery', () => {
  assert.throws(() => parseRunnerArgs([], {}), /missing required runner input/);
  const args = parseRunnerArgs([], {
    OFFICE_G0_XLSX_CANDIDATE: tmpRoot,
    OFFICE_G0_XLSX_BUILDS: tmpRoot,
    OFFICE_G0_XLSX_MANIFEST: tmpRoot,
    OFFICE_G0_PREPARED_SOURCE: tmpRoot,
    OFFICE_G0_FIXTURES_DIR: tmpRoot,
    OFFICE_G0_XLSX_EVIDENCE_PREFIX: tmpRoot,
    OFFICE_G0_EXPECTED_MANIFEST_SHA256: 'b'.repeat(64),
  });
  assert.equal(args.mode, 'discovery');
  assert.equal(args.expectedManifestSha256, 'b'.repeat(64));
  assert.equal(parseRunnerArgs(['--execute'], {
    OFFICE_G0_XLSX_CANDIDATE: tmpRoot,
    OFFICE_G0_XLSX_BUILDS: tmpRoot,
    OFFICE_G0_XLSX_MANIFEST: tmpRoot,
    OFFICE_G0_PREPARED_SOURCE: tmpRoot,
    OFFICE_G0_FIXTURES_DIR: tmpRoot,
    OFFICE_G0_XLSX_EVIDENCE_PREFIX: tmpRoot,
  }).mode, 'execute');
});

test('assertManifest rejects a bad pin, a wrong app set, an untouched-flag miss and a hash mismatch', () => {
  const good = Buffer.from(JSON.stringify(manifestFor({ sheets: {} })));
  const sha = sha256Bytes(good);
  assert.deepEqual(assertManifest({ manifestBytes: good, expectedSha256: sha }), { sha256: sha, sourcePin: SOURCE_PIN, app: 'sheets' });

  assert.throws(() => assertManifest({ manifestBytes: good, expectedSha256: 'c'.repeat(64) }), /SHA256 mismatch/);
  assert.throws(() => assertManifest({ manifestBytes: good, expectedSha256: 'not-hex' }), /64 lowercase hex/);
  assert.throws(() => assertManifest({
    manifestBytes: Buffer.from(JSON.stringify(manifestFor({ slides: {} }))),
    expectedSha256: sha256Bytes(Buffer.from(JSON.stringify(manifestFor({ slides: {} })))),
  }), /exactly one app "sheets"/);
  assert.throws(() => assertManifest({
    manifestBytes: Buffer.from(JSON.stringify(manifestFor({ sheets: {} }, 'deadbeef'))),
    expectedSha256: sha256Bytes(Buffer.from(JSON.stringify(manifestFor({ sheets: {} }, 'deadbeef')))),
  }), /is not the immutable pin/);
  assert.throws(() => assertManifest({
    manifestBytes: Buffer.from(JSON.stringify(manifestFor({ sheets: {} }, SOURCE_PIN, false))),
    expectedSha256: sha256Bytes(Buffer.from(JSON.stringify(manifestFor({ sheets: {} }, SOURCE_PIN, false)))),
  }), /does not prove/);
  assert.throws(() => assertManifest({ manifestBytes: Buffer.from('{'), expectedSha256: sha256Bytes(Buffer.from('{')) }), /not JSON/);
});

test('evidence targets are fresh-only: an existing suffix fails and never gets deleted', () => {
  const prefix = path.join(tmpRoot, 'fresh-check');
  assert.deepEqual(evidenceTargets(prefix), [prefix + '-artifacts', prefix + '-runtime', prefix + '-run.txt', prefix + '-engine.txt', prefix + '-result.json']);
  assert.doesNotThrow(() => assertFreshEvidenceTargets(evidenceTargets(prefix)));
  write('fresh-check-runtime/old.txt', 'prior evidence');
  assert.throws(() => assertFreshEvidenceTargets(evidenceTargets(prefix)), /refusing to reuse or delete/);
  assert.ok(fs.existsSync(path.join(tmpRoot, 'fresh-check-runtime', 'old.txt')), 'prior evidence is preserved');
});

test('a NEW evidence target is proven through its deepest existing parent', () => {
  const ws = path.join(tmpRoot, 'evidence-ws');
  fs.mkdirSync(ws, { recursive: true });
  // The prefix does not exist yet, but its deepest EXISTING parent is the workspace root: accepted.
  const prefix = path.join(ws, 'run-1');
  assert.doesNotThrow(() => assertFreshEvidenceTargets(evidenceTargets(prefix), fs.existsSync, ws));
  // A prefix whose deepest existing parent is OUTSIDE the workspace is refused before creation.
  const outsidePrefix = path.join(os.tmpdir(), 'office-g0-outside-run-1');
  assert.throws(
    () => assertFreshEvidenceTargets(evidenceTargets(outsidePrefix), fs.existsSync, ws),
    /outside it through|cannot be contained|has no existing parent to prove/,
  );
  assert.equal(fs.existsSync(outsidePrefix + '-artifacts'), false, 'nothing is created by the refused gate');
});

test('requireExistingFile fails by name on a missing file and resolves an existing one', () => {
  assert.throws(() => requireExistingFile(path.join(tmpRoot, 'nope.mjs'), 'lab server module'), /missing lab server module/);
  const present = write('present.mjs', 'export {};');
  assert.equal(requireExistingFile(present, 'present'), path.resolve(present));
  // Containment of an EXISTING input: a file inside the workspace passes, an outside file is refused
  // when a workspace root is supplied. realpathSync is injected, so NO link is created.
  const ws = path.join(tmpRoot, 'contain-ws');
  fs.mkdirSync(ws, { recursive: true });
  const inside = write('contain-ws/inside.mjs', 'export {};');
  assert.equal(requireExistingFile(inside, 'inside', fs.existsSync, ws, (p) => path.resolve(p)), path.resolve(inside));
  const outside = write('outside.mjs', 'export {};');
  assert.throws(() => requireExistingFile(outside, 'outside', fs.existsSync, ws, (p) => path.resolve(p)), /must stay inside/);
});

test('assertInsideWorkspace rejects an outside path', () => {
  const root = path.join(tmpRoot, 'ws');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(assertInsideWorkspace(root, path.join(root, 'a', 'b'), 'x'), path.join(root, 'a', 'b'));
  assert.throws(() => assertInsideWorkspace(root, os.tmpdir(), 'x'), /must stay inside/);
});

test('assertInsideWorkspace proves canonical containment and accepts an in-workspace dependency link', () => {
  const root = path.join(tmpRoot, 'ws-link');
  const dep = path.join(root, 'source', 'node_modules');
  const depReal = path.join(root, 'store', 'node_modules-real');
  fs.mkdirSync(dep, { recursive: true });
  fs.mkdirSync(depReal, { recursive: true });
  // Injected realpath: the dependency link's real target is INSIDE the workspace, so it is accepted
  // (the intentional prepared-source link must not be blanket-rejected just because it leaves the lane).
  const realInjected = (p) => (path.resolve(p) === path.resolve(dep) ? depReal : path.resolve(p));
  assert.equal(assertInsideWorkspace(root, path.join(dep, 'tsx'), 'prepared source', { realpathSync: realInjected }), path.join(dep, 'tsx'));
  // A junction inside the root whose REAL target leaves the workspace is refused, without creating any link.
  const escapeReal = path.join(os.tmpdir(), 'outside-node_modules');
  const realEscaping = (p) => (path.resolve(p) === path.resolve(dep) ? escapeReal : path.resolve(p));
  assert.throws(
    () => assertInsideWorkspace(root, path.join(dep, 'tsx'), 'prepared source', { realpathSync: realEscaping }),
    /resolves outside it through/,
  );
  // A path that cannot real-resolve is refused rather than assumed contained.
  assert.throws(
    () => assertInsideWorkspace(root, path.join(root, 'ghost'), 'x', { realpathSync: () => null }),
    /does not real-resolve|cannot be contained/,
  );
});

test('findWorkspaceRoot walks up to the .uniwork-dev ancestor only', () => {
  const ws = path.join(tmpRoot, 'ws2');
  const deep = path.join(ws, 'a', 'b', 'c');
  fs.mkdirSync(path.join(ws, '.uniwork-dev'), { recursive: true });
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(findWorkspaceRoot(deep), ws);
  const orphan = path.join(tmpRoot, 'orphan');
  fs.mkdirSync(orphan, { recursive: true });
  assert.equal(findWorkspaceRoot(orphan, () => false), null);
});

test('resolveRunnerPlan fails on each missing required input file', () => {
  const ws = path.join(tmpRoot, 'ws3');
  fs.mkdirSync(path.join(ws, '.uniwork-dev'), { recursive: true });
  const args = baseArgs({ workspace: ws, candidate: path.join(ws, 'candidate'), builds: path.join(ws, 'builds'), source: path.join(ws, 'source'), fixtures: path.join(ws, 'fixtures'), manifest: path.join(ws, 'builds', 'host-build-manifest.json'), prefix: path.join(ws, 'run-1') });
  assert.throws(() => resolveRunnerPlan(args), /missing approved build manifest/);
  write('ws3/builds/host-build-manifest.json', '{}');
  assert.throws(() => resolveRunnerPlan(args), /missing xlsx Playwright config/);
  write('ws3/candidate/e2e/playwright.office-g0.xlsx.config.ts', 'export default {};');
  assert.throws(() => resolveRunnerPlan(args), /missing xlsx browser spec/);
  write('ws3/candidate/e2e/office-g0/xlsx-cycle.spec.ts', 'export {};');
  assert.throws(() => resolveRunnerPlan(args), /missing lab server module/);
  write('ws3/candidate/e2e/office-g0/lab-server.mjs', 'export {};');
  assert.throws(() => resolveRunnerPlan(args), /missing engine host entry/);
  write('ws3/candidate/e2e/office-g0/engine-host.mts', 'export {};');
  assert.throws(() => resolveRunnerPlan(args), /missing prepared tsx CLI/);
  write('ws3/source/node_modules/tsx/dist/cli.mjs', '// cli');
  assert.throws(() => resolveRunnerPlan(args), /missing prepared xlsx sidecar binary/);
  write('ws3/source/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar.exe', 'MZ');
  assert.throws(() => resolveRunnerPlan(args), /missing xlsx fixture/);
  write('ws3/fixtures/g0-compatibility-edit.xlsx', 'PK');
  assert.throws(() => resolveRunnerPlan(args), /missing sheets renderer build entry/);
  write('ws3/builds/sheets/index.html', '<html></html>');
  const plan = resolveRunnerPlan(args);
  assert.equal(plan.mode, 'discovery');
  assert.equal(plan.ports.engine, 5462);
  assert.equal(plan.spec, path.join(ws, 'candidate', 'e2e', 'office-g0', 'xlsx-cycle.spec.ts'));
});

test('engine handlers translate lab payloads onto the real xlsx routes', async () => {
  const calls = [];
  const handlers = createXlsxEngineHandlers({
    baseUrl: 'http://127.0.0.1:5462/',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), signal: Boolean(init.signal) });
      // Route-shaped engine envelopes: the read-range route wraps its RangeResult in { result },
      // the read-formulas route answers the result itself.
      const route = String(url);
      const result = route.endsWith('/engine/xlsx-read-range')
        ? { result: { cells: [{ row: 0, column: 0 }] } }
        : route.endsWith('/engine/xlsx-read-formulas')
          ? { cells: [], indexingComplete: true, truncated: false }
          : { ok: true };
      return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
    },
  });
  await handlers['xlsx-open']({ viewId: 'v1', sourcePath: 'C:/lab/in.xlsx' });
  // TRUSTED meta on OPEN (cursor r6 F6): createEngineProxy hands the server session identity in as the
  // SECOND argument, so it must beat a conflicting input.viewId.
  await handlers['xlsx-open']({ viewId: 'spoofed-input', sourcePath: 'C:/lab/in.xlsx' }, { viewId: 'v1' });
  await handlers['xlsx-recalc']({ viewId: 'v1', request: { edits: [{ sheetId: 's', row: 1, column: 0, input: 'x' }] } });
  // TRUSTED meta on RECALC must beat BOTH a spoofed input.viewId and a legacy request.viewId.
  await handlers['xlsx-recalc'](
    { viewId: 'spoofed-input', request: { viewId: 'spoofed-request', edits: [{ sheetId: 's', row: 1, column: 0, input: 'x' }] } },
    { viewId: 'v1' },
  );
  // With no trusted meta the caller-supplied id is still honored, so a direct call keeps working.
  await handlers['xlsx-recalc']({ viewId: 'direct', request: { edits: [{ sheetId: 's', row: 1, column: 0, input: 'x' }] } });
  // Accepted central server shape: the engine-shaped fields FLAT plus the server-owned viewId.
  await handlers['xlsx-save']({ viewId: 'v1', edits: [{ sheetId: 's', row: 0, column: 0, input: 'z' }], formulaValues: [{ sheetId: 's', cell: 'B1', value: 2 }], structuralOps: [{ kind: 'insert-row', sheetId: 's', at: 1 }], name: 'book.xlsx' });
  // TRUSTED meta on SAVE must beat a conflicting flat input.viewId AND a legacy request.viewId; the
  // flat edits still win over the wrapper edits.
  await handlers['xlsx-save'](
    { viewId: 'spoofed-input', edits: [{ sheetId: 's', row: 3, column: 0, input: 'm' }], name: 'book.xlsx', request: { viewId: 'spoofed-request', edits: [{ sheetId: 's', row: 9, column: 0, input: 'n' }] } },
    { viewId: 'v1' },
  );
  // The obsolete { request, targetPath } wrapper still routes (compat); name derives from targetPath.
  await handlers['xlsx-save']({ viewId: 'v1', request: { edits: [{}] }, targetPath: 'C:/lab/out/book.xlsx' });
  // Legacy-smuggling negative: a request.viewId inside the wrapper must NOT override the server-owned viewId.
  await handlers['xlsx-save']({ viewId: 'v1', request: { viewId: 'attacker', edits: [{ sheetId: 's', row: 2, column: 0, input: 'q' }] }, targetPath: 'C:/lab/out/book.xlsx' });
  // Direct-call compatibility with no trusted meta: the caller-supplied id is still honored.
  await handlers['xlsx-save']({ viewId: 'direct', edits: [{ sheetId: 's', row: 4, column: 0, input: 'd' }], targetPath: 'C:/lab/out/book.xlsx' });
  // The real read bindings: the renderer calls these on mount and after every edit. Each forwards
  // the wrapped request FLAT onto the engine route with the server-owned viewId applied LAST.
  const range = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 };
  const rangeResult = await handlers['xlsx-read-range']({ viewId: 'v1', request: { sheetId: 's', range } });
  await handlers['xlsx-read-range'](
    { viewId: 'spoofed-input', request: { viewId: 'spoofed-request', sheetId: 's', range } },
    { viewId: 'v1' },
  );
  const formulas = await handlers['xlsx-read-formulas']({ viewId: 'v1', request: { sheetId: 's' } });
  await handlers['xlsx-read-formulas'](
    { viewId: 'spoofed-input', request: { viewId: 'spoofed-request', sheetId: 's' } },
    { viewId: 'v1' },
  );
  // Close keeps the renderer session id as a guard within the trusted view.
  // It must never use that id to select a different view's workbook.
  await handlers['xlsx-close']({ viewId: 'v1', sessionId: 'attacker-session' });
  await handlers['xlsx-close']({ viewId: 'spoofed-input', sessionId: 'attacker-session' }, { viewId: 'v1' });
  // The read-range envelope is unwrapped to the renderer's RangeResult, never left as { result }.
  assert.deepEqual(rangeResult, { cells: [{ row: 0, column: 0 }] }, 'read-range answers the RangeResult, not the route envelope');
  assert.deepEqual(formulas, { cells: [], indexingComplete: true, truncated: false }, 'read-formulas answers the { cells, indexingComplete, truncated } result');
  const readRangeCalls = calls.filter((call) => call.url.endsWith('/engine/xlsx-read-range'));
  const readFormulaCalls = calls.filter((call) => call.url.endsWith('/engine/xlsx-read-formulas'));
  assert.equal(readRangeCalls.length, 2);
  assert.equal(readFormulaCalls.length, 2);
  assert.deepEqual(readRangeCalls[0].body, { viewId: 'v1', sheetId: 's', range }, 'the wrapped range request is forwarded FLAT');
  assert.deepEqual(readRangeCalls[1].body, { viewId: 'v1', sheetId: 's', range }, 'the TRUSTED meta viewId beats a spoofed input and request viewId on read-range');
  assert.deepEqual(readFormulaCalls[0].body, { viewId: 'v1', sheetId: 's' });
  assert.deepEqual(readFormulaCalls[1].body, { viewId: 'v1', sheetId: 's' }, 'the TRUSTED meta viewId beats a spoofed input and request viewId on read-formulas');
  assert.equal(calls[0].url, 'http://127.0.0.1:5462/engine/xlsx-open');
  assert.deepEqual(calls[0].body, { viewId: 'v1', path: 'C:/lab/in.xlsx' });
  assert.deepEqual(calls[1].body, { viewId: 'v1', path: 'C:/lab/in.xlsx' }, 'the TRUSTED meta viewId beats a conflicting input.viewId on open');
  assert.deepEqual(calls[2].body, { viewId: 'v1', edits: [{ sheetId: 's', row: 1, column: 0, input: 'x' }] });
  assert.deepEqual(calls[3].body, { viewId: 'v1', edits: [{ sheetId: 's', row: 1, column: 0, input: 'x' }] }, 'the TRUSTED meta viewId beats both a spoofed input.viewId and a spoofed request.viewId on recalc');
  assert.deepEqual(calls[4].body, { viewId: 'direct', edits: [{ sheetId: 's', row: 1, column: 0, input: 'x' }] }, 'with no trusted meta the caller-supplied id is still honored');
  assert.deepEqual(calls[5].body, { viewId: 'v1', edits: [{ sheetId: 's', row: 0, column: 0, input: 'z' }], formulaValues: [{ sheetId: 's', cell: 'B1', value: 2 }], structuralOps: [{ kind: 'insert-row', sheetId: 's', at: 1 }], name: 'book.xlsx' }, 'the accepted FLAT save shape reaches the engine intact');
  assert.deepEqual(calls[6].body, { viewId: 'v1', edits: [{ sheetId: 's', row: 3, column: 0, input: 'm' }], name: 'book.xlsx' }, 'the TRUSTED meta viewId beats a conflicting flat input.viewId and a smuggled request.viewId on save');
  assert.deepEqual(calls[7].body, { viewId: 'v1', edits: [{}], name: 'book.xlsx' }, 'the legacy request wrapper still routes');
  assert.deepEqual(calls[8].body, { viewId: 'v1', edits: [{ sheetId: 's', row: 2, column: 0, input: 'q' }], name: 'book.xlsx' }, 'the server-owned viewId wins over a smuggled legacy request.viewId');
  assert.deepEqual(calls[9].body, { viewId: 'direct', edits: [{ sheetId: 's', row: 4, column: 0, input: 'd' }], name: 'book.xlsx' }, 'with no trusted meta the caller-supplied id is still honored on save');
  const closeCalls = calls.filter((call) => call.url.endsWith('/engine/xlsx-close'));
  assert.equal(closeCalls.length, 2);
  assert.deepEqual(closeCalls[0].body, { viewId: 'v1', sessionId: 'attacker-session' }, 'close retains the session guard');
  assert.deepEqual(closeCalls[1].body, { viewId: 'v1', sessionId: 'attacker-session' }, 'the TRUSTED meta viewId still controls close');
  assert.ok(calls.every((call) => call.signal), 'every engine request carries an abort signal');
  const refusing = createXlsxEngineHandlers({
    baseUrl: 'http://127.0.0.1:5462',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, code: 'no_session', error: 'no open workbook' }) }),
  });
  // A bound-path engine refusal keeps its NAMED protocol code, so the lab reports engine_error
  // (502) rather than degrading to a generic internal_error (500).
  await assert.rejects(
    () => refusing['xlsx-recalc']({ viewId: 'v', request: {} }),
    (error) => error.code === 'engine_error' && /refused: no open workbook/.test(error.message),
  );
  // A read that does not answer the renderer's RangeResult is a NAMED refusal, never an empty range.
  const shapeless = createXlsxEngineHandlers({
    baseUrl: 'http://127.0.0.1:5462',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { result: { noCells: true } } }) }),
  });
  await assert.rejects(
    () => shapeless['xlsx-read-range']({ viewId: 'v', request: { sheetId: 's', range: {} } }),
    (error) => error.code === 'engine_invalid_response' && /xlsx-read-range did not answer a \{cells\} range result/.test(error.message),
  );
  // read-formulas has the same gate: a result without a cells array is a named refusal, never a
  // silent ok the renderer would show as an empty sheet.
  const shapelessFormulas = createXlsxEngineHandlers({
    baseUrl: 'http://127.0.0.1:5462',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { noCells: true } }) }),
  });
  await assert.rejects(
    () => shapelessFormulas['xlsx-read-formulas']({ viewId: 'v', request: { sheetId: 's' } }),
    (error) => error.code === 'engine_invalid_response' && /xlsx-read-formulas did not answer a \{cells\} formula result/.test(error.message),
  );
  // An upstream HTTP failure is engine_http_error, not a generic internal_error.
  const httpFailed = createXlsxEngineHandlers({
    baseUrl: 'http://127.0.0.1:5462',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  await assert.rejects(
    () => httpFailed['xlsx-read-range']({ viewId: 'v', request: { sheetId: 's', range: {} } }),
    (error) => error.code === 'engine_http_error' && error.details.upstreamStatus === 503,
  );
});

test('discovery list parsing yields project/file/title identities', () => {
  const lines = 'Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a sheets cycle \u203a edits A1 and saves\n'
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a sheets cycle \u203a edits A1 and saves\n';
  assert.deepEqual(parseDiscoveryList(lines).map(testIdentity), [
    'chrome\u0000office-g0/xlsx-cycle.spec.ts\u0000sheets cycle > edits A1 and saves',
    'edge\u0000office-g0/xlsx-cycle.spec.ts\u0000sheets cycle > edits A1 and saves',
  ]);
  assert.deepEqual(parseDiscoveryList('no tests'), []);
  // The real Playwright list shape -- a 'Listing tests:' header, '[project] \u203a spec:line:col \u203a title'
  // rows, and a trailing 'Total: N tests in M files' line -- yields identities AND a verifiable declared
  // total, with nothing silently dropped. Valid Windows and POSIX spec paths both stay real identities.
  const real = 'Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a sheets cycle \u203a edits A1 and saves\n'
    + '  [chrome] \u203a office-g0\\xlsx-cycle.spec.ts:12:1 \u203a sheets cycle \u203a edits A1 and saves\n'
    + 'Total: 2 tests in 2 files\n';
  const parsed = parseDiscoveryListReport(real);
  assert.deepEqual(parsed.unparsed, [], 'both real rows are classified, none is dropped');
  assert.equal(parsed.declaredTotal, 2);
  assert.equal(parsed.declaredFiles, 2);
  assert.deepEqual(parsed.identities.map(testIdentity), [
    'chrome\u0000office-g0/xlsx-cycle.spec.ts\u0000sheets cycle > edits A1 and saves',
    'chrome\u0000office-g0\\xlsx-cycle.spec.ts\u0000sheets cycle > edits A1 and saves',
  ]);
  assert.equal(path.basename(parsed.identities[0].file), 'xlsx-cycle.spec.ts', 'a POSIX spec path keeps its identity');
  assert.equal(path.win32.basename(parsed.identities[1].file), 'xlsx-cycle.spec.ts', 'a Windows spec path keeps its identity under Win32 rules');
  assert.deepEqual(parseDiscoveryList(real).map(testIdentity), parsed.identities.map(testIdentity));
  // A line that is NOT the header, the total or a row is reported in 'unparsed' instead of being dropped.
  const withJunk = parseDiscoveryListReport('Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a sheets cycle \u203a edits A1\n'
    + '  not a listing row at all\n'
    + 'Total: 2 tests in 1 file\n');
  assert.equal(withJunk.identities.length, 1);
  assert.deepEqual(withJunk.unparsed, ['not a listing row at all']);
  assert.equal(withJunk.declaredTotal, 2);
  assert.equal(parseDiscoveryListReport('no tests').declaredTotal, null, 'a missing Total line is visible, not invented');
});

test('assertDiscoveryComplete refuses duplicates, an unknown spec, a wrong project and a short list', () => {
  const good = [
    { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' },
    { project: 'edge', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' },
  ];
  assert.deepEqual(assertDiscoveryComplete(good), good, 'a unique chrome+edge list for the full spec is accepted');
  assert.equal(duplicateIdentities(good).length, 0);
  // A duplicate row is invisible to Set-equality but caught by the count/uniqueness gate.
  assert.deepEqual(duplicateIdentities([...good, { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' }]).length, 1);
  assert.throws(() => assertDiscoveryComplete([]), /listed no xlsx-cycle\.spec\.ts tests/);
  assert.throws(
    () => assertDiscoveryComplete([...good, { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' }]),
    /duplicate identit/,
  );
  assert.throws(
    () => assertDiscoveryComplete([good[0], { project: 'edge', file: 'office-g0/other.spec.ts', title: 'x' }]),
    /outside the xlsx slice/,
  );
  assert.throws(() => assertDiscoveryComplete([good[0], good[0]]), /duplicate identit/);
  assert.throws(() => assertDiscoveryComplete([good[0], { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' }]), /duplicate identit/);
  // F4: with the RAW parse report supplied, a collapsed parse — an unparsed listing line, a missing
  // Total line, or a declared total that does not equal the parsed row count — is refused by NAME
  // before the set comparison, so an extra listing row can never produce a false pass.
  const twoRows = 'Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + 'Total: 2 tests in 1 file\n';
  const twoRowReport = parseDiscoveryListReport(twoRows);
  assert.deepEqual(twoRowReport.unparsed, []);
  assert.equal(twoRowReport.declaredTotal, 2);
  assert.deepEqual(assertDiscoveryComplete(twoRowReport.identities, { report: twoRowReport }), twoRowReport.identities, 'a consistent 2-row chrome+edge list is accepted');
  assert.throws(
    () => assertDiscoveryComplete(twoRowReport.identities, { report: { ...twoRowReport, declaredTotal: 3 } }),
    /declared 3 test\(s\) but parsed 2/,
    'a declared total above the parsed rows is refused, not collapsed',
  );
  // A listing row whose separators reached the parser mangled (a non-UTF8 console code page drops the
  // U+203A separator): the parsed chrome+edge pair still looks perfectly consistent and total, but the
  // RAW report carries the unclassifiable line, so the gate refuses the collapsed accepted set.
  const mangledList = 'Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + '  [edge] office-g0/xlsx-cycle.spec.ts:20:1 saves A1\n'
    + 'Total: 3 tests in 1 file\n';
  const mangled = parseDiscoveryListReport(mangledList);
  assert.equal(mangled.identities.length, 2);
  assert.deepEqual(mangled.unparsed, ['[edge] office-g0/xlsx-cycle.spec.ts:20:1 saves A1'], 'the mangled row is reported, never silently dropped');
  assert.equal(mangled.declaredTotal, 3);
  assert.equal(assertDiscoveryComplete(mangled.identities), mangled.identities, 'the parsed pair alone would pass every existing check');
  assert.throws(
    () => assertDiscoveryComplete(mangled.identities, { report: mangled }),
    /unparsed/,
    'an unparsed listing line cannot yield a false pass even when the parsed rows look exact',
  );
  // A missing Total line leaves declaredTotal null and is refused: cardinality is unverified.
  const noTotal = parseDiscoveryListReport('Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n');
  assert.equal(noTotal.declaredTotal, null);
  assert.throws(
    () => assertDiscoveryComplete(noTotal.identities, { report: noTotal }),
    /printed no Total line/,
    'a listing with no declared total is refused rather than trusted',
  );
  // F4 correction: a SECOND Total line is not valid list output. The preserved parser silently
  // overwrote declaredTotal, so 'Total: 3' followed by 'Total: 2' collapsed into an accepted 2-row
  // set. The corrected parser marks that cardinality ambiguous and the gate refuses it by name.
  const repeatedTotal = parseDiscoveryListReport('Listing tests:'+String.fromCharCode(10)
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1'+String.fromCharCode(10)
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1'+String.fromCharCode(10)
    + 'Total: 3 tests in 1 file'+String.fromCharCode(10)
    + 'Total: 2 tests in 1 file'+String.fromCharCode(10));
  assert.equal(repeatedTotal.ambiguousTotal, true, 'a repeated Total line is reported, not silently overwritten');
  assert.equal(repeatedTotal.declaredTotal, 3, 'the FIRST declared total is kept, never the collapsing later one');
  assert.throws(
    () => assertDiscoveryComplete(repeatedTotal.identities, { report: repeatedTotal }),
    /more than one Total line/,
    'a conflicting repeated total cannot collapse into a false pass',
  );
  // Cardinality still matches for the real spec shape: 2 tests x 2 projects = 4 rows, declared 4.
  const full = parseDiscoveryListReport('Listing tests:\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + '  [chrome] \u203a office-g0/xlsx-cycle.spec.ts:20:1 \u203a saves A1\n'
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:12:1 \u203a edits A1\n'
    + '  [edge] \u203a office-g0/xlsx-cycle.spec.ts:20:1 \u203a saves A1\n'
    + 'Total: 4 tests in 1 file\n');
  assert.equal(full.declaredTotal, 4);
  assert.deepEqual(assertDiscoveryComplete(full.identities, { report: full }), full.identities);
  // RESTORED (r8 correction): the r7 single-project negative that the preserved NEW accidentally
  // dropped. A one-project list must still be refused, exactly as the baseline asserted.
  assert.throws(
    () => assertDiscoveryComplete([{ project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' }]),
    /projects .* are not exactly|not total\/listed-consistent/,
  );
});

const specOf = (project, status, results) => ({
  file: 'office-g0/xlsx-cycle.spec.ts',
  title: 'edits A1',
  tests: [{ projectName: project, status, results }],
});
const suiteOf = (...specs) => ({ suites: [{ specs }] });
const realPass = () => [{ status: 'passed', retry: 0 }];
const bothProjects = (status, results) => suiteOf(specOf('chrome', status, results), specOf('edge', status, results));
const discovery = [
  { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' },
  { project: 'edge', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' },
];

test('report gate requires the exact slice, both projects, real passes and no extras', () => {
  const ok = summarizePlaywrightReport(bothProjects('expected', realPass()));
  assert.equal(assertReportProvesRealRun(ok, { discovery }), true);
  assert.throws(() => assertReportProvesRealRun(summarizePlaywrightReport({ suites: [] }), { discovery }), /zero tests/);
  assert.throws(() => assertReportProvesRealRun(ok, { discovery: discovery.slice(0, 1) }), /does not match discovery/);
  assert.throws(() => assertReportProvesRealRun(ok, { discovery: [...discovery, { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'extra' }] }), /does not match discovery/);
  assert.throws(() => assertReportProvesRealRun(summarizePlaywrightReport(bothProjects('skipped', [{ status: 'skipped', retry: 0 }])), { discovery }), /skipped/);
  assert.throws(() => assertReportProvesRealRun(summarizePlaywrightReport(bothProjects('flaky', [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }])), { discovery }), /retried/);
  // tests>0, passed=0, failed=0, skipped=0 can no longer pass the gate.
  assert.throws(() => assertReportProvesRealRun(summarizePlaywrightReport(bothProjects('expected', [])), { discovery }), /real passed result/);
  assert.throws(() => assertReportProvesRealRun(summarizePlaywrightReport(suiteOf(specOf('chrome', 'expected', realPass()))), { discovery }), /projects/);
  assert.throws(() => assertReportProvesRealRun(summarizePlaywrightReport(suiteOf({ file: 'office-g0/docx-cycle.spec.ts', title: 'x', tests: [{ projectName: 'chrome', status: 'expected', results: realPass() }] })), { discovery }), /outside the xlsx slice/);
  // Cardinality/duplicate negatives: a discovery list with a duplicate identity is refused, and a
  // report whose rows collapsed the same way is refused even though Set-equality alone would pass.
  const dupDiscovery = [...discovery, { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' }];
  assert.throws(() => assertReportProvesRealRun(ok, { discovery: dupDiscovery }), /duplicate identit/);
  assert.throws(() => assertReportProvesRealRun(ok, { discovery: [...discovery, { project: 'chrome', file: 'office-g0/xlsx-cycle.spec.ts', title: 'edits A1' }] }), /duplicate identit|cardinality/);
});

test('stopOwnedChild only proves cleanup when the owned tree kill is observed', async () => {
  if (process.platform !== 'win32') return;
  const fakeChild = (pid) => {
    const child = new EventEmitter();
    child.pid = pid;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => true;
    return child;
  };
  const child = fakeChild(4242);
  const stopping = stopOwnedChild(child, {
    timeoutMs: 50,
    killTree: async () => ({ attempted: true, ok: true, code: 0, signal: null, timedOut: false, error: null }),
  });
  child.emit('exit', 1, null);
  const proven = await stopping;
  assert.equal(proven.proven, true);
  assert.equal(proven.treeKill.code, 0);
  const unproven = await stopOwnedChild(fakeChild(4343), {
    timeoutMs: 50,
    killTree: async () => ({ attempted: true, ok: false, code: 1, signal: null, timedOut: false, error: 'access denied' }),
  });
  assert.equal(unproven.proven, false, 'a non-zero taskkill code is not tree proof');
  assert.match(unproven.note, /not proven/);
});

test('assertDistinctPorts refuses invalid or colliding lane ports', () => {
  assert.deepEqual(assertDistinctPorts(Object.assign({}, PORTS)), PORTS);
  assert.throws(() => assertDistinctPorts({ app: 5460, preview: 5460, engine: 5462 }), /must be distinct/);
  assert.throws(() => assertDistinctPorts({ app: 0, preview: 5461, engine: 5462 }), /invalid port/);
});

const ownedChild = (pid, { autoExit = null, signal = null } = {}) => {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = signal;
  child.stdout = null;
  child.stderr = null;
  child.kill = () => true;
  child.once('exit', (code) => { child.exitCode = code === null ? 1 : code; });
  // A REAL spawned child is a ref-counted process handle; model that ref ownership so production's
  // unref'd timers still fire under node:test. Released on exit (when a real handle would drop) or by
  // the suite sweep for a child a test intentionally leaves alive.
  const release = acquireChildHandle();
  child.dispose = release;
  child.once('exit', release);
  if (autoExit !== null) setTimeout(() => child.emit('exit', autoExit, null), 5);
  return child;
};

test('stopOwnedChild never coerces a signalled kill to exit 0 and never touches an exited PID', async () => {
  if (process.platform !== 'win32') return;
  const signalled = await stopOwnedChild(ownedChild(6060), {
    timeoutMs: 50,
    killTree: async () => ({ attempted: true, ok: false, code: null, signal: 'SIGKILL', timedOut: false, error: null }),
  });
  assert.equal(signalled.proven, false);
  assert.equal(signalled.treeKill.code, null, 'a signalled taskkill is never Number(null) === 0');
  assert.equal(signalled.parentExited, false, 'an unobserved kill does not prove the parent stopped');
  assert.equal(signalled.descendantProof, 'unknown');

  const dead = ownedChild(7070);
  dead.exitCode = 1;
  let kills = 0;
  const recycled = await stopOwnedChild(dead, {
    timeoutMs: 50,
    killTree: async () => { kills += 1; return { attempted: true, ok: true, code: 0, signal: null, timedOut: false, error: null }; },
  });
  assert.equal(kills, 0, 'no taskkill is sent to an already-exited recycled PID');
  assert.equal(recycled.proven, false, 'an unobserved already-exited parent does not prove descendants');
  assert.equal(recycled.parentExited, true, 'the owned parent itself is nevertheless confirmed stopped');
  assert.equal(recycled.descendantProof, 'unknown');
  assert.match(recycled.note, /already exited/);

  // The parent exit THIS run watched is still not descendant tree proof: no taskkill is sent to the
  // gone PID, the parent is recorded as stopped, and the descendant tree stays explicitly unknown.
  const watched = ownedChild(7171);
  watched.exitCode = 0;
  const observed = await stopOwnedChild(watched, {
    timeoutMs: 50, observedExit: true,
    killTree: async () => { kills += 1; return { attempted: true, ok: true, code: 0, signal: null, timedOut: false, error: null }; },
  });
  assert.equal(kills, 0, 'an already-exited owned parent is never taskkilled again');
  assert.equal(observed.proven, false, 'an observed parent exit alone is not descendant tree proof');
  assert.equal(observed.parentExited, true);
  assert.equal(observed.descendantProof, 'unknown');
  const noChild = await stopOwnedChild(null);
  assert.equal(noChild.proven, true);
  assert.equal(noChild.existed, false, 'no-child is distinct from already-exited-unknown');
  assert.equal(noChild.descendantProof, 'not-applicable');
});

test('waitForEngineIdentity rejects a death racing a stalled ping request or body', async () => {
  const stalledRequest = ownedChild(8181);
  const pending = waitForEngineIdentity({
    baseUrl: 'http://127.0.0.1:1', expected: { source: 's', lab: 'l' }, child: stalledRequest,
    timeoutMs: 2000, attemptMs: 1000, fetchImpl: () => new Promise(() => {}),
  });
  setTimeout(() => stalledRequest.emit('exit', 1, null), 10);
  await assert.rejects(pending, /stopped during/);

  const stalledBody = ownedChild(8282);
  const pendingBody = waitForEngineIdentity({
    baseUrl: 'http://127.0.0.1:1', expected: { source: 's', lab: 'l' }, child: stalledBody,
    timeoutMs: 2000, attemptMs: 1000,
    fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  });
  setTimeout(() => stalledBody.emit('exit', 1, null), 10);
  await assert.rejects(pendingBody, /stopped during/);

  const alreadyDead = ownedChild(8383);
  alreadyDead.signalCode = 'SIGTERM';
  await assert.rejects(() => waitForEngineIdentity({
    baseUrl: 'http://127.0.0.1:1', expected: { source: 's', lab: 'l' }, child: alreadyDead,
    timeoutMs: 100, fetchImpl: async () => { throw new Error('must not be called'); },
  }), /already stopped/);
});

test('runOwnedChild races a real deadline, bounds a hung kill and keeps a racing exit', async () => {
  let kills = 0;
  const neverExit = await runOwnedChild({
    command: 'node', args: [], timeoutMs: 20, cleanupBoundMs: 120,
    spawnImpl: () => ownedChild(5151),
    killImpl: async () => { kills += 1; return { attempted: true, ok: true, code: 0, signal: null, timedOut: false, error: null }; },
  });
  assert.equal(neverExit.timedOut, true);
  assert.equal(neverExit.cleanup.proven, false, 'without an observed exit the tree stays honestly unproven');
  if (process.platform === 'win32') assert.ok(kills >= 1, 'the owned tree kill was attempted');

  const started = Date.now();
  const hung = await runOwnedChild({
    command: 'node', args: [], timeoutMs: 20, cleanupBoundMs: 60,
    spawnImpl: () => ownedChild(5252),
    killImpl: () => new Promise(() => {}),
  });
  assert.equal(hung.timedOut, true);
  assert.equal(hung.cleanup.proven, false);
  assert.match(hung.cleanup.note, /bound|not proven/);
  assert.ok(Date.now() - started < 5000, 'a kill that never settles cannot hang the runner');

  const raced = await runOwnedChild({
    command: 'node', args: [], timeoutMs: 5000,
    spawnImpl: () => ownedChild(5353, { autoExit: 0 }),
    killImpl: async () => ({ attempted: true, ok: true, code: 0, signal: null, timedOut: false, error: null }),
  });
  assert.equal(raced.timedOut, false);
  assert.equal(raced.status, 0);
  assert.equal(raced.cleanup.parentExited, true, 'the owned parent is confirmed stopped');
  assert.equal(raced.cleanup.proven, false, 'a self-exited parent is never falsely called tree-clean');
  assert.equal(raced.cleanup.descendantProof, 'unknown');
});

test('an unconfirmed cleanup can never be erased by a later success', () => {
  const record = { ok: true, cleanup: [] };
  noteCleanupOutcome(record, 'playwright-discovery', { parentExited: false, proven: false, descendantProof: 'unknown', note: 'owned child not confirmed stopped' });
  assert.equal(record.ok, false, 'the cleanup failure is latched immediately');
  assert.deepEqual(record.descendantProof, ['playwright-discovery'], 'the unknown descendant proof is recorded, never hidden');
  record.ok = true; // simulate a later success assignment overwriting ok
  assert.equal(reconcileOk(record), false, 'the final ok cannot erase an unconfirmed cleanup');
  assert.equal(record.ok, false);
  const unknownButStopped = { ok: true, cleanup: [{ parentExited: true, proven: false, descendantProof: 'unknown' }] };
  assert.equal(reconcileOk(unknownButStopped), true, 'a confirmed-stopped parent keeps the run acceptable; its unknown tree is reported separately');
  const clean = { ok: true, cleanup: [{ parentExited: true, proven: true, descendantProof: 'proven' }] };
  assert.equal(reconcileOk(clean), true, 'a run whose owned trees were all proven stays ok');
});

test('runOwnedChild hands the live child to the cancellation seam at spawn and releases it after cleanup', async () => {
  const owned = new Set();
  const pending = runOwnedChild({
    command: 'node', args: [], timeoutMs: 0, cleanupBoundMs: 200,
    spawnImpl: () => ownedChild(9191, { autoExit: 20 }),
    killImpl: async () => ({ attempted: true, ok: false, code: null, signal: null, timedOut: false, error: 'no tree' }),
    onSpawn: (child) => owned.add(child),
    onSettled: (child) => owned.delete(child),
  });
  assert.equal(owned.size, 1, 'the cancellation owner can see the child the moment it is spawned');
  const result = await pending;
  assert.equal(owned.size, 0, 'ownership is released only after cleanup settled');
  assert.equal(result.cleanup.parentExited, true);
  assert.equal(result.cleanup.descendantProof, 'unknown');
});

test('runOwnedChild reports an immediate spawn failure with a structured cleanup and no exit event', async () => {
  let spawns = 0;
  await assert.rejects(
    () => runOwnedChild({ command: 'node', args: [], spawnImpl: () => { spawns += 1; throw new Error('ENOENT'); } }),
    (error) => {
      assert.match(error.message, /child failed to start: ENOENT/);
      assert.equal(error.cleanup.existed, false);
      assert.equal(error.cleanup.proven, false);
      assert.equal(error.cleanup.descendantProof, 'not-applicable');
      return true;
    },
  );
  assert.equal(spawns, 1);
});

test('waitForEngineIdentity bounds a hung ping even when the child never exits', async () => {
  const frozen = ownedChild(8484);
  const started = Date.now();
  await assert.rejects(() => waitForEngineIdentity({
    baseUrl: 'http://127.0.0.1:1', expected: { source: 's', lab: 'l' }, child: frozen,
    timeoutMs: 300, attemptMs: 50, fetchImpl: () => new Promise(() => {}),
  }), /never identified the intended source\/lab/);
  assert.ok(Date.now() - started < 5000, 'a fetch/body that ignores abort cannot hang the identity wait');
  frozen.emit('exit', 1, null);
});

test('a signal that lands during finalization is latched into the single structured result', () => {
  const record = { ok: true, primaryError: null, cleanup: [] };
  // finalize(null) has already started; the signal arrives while cleanup is in flight.
  assert.equal(record.ok, true);
  latchSignalFailure(record, 'terminated by SIGTERM');
  assert.equal(record.ok, false, 'the in-flight finalize must not persist an ok=true result');
  assert.equal(record.primaryError, 'terminated by SIGTERM');
  record.ok = true; // simulate a later assignment racing the latch
  assert.equal(reconcileOk(record), false, 'a signal failure can never be erased by a later success');
});

test('the production ownership hooks keep the live child until cleanup confirms it stopped', async () => {
  const owned = new Set();
  const pending = runOwnedChild({
    command: 'node', args: [], timeoutMs: 0, cleanupBoundMs: 200,
    spawnImpl: () => ownedChild(9393, { autoExit: 0 }),
    killImpl: async () => ({ attempted: true, ok: true, code: 0, signal: null, timedOut: false, error: null }),
    ...ownedChildHooks(owned),
  });
  assert.equal(owned.size, 1, 'main owns the live child from the moment it is spawned');
  const result = await pending;
  assert.equal(result.cleanup.parentExited, true, 'the owned parent is confirmed stopped');
  assert.equal(owned.size, 0, 'ownership is released only after a confirmed stop');
});

test('an unconfirmed cleanup keeps the live child owned so finalize still reaches it', async () => {
  const owned = new Set();
  const result = await runOwnedChild({
    command: 'node', args: [], timeoutMs: 10, cleanupBoundMs: 40,
    spawnImpl: () => ownedChild(9494),
    killImpl: () => new Promise(() => {}),
    ...ownedChildHooks(owned),
  });
  assert.equal(result.cleanup.parentExited, false, 'the cleanup bound expired without a confirmed stop');
  assert.equal(owned.size, 1, 'a still-live child is never released silently; finalize still owns it');
});

test('a thrown onSpawn never releases the live child it just registered', async () => {
  const owned = new Set();
  await assert.rejects(() => runOwnedChild({
    command: 'node', args: [], timeoutMs: 0,
    spawnImpl: () => ownedChild(9292),
    onSpawn: (child) => { ownedChildHooks(owned).onSpawn(child); throw new Error('registration observer failed'); },
    onSettled: (child) => { owned.delete(child); },
  }), /registration observer failed/);
  assert.equal(owned.size, 1, 'the live child stays in the cancellation owner when onSpawn threw');
});

test('a throwing result writer never yields success and never writes a success artifact', () => {
  const target = path.join(tmpRoot, 'persist-throw-result.json');
  const record = { ok: true, cleanup: [], primaryError: null };
  let writes = 0;
  const outcome = persistResultOnce({
    record, target, signalLatch: null,
    writer: () => { writes += 1; throw new Error('disk full'); },
  });
  assert.equal(writes, 1, 'the injected writer was attempted exactly once');
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.ok, false, 'a writer failure is never reported as success');
  assert.equal(outcome.exitCode, 1, 'a failed write sets the failure exit code');
  assert.match(record.primaryError, /result persistence failed: disk full/);
  assert.equal(fs.existsSync(target), false, 'no artifact is claimed when the write threw');
});

test('the writer latches on the successful write only and never writes a success twice', () => {
  const target = path.join(tmpRoot, 'persist-once-result.json');
  const record = { ok: true, cleanup: [], primaryError: null };
  let writes = 0;
  const writer = (file, bytes, opts) => { writes += 1; fs.writeFileSync(file, bytes, opts); };
  const first = persistResultOnce({ record, target, signalLatch: null, writer });
  assert.equal(first.wrote, true);
  assert.equal(first.ok, true);
  assert.equal(first.exitCode, 0);
  assert.equal(writes, 1);
  const second = persistResultOnce({ record, target, signalLatch: null, writer });
  assert.equal(second.wrote, false, 'an existing result is never written again');
  assert.equal(writes, 1, 'at most one success write, ever');
});

test('a preexisting result path is refused with a non-zero outcome and its bytes are preserved', () => {
  const target = path.join(tmpRoot, 'persist-collision-result.json');
  const priorBytes = '{"from":"a previous run"}' + String.fromCharCode(10);
  fs.writeFileSync(target, priorBytes, { flag: 'wx' });
  const record = { ok: true, cleanup: [], primaryError: null };
  let writes = 0;
  const outcome = persistResultOnce({
    record, target, signalLatch: null,
    writer: (file, bytes, opts) => { writes += 1; fs.writeFileSync(file, bytes, opts); },
  });
  assert.equal(writes, 0, 'a colliding result path is never written over');
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.ok, false, 'existence is not proof that THIS invocation wrote those bytes');
  assert.equal(outcome.exitCode, 1, 'a refused collision is a non-zero outcome');
  assert.equal(outcome.reason, 'exists');
  assert.match(record.primaryError, /result persistence refused: .* already exists/);
  assert.equal(fs.readFileSync(target, 'utf8'), priorBytes, 'the prior bytes are preserved untouched');
});

test('a signal rejection exits non-zero and keeps both errors even when the writer throws', () => {
  const record = { ok: true, cleanup: [], primaryError: null };
  const outcome = persistResultOnce({
    record, target: path.join(tmpRoot, 'persist-signal-throw.json'),
    signalLatch: 'terminated by SIGTERM',
    writer: () => { throw new Error('locked'); },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, 1, 'a signalled run is never exit 0, even when the write failed');
  assert.match(record.primaryError, /terminated by SIGTERM/);
  assert.match(record.primaryError, /result persistence failed: locked/);
});

// ---- Production-wiring tests: the seams main ACTUALLY calls, driven with injected I/O only ----

const fakeChild = (pid) => {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = null;
  child.stderr = null;
  child.kill = () => true;
  return child;
};

test('finalizeOwnedChildren stops every owned child under ONE bound and keeps the rest owned', async () => {
  const stopped = [];
  const entries = [
    { label: 'owned-child', child: fakeChild(1001) },
    { label: 'owned-child', child: fakeChild(1002) },
  ];
  const done = await finalizeOwnedChildren(entries, {
    boundMs: 1000,
    stop: async (child) => { stopped.push(child.pid); return { stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' }; },
  });
  assert.equal(done.complete, true);
  assert.deepEqual(stopped, [1001, 1002]);
  assert.equal(done.unconfirmed.length, 0);
  // A stop that never settles: the sweep returns unconfirmed WITHOUT awaiting it, and reports the
  // remaining children as NOT confirmed stopped (they stay owned).
  const hangEntry = { label: 'owned-child', child: fakeChild(1003) };
  const bounded = await finalizeOwnedChildren([hangEntry], { boundMs: 30, stop: () => new Promise(() => {}) });
  assert.equal(bounded.complete, false);
  assert.equal(bounded.settled.length, 0);
  assert.equal(bounded.unconfirmed.length, 1);
  assert.equal(bounded.unconfirmed[0].outcome.parentExited, false);
  assert.equal(bounded.unconfirmed[0].outcome.stopped, false);
  // A REJECTING stop is turned into a structured unconfirmed outcome, never thrown past the sweep.
  const rejecting = await finalizeOwnedChildren([{ label: 'owned-child', child: fakeChild(1004) }], {
    boundMs: 1000, stop: async () => { throw new Error('stop exploded'); },
  });
  assert.equal(rejecting.settled.length, 1);
  assert.equal(rejecting.settled[0].outcome.parentExited, false);
  assert.match(rejecting.settled[0].outcome.note, /stop threw: stop exploded/);
  // F8 (the regression): stop() is INVOKED for EVERY owned child up front. The first entry's stop
  // never settles; under the old sequential loop the later siblings were never reached and the bound
  // simply returned them as unconfirmed without ever calling stop. All three must be invoked, the bound
  // must report an honest incomplete sweep, and per-child identity must survive out-of-order settlement.
  const invoked = [];
  const multi = await finalizeOwnedChildren([
    { label: 'engine-host', child: fakeChild(1005) },
    { label: 'owned-child', child: fakeChild(1006) },
    { label: 'owned-child', child: fakeChild(1007) },
  ], {
    boundMs: 40,
    stop: (child) => {
      invoked.push(child.pid);
      if (child.pid === 1005) return new Promise(() => {});         // never confirms
      if (child.pid === 1006) return new Promise((ok) => setTimeout(() => ok({ stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' }), 20));
      return Promise.resolve({ stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' });
    },
  });
  assert.deepEqual(invoked, [1005, 1006, 1007], 'stop() is invoked for every owned child, in entry order, before the bound');
  assert.equal(multi.complete, false, 'the sweep is incomplete while one stop has not confirmed');
  assert.equal(multi.invoked, 3);
  assert.equal(multi.settled.length, 2, 'both confirming children settle');
  assert.deepEqual(multi.settled.map((e) => [e.label, e.child.pid]), [['owned-child', 1006], ['owned-child', 1007]], 'per-child identity and label survive out-of-order settlement');
  assert.deepEqual(multi.unconfirmed.map((e) => [e.label, e.child.pid]), [['engine-host', 1005]], 'only the never-confirming child is unconfirmed, and it stays owned');
  assert.equal(multi.unconfirmed[0].outcome.parentExited, false);
  // A sync-throwing stop must not stop the sweep from invoking every later sibling.
  const syncInvoked = [];
  const syncThrow = await finalizeOwnedChildren([
    { label: 'owned-child', child: fakeChild(1010) },
    { label: 'owned-child', child: fakeChild(1011) },
  ], {
    boundMs: 500,
    stop: (child) => { syncInvoked.push(child.pid); if (child.pid === 1010) throw new Error('sync stop exploded'); return { stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' }; },
  });
  assert.deepEqual(syncInvoked, [1010, 1011], 'a sync-throwing stop does not skip its later siblings');
  assert.equal(syncThrow.complete, true);
  assert.match(syncThrow.settled[0].outcome.note, /stop threw: sync stop exploded/);
  assert.equal(syncThrow.settled[1].outcome.parentExited, true, 'the later sibling keeps its own confirmed outcome');
});

test('createRunFinalizer finalizes and persists ONCE through the production wiring', async () => {
  const record = { ok: true, primaryError: null, cleanup: [] };
  const ownedChildren = new Set();
  const child = fakeChild(2001);
  ownedChildren.add(child);
  const writes = [];
  const closed = [];
  const finalizer = createRunFinalizer({
    record,
    resultPath: path.join(tmpRoot, 'seam-result.json'),
    ownedChildren,
    getServer: () => ({ close: () => { closed.push('server'); }, records: () => ['r'] }),
    getEngineChild: () => null,
    persist: ({ record: rec, target, signalLatch }) => {
      writes.push({ target, signalLatch });
      return { wrote: true, error: null, ok: rec.ok, exitCode: rec.ok ? 0 : 1, reason: null };
    },
    stop: async () => ({ stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' }),
    close: async () => { closed.push('closeWithin'); return { proven: true, error: null }; },
    writeStderr: () => {},
    processRef: { on() {}, removeListener() {}, exitCode: null },
    exit: () => {},
  });
  const first = await finalizer.finalize(null);
  const second = await finalizer.finalize(null);
  assert.equal(writes.length, 1, 'finalize persists exactly once');
  assert.equal(first, second, 'finalize is memoized: the signal path rejoins the same promise');
  assert.equal(record.resultCommitted, true, 'the commit boundary is recorded after the write');
  assert.equal(ownedChildren.size, 0, 'a confirmed-stopped child is released');
  assert.ok(closed.includes('closeWithin'), 'the lab server is closed through the bounded close');
  assert.deepEqual(record.records, ['r']);
});

test('an unconfirmed sweep result keeps the live child owned after finalize', async () => {
  const record = { ok: true, primaryError: null, cleanup: [] };
  const ownedChildren = new Set();
  const live = fakeChild(3001);
  ownedChildren.add(live);
  const finalizer = createRunFinalizer({
    record, resultPath: path.join(tmpRoot, 'seam-keep.json'), ownedChildren,
    getServer: () => null, getEngineChild: () => null,
    cleanupBoundMs: 30,
    persist: () => ({ wrote: true, error: null, ok: false, exitCode: 1, reason: null }),
    stop: () => new Promise(() => {}),   // never confirms the stop
    close: async () => ({ proven: true, error: null }),
    writeStderr: () => {},
    processRef: { on() {}, removeListener() {}, exitCode: null },
    exit: () => {},
  });
  await finalizer.finalize(null);
  assert.equal(record.ok, false, 'an unconfirmed cleanup fails the run closed');
  assert.equal(ownedChildren.has(live), true, 'a still-live child is NEVER forgotten by finalize (F1)');
});

test('the engine host is spawned as an owned child through the production seam', () => {
  const ownedChildren = new Set();
  let spawned = 0;
  let exitSeen = 0;
  const child = startOwnedEngineChild({
    command: 'node', args: ['engine-host.mts'], options: {},
    spawnImpl: () => { spawned += 1; return fakeChild(4001); },
    ownedChildren,
    onExit: () => { exitSeen += 1; },
  });
  assert.equal(spawned, 1);
  assert.equal(ownedChildren.has(child), true, 'the engine child is registered in the owner set at spawn');
  assert.equal(child.pid, 4001);
});

test('a signal that lands AFTER the commit boundary is recorded separately and never flips the file', async () => {
  const record = { ok: true, primaryError: null, cleanup: [] };
  const writes = [];
  const exits = [];
  const finalizer = createRunFinalizer({
    record, resultPath: path.join(tmpRoot, 'seam-postcommit.json'), ownedChildren: new Set(),
    getServer: () => null, getEngineChild: () => null,
    persist: ({ record: rec, signalLatch }) => { writes.push(signalLatch); return { wrote: true, error: null, ok: rec.ok, exitCode: rec.ok ? 0 : 1, reason: null }; },
    stop: async () => ({ stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' }),
    close: async () => ({ proven: true, error: null }),
    writeStderr: () => {},
    processRef: { on() {}, removeListener() {}, exitCode: null },
    exit: (code) => { exits.push(code); },
  });
  await finalizer.finalize(null);         // commits the artifact (resultCommitted true)
  assert.equal(record.resultCommitted, true);
  const writesBefore = writes.length;
  finalizer.onSignal('SIGTERM');          // a signal AFTER the commit
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(record.postCommitSignal, 'terminated by SIGTERM', 'the late signal is a separate diagnostic');
  assert.equal(writes.length, writesBefore, 'the committed artifact is never rewritten by a late signal');
  assert.deepEqual(exits, [1], 'a late signal still exits non-zero');
});

test('a signal finalizer invokes stop() for every owned child before it exits, even when an earlier stop never settles', async () => {
  const record = { ok: true, primaryError: null, cleanup: [] };
  const ownedChildren = new Set();
  const first = fakeChild(5001);
  const second = fakeChild(5002);
  ownedChildren.add(first);
  ownedChildren.add(second);
  const invoked = [];
  const exits = [];
  const finalizer = createRunFinalizer({
    record, resultPath: path.join(tmpRoot, 'seam-signal-children.json'), ownedChildren,
    getServer: () => null, getEngineChild: () => null,
    cleanupBoundMs: 40,
    persist: () => ({ wrote: true, error: null, ok: false, exitCode: 1, reason: null }),
    stop: (child) => {
      invoked.push(child.pid);
      if (child.pid === 5001) return new Promise(() => {});   // the first stop never settles
      return Promise.resolve({ stopped: true, exited: true, parentExited: true, proven: false, descendantProof: 'unknown' });
    },
    close: async () => ({ proven: true, error: null }),
    writeStderr: () => {},
    processRef: { on() {}, removeListener() {}, exitCode: null },
    exit: (code) => { exits.push(code); },
  });
  finalizer.onSignal('SIGTERM');
  await new Promise((ok) => setTimeout(ok, 150));
  assert.deepEqual(invoked, [5001, 5002], 'BOTH owned children get stop() invoked before the bound/exit, not just the one the bound would have waited on');
  assert.equal(record.ok, false, 'the signal latches a fail-closed result');
  assert.equal(record.signalTermination, 'terminated by SIGTERM');
  assert.deepEqual(exits, [1], 'the signal path still exits non-zero exactly once');
  assert.equal(ownedChildren.has(second), false, 'the child whose stop WAS confirmed is released');
  assert.equal(ownedChildren.has(first), true, 'the never-confirming child is NEVER released by finalize');
  assert.equal(record.cleanup.some((entry) => entry.label === 'owned-child' && entry.parentExited === true), true, 'the confirmed child keeps its per-child identity');
  assert.equal(record.cleanup.some((entry) => entry.label === 'owned-child' && entry.parentExited === false), true, 'the unconfirmed child is recorded fail-closed under its own label');
});
