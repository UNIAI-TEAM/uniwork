// UNI-667 XLSX r2-r17: focused lifecycle tests for the Orca-bound XLSX hold launcher.
// Holder correctionONE/r2 over the frozen initial/r1 pair. Keeps all 37 prior predicates and
// adds the late partial-listen REJECTION disposal cases (L5, A11, A12) and the real
// holdWithSignals deadline cases (H4 unconfirmed nonzero exit, H5 confirmed, H6 throwing
// cleanup), plus a strengthened A2 that asserts the actual close of the lab it opened.
//
// TEXT PROPOSAL ONLY (Terra). Main applies; Grok executes. These tests run against
// the REAL orchestration in scripts/office-g0/hold-xlsx-lab.mjs with INJECTED
// process/server/fetch/spawn controls: no port is bound, no engine is spawned, no
// Playwright, no browser, no native process kill. Every case asserts on observed
// behaviour of the production helper, never on a local re-implementation of it.
//
// Run with the prepared Node22:
//   node --test scripts/office-g0/hold-xlsx-lab.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_MAX_HOLD_MS,
  HoldError,
  HOLD_FLAGS,
  HOLD_ROLE,
  HOLD_SIGNALS,
  XLSX_ENGINE_OPERATIONS,
  acquireWithBound,
  assertEngineRoutes,
  buildEngineBindings,
  buildReceipt,
  createCancellationLatch,
  createHoldShutdown,
  createHoldSignalGuard,
  createOwnedRegistry,
  fixturePinOk,
  holdReceiptPath,
  holdWithSignals,
  persistReceipt,
  requiredRouteNames,
  resolveHoldArgs,
  resolveHoldPlan,
  runHold,
  startHoldSession,
  waitForHoldDeadline,
} from './hold-xlsx-lab.mjs';
import { ENGINE_OPERATIONS, createEngineProxy } from '../../e2e/office-g0/lab-engine.mjs';
import { PORTS, SOURCE_PIN, createXlsxEngineHandlers } from './run-xlsx-cycle.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'office-g0-xlsx-hold-'));
test.after(() => {
  // A leaked owned descriptor makes this throw on Windows, so it doubles as the
  // "owned logs/file descriptors close on startup failure" assertion.
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

let seq = 0;
const freshDir = (label) => {
  const dir = path.join(tmpRoot, label + '-' + ++seq);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const expectCode = (code, run) => {
  assert.throws(run, (error) => {
    assert.ok(error instanceof HoldError, 'expected a HoldError, got ' + error);
    assert.equal(error.code, code);
    return true;
  });
};
const rejectsCode = (code, run) =>
  assert.rejects(run, (error) => {
    assert.ok(error instanceof HoldError, 'expected a HoldError, got ' + error);
    assert.equal(error.code, code);
    return true;
  });

/** Poll a condition of the REAL orchestration without owning its internals. */
const waitFor = async (predicate, { timeoutMs = 3000, stepMs = 5 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error('waitFor timed out');
};

/**
 * A fake process that records the guard signal listeners and records any re-raise.
 * No real signal is delivered and no real process is killed.
 */
const makeGuardProcess = (pid) => {
  const handlers = new Map();
  const killed = [];
  const output = [];
  return {
    pid,
    exitCode: 0,
    handlers,
    killed,
    output,
    stdout: { write: (line) => { output.push(String(line)); } },
    on: (event, handler) => { handlers.set(event, handler); },
    removeListener: (event) => { handlers.delete(event); },
    kill: (target, signal) => { killed.push({ pid: target, signal }); return true; },
    exit: () => { throw new Error('exit must not be used when kill succeeds'); },
  };
};

// The real engine route table engine-host.mts createHost publishes, restricted to
// what the accepted XLSX bridge can bind plus the shared routes.
const REAL_ROUTES = Object.freeze([
  '/engine/ping',
  '/engine/read-file',
  '/engine/xlsx-open',
  '/engine/xlsx-open-blank',
  '/engine/xlsx-recalc',
  '/engine/xlsx-read-range',
  '/engine/xlsx-read-formulas',
  '/engine/xlsx-save',
  '/engine/xlsx-close',
  '/engine/xlsx-is-dirty',
  '/engine/session-close',
]);

/** A fake owned child: exactly the surface waitForEngineIdentity and stop read. */
const makeChild = (pid) => ({
  pid,
  exitCode: null,
  signalCode: null,
  listeners: new Map(),
  once(event, handler) { this.listeners.set(event, handler); return this; },
  on(event, handler) { this.listeners.set(event, handler); return this; },
  removeListener(event) { this.listeners.delete(event); return this; },
  kill() { return true; },
});

const cleanOutcome = (pid) => ({
  stopped: true, existed: true, exited: true, parentExited: true, proven: true,
  descendantProof: 'proven', forced: false, exitCode: 0, signal: null, treeKill: { attempted: true, ok: true, timedOut: false },
  note: 'owned child tree reported a successful bounded taskkill plus an observed owned-child exit', pid,
});
const unprovenOutcome = (pid) => ({
  stopped: false, existed: true, exited: false, parentExited: false, proven: false,
  descendantProof: 'unknown', forced: false, exitCode: null, signal: null, treeKill: null,
  note: 'child tree exit not proven: no bounded successful taskkill and no observed owned-child exit', pid,
});

/** A plan whose paths all live under this test own temp root. */
const makePlan = (extra = {}) => {
  const root = freshDir('plan');
  const runtimeDir = path.join(root, 'run-runtime');
  const engineHost = path.join(root, 'engine-host.mts');
  const tsxCli = path.join(root, 'tsx-cli.mjs');
  fs.writeFileSync(engineHost, '// engine host placeholder\n', 'utf8');
  fs.writeFileSync(tsxCli, '// tsx cli placeholder\n', 'utf8');
  // A manifest that genuinely satisfies the accepted assertManifest contract: the
  // immutable pin, exactly one app, and both untouched flags true.
  const manifestBytes = Buffer.from(JSON.stringify({
    pinnedSourceCommit: SOURCE_PIN,
    sourceUntouched: true,
    appSourcesUntouched: true,
    apps: { sheets: { entry: 'index.html' } },
  }), 'utf8');
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  return {
    mode: 'hold',
    workspaceRoot: tmpRoot,
    candidate: root,
    builds: path.join(root, 'builds'),
    source: path.join(root, 'source'),
    fixtures: path.join(root, 'fixtures'),
    manifest: path.join(root, 'manifest.json'),
    fixture: path.join(root, 'g0-compatibility-edit.xlsx'),
    sidecar: path.join(root, 'xlsx-sidecar.exe'),
    tsxCli,
    engineHost,
    labServer: path.join(root, 'lab-server.mjs'),
    config: path.join(root, 'playwright.office-g0.xlsx.config.ts'),
    spec: path.join(root, 'xlsx-cycle.spec.ts'),
    buildEntry: path.join(root, 'builds', 'sheets', 'index.html'),
    prefix: path.join(root, 'evidence'),
    runtimeDir,
    artifactsDir: path.join(root, 'evidence-artifacts'),
    tmpDir: path.join(runtimeDir, 'tmp'),
    engineLog: path.join(root, 'evidence-engine.txt'),
    labDir: runtimeDir,
    engineLabDir: runtimeDir,
    engineBaseUrl: 'http://127.0.0.1:' + PORTS.engine,
    engineArgs: [tsxCli, engineHost, '--source', path.join(root, 'source'), '--lab', runtimeDir, '--port', String(PORTS.engine)],
    ports: { ...PORTS },
    expectedManifestSha256: manifestSha256,
    manifestBytes,
    maxHoldMs: 50,
    ...extra,
  };
};

/** Everything startHoldSession needs that must not touch the real process/disk. */
const baseDeps = (plan, overrides = {}) => {
  const written = [];
  const closed = [];
  const stopped = [];
  const labCalls = [];
  const deps = {
    env: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: { ok: true, source: plan.source, lab: plan.labDir, routes: REAL_ROUTES } }) }),
    spawnImpl: () => makeChild(4242),
    readBytes: (target) => (target === plan.manifest ? plan.manifestBytes : Buffer.from('unused')),
    exists: () => true,
    fixturePinOk: () => true,
    mkdir: () => undefined,
    openLog: () => 777,
    closeLog: (fd) => { closed.push(fd); },
    now: () => '2026-09-19T00:00:00.000Z',
    assertPortsFree: async () => [],
    persist: (prefix, receipt, d) => { written.push({ prefix, receipt, deps: d }); return holdReceiptPath(prefix); },
    stopChild: async (child) => { stopped.push(child); return cleanOutcome(child && child.pid); },
    closeServer: async () => ({ proven: true, error: null }),
    labModule: {
      createLabServer: (options) => {
        labCalls.push(options);
        return {
          listen: async () => ({ app: 'http://127.0.0.1:' + options.port, preview: 'http://127.0.0.1:' + options.previewPort }),
          close: async () => undefined,
        };
      },
    },
  };
  return Object.assign(deps, overrides, {
    written,
    closed,
    stopped,
    labCalls,
  });
};

