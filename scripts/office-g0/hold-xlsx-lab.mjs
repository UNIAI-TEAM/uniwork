// UNI-667 XLSX r2-r17: Orca-bound lab hold launcher (Terra text proposal; Main applies).
// Holder correctionONE/r2 over the frozen initial/r1 span (r15 -> r16 continuation).
// Corrects exactly two late-cleanup seams: (1) a late listen REJECTION after a bounded
// cleanup must still dispose the partially acquired server instead of reporting that
// nothing was acquired; (2) a cleanup that throws at the bounded deadline must report an
// unconfirmed stop and latch a nonzero process exit rather than surface as an unhandled
// rejection. The bounded startup acquisition, late-fulfillment disposal and the
// holder-vs-engine stop contract from initial/r1 are preserved unchanged.
//
// WHY THIS EXISTS
// scripts/office-g0/run-xlsx-cycle.mjs has exactly two modes: discovery (starts
// nothing that listens) and execute, which starts the bound lab + engine host,
// runs Playwright --list and the real spec, and ALWAYS finalizes
// (finalizeOwnedChildren + lab close) before it returns. A lab torn down when
// Playwright finishes cannot host an interactive Orca browser session.
//
// e2e/office-g0/lab-server.mjs also has a standalone CLI (its own main()), but that
// main forwards only engineBaseUrl and never passes engineHandlers, so
// createEngineProxy has no binding and host:sheets-save-edits / -read-range /
// -recalc raise EngineUnsupportedError. It listens, but it is not a browser-ready
// XLSX session: listening is not the acceptance criterion.
//
// This launcher is the missing hold entry. It reuses the accepted central runner
// exports unchanged, adds ONLY the hold lifecycle, and keeps the REAL XLSX engine
// host and the REAL lab server - bound through the accepted
// createXlsxEngineHandlers bridge - alive for the Orca browser. It never imports or
// calls run-xlsx-cycle main(), never runs Playwright, and never builds.
//
// ONE ROOT: the engine lab directory and the lab server labDir are the SAME
// runtimeDir, exactly as the accepted runner wires it, so the engine published
// output under lab/out/<viewId> lands inside the lab server granted native output
// and a save is not refused as not_native_output.
//
// STOP: the only supported stop is a SIGINT/SIGTERM delivered to the HOLDER process,
// whose PID the receipt publishes as holderPid, or the bounded --max-hold-ms deadline.
// ownedPid in the receipt is the OWNED ENGINE CHILD, never the holder: it is what the
// holder stops, not what an operator signals. The holder closes its own lab server and
// stops exactly the child tree it spawned through the runner stopOwnedChild (a bounded
// taskkill /PID <owned child pid> /T /F on Windows). No image-name kill, no port sweep,
// no foreign PID.
//
// Node 22 built-ins plus the accepted sibling modules only. No production imports.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CLEANUP_TIMEOUT_MS,
  ENGINE_PING_TIMEOUT_MS,
  FIXTURE,
  SERVER_CLOSE_TIMEOUT_MS,
  SOURCE_PIN,
  XLSX_APP,
  assertManifest,
  assertPortFree,
  closeWithin,
  createXlsxEngineHandlers,
  finalizeOwnedChildren,
  hashFileList,
  noteCleanupOutcome,
  parseRunnerArgs,
  reconcileOk,
  resolveRunnerPlan,
  sha256Bytes,
  startOwnedEngineChild,
  stopOwnedChild,
  waitForEngineIdentity,
} from './run-xlsx-cycle.mjs';
// scripts/office-g0/ to repo root is two levels up; lab-engine lives under e2e/office-g0/.
import { ENGINE_OPERATIONS, createEngineProxy } from '../../e2e/office-g0/lab-engine.mjs';

export const HOLD_ROLE = 'orca-xlsx-bound-hold';
/** Both signals this launcher owns. Windows maps these through its console handler. */
export const HOLD_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM']);
/** The receipt channel; never one of the runner own evidence targets. */
export const RECEIPT_NAME = 'hold-ready.json';
export const ENGINE_LOG_SUFFIX = '-hold-engine.txt';
// A held lab nobody ever closes must not outlive the task. Bounded, in-process.
export const DEFAULT_MAX_HOLD_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_LISTEN_AWAIT_MS = SERVER_CLOSE_TIMEOUT_MS;
export const DEFAULT_FINALIZE_BOUND_MS = CLEANUP_TIMEOUT_MS + 2000;
export const DEFAULT_ENGINE_PING_TIMEOUT_MS = ENGINE_PING_TIMEOUT_MS;
// A startup listen that never settles must not hold the holder open forever: the
// acquisition await is raced against this bound, and an acquisition that misses it is
// a bounded named failure whose cleanup still owns any socket that arrives later.
export const DEFAULT_LISTEN_STARTUP_MS = 15000;
// Bound on waiting for an in-flight startup acquisition before a signal initiates
// cleanup, so a signal never waits on a session that may never arrive.
export const DEFAULT_STARTUP_DISPOSE_MS = CLEANUP_TIMEOUT_MS + 2000;

/**
 * The five operations the accepted XLSX bridge actually binds. It is exactly what
 * createXlsxEngineHandlers exports, so a holder that claims fewer or more is
 * refused by name. read-range/read-formulas are required because the pinned
 * renderer reads a range and the sheet's formulas on mount and on every edit; a
 * holder that binds only open/recalc/save leaves the grid empty and Save disabled.
 */