// --- CLI surface ---------------------------------------------------------------

test('P1 --execute is refused outright and the hold surface is named', () => {
  expectCode('execute_refused', () => resolveHoldArgs(['--execute']));
  assert.deepEqual([...HOLD_FLAGS].sort(), [
    'builds', 'candidate', 'expected-manifest-sha256', 'fixtures', 'manifest', 'max-hold-ms', 'prefix', 'source', 'workspace',
  ]);
});

test('P2 an unknown flag is refused by name', () => {
  expectCode('unsupported_flag', () => resolveHoldArgs(['--candidate', 'c', '--bogus', '1']));
});

test('P3 --max-hold-ms validates and defaults to the bounded four hours', () => {
  expectCode('invalid_max_hold', () => resolveHoldArgs(['--candidate', 'c', '--max-hold-ms', '0']));
  expectCode('invalid_max_hold', () => resolveHoldArgs(['--candidate', 'c', '--max-hold-ms', 'nope']));
  const args = ['--candidate', 'c', '--builds', 'b', '--manifest', 'm', '--source', 's', '--fixtures', 'f', '--prefix', 'p'];
  const parsed = resolveHoldArgs(args, {}, {});
  assert.equal(parsed.mode, 'hold');
  assert.equal(parsed.maxHoldMs, DEFAULT_MAX_HOLD_MS);
});

// --- Route proof and binding ---------------------------------------------------

test('B1 the real host route table satisfies the required XLSX set', () => {
  const proof = assertEngineRoutes({ routes: REAL_ROUTES });
  assert.deepEqual(proof.required, requiredRouteNames());
  assert.deepEqual(proof.required, [
    '/engine/xlsx-open',
    '/engine/xlsx-read-range',
    '/engine/xlsx-read-formulas',
    '/engine/xlsx-recalc',
    '/engine/xlsx-save',
    '/engine/xlsx-close',
  ]);
});

test('B2 a ping with no routes list or a missing route fails by name', () => {
  expectCode('engine_routes_missing', () => assertEngineRoutes({ source: 'S', lab: 'L' }));
  expectCode('engine_routes_incomplete', () => assertEngineRoutes({ routes: ['/engine/xlsx-open', '/engine/xlsx-recalc'] }));
  // A host that dropped a read route is refused by name too: the grid cannot populate without it.
  expectCode('engine_routes_incomplete', () => assertEngineRoutes({
    routes: ['/engine/xlsx-open', '/engine/xlsx-recalc', '/engine/xlsx-save', '/engine/xlsx-read-range'],
  }));
});