export const XLSX_ENGINE_OPERATIONS = Object.freeze([
  'xlsx-open',
  'xlsx-read-range',
  'xlsx-read-formulas',
  'xlsx-recalc',
  'xlsx-save',
  // The renderer closes its workbook on unmount, so the accepted bridge must carry a real close.
  // xlsx-is-dirty stays OUT: the sheets surface has no such member, so binding it would widen the
  // holder beyond what any caller reaches.
  'xlsx-close',
]);

/**
 * The complete supported CLI. parseRunnerArgs already owns the pinned runner
 * inputs, containment and freshness; --max-hold-ms is the one addition, because a
 * bounded hold deadline is required. An unknown flag is refused by name so the
 * surface cannot drift into a generic framework.
 */
export const HOLD_FLAGS = Object.freeze([
  'candidate',
  'builds',
  'manifest',
  'source',
  'fixtures',
  'prefix',
  'workspace',
  'expected-manifest-sha256',
  'max-hold-ms',
]);

const NL = String.fromCharCode(10);
const describeError = (error) => String((error && error.message) || error);

/** A named holder failure; the code is the machine-readable part. */
export class HoldError extends Error {
  constructor(code, message) {
    super('[office-g0-xlsx-hold] ' + message);
    this.name = 'HoldError';
    this.code = code;
  }
}

/** The hold launcher own receipt path; never the runner -result.json. */
export function holdReceiptPath(prefix) {
  return prefix + '-' + RECEIPT_NAME;
}

/**
 * The pinned-fixture predicate, applied by startHoldSession. It is exported so the
 * focused test drives the REAL check rather than a local copy of it.
 */
export function fixturePinOk(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  return bytes.length === FIXTURE.bytes && sha256Bytes(bytes) === FIXTURE.sha256;
}

const readFlag = (argv, name) => {
  const index = argv.indexOf('--' + name);
  return index === -1 ? undefined : argv[index + 1];
};

const flagNames = (argv) =>
  argv
    .filter((token) => typeof token === 'string' && token.startsWith('--'))
    .map((token) => token.slice(2).split('=')[0]);

/**
 * The hold launcher accepts exactly the runner-pinned inputs plus the bounded
 * deadline. parseRunnerArgs already rejects a missing input by name and freezes the
 * lane ports; only the mode label differs. --execute is refused outright: a hold
 * launcher that can be talked into running the xlsx cycle is exactly the collision
 * this file exists to avoid.
 */
export function resolveHoldArgs(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--execute')) {
    throw new HoldError('execute_refused', '--execute is not a hold mode; this launcher never runs Playwright, builds or the xlsx cycle');
  }
  const unsupported = flagNames(argv).filter((name) => !HOLD_FLAGS.includes(name));
  if (unsupported.length > 0) {
    throw new HoldError('unsupported_flag', 'unsupported flag(s): ' + unsupported.join(', ') + '; supported=[' + HOLD_FLAGS.join(', ') + ']');
  }
  const rawMax = readFlag(argv, 'max-hold-ms') ?? env.OFFICE_G0_XLSX_HOLD_MS;
  let maxHoldMs = DEFAULT_MAX_HOLD_MS;
  if (rawMax !== undefined) {
    const parsed = Number(rawMax);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HoldError('invalid_max_hold', '--max-hold-ms must be a positive integer of milliseconds, got ' + JSON.stringify(rawMax));
    }
    maxHoldMs = parsed;
  }
  const options = parseRunnerArgs(argv, env);
  return Object.freeze({ ...options, mode: 'hold', maxHoldMs });
}

/**
 * Resolve the ONE canonical hold plan from the accepted runner plan. Every input
 * (candidate, builds, manifest, prepared source, fixtures, fresh prefix) is proven
 * by resolveRunnerPlan, which enforces workspace containment, refuses to reuse any
 * existing evidence target, and requires the prepared tsx CLI, the engine host entry
 * and the pinned native xlsx sidecar. Nothing is started here: this is pure
 * resolution plus the shared-root check.
 */
export function resolveHoldPlan(args, { existsSync = fs.existsSync } = {}) {
  const plan = resolveRunnerPlan(args, { existsSync });
  const runtimeDir = plan.prefix + '-runtime';
  const artifactsDir = plan.prefix + '-artifacts';
  const tmpDir = path.join(runtimeDir, 'tmp');
  const engineLog = plan.prefix + ENGINE_LOG_SUFFIX;
  const engineBaseUrl = 'http://127.0.0.1:' + plan.ports.engine;
  const engineArgs = [
    plan.tsxCli, plan.engineHost,
    '--source', plan.source,
    '--lab', runtimeDir,
    '--port', String(plan.ports.engine),
  ];
  const engineLabDir = engineArgs[engineArgs.indexOf('--lab') + 1];
  if (engineLabDir !== runtimeDir) {
    throw new HoldError('shared_root_split', 'engine lab and lab server labDir must be the same directory: ' + engineLabDir + ' vs ' + runtimeDir);
  }
  return Object.freeze({
    mode: 'hold',
    workspaceRoot: plan.workspaceRoot,
    candidate: plan.candidate,
    builds: plan.builds,
    source: plan.source,
    fixtures: plan.fixtures,
    manifest: plan.manifest,
    fixture: plan.fixture,
    sidecar: plan.sidecar,
    tsxCli: plan.tsxCli,
    engineHost: plan.engineHost,
    labServer: plan.labServer,
    config: plan.config,
    spec: plan.spec,
    buildEntry: plan.buildEntry,
    prefix: plan.prefix,
    runtimeDir,
    artifactsDir,
    tmpDir,
    engineLog,
    labDir: runtimeDir,
    engineLabDir,
    engineBaseUrl,
    engineArgs,
    ports: { ...plan.ports },
    expectedManifestSha256: args.expectedManifestSha256,
    maxHoldMs: args.maxHoldMs,
  });
}