test('B3 the real createXlsxEngineHandlers map binds every operation and stays on the allowlist', () => {
  const handlers = createXlsxEngineHandlers({ baseUrl: 'http://127.0.0.1:' + PORTS.engine, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }) });
  const bindings = buildEngineBindings({ ping: { routes: REAL_ROUTES }, handlers });
  assert.deepEqual(bindings.operations, [...XLSX_ENGINE_OPERATIONS].sort());
  assert.equal(bindings.allowlisted.includes('xlsx-open'), true);
  assert.equal(ENGINE_OPERATIONS.includes('xlsx-open'), true);
  // The two read bindings are really on the shared allowlist, and the real proxy exposes every
  // bound XLSX read operation instead of leaving it to fail as engine_unsupported later.
  assert.equal(bindings.allowlisted.includes('xlsx-read-range'), true);
  assert.equal(bindings.allowlisted.includes('xlsx-read-formulas'), true);
  const proxy = createEngineProxy({ handlers });
  for (const operation of XLSX_ENGINE_OPERATIONS) {
    assert.equal(proxy.has(operation), true, operation + ' must be bound on the real proxy');
  }
});

test('B3b an operation outside the allowlist stays an unknown-operation refusal', async () => {
  // The lab proxy rejects a name it does not know before any handler runs, and reports a bound
  // operation the bridge never supplied as a named engine_unsupported - never an empty success.
  const handlers = createXlsxEngineHandlers({ baseUrl: 'http://127.0.0.1:' + PORTS.engine, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }) });
  const proxy = createEngineProxy({ handlers });
  await assert.rejects(
    () => proxy.call('xlsx-not-a-real-operation', {}),
    (error) => error.code === 'unknown_engine_operation',
    'an unlisted operation is refused by name',
  );
  await assert.rejects(
    () => proxy.call('pptx-txn', {}),
    (error) => error.code === 'engine_unsupported',
    'an allowlisted but unbound operation is a named unsupported refusal',
  );
});

test('B4 a handler outside the shared allowlist is refused by name', () => {
  expectCode('engine_handlers_unpermitted', () => buildEngineBindings({
    ping: { routes: REAL_ROUTES },
    handlers: { 'xlsx-open': () => {}, 'xlsx-recalc': () => {}, 'xlsx-save': () => {}, 'pptx-open': () => {} },
  }));
});

test('B5 an incomplete bridge is refused by name', () => {
  expectCode('engine_handlers_incomplete', () => buildEngineBindings({
    ping: { routes: REAL_ROUTES },
    handlers: { 'xlsx-open': () => {}, 'xlsx-recalc': () => {} },
  }));
});

test('B6 the fixture pin rejects bytes that are not the pinned fixture', () => {
  assert.equal(fixturePinOk(Buffer.from('not-the-fixture')), false);
  assert.equal(fixturePinOk(null), false);
});

// --- Shared root / runner plan -------------------------------------------------