/** The route strings one honest XLSX hold must see on the real engine host. */
export function requiredRouteNames(operations = XLSX_ENGINE_OPERATIONS) {
  return operations.map((operation) => '/engine/' + operation);
}

/**
 * The real engine ping must prove the required open/read/recalc/save routes. A host
 * that routes fewer, or reports no routes list, is a named failure - never a lab
 * bound to less than the accepted bridge needs.
 */
export function assertEngineRoutes(ping, { operations = XLSX_ENGINE_OPERATIONS } = {}) {
  const declared = ping && Array.isArray(ping.routes) ? ping.routes : null;
  if (declared === null) {
    throw new HoldError('engine_routes_missing', 'engine ping did not report a routes list; the required XLSX open/read/recalc/save bind cannot be proven');
  }
  const have = new Set(declared);
  const missing = requiredRouteNames(operations).filter((route) => !have.has(route));
  if (missing.length > 0) {
    throw new HoldError('engine_routes_incomplete', 'engine host does not route required XLSX operation(s): ' + missing.join(', ') + '; declared=[' + declared.slice().sort().join(', ') + ']');
  }
  return { routes: declared.slice().sort(), required: requiredRouteNames(operations) };
}

/**
 * Bind the lab proxy to the REAL accepted XLSX bridge. handlers is the object
 * createXlsxEngineHandlers returns; each value is a function that POSTs to the
 * engine host and applies the server-owned viewId last. The map is proven twice:
 * every name is on the shared lab allowlist, and createEngineProxy reports it as
 * integrated. A missing or unexposed operation is a named failure, never a lab that
 * silently answers engine_unsupported later.
 */
export function buildEngineBindings({ ping, handlers, allowlist = ENGINE_OPERATIONS } = {}) {
  const proof = assertEngineRoutes(ping);
  if (!handlers || typeof handlers !== 'object') {
    throw new HoldError('engine_handlers_missing', 'createXlsxEngineHandlers returned no handler map');
  }
  const names = Object.keys(handlers);
  // Two gates: the bridge may only carry the accepted XLSX operation names, and every
  // name must also sit on the shared lab allowlist. An extra foreign handler is
  // refused by name rather than silently widening what this hold can reach.
  const foreign = names.filter((name) => !XLSX_ENGINE_OPERATIONS.includes(name));
  if (foreign.length > 0) {
    throw new HoldError('engine_handlers_unpermitted', 'handler(s) outside the accepted XLSX bridge: ' + foreign.join(', '));
  }
  const unpermitted = names.filter((name) => !allowlist.includes(name));
  if (unpermitted.length > 0) {
    throw new HoldError('engine_handlers_unpermitted', 'handler(s) outside the shared lab engine allowlist: ' + unpermitted.join(', '));
  }
  const missing = XLSX_ENGINE_OPERATIONS.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new HoldError('engine_handlers_incomplete', 'the XLSX engine bridge is missing operation(s): ' + missing.join(', '));
  }
  const probe = createEngineProxy({ handlers });
  const exposed = probe.integrated();
  const withheld = names.filter((name) => !exposed.includes(name));
  if (withheld.length > 0) {
    throw new HoldError('engine_binding_unexposed', 'lab engine proxy did not expose bound XLSX operation(s): ' + withheld.join(', '));
  }
  return {
    operations: names.slice().sort(),
    routes: requiredRouteNames(XLSX_ENGINE_OPERATIONS),
    declaredRoutes: proof.routes,
    allowlisted: [...allowlist],
  };
}

/** A cancellation latch, so startup can never publish a late ready or spawn after a stop. */
export function createCancellationLatch() {
  let reason = null;
  return {
    cancel(next) {
      if (reason === null) reason = next || 'cancelled';
      return reason;
    },
    get cancelled() {
      return reason !== null;
    },
    reason: () => reason,
  };
}

/**
 * Owned-child registry. The entries array is read at CLEANUP TIME, so a shutdown
 * that ran (and memoized) before acquisition can never cache an empty set and hide
 * a child that was tracked afterwards.
 */
export function createOwnedRegistry() {
  const entries = [];
  return {
    entries,
    track(child, { label = 'engine-host', command = null } = {}) {
      const entry = { label, child, command, trackedAt: new Date().toISOString() };
      entries.push(entry);
      return entry;
    },
    size: () => entries.length,
  };
}

/**
 * Await an acquisition (the lab listen) under a bound AND a cancellation, without
 * detaching from the underlying promise. The promise stays OWNED and referenced - it
 * is the same promise the cleanup awaits - so an acquisition that completes AFTER this
 * bounded await rejected is still owned and its late socket is still closed by cleanup
 * rather than leaked behind a memoized empty shutdown.
 *
 * The bound timer and the cancellation poll are deliberately NOT unref'd: a holder that
 * is mid-startup has nothing else pending, so an unref-timer sole handle could let the
 * process exit instead of reporting the unconfirmed acquisition.
 */
export async function acquireWithBound(promise, { latch = null, boundMs = DEFAULT_LISTEN_STARTUP_MS, onTimeout, onCancel, pollMs = 25 } = {}) {
  const acquired = Promise.resolve(promise).then(
    (value) => ({ kind: 'acquired', value }),
    (error) => ({ kind: 'failed', error }),
  );
  if (latch && latch.cancelled) throw onCancel ? onCancel(latch) : new Error('cancelled before acquisition');
  let timer = null;
  let poll = null;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), boundMs);
    if (latch) poll = setInterval(() => { if (latch.cancelled) resolve({ kind: 'cancelled' }); }, pollMs);
  });
  try {
    const outcome = await Promise.race([acquired, bound]);
    if (outcome.kind === 'acquired') return outcome.value;
    if (outcome.kind === 'failed') throw outcome.error;
    if (outcome.kind === 'cancelled') throw onCancel ? onCancel(latch) : new Error('cancelled during acquisition');
    throw onTimeout ? onTimeout() : new Error('acquisition did not settle within ' + boundMs + 'ms');
  } finally {
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
  }
}