test('T1 the accepted plan gives the engine lab and the lab server labDir ONE root', () => {
  const workspace = freshDir('ws');
  fs.mkdirSync(path.join(workspace, '.uniwork-dev'), { recursive: true });
  const candidate = path.join(workspace, 'candidate');
  const e2e = path.join(candidate, 'e2e', 'office-g0');
  const e2eRoot = path.join(candidate, 'e2e');
  const source = path.join(workspace, 'bootstrap-source');
  const builds = path.join(workspace, 'builds');
  const fixtures = path.join(workspace, 'fixtures');
  for (const dir of [e2e, path.join(builds, 'sheets'), path.join(source, 'node_modules', 'tsx', 'dist'), path.join(source, 'apps', 'sheets', 'native', 'xlsx-engine', 'target', 'release'), fixtures]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const write = (target, body) => fs.writeFileSync(target, body, 'utf8');
  write(path.join(e2e, 'xlsx-cycle.spec.ts'), '// spec\n');
  write(path.join(e2eRoot, 'playwright.office-g0.xlsx.config.ts'), '// config\n');
  write(path.join(e2e, 'lab-server.mjs'), '// lab server\n');
  write(path.join(e2e, 'engine-host.mts'), '// engine host\n');
  write(path.join(source, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '// tsx\n');
  write(path.join(source, 'apps', 'sheets', 'native', 'xlsx-engine', 'target', 'release', 'xlsx-sidecar.exe'), 'sidecar\n');
  write(path.join(fixtures, 'g0-compatibility-edit.xlsx'), 'fixture\n');
  write(path.join(builds, 'sheets', 'index.html'), '<!doctype html>\n');
  const manifestPath = path.join(builds, 'host-build-manifest.json');
  write(manifestPath, JSON.stringify({
    pinnedSourceCommit: SOURCE_PIN,
    sourceUntouched: true,
    appSourcesUntouched: true,
    apps: { sheets: { entry: 'index.html' } },
  }));
  const args = resolveHoldArgs([
    '--candidate', candidate,
    '--builds', builds,
    '--manifest', manifestPath,
    '--source', source,
    '--fixtures', fixtures,
    '--prefix', path.join(workspace, 'evidence-fresh'),
    '--workspace', workspace,
  ], {}, {});
  const plan = resolveHoldPlan(args);
  const labIndex = plan.engineArgs.indexOf('--lab');
  assert.equal(plan.engineArgs[labIndex + 1], plan.labDir);
  assert.equal(plan.engineLabDir, plan.labDir);
  assert.equal(plan.labDir, plan.prefix + '-runtime');
  assert.equal(plan.ports.app, 5460);
  assert.equal(plan.ports.preview, 5461);
  assert.equal(plan.ports.engine, 5462);
});

// --- Latch and registry --------------------------------------------------------

test('L1 the latch latches exactly once and stays cancelled', () => {
  const latch = createCancellationLatch();
  assert.equal(latch.cancelled, false);
  assert.equal(latch.cancel('first'), 'first');
  assert.equal(latch.cancel('second'), 'first');
  assert.equal(latch.cancelled, true);
  assert.equal(latch.reason(), 'first');
});

test('L2 cleanup reads ownership at cleanup time, not construction time', async () => {
  const registry = createOwnedRegistry();
  const child = makeChild(9001);
  const shutdown = createHoldShutdown({ registry, deps: { stopChild: async (c) => cleanOutcome(c.pid) } });
  registry.track(child); // tracked AFTER the shutdown object existed
  const result = await shutdown.run();
  assert.equal(result.ownedCount, 1);
  assert.equal(result.invoked, 1);
  assert.equal(result.stopped, true);
});

test('L3 acquireWithBound bounds an unsettled acquisition, honours cancellation and stays owned', async () => {
  assert.equal(await acquireWithBound(Promise.resolve('ok'), { boundMs: 50 }), 'ok');
  await assert.rejects(acquireWithBound(new Promise(() => {}), { boundMs: 30 }), /did not settle/);
  const latch = createCancellationLatch();
  const cancelled = acquireWithBound(new Promise(() => {}), { latch, boundMs: 5000 });
  setTimeout(() => latch.cancel('SIGTERM'), 10);
  await assert.rejects(cancelled, /cancelled during acquisition/);
  // A promise that completes AFTER the bound is still the SAME object the caller owns,
  // which is exactly what lets cleanup close a socket acquired later.
  let resolveLate = null;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  await assert.rejects(acquireWithBound(late, { boundMs: 20 }), /did not settle/);
  resolveLate('late');
  assert.equal(await late, 'late');
});

test('L4 a listen that settles after the cleanup bound is disposed as a late acquisition', async () => {
  let resolveListen = null;
  let closes = 0;
  const shutdown = createHoldShutdown({
    getServer: () => ({ close: async () => { closes += 1; } }),
    getListenPromise: () => new Promise((resolve) => { resolveListen = resolve; }),
    deps: { listenAwaitMs: 40, closeServer: async (server) => { await server.close(); return { proven: true, error: null }; } },
  });
  const result = await shutdown.run();
  assert.equal(result.listenSettled, false);
  assert.equal(result.stopped, false);
  assert.ok(result.lateDisposal, 'the unresolved acquisition must stay owned');
  const duringCleanup = closes;
  resolveListen({ app: 'a', preview: 'p' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(closes, duringCleanup + 1, 'the late-acquired socket was disposed after the bounded cleanup returned');
});

test('L5 a listen that REJECTS after the cleanup bound still disposes the registered server', async () => {
  let rejectListen = null;
  let closes = 0;
  const server = { close: async () => { closes += 1; } };
  const shutdown = createHoldShutdown({
    getServer: () => server,
    getListenPromise: () => new Promise((resolve, reject) => { rejectListen = reject; }),
    deps: { listenAwaitMs: 40, closeServer: async (s) => { await s.close(); return { proven: true, error: null }; } },
  });
  const result = await shutdown.run();
  assert.equal(result.listenSettled, false, 'the acquisition barrier is reported unconfirmed');
  assert.equal(result.stopped, false, 'an unsettled acquisition is never described as a clean stop');
  assert.ok(result.lateDisposal, 'the unresolved acquisition must stay owned');
  const duringCleanup = closes;
  // A sequential lab-server listen acquires the app socket before it can reject on the
  // preview socket, so this rejection follows a REAL partial acquisition.
  rejectListen(new Error('preview socket refused'));
  const late = await result.lateDisposal;
  assert.equal(late.rejected, true, 'a rejection must be recorded as a rejection');
  assert.equal(late.settled, true);
  assert.equal(late.acquired, 'partial', 'a rejecting sequential listen had already acquired a socket');
  assert.equal(late.disposed, true, 'the partially acquired server must actually be closed');
  assert.match(late.note, /partial/);
  assert.ok(closes > duringCleanup, 'the registered server was disposed after the bounded cleanup returned');
});

// --- Shutdown ------------------------------------------------------------------

test('S1 a confirmed stop is clean and reports no unproven child', async () => {
  const child = makeChild(1001);
  const shutdown = createHoldShutdown({
    ownedChildren: new Set([child]),
    deps: { stopChild: async (c) => cleanOutcome(c.pid), closeServer: async () => ({ proven: true, error: null }) },
  });
  const result = await shutdown.run();
  assert.equal(result.stopped, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unproven, []);
});

test('S2 an unconfirmed stop is never clean and never fakes descendant proof', async () => {
  const child = makeChild(1002);
  let stopCalls = 0;
  const shutdown = createHoldShutdown({
    ownedChildren: new Set([child]),
    deps: { stopChild: async (c) => { stopCalls += 1; return unprovenOutcome(c.pid); } },
  });
  const result = await shutdown.run();
  assert.equal(stopCalls, 1);
  assert.equal(result.stopped, false);
  assert.equal(result.ok, false);
  assert.equal(result.unproven.length, 1);
  assert.equal(result.unproven[0].parentExited, false);
  assert.equal(result.unproven[0].descendantProof, 'unknown');
});

test('S3 a failing server close is surfaced, not swallowed', async () => {
  const shutdown = createHoldShutdown({
    getServer: () => ({ close: async () => undefined }),
    deps: { closeServer: async () => ({ proven: false, error: 'close exceeded 5000ms' }) },
  });
  const result = await shutdown.run();
  assert.equal(result.serverClosed, false);
  assert.equal(result.stopped, false);
  assert.match(result.errors.join(' '), /close not proven/);
});

test('S4 a late listen is awaited and its socket closed before cleanup decides', async () => {
  let resolveListen = null;
  const listen = new Promise((resolve) => { resolveListen = resolve; });
  let closes = 0;
  const shutdown = createHoldShutdown({
    getServer: () => ({ close: async () => { closes += 1; } }),
    getListenPromise: () => listen,
    deps: { closeServer: async (server) => { await server.close(); return { proven: true, error: null }; } },
  });
  const running = shutdown.run();
  // The listen completes AFTER cleanup was requested: the sequential second socket
  // must still be closed rather than hidden behind a memoized empty shutdown.
  setTimeout(() => resolveListen(), 10);
  const result = await running;
  assert.equal(closes, 1);
  assert.equal(result.listenSettled, true);
  assert.equal(result.serverClosed, true);
});

test('S5 a listen that never settles is reported unconfirmed and bounded', async () => {
  const shutdown = createHoldShutdown({
    getServer: () => ({ close: async () => undefined }),
    getListenPromise: () => new Promise(() => {}),
    deps: { listenAwaitMs: 40, closeServer: async () => ({ proven: true, error: null }) },
  });
  const result = await shutdown.run();
  assert.equal(result.listenSettled, false);
  assert.equal(result.stopped, false);
  assert.match(result.errors.join(' '), /did not settle/);
});

// --- Session acquisition -------------------------------------------------------

test('A1 a successful start wires the real shared root, one owned child and a ready receipt', async () => {
  const plan = makePlan();
  const deps = baseDeps(plan);
  const session = await startHoldSession(plan, deps);
  const options = deps.labCalls[0];
  assert.deepEqual(Object.keys(options.engineHandlers).sort(), [...XLSX_ENGINE_OPERATIONS].sort());
  assert.equal(options.labDir, plan.engineLabDir);
  assert.equal(options.labDir, plan.engineArgs[plan.engineArgs.indexOf('--lab') + 1]);
  assert.equal(options.engineBaseUrl, plan.engineBaseUrl);
  assert.equal(deps.stopped.length, 0);
  assert.equal(deps.written.length, 1);
  assert.equal(session.record.enginePid, 4242);
  const receipt = session.receipt;
  assert.equal(receipt.role, HOLD_ROLE);
  assert.equal(receipt.ownedPid, 4242);
  assert.equal(receipt.sharedRuntimeRoot, plan.labDir);
  assert.equal(receipt.urls.engine, plan.engineBaseUrl);
  assert.equal(receipt.sourcePin, SOURCE_PIN);
  assert.deepEqual(receipt.engine.boundOperations, [...XLSX_ENGINE_OPERATIONS].sort());
  assert.equal(receipt.orca.runnerStartedPlaywright, false);
  assert.equal(receipt.orca.cycleMainCalled, false);
  assert.equal(receipt.orca.finalizeCycleCalled, false);
  assert.equal(receipt.hashes.length, 9);
});

test('A2 a partial listen failure closes the lab it opened and starts no child', async () => {
  const plan = makePlan();
  let closes = 0;
  let created = 0;
  const deps = baseDeps(plan, {
    listenAwaitMs: 40,
    labModule: {
      createLabServer: () => {
        created += 1;
        return {
          listen: async () => { throw new Error('preview socket refused'); },
          close: async () => { closes += 1; },
        };
      },
    },
    closeServer: async (server) => { await server.close(); return { proven: true, error: null }; },
  });
  const error = await startHoldSession(plan, deps).then(() => null, (e) => e);
  assert.match(String(error && error.message), /preview socket refused/);
  assert.equal(created, 1, 'the lab server was created exactly once');
  assert.equal(closes, 1, 'the lab the rejected listen opened was actually closed');
  assert.equal(deps.stopped.length, 0, 'no owned child may be stopped because none was spawned');
  assert.equal(deps.written.length, 0);
});

test('A3 a spawn throw releases what the session owned and writes no receipt', async () => {
  const plan = makePlan();
  const deps = baseDeps(plan, { spawnImpl: () => { throw new Error('spawn ENOENT'); } });
  await assert.rejects(startHoldSession(plan, deps), /spawn ENOENT/);
  assert.equal(deps.written.length, 0);
  assert.equal(deps.closed.includes(777), true);
});

test('A4 a ping that never identifies the engine fails closed and stops the child', async () => {
  const plan = makePlan();
  const stops = [];
  const deps = baseDeps(plan, {
    fetchImpl: async () => { throw new Error('unreachable'); },
    enginePingTimeoutMs: 250,
    stopChild: async (child) => { stops.push(child); return cleanOutcome(child && child.pid); },
  });
  await assert.rejects(startHoldSession(plan, deps), /never identified the intended source\/lab/);
  assert.equal(stops.length, 1);
  assert.equal(deps.written.length, 0);
});

test('A5 an existing receipt is refused and the failure path still stops the child', async () => {
  const plan = makePlan();
  const deps = baseDeps(plan, {
    persist: () => { throw new HoldError('receipt_exists', 'hold receipt already exists'); },
  });
  await rejectsCode('receipt_exists', startHoldSession(plan, deps));
  assert.equal(deps.stopped.length, 1);
});

test('A6 cancellation before acquisition stops before anything is created', async () => {
  const plan = makePlan();
  const latch = createCancellationLatch();
  latch.cancel('pre-cancelled');
  const deps = baseDeps(plan, { latch });
  await rejectsCode('cancelled_before_acquisition', startHoldSession(plan, deps));
  assert.equal(deps.labCalls.length, 0);
  assert.equal(deps.written.length, 0);
});

test('A7 a startup listen that never settles is a bounded named failure with the socket still owned', async () => {
  const plan = makePlan();
  let resolveListen = null;
  let closes = 0;
  const deps = baseDeps(plan, {
    listenStartupMs: 30,
    listenAwaitMs: 40,
    labModule: {
      createLabServer: () => ({
        listen: () => new Promise((resolve) => { resolveListen = resolve; }),
        close: async () => { closes += 1; },
      }),
    },
    closeServer: async (server) => { await server.close(); return { proven: true, error: null }; },
  });
  await rejectsCode('listen_timeout', startHoldSession(plan, deps));
  assert.equal(deps.written.length, 0, 'no receipt may be published for an unsettled startup');
  assert.equal(deps.stopped.length, 0, 'no engine child may be spawned after a failed acquisition');
  const duringCleanup = closes;
  assert.ok(resolveListen, 'the acquisition was still pending when the startup bound won');
  resolveListen({ app: 'a', preview: 'p' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(closes, duringCleanup + 1, 'the socket acquired after the bound was disposed, not leaked');
});

test('A8 a signal while the engine ping is pending runs one bounded cleanup and never publishes', async () => {
  const plan = makePlan();
  const spawned = [];
  const stopped = [];
  const deps = baseDeps(plan, {
    fetchImpl: async () => { throw new Error('unreachable'); },
    enginePingTimeoutMs: 800,
    startupDisposeMs: 60,
    spawnImpl: () => { const child = makeChild(6001); spawned.push(child); return child; },
    stopChild: async (child) => { stopped.push(child); return unprovenOutcome(child && child.pid); },
  });
  const guardProcess = makeGuardProcess(6001);
  const run = holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  run.catch(() => undefined);
  await waitFor(() => spawned.length === 1);
  guardProcess.handlers.get('SIGINT')();
  // Cleanup must BEGIN well inside the ping bound rather than waiting for it to expire.
  await waitFor(() => stopped.length === 1, { timeoutMs: 400 });
  // Let the guard own re-raise continuation settle before reading the exit code.
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(guardProcess.exitCode, 1, 'an unconfirmed startup stop latches a nonzero exit code');
  await assert.rejects(run, /never identified the intended source\/lab/);
  assert.equal(stopped.length, 1, 'the memoized shutdown stopped the owned child exactly once');
  assert.equal(deps.written.length, 0, 'no ready receipt may be written after a cancellation');
});

test('A9 a signal while the listen is pending disposes the late socket it eventually acquires', async () => {
  const plan = makePlan();
  let resolveListen = null;
  let closes = 0;
  const deps = baseDeps(plan, {
    listenStartupMs: 5000,
    listenAwaitMs: 40,
    startupDisposeMs: 60,
    labModule: {
      createLabServer: () => ({
        listen: () => new Promise((resolve) => { resolveListen = resolve; }),
        close: async () => { closes += 1; },
      }),
    },
    closeServer: async (server) => { await server.close(); return { proven: true, error: null }; },
  });
  const guardProcess = makeGuardProcess(7001);
  const run = holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  run.catch(() => undefined);
  await waitFor(() => resolveListen !== null);
  guardProcess.handlers.get('SIGTERM')();
  await assert.rejects(run, /cancelled during the lab listen/);
  assert.equal(deps.written.length, 0);
  const duringCleanup = closes;
  resolveListen({ app: 'a', preview: 'p' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(closes, duringCleanup + 1, 'the socket acquired after the signal was disposed');
});

test('A10 a signal while the ping is pending with a confirmed cleanup leaves exit code zero', async () => {
  const plan = makePlan();
  const spawned = [];
  const deps = baseDeps(plan, {
    fetchImpl: async () => { throw new Error('unreachable'); },
    enginePingTimeoutMs: 800,
    startupDisposeMs: 60,
    spawnImpl: () => { const child = makeChild(6002); spawned.push(child); return child; },
    stopChild: async (child) => cleanOutcome(child && child.pid),
  });
  const guardProcess = makeGuardProcess(6002);
  const run = holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  run.catch(() => undefined);
  await waitFor(() => spawned.length === 1);
  guardProcess.handlers.get('SIGINT')();
  await assert.rejects(run, /never identified the intended source\/lab/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(guardProcess.exitCode, 0, 'a confirmed stop must not latch a nonzero code');
});

test('A11 a signal during listen whose partial acquisition rejects AFTER cleanup is disposed', async () => {
  const plan = makePlan();
  let rejectListen = null;
  let closes = 0;
  const deps = baseDeps(plan, {
    listenStartupMs: 5000,
    listenAwaitMs: 40,
    startupDisposeMs: 60,
    labModule: {
      createLabServer: () => ({
        listen: () => new Promise((resolve, reject) => { rejectListen = reject; }),
        close: async () => { closes += 1; },
      }),
    },
    closeServer: async (server) => { await server.close(); return { proven: true, error: null }; },
  });
  const guardProcess = makeGuardProcess(7101);
  const run = holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  const settled = run.then(() => null, (error) => error);
  await waitFor(() => rejectListen !== null, { timeoutMs: 1000 });
  guardProcess.handlers.get('SIGTERM')();
  const error = await settled;
  assert.match(String(error && error.message), /cancelled during the lab listen/);
  const cleanup = error.cleanup;
  assert.ok(cleanup, 'the failing startup must carry its real cleanup outcome');
  assert.equal(cleanup.listenSettled, false, 'the acquisition barrier returned unconfirmed and bounded');
  assert.equal(cleanup.stopped, false, 'an unconfirmed acquisition is never reported clean');
  assert.ok(cleanup.lateDisposal, 'ownership of the late acquisition is retained on the cleanup result');
  const duringCleanup = closes;
  // lab-server listen() awaits the app socket before the preview socket, so this rejection
  // follows a REAL partial acquisition that cleanup had already decided to close.
  rejectListen(new Error('preview socket refused'));
  const late = await cleanup.lateDisposal;
  assert.equal(late.rejected, true);
  assert.equal(late.settled, true);
  assert.equal(late.acquired, 'partial', 'the rejecting sequential listen had acquired a socket');
  assert.equal(late.disposed, true, 'the partially acquired server must actually be closed');
  assert.ok(closes > duringCleanup, 'disposal happened after the bounded cleanup returned');
  assert.equal(deps.stopped.length, 0, 'no owned child may be spawned after a cancellation');
  assert.equal(deps.written.length, 0, 'no ready receipt may be published after a cancellation');
});

test('A12 a startHoldSession listen timeout whose late acquisition rejects still disposes', async () => {
  const plan = makePlan();
  let rejectListen = null;
  let closes = 0;
  const deps = baseDeps(plan, {
    listenStartupMs: 30,
    listenAwaitMs: 40,
    labModule: {
      createLabServer: () => ({
        listen: () => new Promise((resolve, reject) => { rejectListen = reject; }),
        close: async () => { closes += 1; },
      }),
    },
    closeServer: async (server) => { await server.close(); return { proven: true, error: null }; },
  });
  const error = await startHoldSession(plan, deps).then(() => null, (e) => e);
  assert.ok(error && error.code === 'listen_timeout', 'a hung listen is a bounded named failure');
  const cleanup = error.cleanup;
  assert.ok(cleanup && cleanup.lateDisposal, 'the unresolved acquisition is still owned by cleanup');
  assert.equal(cleanup.listenSettled, false);
  const duringCleanup = closes;
  rejectListen(new Error('preview socket refused'));
  const late = await cleanup.lateDisposal;
  assert.equal(late.rejected, true);
  assert.equal(late.acquired, 'partial');
  assert.equal(late.disposed, true);
  assert.ok(closes > duringCleanup, 'the partial late acquisition was disposed after cleanup returned');
  assert.equal(deps.stopped.length, 0, 'no engine child may be spawned after a failed acquisition');
  assert.equal(deps.written.length, 0);
});

// --- Hold window ---------------------------------------------------------------

test('H1 the bounded hold window resolves on the deadline', async () => {
  const reason = await waitForHoldDeadline(createCancellationLatch(), 40);
  assert.equal(reason, 'deadline');
});

test('H2 the bounded hold window resolves immediately on cancellation', async () => {
  const latch = createCancellationLatch();
  const pending = waitForHoldDeadline(latch, 5000);
  setTimeout(() => latch.cancel('SIGTERM'), 10);
  assert.equal(await pending, 'cancelled');
});

test('H3 runHold acquires then stops through the same idempotent shutdown', async () => {
  const plan = makePlan({ maxHoldMs: 40 });
  const deps = baseDeps(plan);
  const result = await runHold(plan, deps);
  assert.equal(result.record.stopReason, 'deadline');
  assert.equal(result.stop.stopped, true);
  assert.equal(result.record.ok, true);
  assert.equal(deps.stopped.length, 1);
});

// The deadline seam on the REAL holdWithSignals orchestration. A bounded hold that
// cannot confirm its owned cleanup must latch a nonzero injected process exit; a
// confirmed deadline stop must leave it zero. Neither drives a helper in isolation.
test('H4 an unconfirmed owned cleanup at the real hold deadline latches a nonzero process exit', async () => {
  const plan = makePlan({ maxHoldMs: 40 });
  const stopped = [];
  const deps = baseDeps(plan, {
    stopChild: async (child) => { stopped.push(child); return unprovenOutcome(child && child.pid); },
  });
  const guardProcess = makeGuardProcess(7201);
  guardProcess.exitCode = 0;
  const result = await holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  await waitFor(() => stopped.length === 1, { timeoutMs: 2000 });
  assert.equal(result.stopReason, 'deadline', 'the bounded deadline is the stop reason, not a signal');
  assert.equal(result.stop.stopped, false, 'an unconfirmed cleanup is never reported clean');
  assert.equal(result.stop.ok, false);
  assert.equal(result.record.ok, false, 'the session record must not claim a clean hold');
  assert.equal(stopped.length, 1, 'the owned child was stopped exactly once through the real shutdown');
  assert.equal(guardProcess.exitCode, 1, 'an unconfirmed deadline cleanup latches a nonzero exit code');
  assert.equal(deps.written.length, 1, 'the ready receipt is still published before the deadline');
  assert.equal(guardProcess.output.filter((line) => line.includes('ready')).length, 1, 'exactly one ready line');
  assert.equal(guardProcess.output.filter((line) => line.includes('deadline')).length, 1, 'exactly one stop line');
  assert.equal(guardProcess.killed.length, 0, 'a deadline stop does not re-raise a signal');
});

test('H5 a confirmed owned cleanup at the real hold deadline leaves exit code zero', async () => {
  const plan = makePlan({ maxHoldMs: 40 });
  const deps = baseDeps(plan);
  const guardProcess = makeGuardProcess(7202);
  guardProcess.exitCode = 0;
  const result = await holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  assert.equal(result.stopReason, 'deadline');
  assert.equal(result.stop.stopped, true);
  assert.equal(deps.stopped.length, 1);
  assert.equal(guardProcess.exitCode, 0, 'a confirmed deadline stop must not latch a nonzero code');
  assert.equal(deps.written.length, 1);
  assert.equal(guardProcess.killed.length, 0);
});

test('H6 a deadline cleanup that THROWS is reported unconfirmed and latches a nonzero exit', async () => {
  const plan = makePlan({ maxHoldMs: 40 });
  // A log descriptor close that throws rejects the whole bounded cleanup. The real
  // holdWithSignals deadline path must still report an unconfirmed stop and latch a
  // nonzero exit rather than surfacing the failure as an unhandled rejection.
  const deps = baseDeps(plan, {
    closeLog: () => { throw new Error('engine log descriptor close exploded'); },
  });
  const guardProcess = makeGuardProcess(7203);
  guardProcess.exitCode = 0;
  const result = await holdWithSignals(plan, { env: {}, deps, processImpl: guardProcess });
  assert.equal(result.stopReason, 'deadline');
  assert.equal(result.stop.stopped, false, 'a cleanup that threw is never a clean stop');
  assert.equal(result.stop.ok, false);
  assert.match(result.stop.errors.join(' '), /deadline cleanup threw/);
  assert.match(result.stop.errors.join(' '), /engine log descriptor close exploded/);
  assert.equal(result.record.ok, false, 'the session record must not claim a clean hold');
  assert.equal(guardProcess.exitCode, 1, 'a throwing deadline cleanup latches a nonzero exit code');
  assert.equal(guardProcess.output.filter((line) => line.includes('deadline')).length, 1, 'the stop line is still printed');
  assert.equal(guardProcess.killed.length, 0, 'no signal is re-raised for a deadline stop');
});

// --- Signals -------------------------------------------------------------------

test('S6 the signal guard runs one cleanup with the same signal and re-raises it', async () => {
  const handlers = new Map();
  const killed = [];
  let cleanupCalls = 0;
  const fakeProcess = {
    pid: 5555,
    exitCode: 0,
    on: (event, handler) => handlers.set(event, handler),
    removeListener: (event) => handlers.delete(event),
    kill: (pid, signal) => { killed.push({ pid, signal }); return true; },
    exit: () => { throw new Error('exit must not be used when kill succeeds'); },
  };
  const guard = createHoldSignalGuard({
    processImpl: fakeProcess,
    onSignal: async () => { cleanupCalls += 1; return true; },
  });
  assert.deepEqual([...handlers.keys()].sort(), [...HOLD_SIGNALS].sort());
  // Grab the handler BEFORE delivery: the guard removes its listener while re-raising.
  const onSigterm = handlers.get('SIGTERM');
  onSigterm();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cleanupCalls, 1);
  assert.equal(fakeProcess.exitCode, 0);
  assert.deepEqual(killed, [{ pid: 5555, signal: 'SIGTERM' }]);
  onSigterm(); // a second delivery must not run cleanup again
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cleanupCalls, 1);
  guard.dispose();
});

test('S7 an unconfirmed stop at signal time latches a nonzero exit code', async () => {
  const handlers = new Map();
  const fakeProcess = {
    pid: 5556, exitCode: 0,
    on: (event, handler) => handlers.set(event, handler),
    removeListener: (event) => handlers.delete(event),
    kill: () => true,
    exit: () => true,
  };
  createHoldSignalGuard({ processImpl: fakeProcess, onSignal: async () => false });
  const onSigint = handlers.get('SIGINT');
  onSigint();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fakeProcess.exitCode, 1);
});

test('R3 the receipt separates the holder stop target from the owned engine child', () => {
  const plan = makePlan();
  const receipt = buildReceipt({
    plan,
    manifest: { sha256: 'a'.repeat(64), sourcePin: SOURCE_PIN, app: 'sheets' },
    ping: { source: 'S', lab: 'L', routes: REAL_ROUTES },
    bindings: buildEngineBindings({ ping: { routes: REAL_ROUTES }, handlers: createXlsxEngineHandlers({ baseUrl: plan.engineBaseUrl, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }) }) }),
    engineChild: { pid: 7777 },
    origins: { app: 'http://127.0.0.1:5460', preview: 'http://127.0.0.1:5461' },
    now: () => '2026-09-19T00:00:00.000Z',
  });
  assert.equal(receipt.holderPid, process.pid);
  assert.equal(receipt.ownership.holderPid, process.pid);
  assert.equal(receipt.ownedPid, 7777);
  assert.equal(receipt.ownership.engineChildPid, 7777);
  assert.notEqual(receipt.holderPid, receipt.ownedPid, 'the holder and the engine child must never be conflated');
  assert.equal(receipt.ownership.stopTarget, 'holder');
  assert.match(receipt.ownership.stopInstruction, /SIGINT or SIGTERM to holderPid/);
});

// --- Receipt ------------------------------------------------------------------

test('R1 persistReceipt writes once with the exclusive-create flag', () => {
  const dir = freshDir('receipt');
  const prefix = path.join(dir, 'evidence');
  const writes = [];
  const target = persistReceipt(prefix, { ok: true }, {
    writer: (file, body, options) => { writes.push({ file, body, options }); },
    exists: () => false,
  });
  assert.equal(target, holdReceiptPath(prefix));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].options, { flag: 'wx' });
  expectCode('receipt_exists', () => persistReceipt(prefix, { ok: true }, { writer: () => {}, exists: () => true }));
});

test('R2 the receipt records the actual URLs, pins, routes and no-Playwright claims', () => {
  const plan = makePlan();
  const receipt = buildReceipt({
    plan,
    manifest: { sha256: 'a'.repeat(64), sourcePin: SOURCE_PIN, app: 'sheets' },
    ping: { source: 'S', lab: 'L', routes: REAL_ROUTES },
    bindings: buildEngineBindings({ ping: { routes: REAL_ROUTES }, handlers: createXlsxEngineHandlers({ baseUrl: plan.engineBaseUrl, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }) }) }),
    engineChild: { pid: 7777 },
    origins: { app: 'http://127.0.0.1:5460', preview: 'http://127.0.0.1:5461' },
    now: () => '2026-09-19T00:00:00.000Z',
  });
  assert.equal(receipt.ownedPid, 7777);
  assert.equal(receipt.engine.pingSource, 'S');
  assert.equal(receipt.engine.pingLab, 'L');
  assert.deepEqual(receipt.engine.declaredRoutes, [...REAL_ROUTES].sort());
  assert.equal(receipt.engine.identity, 'verified source+lab via /engine/ping');
  assert.equal(receipt.urls.lab, 'http://127.0.0.1:5460');
  assert.equal(receipt.urls.sheets, 'http://127.0.0.1:5460/sheets/');
  assert.equal(receipt.orca.buildRan, false);
  assert.equal(receipt.at, '2026-09-19T00:00:00.000Z');
});