/** Resolve true when a promise settles within the bound, false when the bound wins. */
const settledWithin = async (promise, boundMs) => {
  let timer = null;
  const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(false), boundMs); });
  try {
    return await Promise.race([Promise.resolve(promise).then(() => true, () => true), bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * One bounded, idempotent cleanup for a held session.
 *
 * It reads the server, the LISTEN PROMISE and the ownership list at cleanup time,
 * and it awaits the acquisition barrier first: lab-server listen() is sequential
 * (app socket, then preview socket), so a close decided while the preview listen is
 * still in flight can leave that second socket acquired LATER. Awaiting the bounded
 * listen promise before deciding what to close means a late-acquired socket is
 * closed rather than hidden behind a memoized empty shutdown. Ownership is kept through
 * BOTH settlement outcomes: a listen that REJECTS on the sequential preview socket has
 * already acquired the app socket, so the rejection path disposes the registered server
 * too and never claims that nothing was acquired.
 *
 * Every owned child stop is invoked up front by the accepted finalizeOwnedChildren,
 * so one hung stop cannot starve its siblings. An unconfirmed stop is reported as
 * unproven and forces stopped false; it is never described as clean. The owned
 * engine log descriptor is closed AFTER its child is stopped, and only that
 * descriptor is closed.
 */
export function createHoldShutdown({
  getServer = () => null,
  getListenPromise = () => null,
  getEngineLogFd = () => null,
  ownedChildren = null,
  registry = null,
  deps = {},
} = {}) {
  const stop = deps.stopChild || stopOwnedChild;
  const close = deps.closeServer || closeWithin;
  const closeLog = deps.closeLog || ((fd) => { try { fs.closeSync(fd); } catch { /* already closed */ } });
  const finalizeBoundMs = deps.finalizeBoundMs ?? DEFAULT_FINALIZE_BOUND_MS;
  const listenAwaitMs = deps.listenAwaitMs ?? DEFAULT_LISTEN_AWAIT_MS;
  let started = null;
  let lateDisposal = null;
  const run = () => {
    if (started) return started;
    started = (async () => {
      const errors = [];
      const record = { ok: true, cleanup: [] };
      // (a) Acquisition barrier: bounded await of a listen that may still complete.
      const listen = getListenPromise ? getListenPromise() : null;
      let listenSettled = true;
      if (listen) {
        let timer = null;
        listenSettled = await Promise.race([
          Promise.resolve(listen).then(() => true, () => true),
          new Promise((resolve) => {
            // Deliberately NOT unref'd: this timer only has to outlive the listen it
            // bounds, and an unref'd sole pending handle could let the process exit
            // before the bound is reported instead of recording the unconfirmed socket.
            timer = setTimeout(() => resolve(false), listenAwaitMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (listenSettled === false) {
          errors.push('lab listen did not settle within ' + listenAwaitMs + 'ms before cleanup; its sockets are unconfirmed');
          // Keep OWNING the unresolved acquisition: whenever it finally settles - fulfilled
          // OR rejected - dispose whatever lab server is registered by then, even though
          // this bounded cleanup already returned. lab-server listen() awaits the app socket
          // first and the preview socket second, so a REJECTION can follow a REAL partial
          // acquisition of the first socket; a memoized empty shutdown must never hide it,
          // and the rejection arm must not assume nothing was acquired. Both arms are
          // guarded so a disposal failure is reported truthfully and a late disposal can
          // never surface as an unhandled rejection or be mistaken for a clean run.
          const disposeLate = async (rejected) => {
            const armed = rejected ? 'partial' : 'settled';
            try {
              const lateServer = getServer ? getServer() : null;
              if (!lateServer) {
                return { disposed: false, settled: true, rejected, acquired: 'none', note: rejected ? 'late listen rejected after the bounded cleanup with no registered lab server' : 'late listen settled with no registered lab server' };
              }
              const closed = await close(lateServer);
              const proven = !!(closed && closed.proven === true);
              const what = rejected ? 'a partial late acquisition' : 'the late acquisition';
              return { disposed: proven, settled: true, rejected, acquired: armed, note: 'late listen ' + (rejected ? 'rejected after' : 'settled after') + ' the bounded cleanup and ' + (proven ? what + ' was disposed' : 'disposal of ' + what + ' did not confirm') };
            } catch (error) {
              return { disposed: false, settled: true, rejected, acquired: armed, note: 'late disposal of ' + (rejected ? 'a partial late acquisition' : 'the late acquisition') + ' failed: ' + String((error && error.message) || error) };
            }
          };
          lateDisposal = Promise.resolve(listen).then(
            () => disposeLate(false),
            () => disposeLate(true),
          );
        }
      }
      // (b) Close whatever server this session holds, bounded.
      const server = getServer ? getServer() : null;
      let serverClose = { proven: true, error: null };
      if (server) {
        // A close that THROWS is a close that was not proven. Record it as unproven
        // instead of letting the rejection destroy the whole cleanup result and hide
        // the primary failure the caller is about to report.
        try {
          serverClose = await close(server);
        } catch (error) {
          serverClose = { proven: false, error: String((error && error.message) || error) };
        }
        if (!serverClose || serverClose.proven !== true) {
          errors.push('lab server close not proven: ' + String(serverClose && serverClose.error));
        }
      }
      // (c) Stop every owned child; all stops are invoked before the first await.
      const entries = ownedChildren
        ? [...ownedChildren].map((child) => ({ label: 'engine-host', child }))
        : (registry ? registry.entries.map((entry) => ({ label: entry.label, child: entry.child })) : []);
      const swept = await finalizeOwnedChildren(entries, { boundMs: finalizeBoundMs, stop });
      const outcomes = [];
      for (const entry of swept.settled) outcomes.push(noteCleanupOutcome(record, entry.label, entry.outcome));
      for (const entry of swept.unconfirmed) outcomes.push(noteCleanupOutcome(record, entry.label, entry.outcome));
      reconcileOk(record);
      const unproven = outcomes
        .filter((outcome) => !outcome || outcome.parentExited !== true || outcome.exited !== true)
        .map((outcome) => ({
          label: 'engine-host',
          exited: outcome ? outcome.exited === true : false,
          parentExited: outcome ? outcome.parentExited === true : false,
          descendantProof: outcome ? outcome.descendantProof : 'unknown',
          note: outcome ? outcome.note ?? null : 'no stop outcome was produced',
        }));
      const stopped = errors.length === 0 && record.ok === true && swept.complete === true && listenSettled === true;
      // Close the owned engine log AFTER the child it belongs to has been stopped.
      const fd = getEngineLogFd ? getEngineLogFd() : null;
      if (fd !== null && fd !== undefined) closeLog(fd);
      return {
        ok: stopped,
        stopped,
        serverClosed: serverClose ? serverClose.proven === true : true,
        complete: swept.complete,
        listenSettled,
        ownedCount: entries.length,
        invoked: swept.invoked,
        outcomes,
        unproven,
        errors: errors.slice(),
        lateDisposal,
      };
    })();
    return started;
  };
  return { run };
}

/**
 * The ready receipt. It records the ACTUAL lab/preview/engine URLs, the shared
 * runtime root, the owned engine PID, the manifest and source pins, the real engine
 * routes the ping reported, the bound operation set, and real file hashes. It states
 * outright that this launcher started no Playwright and called no cycle
 * main/finalize, so the claim is checkable rather than assumed. It is built only
 * after the identity ping, the route proof and listen() have all succeeded.
 */
export function buildReceipt({ plan, manifest, ping, bindings, engineChild, origins, now = () => new Date().toISOString() }) {
  const routes = ping && Array.isArray(ping.routes) ? ping.routes.slice().sort() : [];
  return {
    role: HOLD_ROLE,
    at: now(),
    ok: true,
    // Stop contract: an operator signals holderPid (this launcher process). ownedPid is
    // the OWNED ENGINE CHILD the holder stops; it is never the process to signal, and
    // the receipt names the stop target explicitly instead of leaving it to be inferred.
    holderPid: process.pid,
    ownedPid: engineChild ? engineChild.pid : null,
    ownership: {
      holderPid: process.pid,
      engineHostPid: engineChild ? engineChild.pid : null,
      engineChildPid: engineChild ? engineChild.pid : null,
      stopTarget: 'holder',
      stopInstruction: 'send SIGINT or SIGTERM to holderPid (the launcher process); the holder then closes the lab and stops the owned engine child tree',
      ownsOnlyRegisteredChildren: true,
    },
    urls: { lab: origins.app, preview: origins.preview, sheets: origins.app + '/sheets/', engine: plan.engineBaseUrl },
    sharedRuntimeRoot: plan.labDir,
    labDir: plan.labDir,
    engineLabDir: plan.engineLabDir,
    ports: { ...plan.ports },
    sourcePin: SOURCE_PIN,
    app: XLSX_APP,
    manifest: { path: plan.manifest, sha256: manifest.sha256, sourcePin: manifest.sourcePin, app: manifest.app },
    fixture: { path: plan.fixture, bytes: FIXTURE.bytes, sha256: FIXTURE.sha256 },
    engine: {
      baseUrl: plan.engineBaseUrl,
      identity: 'verified source+lab via /engine/ping',
      pingSource: ping && ping.source !== undefined ? ping.source : null,
      pingLab: ping && ping.lab !== undefined ? ping.lab : null,
      declaredRoutes: routes,
      boundOperations: bindings.operations,
      boundRoutes: bindings.routes,
      allowlist: bindings.allowlisted,
    },
    orca: { runnerStartedPlaywright: false, cycleMainCalled: false, finalizeCycleCalled: false, buildRan: false },
    hashes: hashFileList([plan.manifest, plan.sidecar, plan.tsxCli, plan.engineHost, plan.labServer, plan.fixture, plan.buildEntry, plan.config, plan.spec]),
    maxHoldMs: plan.maxHoldMs,
  };
}

/** Write the receipt once with the exclusive-create flag, so it never clobbers. */
export function persistReceipt(prefix, receipt, deps = {}) {
  const target = holdReceiptPath(prefix);
  const writer = deps.writer || fs.writeFileSync;
  const exists = deps.exists || fs.existsSync;
  if (exists(target)) {
    throw new HoldError('receipt_exists', 'hold receipt already exists; refusing to overwrite: ' + target);
  }
  writer(target, JSON.stringify(receipt, null, 2) + NL, { flag: 'wx' });
  return target;
}

/**
 * Acquire the held session: the bound lab server plus the owned engine host.
 *
 * Ordering rules this function enforces:
 *   * the lab server is registered BEFORE the listen await, so a stop during listen
 *     still closes it, and the listen PROMISE is recorded so cleanup can await a
 *     late sequential second socket;
 *   * that listen await is BOUNDED and cancellable through acquireWithBound, so a
 *     listen that never settles can neither hang startup before the holder deadline
 *     starts nor delay owned cleanup, while the SAME promise stays owned so a socket
 *     acquired after the bound is still disposed by cleanup;
 *   * the cancellation latch is checked before acquisition, again immediately before
 *     the spawn with NO await between the check and the spawn, and once more before
 *     readiness is published, so nothing is spawned or published after a latch;
 *   * the engine spawn error is created AND consumed in the same synchronous block as
 *     the spawn, so a spawn failure is a fast named failure and never an unhandled
 *     rejection;
 *   * on any failure the same idempotent shutdown runs, so the server, the child and
 *     the owned log descriptor are all released, and the error carries the outcome.
 */
export async function startHoldSession(plan, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const spawnImpl = deps.spawnImpl || spawn;
  const createHandlers = deps.createHandlers || createXlsxEngineHandlers;
  const openLog = deps.openLog || ((target) => fs.openSync(target, 'wx'));
  const closeLog = deps.closeLog || ((fd) => { try { fs.closeSync(fd); } catch { /* already closed */ } });
  const now = deps.now || (() => new Date().toISOString());
  const checkPorts = deps.assertPortsFree || ((ports) => Promise.all([...new Set(ports)].map((port) => assertPortFree(port))));
  const persist = deps.persist || persistReceipt;
  const holdMs = Number.isInteger(deps.maxHoldMs) && deps.maxHoldMs > 0 ? deps.maxHoldMs : plan.maxHoldMs;
  const pingTimeoutMs = deps.enginePingTimeoutMs ?? DEFAULT_ENGINE_PING_TIMEOUT_MS;
  const listenStartupMs = Number.isInteger(deps.listenStartupMs) && deps.listenStartupMs > 0 ? deps.listenStartupMs : DEFAULT_LISTEN_STARTUP_MS;
  const readBytes = deps.readBytes || ((target) => fs.readFileSync(target));
  const checkFixture = deps.fixturePinOk || fixturePinOk;
  const exists = deps.exists || fs.existsSync;
  const mkdir = deps.mkdir || ((target) => fs.mkdirSync(target, { recursive: true }));

  if (typeof fetchImpl !== 'function') {
    throw new HoldError('engine_fetch_missing', 'no fetch implementation is available for the engine identity ping');
  }
  const effective = Object.freeze({ ...plan, maxHoldMs: holdMs });
  const latch = deps.latch || createCancellationLatch();
  const registry = createOwnedRegistry();
  const ownedChildren = new Set();
  let server = null;
  let listenPromise = null;
  let engineChild = null;
  let engineLogFd = null;
  const record = { ok: false, primaryError: null, cleanup: [], engineExitObserved: false, role: HOLD_ROLE };

  const shutdown = createHoldShutdown({
    getServer: () => server,
    getListenPromise: () => listenPromise,
    getEngineLogFd: () => engineLogFd,
    ownedChildren,
    registry,
    deps: {
      stopChild: deps.stopChild,
      closeServer: deps.closeServer,
      closeLog,
      finalizeBoundMs: deps.finalizeBoundMs,
      listenAwaitMs: deps.listenAwaitMs,
    },
  });
  // Let a signal arriving DURING startup reach the ONE idempotent shutdown this
  // session owns, so the guard can begin bounded cleanup without waiting for a
  // startup that may never settle. The same memoized object stops exactly once.
  if (deps.shutdownRef) deps.shutdownRef.shutdown = shutdown;

  try {
    mkdir(effective.runtimeDir);
    mkdir(effective.artifactsDir);
    mkdir(effective.tmpDir);
    engineLogFd = openLog(effective.engineLog);

    if (latch.cancelled) throw new HoldError('cancelled_before_acquisition', 'cancelled before the lab was created: ' + latch.reason());

    // Accepted manifest proof: hash + immutable pin + exactly one app (sheets) +
    // untouched prepared source.
    const manifest = assertManifest({
      manifestBytes: readBytes(effective.manifest),
      expectedSha256: effective.expectedManifestSha256,
    });
    // The fixture pin is checked inline by the runner main and is not an export, so
    // the same FIXTURE contract is applied here.
    if (!checkFixture(readBytes(effective.fixture))) {
      throw new HoldError('fixture_mismatch', 'fixture bytes do not match the pinned immutable fixture ' + FIXTURE.name);
    }
    // A save can only be published when the native sidecar the accepted plan
    // configured is present; resolveRunnerPlan already required it, and the holder
    // refuses to start without it rather than binding operations that cannot save.
    if (!exists(effective.sidecar)) {
      throw new HoldError('sidecar_missing', 'accepted native xlsx sidecar is not present: ' + effective.sidecar);
    }
    await checkPorts([effective.ports.app, effective.ports.preview, effective.ports.engine]);
    if (latch.cancelled) throw new HoldError('cancelled_before_acquire', 'cancelled before the lab was acquired: ' + latch.reason());

    const labModule = deps.labModule || await import(pathToFileURL(effective.labServer).href);
    const engineBaseUrl = effective.engineBaseUrl;
    const handlers = createHandlers({ baseUrl: engineBaseUrl, fetchImpl });
    // Registered BEFORE the listen await.
    server = labModule.createLabServer({
      buildsDir: effective.builds,
      labDir: effective.labDir,
      fixturesDir: effective.fixtures,
      sourceDir: effective.source,
      port: effective.ports.app,
      previewPort: effective.ports.preview,
      engineBaseUrl,
      engineHandlers: handlers,
    });
    listenPromise = Promise.resolve().then(() => server.listen());
    // BOUNDED startup acquisition. Directly awaiting a listen that never settles would
    // hang before the holder deadline ever starts, and the socket it eventually acquires
    // would then outlive a memoized cleanup. Racing the SAME promise against a bound and
    // a cancellation poll keeps it owned: cleanup still awaits it and disposes a late
    // socket, while a hung listen becomes a bounded named failure instead of a hang.
    const origins = await acquireWithBound(listenPromise, {
      latch,
      boundMs: listenStartupMs,
      onCancel: () => new HoldError('cancelled_during_listen', 'cancelled during the lab listen: ' + latch.reason()),
      onTimeout: () => new HoldError('listen_timeout', 'lab listen did not settle within ' + listenStartupMs + 'ms; its sockets are unconfirmed and cleanup will dispose a late acquisition'),
    });
    if (latch.cancelled) throw new HoldError('cancelled_during_listen', 'cancelled during the lab listen: ' + latch.reason());

    // No await between the cancellation check and the spawn.
    if (latch.cancelled) throw new HoldError('cancelled_before_spawn', 'cancelled before the engine host was started: ' + latch.reason());
    engineChild = startOwnedEngineChild({
      command: process.execPath,
      args: [...effective.engineArgs],
      options: {
        cwd: effective.candidate,
        windowsHide: true,
        stdio: ['ignore', engineLogFd, engineLogFd],
        env: Object.assign({}, env, { TEMP: effective.tmpDir, TMP: effective.tmpDir, TMPDIR: effective.tmpDir }),
      },
      spawnImpl,
      ownedChildren,
      onExit: () => { record.engineExitObserved = true; },
    });
    registry.track(engineChild, { label: 'engine-host', command: process.execPath });
    record.enginePid = engineChild.pid;

    let spawnFailure = null;
    const spawnError = new Promise((resolve) => {
      engineChild.once('error', (error) => { spawnFailure = error; resolve({ error }); });
    });
    record.ping = await Promise.race([
      waitForEngineIdentity({
        baseUrl: engineBaseUrl,
        expected: { source: effective.source, lab: effective.labDir },
        child: engineChild,
        fetchImpl,
        timeoutMs: pingTimeoutMs,
      }),
      spawnError.then((failure) => {
        throw new HoldError('engine_spawn_error', 'engine host failed to start: ' + describeError(failure.error));
      }),
    ]);
    const bindings = buildEngineBindings({ ping: record.ping, handlers });
    if (latch.cancelled) throw new HoldError('cancelled_before_ready', 'cancelled before readiness was published: ' + latch.reason());

    const receipt = buildReceipt({ plan: effective, manifest, ping: record.ping, bindings, engineChild, origins, now });
    persist(effective.prefix, receipt, deps);
    record.ok = true;
    record.receipt = receipt;
    record.bindings = bindings;
    return { plan: effective, record, receipt, server, engineChild, latch, registry, ownedChildren, shutdown, origins };
  } catch (error) {
    record.primaryError = describeError(error);
    // The same idempotent shutdown closes whatever was acquired, including a socket a
    // late sequential listen acquired after this failure was decided.
    const cleanup = await shutdown.run();
    record.cleanupRun = cleanup;
    error.cleanup = cleanup;
    throw error;
  }
}

/**
 * The bounded hold window. It resolves on the deadline or as soon as the cancellation
 * latch is set; it never blocks forever.
 */
export async function waitForHoldDeadline(latch, maxHoldMs) {
  return await new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(reason);
    };
    // Deliberately NOT unref'd: this wait IS the hold. An unref'd timer would let the
    // process exit the moment nothing else is pending, instead of holding until the
    // bounded deadline or a cancellation. Both handles are cleared on resolve.
    const timer = setTimeout(() => finish('deadline'), maxHoldMs);
    const poll = setInterval(() => { if (latch.cancelled) finish('cancelled'); }, 25);
  });
}

/**
 * Acquire, hold, then stop. The stop reuses the SAME shutdown object the failure
 * path uses, so there is exactly one cleanup mechanism and it is idempotent.
 */
export async function runHold(plan, deps = {}) {
  const session = await startHoldSession(plan, deps);
  const reason = deps.waitForHold
    ? await deps.waitForHold({ latch: session.latch, maxHoldMs: session.plan.maxHoldMs })
    : await waitForHoldDeadline(session.latch, session.plan.maxHoldMs);
  const stop = await session.shutdown.run();
  session.record.stopReason = reason;
  session.record.cleanupRun = stop;
  session.record.ok = session.record.ok === true && stop.stopped === true;
  return { record: session.record, receipt: session.receipt, stop, plan: session.plan };
}

/** Resolve the CLI inputs and plan, then acquire + hold + stop. */
export async function startHold(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = resolveHoldArgs(argv, env);
  const plan = resolveHoldPlan(args);
  return await runHold(plan, Object.assign({ env }, deps));
}

/**
 * Own SIGINT/SIGTERM: run one cleanup, then re-raise the SAME signal so the process
 * exits by signal rather than an arbitrary code. A cleanup that could not confirm its
 * stop sets a nonzero exit code before the re-raise. Injectable so the focused test
 * drives it without touching the real process.
 */
export function createHoldSignalGuard({ processImpl = process, signals = HOLD_SIGNALS, onSignal } = {}) {
  let received = null;
  let disposed = false;
  const handlers = new Map();
  const reRaise = (signal) => {
    try { processImpl.removeListener(signal, handlers.get(signal)); } catch { /* already gone */ }
    try {
      processImpl.kill(processImpl.pid, signal);
    } catch {
      try { processImpl.exit(1); } catch { /* ignore */ }
    }
  };
  const trigger = (signal) => {
    if (received || disposed) return;
    received = signal;
    void Promise.resolve()
      .then(() => (onSignal ? onSignal(signal) : true))
      .then(
        (ok) => { if (ok === false) processImpl.exitCode = 1; reRaise(signal); },
        () => { processImpl.exitCode = 1; reRaise(signal); },
      );
  };
  for (const signal of signals) {
    const handler = () => trigger(signal);
    try { processImpl.on(signal, handler); } catch { /* platform without this signal */ }
    handlers.set(signal, handler);
  }
  return {
    dispose: () => {
      disposed = true;
      for (const signal of signals) {
        try { processImpl.removeListener(signal, handlers.get(signal)); } catch { /* ignore */ }
      }
    },
    received: () => received,
  };
}

/**
 * Acquire the hold with the signal guard ALREADY installed, print the receipt once,
 * hold for the bounded window, then stop.
 *
 * The guard is installed BEFORE acquisition on purpose. A SIGINT/SIGTERM that
 * arrives while the lab listen or the engine ping is still pending must not be
 * answered by re-raising into a process that has already spawned an owned child:
 * the signal first latches the cancellation (so the in-flight startup observes it at
 * its own latch check and runs the ONE idempotent shutdown), and the guard waits for
 * that startup to settle before it re-raises. Nothing is published and nothing is
 * left owned.
 *
 * Each stage returns whether the stop was CONFIRMED, and a false result makes the
 * guard latch a nonzero exit code and `main` set a nonzero exit code.
 */
export async function holdWithSignals(plan, { env = process.env, deps = {}, processImpl = process } = {}) {
  const latch = deps.latch || createCancellationLatch();
  const holder = { session: null, startupStop: null };
  const startupShutdown = { shutdown: null };
  const startupDisposeMs = Number.isInteger(deps.startupDisposeMs) && deps.startupDisposeMs > 0 ? deps.startupDisposeMs : DEFAULT_STARTUP_DISPOSE_MS;
  let startupSettled = null;
  const startupDone = new Promise((resolve) => { startupSettled = resolve; });
  let stop = null;

  const finish = async (signal) => {
    if (signal) latch.cancel(signal);
    if (!holder.session) {
      // Startup is still in flight. Give its own failure path a BOUNDED chance to run
      // the same shutdown; then, if it has not settled, dispose the SAME idempotent
      // shutdown this startup owns rather than awaiting a session that may never
      // arrive. Cleanup therefore begins within the bound even while the listen or the
      // identity ping is still pending, and the memoized shutdown still runs once.
      const settled = await settledWithin(startupDone, startupDisposeMs);
      if (!holder.session) {
        if (settled && holder.startupStop) return holder.startupStop.stopped === true;
        if (!startupShutdown.shutdown) return false;
        const startupStop = await startupShutdown.shutdown.run();
        holder.startupStop = startupStop;
        return startupStop.stopped === true;
      }
    }
    stop = await holder.session.shutdown.run();
    holder.session.record.stopped = stop;
    holder.session.record.ok = holder.session.record.ok === true && stop.stopped === true;
    return stop.stopped === true;
  };

  const guard = createHoldSignalGuard({ processImpl, onSignal: (signal) => finish(signal) });
  let session;
  try {
    session = await startHoldSession(plan, Object.assign({}, deps, { env, latch, shutdownRef: startupShutdown }));
  } catch (error) {
    holder.startupStop = error && error.cleanup ? error.cleanup : null;
    startupSettled();
    guard.dispose();
    throw error;
  }
  holder.session = session;
  startupSettled();
  processImpl.stdout.write('[office-g0-xlsx-hold] ready ' + JSON.stringify(session.receipt) + NL);

  const reason = await waitForHoldDeadline(session.latch, session.plan.maxHoldMs);
  guard.dispose();
  let stopped = false;
  try {
    stopped = await finish(reason === 'cancelled' ? 'cancelled' : null);
  } catch (error) {
    // A deadline cleanup that THREW is not a confirmed stop. Report it in the same
    // unconfirmed shape an unproven child produces and latch the same nonzero exit
    // code, so a failed deadline cleanup can neither look like a clean run nor surface
    // as an unhandled rejection out of the bounded hold.
    stop = {
      ok: false, stopped: false, complete: false, listenSettled: false,
      serverClosed: false, ownedCount: 0, invoked: 0, outcomes: [], unproven: [], lateDisposal: null,
      errors: ['deadline cleanup threw: ' + String((error && error.message) || error)],
    };
    holder.session.record.stopped = stop;
    holder.session.record.ok = false;
  }
  processImpl.stdout.write('[office-g0-xlsx-hold] ' + JSON.stringify({ reason, stop }) + NL);
  if (!stopped) processImpl.exitCode = 1;
  return { record: session.record, receipt: session.receipt, stop, stopReason: reason };
}

/**
 * The CLI: resolve the inputs and plan, then hand off to holdWithSignals. It prints
 * one stop line and sets a nonzero exit code when the cleanup could not confirm the
 * stop.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = resolveHoldArgs(argv, env);
  const plan = resolveHoldPlan(args);
  return await holdWithSignals(plan, { env });
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
})();

if (isDirectRun) {
  main().then(
    () => undefined,
    (error) => {
      process.stderr.write('[office-g0-xlsx-hold] failed: ' + String((error && error.stack) || error) + NL);
      process.exitCode = 1;
    },
  );
}
