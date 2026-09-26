// UNI-668 (DOC-004) - tests for the reproducible real engine contract lab launcher.
//
// The launcher is the NEW process-orchestration behaviour, so it needs its own
// real execution: a stub host cannot prove the real adapter contract, and the
// real adapter contract cannot prove the launcher's lifecycle. These tests cover
// both, in two layers:
//
//   * hermetic unit tests with injectable seams - no port is bound, no process is
//     spawned, so they run anywhere and in any order;
//   * real bounded integrations - a stub host entry that crashes or never binds,
//     an occupied port, a missing dependency, a wrong pin, and finally the REAL
//     pinned engine host booted by the launcher with the frozen adapter contract.
//
// The real end-to-end case needs the prepared source tree and the pinned Node.
// It is skipped (never silently passed) when the required inputs are absent.
//
//   node --test scripts/office-g0/run-engine-contract-lab.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ADAPTER_SCRIPT_RELATIVE,
  DEFAULT_ENGINE_PORT,
  DEFAULT_TIMEOUTS,
  HOST_ENTRY_RELATIVE,
  RUN_KIND,
  assertDependencies,
  assertNotTerminated,
  assertPinState,
  assertPortFreeOrRefuse,
  assertPortNumber,
  assertWorkInsideWorkspace,
  buildFailureRecord,
  buildHostCommand,
  cleanupOwned,
  dependencyChecks,
  describeError,
  findWorkspaceRoot,
  generateFixtures,
  isInside,
  isReallyInside,
  installTerminationHandler,
  parseArgs,
  probePortFree,
  probeNodeVersion,
  satisfiesNodeRange,
  readChildFailure,
  readinessProbe,
  captureOwnedChildDescendants,
  captureOwnedDescendants,
  descendantPids,
  liveCapturedPids,
  listProcesses,
  sourceTreeDigest,
  verifySourceProvenance,
  verifyNodeIdentity,
  verifyUpstreamCheckout,
  renderCommand,
  requireExistingFile,
  resolveDefaults,
  resolvePinState,
  runLab,
  sha256File,
  stopOwnedChild,
  waitForIdentity,
  waitForPortRelease,
} from './run-engine-contract-lab.mjs';
import { resolveTestScratchRoot, TEST_AUTHORIZED_ROOT_ENV } from './test-scratch-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const WORKSPACE_ROOT = findWorkspaceRoot(REPO_ROOT);
// Guard: a linked worktree also has its own .uniwork-dev, so assert we resolved the shared lab root.
assert.ok(!WORKSPACE_ROOT || fs.existsSync(path.join(WORKSPACE_ROOT, '.uniwork-dev', 'office-g0')) || fs.existsSync(path.join(WORKSPACE_ROOT, '.uniwork-dev', 'tools')), 'the workspace root must be the shared lab root');
const PIN = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
const SOURCE_MANIFEST = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'source-manifest.json');
const PREPARED_SOURCE = WORKSPACE_ROOT ? path.join(WORKSPACE_ROOT, '.uniwork-dev', 'office-g0', 'bootstrap-source') : null;
const PINNED_NODE = WORKSPACE_ROOT ? path.join(WORKSPACE_ROOT, '.uniwork-dev', 'tools', 'node-v22.23.2-win-x64', 'node.exe') : null;
// Discovery selects the launcher's layout; the separate authorized root bounds writes.
const TEST_SCRATCH_ROOT = resolveTestScratchRoot({
  repoRoot: REPO_ROOT,
  workspaceRoot: WORKSPACE_ROOT || REPO_ROOT,
});

const tempRoots = [];
function scratchDir(label) {
  fs.mkdirSync(TEST_SCRATCH_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TEST_SCRATCH_ROOT, label + '-'));
  tempRoots.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const baseArgs = (work) => ['--source', PREPARED_SOURCE || 'source', '--work', work];
// An absent shared input is an explicit SKIP, never a bare return that reads as a pass.
const skipPrepared = PREPARED_SOURCE && fs.existsSync(PREPARED_SOURCE) ? false : 'the prepared pinned source tree is not present in this checkout';
const skipWorkspace = WORKSPACE_ROOT ? false : 'no shared workspace root (.uniwork-dev) is present above this checkout';
const skipPinnedNode = (WORKSPACE_ROOT && PINNED_NODE && fs.existsSync(PINNED_NODE)) ? false : 'the pinned node executable is not present in this checkout';

// ---------------------------------------------------------------------------
// argument handling
// ---------------------------------------------------------------------------

test('source and work are required, and are never inferred from a sibling lane', () => {
  assert.throws(() => parseArgs([], {}), /missing required input\(s\): --source \(or OFFICE_G0_LAB_SOURCE\), --work \(or OFFICE_G0_LAB_WORK\)/);
  assert.throws(() => parseArgs(['--source', 'a'], {}), /--work/);
  const args = parseArgs(['--source', 'a', '--work', 'b'], {});
  assert.equal(args.source, 'a');
  assert.equal(args.work, 'b');
});

test('an unknown flag is refused instead of silently ignored', () => {
  assert.throws(() => parseArgs(['--source', 'a', '--work', 'b', '--nope', 'x'], {}), /unknown argument\(s\): --nope/);
});

test('a value that starts with dashes is data, not an unknown flag', () => {
  const args = parseArgs(['--source', '--odd-source', '--work', 'w'], {});
  assert.equal(args.source, '--odd-source');
});

test('the engine port defaults to the historical lab port and is range-checked', () => {
  assert.equal(parseArgs(baseArgs('w'), {}).enginePort, DEFAULT_ENGINE_PORT);
  assert.equal(parseArgs(baseArgs('w').concat(['--engine-port', '6123']), {}).enginePort, 6123);
  assert.throws(() => assertPortNumber(0), /invalid engine port/);
  assert.throws(() => assertPortNumber(70000), /invalid engine port/);
  assert.throws(() => assertPortNumber('abc'), /invalid engine port/);
});

test('an unusable readiness timeout is refused rather than becoming an unbounded wait', () => {
  assert.throws(() => parseArgs(baseArgs('w').concat(['--readiness-timeout-ms', '0']), {}), /positive number/);
  assert.throws(() => parseArgs(baseArgs('w').concat(['--readiness-timeout-ms', 'abc']), {}), /positive number/);
});

test('--help needs no work directory and starts nothing', () => {
  const args = parseArgs(['--help'], {});
  assert.equal(args.help, true);
  assert.equal(args.work, null);
});

// ---------------------------------------------------------------------------
// path ownership
// ---------------------------------------------------------------------------

test('the work directory must live under the workspace root', () => {
  const inside = resolveDefaults({ source: PREPARED_SOURCE || 's', work: scratchDir('inside') }, { cwd: WORKSPACE_ROOT || process.cwd() });
  assert.equal(assertWorkInsideWorkspace(inside, WORKSPACE_ROOT), WORKSPACE_ROOT);

  const outsideRoot = path.resolve(REPO_ROOT, '..', '..', 'uni668-outside-' + Date.now());
  const outside = resolveDefaults({ source: PREPARED_SOURCE || 's', work: outsideRoot }, { cwd: process.cwd() });
  assert.throws(() => assertWorkInsideWorkspace(outside, WORKSPACE_ROOT), /--work must be a fresh directory under/);
});

test('isInside is ancestry, not a string prefix', () => {
  assert.equal(isInside('C:/a/b', 'C:/a/b'), true);
  assert.equal(isInside('C:/a/b', 'C:/a/b/c'), true);
  assert.equal(isInside('C:/a/b', 'C:/a/bc'), false);
});

test('isReallyInside resolves junctions, so a physical escape cannot pass as contained', () => {
  // A fake realpathSync models a junction: lexical root==target but physical target elsewhere.
  const ws = path.resolve('C:/ws');
  const link = path.join(ws, 'link');
  const child = path.join(link, 'child');
  const fakeRealpath = (target) => (path.resolve(target) === link ? path.resolve('D:/elsewhere/link') : path.resolve(target));
  const fakeExists = (target) => [ws, link].includes(path.resolve(target));
  assert.equal(isReallyInside(ws, child, { realpathSync: fakeRealpath, existsSync: fakeExists }), false);
  assert.equal(isReallyInside(ws, path.join(ws, 'child'), { realpathSync: fakeRealpath, existsSync: fakeExists }), true);
});

test('M2: an absent child of a junction that leaves the workspace is still refused', () => {
  // The junction itself exists and resolves outside; the child does NOT exist yet.
  // A realpath-only check falls back to the lexical path and would accept it, which is
  // the shape a --work mistake actually takes.
  const ws = path.resolve('C:/ws');
  const link = path.join(ws, '.uniwork-dev', 'junction');
  const child = path.join(link, 'fresh-child');
  const outside = path.resolve('C:/elsewhere');
  const fakeRealpath = (target) => (path.resolve(target) === path.resolve(link) ? outside : path.resolve(target));
  const fakeExists = (target) => [ws, path.join(ws, '.uniwork-dev'), link].includes(path.resolve(target));
  assert.equal(isReallyInside(path.join(ws, '.uniwork-dev'), child, { realpathSync: fakeRealpath, existsSync: fakeExists }), false);
});

test('M5: a run interrupted at ANY stage is a refusal, never a green pass', () => {
  // Guard against the control-flow hole where a signal arriving during the adapter
  // contract left ok===true while termination.honored was written as true.
  const source = fs.readFileSync(path.join(HERE, 'run-engine-contract-lab.mjs'), 'utf8');
  assert.match(source, /const ok = adapterOk && cleanupOk && sourceOk && !terminated/, 'the interrupt flag must gate ok');
});

test('--work is refused when it overlaps the workspace root', { skip: skipWorkspace }, () => {
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work: WORKSPACE_ROOT }, { cwd: WORKSPACE_ROOT });
  assert.throws(() => assertWorkInsideWorkspace(plan, WORKSPACE_ROOT), /must be a fresh directory under/);
});

test('a refused --work leaves no evidence record and creates nothing', { skip: skipWorkspace }, async () => {
  // Outside <workspace>/.uniwork-dev, so the launcher refuses it whatever scratch root the run uses
  // (TEST_SCRATCH_ROOT may itself sit under .uniwork-dev, where a fresh dir is legitimately accepted).
  const refused = path.join(WORKSPACE_ROOT, 'uni668-refused-' + Date.now());
  const outcome = await runLab(['--source', PREPARED_SOURCE || 's', '--work', refused], process.env);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.record.failure.stage, 'work-ownership');
  assert.equal(outcome.record.evidencePath, null, 'a refused work dir must not produce a record');
  assert.equal(fs.existsSync(refused), false, 'the refused directory must not be created');
});

test('N4: --work must not adopt another run managed tree', async () => {
  const work = scratchDir('adopt');
  // A leftover evidence tree from a previous run is the shape that matters: adopting
  // it would mix two runs into one record.
  fs.mkdirSync(path.join(work, 'lab'), { recursive: true });
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  assert.throws(() => assertWorkInsideWorkspace(plan, WORKSPACE_ROOT), /--work is not fresh: it already holds a lab tree/);
  const outcome = await runLab(['--source', PREPARED_SOURCE || 's', '--work', work], process.env);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.record.failure.stage, 'work-ownership');
});

test('a work dir holding only caller inputs is still accepted (freshness is about our trees)', () => {
  const work = scratchDir('inputs-only');
  fs.writeFileSync(path.join(work, 'stub-host.mjs'), 'process.exit(0);');
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  assert.equal(assertWorkInsideWorkspace(plan, WORKSPACE_ROOT), WORKSPACE_ROOT);
});

// ---------------------------------------------------------------------------
// workspace-root discovery: the shared lab root vs a checkout-local stub
// ---------------------------------------------------------------------------

/** A fake filesystem for findWorkspaceRoot, normalized so Windows casing/separators match. */
function markerFs(entries) {
  const set = new Set(entries.map((entry) => path.resolve(entry).toLowerCase()));
  return (target) => set.has(path.resolve(target).toLowerCase());
}

test('discovery: a shared lab root wins over a NEARER checkout-local office-g0 stub', () => {
  // The integration checkout W/dev-uniwork carries only .uniwork-dev/office-g0, while
  // the shared root W also carries .uniwork-dev/tools. Nearest-first lookup returned
  // dev-uniwork, which then made every valid --work dir look like it overlapped the
  // checkout and resolved the pinned lockfile under the wrong root.
  const shared = path.resolve('C:/ws');
  const checkout = path.join(shared, 'dev-uniwork');
  const exists = markerFs([
    shared,
    path.join(shared, '.uniwork-dev'),
    path.join(shared, '.uniwork-dev', 'office-g0'),
    path.join(shared, '.uniwork-dev', 'tools'),
    checkout,
    path.join(checkout, '.uniwork-dev'),
    path.join(checkout, '.uniwork-dev', 'office-g0'),
  ]);
  assert.equal(findWorkspaceRoot(path.join(checkout, 'scripts', 'office-g0'), exists), shared);
});

test('discovery: a lone checkout-local office-g0 root is still selected', () => {
  // With no shared marker anywhere above, the checkout-local lab must still resolve:
  // preferring a shared marker cannot hard-require one that does not exist.
  const root = path.resolve('C:/only');
  const exists = markerFs([root, path.join(root, '.uniwork-dev'), path.join(root, '.uniwork-dev', 'office-g0')]);
  assert.equal(findWorkspaceRoot(path.join(root, 'apps'), exists), root);
});

test('discovery: with no office-g0 above, the nearest .uniwork-dev ancestor is the fallback', () => {
  const outer = path.resolve('C:/outer');
  const inner = path.join(outer, 'repo');
  const exists = markerFs([outer, path.join(outer, '.uniwork-dev'), inner, path.join(inner, '.uniwork-dev')]);
  assert.equal(findWorkspaceRoot(path.join(inner, 'src'), exists), inner);
});

test('discovery: a linked worktree own .uniwork-dev does not beat the shared ancestor root', () => {
  const shared = path.resolve('C:/ws');
  const worktree = path.join(shared, '.uniwork-dev', 'worktrees', 'dev-uniwork', 'UNI-668-runtime-launcher');
  const exists = markerFs([
    shared,
    path.join(shared, '.uniwork-dev'),
    path.join(shared, '.uniwork-dev', 'office-g0'),
    path.join(shared, '.uniwork-dev', 'worktrees'),
    worktree,
    path.join(worktree, '.uniwork-dev'),
  ]);
  assert.equal(findWorkspaceRoot(path.join(worktree, 'scripts', 'office-g0'), exists), shared);
});

test('discovery: the real integration layout resolves to the shared root (real filesystem)', () => {
  // Real directories and the real fs.existsSync: an owned scratch copy of the main
  // layout, with a checkout-local .uniwork-dev/office-g0 stub and a shared root that
  // also owns .uniwork-dev/tools. No injection, so this proves the rule on a real disk.
  const shared = scratchDir('discovery-shared');
  fs.mkdirSync(path.join(shared, '.uniwork-dev', 'office-g0'), { recursive: true });
  fs.mkdirSync(path.join(shared, '.uniwork-dev', 'tools'), { recursive: true });
  const checkout = path.join(shared, 'dev-uniwork');
  fs.mkdirSync(path.join(checkout, '.uniwork-dev', 'office-g0'), { recursive: true });
  fs.mkdirSync(path.join(checkout, 'scripts', 'office-g0'), { recursive: true });
  assert.equal(fs.existsSync(path.join(checkout, '.uniwork-dev', 'office-g0')), true, 'the checkout-local stub must be the nearer marker');
  assert.equal(findWorkspaceRoot(path.join(checkout, 'scripts', 'office-g0')), shared);
  const defaultScratch = resolveTestScratchRoot({
    repoRoot: checkout,
    workspaceRoot: shared,
    env: { [TEST_AUTHORIZED_ROOT_ENV]: shared },
  });
  assert.equal(defaultScratch, path.join(shared, '.uniwork-dev', 'uni-668-lab-test'));
  const work = path.join(defaultScratch, 'default-layout-run');
  const plan = resolveDefaults({ source: path.join(shared, '.uniwork-dev', 'office-g0'), work }, { cwd: checkout });
  assert.equal(assertWorkInsideWorkspace(plan, findWorkspaceRoot(checkout)), shared);
});

test('discovery: preferring the shared root does NOT widen --work ownership', () => {
  // Selection and containment are two separate guarantees. Preferring a shared ancestor
  // must not let --work adopt a path under the nearer checkout-local .uniwork-dev, which
  // the old (wrong) root would have treated as inside its own workspace.
  const shared = scratchDir('discovery-containment');
  fs.mkdirSync(path.join(shared, '.uniwork-dev', 'office-g0'), { recursive: true });
  fs.mkdirSync(path.join(shared, '.uniwork-dev', 'tools'), { recursive: true });
  const checkout = path.join(shared, 'dev-uniwork');
  fs.mkdirSync(path.join(checkout, '.uniwork-dev', 'office-g0'), { recursive: true });
  const checkoutScratch = path.join(checkout, '.uniwork-dev', 'would-adopt');
  const plan = resolveDefaults({ source: path.join(shared, '.uniwork-dev', 'office-g0'), work: checkoutScratch }, { cwd: checkout });
  assert.throws(
    () => assertWorkInsideWorkspace(plan, findWorkspaceRoot(path.join(checkout, 'scripts'))),
    /must overlap|must be a fresh directory under|--work must be a directory inside|overlaps/,
    'a --work dir under the nested checkout must not be accepted just because a shared root was preferred',
  );
});

test('a missing dependency is named exactly and refuses the run before any spawn', () => {
  const work = scratchDir('deps');
  const plan = resolveDefaults({ source: path.join(work, 'no-such-source'), work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  const checks = dependencyChecks(plan);
  const missing = checks.filter((entry) => !entry.ok);
  assert.ok(missing.length > 0, 'the absent source must be detected');
  assert.throws(() => assertDependencies(checks), /missing dependency: source root -> /);
  assert.throws(() => requireExistingFile(path.join(work, 'nope.txt'), 'fixtures dir'), /missing fixtures dir/);
});

// ---------------------------------------------------------------------------
// pin
// ---------------------------------------------------------------------------

test('the pin is verified against the manifest, the lockfile and the frozen adapter', () => {
  const good = resolvePinState({ manifestPath: SOURCE_MANIFEST, sourceRoot: PREPARED_SOURCE || REPO_ROOT, expectedPin: PIN, adapterUpstreamPin: PIN });
  assert.equal(good.verified, true, JSON.stringify(good.problems));
  assert.equal(good.expectedPin, PIN);
  assert.equal(assertPinState(good), good);
});

test('a wrong --expected-pin is refused and names expected versus manifest', () => {
  const bad = resolvePinState({ manifestPath: SOURCE_MANIFEST, sourceRoot: PREPARED_SOURCE || REPO_ROOT, expectedPin: 'f'.repeat(40), adapterUpstreamPin: PIN });
  assert.equal(bad.verified, false);
  assert.throws(() => assertPinState(bad), /wrong pin: --expected-pin f{40} disagrees with the manifest pin/);
});

test('an adapter whose declared upstream pin differs from the manifest is refused', () => {
  const bad = resolvePinState({ manifestPath: SOURCE_MANIFEST, sourceRoot: PREPARED_SOURCE || REPO_ROOT, adapterUpstreamPin: 'a'.repeat(40) });
  assert.equal(bad.verified, false);
  assert.throws(() => assertPinState(bad), /the frozen adapter declares upstream pin a{40}/);
});

test('a lockfile that is not the pinned one is refused', () => {
  const work = scratchDir('lock');
  fs.writeFileSync(path.join(work, 'package-lock.json'), 'not the pinned lockfile');
  const bad = resolvePinState({ manifestPath: SOURCE_MANIFEST, sourceRoot: work, adapterUpstreamPin: PIN });
  assert.equal(bad.verified, false);
  assert.throws(() => assertPinState(bad), /the source lockfile is not the pinned one/);
});

// ---------------------------------------------------------------------------
// M1 provenance: the pin must be proven against the manifest's own recorded bytes,
// not against a digest the run observed about itself.
// ---------------------------------------------------------------------------

test('M1: the prepared source is verified against the manifest recorded bytes', { skip: skipPrepared }, () => {
  const proven = verifySourceProvenance({ manifestPath: SOURCE_MANIFEST, sourceRoot: PREPARED_SOURCE });
  assert.equal(proven.verified, true, JSON.stringify(proven.problems));
  assert.equal(proven.manifestPin, PIN);
  assert.equal(proven.manifestTree, 'b743f03ab1f1de8f0ba1913b7bd9c06edef8f884');
  assert.ok(proven.evidence.checked.length >= 3, 'license, lockfile and package must all be checked');
  assert.equal(proven.evidence.checked.every((row) => row.ok === true), true, 'every recorded artifact must match');
  const kinds = proven.evidence.checked.map((row) => row.kind);
  for (const kind of ['license', 'lockfile', 'package']) assert.ok(kinds.includes(kind), 'the ' + kind + ' must be checked');
});

test('M1: a tampered license or root package is refused, not waved through', { skip: skipPrepared }, () => {
  const copy = scratchDir('provenance-tamper');
  // Tamper the root package.json: still valid JSON and still the pinned lockfile,
  // but no longer the pinned upstream identity.
  fs.copyFileSync(path.join(PREPARED_SOURCE, 'package.json'), path.join(copy, 'package.json'));
  fs.copyFileSync(path.join(PREPARED_SOURCE, 'package-lock.json'), path.join(copy, 'package-lock.json'));
  const pkg = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
  pkg.name = 'not-the-pinned-package';
  fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(pkg, null, 2));
  const result = verifySourceProvenance({ manifestPath: SOURCE_MANIFEST, sourceRoot: copy });
  assert.equal(result.verified, false, 'a rewritten root package must not verify');
  assert.match(result.problems.join(' '), /does not match the pinned upstream identity|does not match the pinned bytes/);
});

test('M1: an absent upstream checkout is recorded as unproven, never claimed as verified', () => {
  const absent = verifyUpstreamCheckout({ upstreamRoot: null, manifestPath: SOURCE_MANIFEST });
  assert.equal(absent.checked, false);
  assert.match(absent.reason, /rests on the manifest artifacts alone/);
});

test('M1: an upstream checkout at the wrong commit or tree is refused', { skip: skipPrepared }, () => {
  const manifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'));
  const fakeGit = (args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: '0'.repeat(40) + '\n' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: '1'.repeat(40) + '\n' };
    return { status: 0, stdout: '' };
  };
  const wrongCommit = verifyUpstreamCheckout({ upstreamRoot: path.dirname(SOURCE_MANIFEST), manifestPath: SOURCE_MANIFEST, runGit: fakeGit, existsSync: () => true });
  assert.equal(wrongCommit.checked, true);
  assert.equal(wrongCommit.verified, false);
  assert.ok(wrongCommit.problems.join(' ').includes('not the pinned commit ' + manifest.upstream.pinnedCommit), 'the refusal names the pinned commit');
  assert.ok(wrongCommit.problems.join(' ').includes(manifest.upstream.pinnedTree), 'the refused tree is named');
  // A dirty checkout is refused even when its commit and tree match.
  const dirtyGit = (args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: manifest.upstream.pinnedCommit + '\n' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: manifest.upstream.pinnedTree + '\n' };
    return { status: 0, stdout: ' M package.json\n' };
  };
  const dirty = verifyUpstreamCheckout({ upstreamRoot: path.dirname(SOURCE_MANIFEST), manifestPath: SOURCE_MANIFEST, runGit: dirtyGit, existsSync: () => true });
  assert.equal(dirty.verified, false);
  assert.match(dirty.problems.join(' '), /uncommitted changes/);
});

test('the manifest supported node range is enforced before any spawn', () => {
  assert.equal(satisfiesNodeRange('v22.23.2', '>=22.12.0').satisfied, true);
  assert.equal(satisfiesNodeRange('v22.23.2', '>=23.0.0').satisfied, false);
  assert.equal(satisfiesNodeRange('v25.8.0', '>=22.12.0').satisfied, true);
  // An uninterpretable version or range must not be treated as a pass.
  assert.equal(satisfiesNodeRange('not-a-version', '>=22.12.0').satisfied, null);
  assert.equal(satisfiesNodeRange('v22.23.2', '').satisfied, null);
  assert.equal(satisfiesNodeRange('v22.23.2', '^22.12.0').satisfied, null);
});

test('M1: the host node executable and version must match the manifest runtime identity', { skip: skipPinnedNode }, () => {
  const manifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'));
  const plan = resolveDefaults({ source: PREPARED_SOURCE, work: scratchDir('node-identity'), node: PINNED_NODE }, { cwd: WORKSPACE_ROOT });
  const good = verifyNodeIdentity({ plan, manifestNode: manifest.runtime.node, observedVersion: 'v22.23.2', workspaceRoot: WORKSPACE_ROOT });
  assert.equal(good.verified, true, JSON.stringify(good.problems));
  assert.equal(good.binary.sha256.length, 64, 'the actual binary bytes are recorded, never inferred');
  assert.match(good.note, /does not record a binary hash/);
  const wrongVersion = verifyNodeIdentity({ plan, manifestNode: manifest.runtime.node, observedVersion: 'v25.8.0', workspaceRoot: WORKSPACE_ROOT });
  assert.equal(wrongVersion.verified, false);
  assert.match(wrongVersion.problems.join(' '), /manifest was checked with 22\.23\.2/);
});

test('normal termination: a cooperative signal is recorded and stops the run, never swallowed', () => {
  const listeners = new Map();
  const fakeProcess = {
    on(name, handler) { listeners.set(name, handler); },
    removeListener(name) { listeners.delete(name); },
  };
  const seen = [];
  const handler = installTerminationHandler({ onSignal: (name) => seen.push(name), processImpl: fakeProcess });
  assert.deepEqual(handler.signals, ['SIGINT', 'SIGTERM', 'SIGHUP']);
  assert.ok(listeners.has('SIGINT') && listeners.has('SIGTERM') && listeners.has('SIGHUP'), 'all cooperative signals are handled');
  listeners.get('SIGINT')();
  assert.deepEqual(seen, ['SIGINT'], 'the handler sees the delivered signal');
  handler.remove();
  assert.equal(listeners.size, 0, 'the handlers are removed so a later run is not steered by this one');
});

test('normal termination: an interrupt makes the run fail nonzero instead of continuing to spawn', () => {
  assert.doesNotThrow(() => assertNotTerminated(null), 'no interrupt is not a failure');
  assert.doesNotThrow(() => assertNotTerminated({ requested: false, signal: null }));
  assert.throws(
    () => assertNotTerminated({ requested: true, signal: 'SIGINT' }),
    /received SIGINT; the run stopped/,
  );
});

// ---------------------------------------------------------------------------
// ports and readiness
// ---------------------------------------------------------------------------

test('an occupied port fails safely and never signals the foreign owner', async () => {
  const holder = createServer(() => {});
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  try {
    const probe = await probePortFree(port);
    assert.equal(probe.free, false);
    await assert.rejects(() => assertPortFreeOrRefuse(port), /already in use; refusing to boot and refusing to signal a foreign process/);
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('a free port is accepted and released back for real', async () => {
  const probe = await probePortFree(0);
  assert.equal(probe.free, true);
  const released = await waitForPortRelease(probe.port, { timeoutMs: 2000 });
  assert.equal(released.released, true);
});

test('waitForPortRelease is bounded when the port never frees', async () => {
  const holder = createServer(() => {});
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  try {
    const released = await waitForPortRelease(port, { timeoutMs: 400, sleep: () => Promise.resolve() });
    assert.equal(released.released, false);
    assert.equal(released.port, port);
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('a child that already exited with no observed descendant is an honest unknown, never fabricated tree proof', async () => {
  const fake = { pid: 424242, exitCode: 7, signalCode: null, once() {}, removeListener() {} };
  const stop = await stopOwnedChild(fake, { platform: 'win32', spawnImpl: () => { throw new Error('must not be spawned'); } });
  assert.equal(stop.stopped, true);
  assert.equal(stop.treeProven, false);
  assert.equal(stop.unknown, true);
  assert.match(stop.note, /descendants are unproven, not killed/);
});

// ---------------------------------------------------------------------------
// owned-tree proof (regression for the cleanup-proof race)
//
// The launcher owns the tsx WRAPPER pid, but tsx runs the real host in a
// grandchild. A parent that exits on its own therefore says NOTHING about the
// process holding the port, and an already-dead parent also makes
// `taskkill /T` return "not found" (128). Reading either as a leaked tree
// refused truthful green runs; these cases pin the corrected proof.
// ---------------------------------------------------------------------------

test('descendantPids resolves the whole captured tree, not just direct children', () => {
  const rows = [{ pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 1 }, { pid: 5, ppid: 99 }];
  assert.deepEqual(descendantPids(1, rows).sort((a, b) => a - b), [2, 3, 4]);
  assert.deepEqual(descendantPids(5, rows), []);
  assert.deepEqual(descendantPids(1, []), []);
});

test('a captured parent that exited on its own is PROVEN when every observed descendant is gone', async () => {
  const exited = { pid: 111, exitCode: 1, signalCode: null, once() {}, removeListener() {} };
  const gone = await stopOwnedChild(exited, {
    platform: 'win32',
    knownDescendants: [9001, 9002],
    list: () => ({ ok: true, rows: [{ pid: 1, ppid: 0 }], reason: null }),
  });
  assert.equal(gone.stopped, true);
  assert.equal(gone.treeProven, true);
  assert.equal(gone.unknown, false);
  assert.equal(gone.descendantsProven, true);
  assert.equal(gone.descendantsObserved, 2);
  assert.match(gone.note, /every process observed under it while it was alive is gone/);
});

test('a captured descendant still alive keeps the tree unproven, never a pass', async () => {
  const exited = { pid: 111, exitCode: 1, signalCode: null, once() {}, removeListener() {} };
  const leaked = await stopOwnedChild(exited, {
    platform: 'win32',
    knownDescendants: [9001, 9002],
    list: () => ({ ok: true, rows: [{ pid: 9002, ppid: 1 }], reason: null }),
  });
  // The parent itself did exit, so `stopped` is true; strictness rides on the
  // tree proof, which must stay unproven while an observed descendant is alive.
  assert.equal(leaked.stopped, true);
  assert.equal(leaked.treeProven, false);
  assert.equal(leaked.unknown, true);
  assert.deepEqual(leaked.descendantsStillAlive, [9002]);
  assert.match(leaked.note, /descendants are unproven, not killed/);

  // And the run-level verdict must refuse it rather than carrying exit 0.
  const work = scratchDir('leaked-descendant');
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  plan.existsSync = () => false;
  const refused = await cleanupOwned({
    plan, host: { pid: 111 },
    stop: async () => leaked,
    releaseWait: async () => ({ released: true, port: plan.enginePort }),
  });
  assert.equal(refused.host.ok, false, 'a live observed descendant cannot be a clean cleanup');
  assert.equal(refused.host.treeProof, 'unproven');
});

test('an unavailable process enumeration is an honest unknown, never a guessed clean tree', async () => {
  const exited = { pid: 111, exitCode: 1, signalCode: null, once() {}, removeListener() {} };
  const blind = await stopOwnedChild(exited, {
    platform: 'win32',
    knownDescendants: [9001],
    list: () => ({ ok: false, rows: null, reason: 'enumeration unavailable' }),
  });
  assert.equal(blind.treeProven, false);
  assert.equal(blind.unknown, true);
  assert.match(blind.note, /enumeration unavailable/);
});

test('the taskkill not-found race is proven by observation, not refused as a leaked tree', async () => {
  const { EventEmitter } = await import('node:events');
  let capturedExit = false;
  const racy = {
    pid: 222, exitCode: null, signalCode: null,
    once(event, handler) { if (event === 'exit') setTimeout(() => { racy.exitCode = 1; capturedExit = true; handler(); }, 0); },
    removeListener() {},
  };
  const outcome = await stopOwnedChild(racy, {
    platform: 'win32',
    timeoutMs: 50,
    knownDescendants: [9001],
    list: () => ({ ok: true, rows: [], reason: null }),
    spawnImpl: () => { const fake = new EventEmitter(); fake.stdout = { resume() {} }; fake.stderr = { resume() {} }; setTimeout(() => fake.emit('close', 128), 0); return fake; },
    sleep: () => Promise.resolve(),
  });
  assert.equal(capturedExit, true);
  assert.equal(outcome.killExitCode, 128, 'taskkill on an already-dead pid reports not-found');
  assert.equal(outcome.treeProven, true);
  assert.equal(outcome.unknown, false);
  assert.match(outcome.note, /every process observed under it while it was alive is gone/);
});

test('captureOwnedChildDescendants reports an unobservable tree instead of an empty one', async () => {
  const noPid = await captureOwnedChildDescendants(null, { list: () => ({ ok: true, rows: [{ pid: 1, ppid: 0 }], reason: null }) });
  assert.equal(noPid.ok, false);
  assert.deepEqual(noPid.pids, []);
  const blind = await captureOwnedChildDescendants({ pid: 7 }, { list: () => ({ ok: false, rows: null, reason: 'no WMI' }), attempts: 1 });
  assert.equal(blind.ok, false);
  assert.match(blind.reason, /no WMI/);
});

test('liveCapturedPids distinguishes a surviving descendant from a released one', () => {
  const rows = [{ pid: 11, ppid: 0 }, { pid: 12, ppid: 0 }];
  const list = () => ({ ok: true, rows, reason: null });
  assert.deepEqual(liveCapturedPids([11, 99], { list }).live, [11]);
  assert.deepEqual(liveCapturedPids([98, 99], { list }).live, []);
  assert.equal(liveCapturedPids([], { list }).ok, false);
  assert.equal(liveCapturedPids([11], { list: () => ({ ok: false, rows: null, reason: 'down' }) }).ok, false);
});

test('an unowned child is a clean no-op', async () => {
  const stop = await stopOwnedChild(null);
  assert.equal(stop.stopped, true);
  assert.equal(stop.existed, false);
  assert.equal(stop.treeProven, true);
});

test('a crashed child is an honest failure, not a retry', () => {
  const crashed = { exitCode: 3, signalCode: null };
  assert.match(readChildFailure(crashed), /exited \(code 3\) before identifying itself/);
  const signalled = { exitCode: null, signalCode: 'SIGKILL' };
  assert.match(readChildFailure(signalled), /exited by signal SIGKILL/);
  assert.match(readChildFailure({}, new Error('spawn ENOENT')), /errored before identifying itself: spawn ENOENT/);
  assert.equal(readChildFailure({ exitCode: null, signalCode: null }), null);
});

test('identity must match this exact source, lab and prebundle', async () => {
  const expected = { source: 'S', lab: 'L', prebundle: 'P' };
  const attempts = [];
  const post = async () => {
    attempts.push(1);
    return { reachable: true, status: 200, parsed: { ok: true, result: { source: 'S', lab: 'L', prebundle: 'P', routes: ['/engine/docx-edit', '/engine/pdf-text-read', '/engine/pptx-open', '/engine/session-close'] } } };
  };
  const identity = await waitForIdentity({ baseUrl: 'http://127.0.0.1:1', expected, child: null, post, sleep: () => Promise.resolve(), requiredRoutes: ['/engine/docx-edit'] });
  assert.equal(identity.source, 'S');
  assert.equal(attempts.length, 1);
});

test('a host that answers with the wrong lab is refused, not accepted', async () => {
  const post = async () => ({ reachable: true, status: 200, parsed: { ok: true, result: { source: 'S', lab: 'OTHER', prebundle: 'P', routes: [] } } });
  await assert.rejects(
    () => waitForIdentity({ baseUrl: 'http://127.0.0.1:1', expected: { source: 'S', lab: 'L', prebundle: 'P' }, child: null, post, timeoutMs: 300, sleep: () => Promise.resolve(), pingAttemptMs: 1 }),
    /readiness timeout: the host never identified as S \/ L within 300ms/,
  );
});

test('readiness needs a real route answer, not merely a listener', async () => {
  const refused = await readinessProbe({ baseUrl: 'http://127.0.0.1:1', fixturePath: 'f', post: async () => ({ reachable: true, status: 200, parsed: { ok: false, code: 'no_route' } }) });
  assert.equal(refused.ok, false);
  const served = await readinessProbe({ baseUrl: 'http://127.0.0.1:1', fixturePath: 'f', post: async () => ({ reachable: true, status: 200, parsed: { ok: true, result: {} } }) });
  assert.equal(served.ok, true);
});

// ---------------------------------------------------------------------------
// cleanup and evidence
// ---------------------------------------------------------------------------

test('cleanup reports what actually happened and cannot claim a clean release it did not prove', async () => {
  const work = scratchDir('cleanup');
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  plan.existsSync = () => false;
  const unproven = await cleanupOwned({
    plan,
    host: { pid: 1 },
    stop: async () => ({ stopped: false, exited: false, treeProven: false }),
    releaseWait: async () => ({ released: false, port: plan.enginePort }),
  });
  assert.equal(unproven.host.ok, false);
  assert.equal(unproven.portReleased.released, false);
  assert.match(unproven.note, /cleanup is not proven clean; the exit code is nonzero/);

  const proven = await cleanupOwned({
    plan,
    host: { pid: 1 },
    stop: async () => ({ stopped: true, exited: true, treeProven: true }),
    releaseWait: async () => ({ released: true, port: plan.enginePort }),
  });
  assert.equal(proven.host.ok, true);
  assert.match(proven.note, /the owned host tree stopped and the engine port is free again/);
});

test('a cleanup that throws is reported as a failure, never as a success', async () => {
  const work = scratchDir('cleanup-throw');
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  plan.existsSync = () => false;
  const outcome = await cleanupOwned({
    plan,
    host: { pid: 1 },
    stop: async () => { throw new Error('boom'); },
    releaseWait: async () => ({ released: true, port: plan.enginePort }),
  });
  assert.equal(outcome.host.ok, false);
  assert.match(outcome.host.killError, /boom/);
});

test('an unproven descendant tree cannot carry exit 0 unless the operator opts in', async () => {
  const work = scratchDir('cleanup-unknown');
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  plan.existsSync = () => false;
  const unknownStop = async () => ({ stopped: true, exited: true, treeProven: false, unknown: true });
  const released = async () => ({ released: true, port: plan.enginePort });
  const strict = await cleanupOwned({ plan, host: { pid: 1 }, stop: unknownStop, releaseWait: released });
  assert.equal(strict.host.ok, false, 'unproven by default must not be clean');
  const opted = await cleanupOwned({ plan: Object.assign({}, plan, { allowUnknownCleanup: true }), host: { pid: 1 }, stop: unknownStop, releaseWait: released });
  assert.equal(opted.host.ok, true);
  assert.equal(opted.host.unknownAccepted, true);
  assert.match(opted.note, /UNPROVEN/);
});

test('a failure record keeps the run kind and the stage that failed', () => {
  const record = buildFailureRecord({ stage: 'dependencies', error: new Error('missing dependency: x'), startedAt: 'T0' });
  assert.equal(record.kind, RUN_KIND);
  assert.equal(record.ok, false);
  assert.equal(record.exitCode, 1);
  assert.equal(record.failure.stage, 'dependencies');
  assert.match(record.failure.message, /missing dependency: x/);
});

test('the host command names the pinned node, tsx, host entry, lab, prebundle and port', () => {
  const work = scratchDir('cmd');
  const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  const command = buildHostCommand(plan);
  assert.equal(command.executable, plan.nodeExe);
  const line = renderCommand(command);
  assert.match(line, /engine-host\.mts/);
  assert.match(line, /--source/);
  assert.match(line, /--lab/);
  assert.match(line, /--prebundle/);
  assert.match(line, new RegExp('--port ' + plan.enginePort));
  assert.equal(plan.hostEntry, path.join(REPO_ROOT, ...HOST_ENTRY_RELATIVE));
  assert.equal(plan.adapterScript, path.join(REPO_ROOT, ...ADAPTER_SCRIPT_RELATIVE));
});

// ---------------------------------------------------------------------------
// real bounded integrations (no host boot of the real engine needed)
// ---------------------------------------------------------------------------

const realInputsReady = Boolean(PREPARED_SOURCE && fs.existsSync(PREPARED_SOURCE) && fs.existsSync(SOURCE_MANIFEST));
const skipReal = realInputsReady ? false : 'the prepared pinned source tree is not present in this checkout';

test('an occupied engine port makes the launcher fail nonzero before it boots anything', { skip: skipReal }, async () => {
  const holder = createServer(() => {});
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  const work = scratchDir('occupied');
  try {
    const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', String(port)], process.env);
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.record.ok, false);
    assert.match(outcome.record.failure.message, /already in use/);
    assert.equal(outcome.record.host, null, 'no host may be booted when the port is taken');
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('a stub host that crashes immediately is bounded and fails nonzero', { skip: skipReal }, async () => {
  const work = scratchDir('crash');
  const stub = path.join(work, 'crash-host.mjs');
  fs.writeFileSync(stub, 'process.exit(3);');
  const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', '5397', '--host-entry', stub, '--readiness-timeout-ms', '20000'], process.env);
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.record.failure.message, /exited \(code 3\) before identifying itself/);
  assert.equal(outcome.record.cleanup.portReleased.released, true, 'the owned port must be free again');
});

test('a stub host that never listens times out on a bounded wait and leaves no port held', { skip: skipReal }, async () => {
  const work = scratchDir('timeout');
  const stub = path.join(work, 'silent-host.mjs');
  fs.writeFileSync(stub, 'setInterval(() => {}, 1000);');
  const started = Date.now();
  const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', '5398', '--host-entry', stub, '--readiness-timeout-ms', '4000'], process.env);
  const elapsed = Date.now() - started;
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.record.failure.message, /readiness timeout/);
  assert.ok(elapsed < 90000, 'the wait must stay bounded, observed ' + elapsed + 'ms');
  assert.equal(outcome.record.cleanup.portReleased.released, true, 'the owned port must be free again');
});

test('a missing prepared source refuses the run and still writes a truthful failure record', async () => {
  const work = scratchDir('missing-source');
  // The absent source lives beside the work dir, not inside it: a --source inside
  // --work is now refused earlier as an ownership overlap, and this test is about
  // the dependency stage specifically.
  const absentSource = path.join(TEST_SCRATCH_ROOT, 'absent-source-' + Date.now());
  const outcome = await runLab(['--source', absentSource, '--work', work, '--engine-port', '5399'], process.env);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.record.failure.stage, 'dependencies');
  assert.match(outcome.record.failure.message, /missing dependency: source root/);
  assert.ok(outcome.record.evidencePath, 'the failure record must survive for a reader');
  assert.equal(outcome.record.ok, false);
});

test('a wrong pin refuses the run before it boots anything', { skip: skipReal }, async () => {
  const work = scratchDir('wrong-pin');
  const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--expected-pin', 'f'.repeat(40), '--engine-port', '5400'], process.env);
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.record.failure.message, /wrong pin/);
  assert.equal(outcome.record.host, null, 'no host may be booted when the pin is wrong');
});

// ---------------------------------------------------------------------------
// the REAL end-to-end run: the launcher boots the real pinned engine host and
// the frozen adapter contract must pass every case with no unavailable rows.
// ---------------------------------------------------------------------------

// A real interrupt: the handler is installed on an injected process object so this
// test can deliver SIGINT precisely, while the child process, the bounded wait and
// the cleanup are all the real ones. Scope, stated honestly: this proves the
// COOPERATIVE path. An external forced kill of the launcher PID runs no JavaScript
// and can still orphan descendants (a named G0 limitation, not a claimed guarantee).
test('a delivered SIGINT is honored: nonzero, named, bounded, and the owned port is released', { skip: skipReal, timeout: 120000 }, async () => {
  const work = scratchDir('interrupt');
  const stub = path.join(work, 'silent-host.mjs');
  fs.writeFileSync(stub, 'setInterval(() => {}, 1000);');
  const fakeProcess = new EventEmitter();
  const started = Date.now();
  const timer = setTimeout(() => fakeProcess.emit('SIGINT'), 3000);
  try {
    const outcome = await runLab(
      ['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', '5404', '--host-entry', stub, '--readiness-timeout-ms', '30000'],
      process.env,
      { processImpl: fakeProcess },
    );
    const elapsed = Date.now() - started;
    assert.equal(outcome.exitCode, 1, 'an interrupt is a refusal, never a pass');
    assert.match(outcome.record.failure.message, /received SIGINT; the run stopped/);
    assert.deepEqual(outcome.record.termination, { requested: true, signal: 'SIGINT', honored: true });
    assert.ok(elapsed < 25000, 'the interrupt must cut the bounded wait short, observed ' + elapsed + 'ms');
    assert.equal(outcome.record.cleanup.portReleased.released, true, 'the owned port must be free after an interrupt');
    const record = JSON.parse(fs.readFileSync(outcome.record.evidencePath, 'utf8'));
    assert.deepEqual(record.termination, { requested: true, signal: 'SIGINT', honored: true }, 'the interrupt survives in the retained evidence');
  } finally {
    clearTimeout(timer);
  }
});

test('the launcher boots the real pinned host and the frozen adapter passes with no unavailable rows', { skip: skipReal, timeout: 600000 }, async () => {
  const work = scratchDir('real');
  const port = 5401;
  const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', String(port)], process.env);
  const record = outcome.record;
  assert.equal(outcome.exitCode, 0, JSON.stringify({ failure: record.failure, cleanup: record.cleanup, adapter: record.adapter && { passed: record.adapter.passed, failed: record.adapter.failed, unavailable: record.adapter.unavailable } }));
  assert.equal(record.ok, true);
  assert.equal(record.adapter.total, 11);
  assert.equal(record.adapter.passed, 11);
  assert.equal(record.adapter.failed, 0);
  assert.equal(record.adapter.unavailable, 0);
  assert.equal(record.adapter.cases.every((entry) => entry.pass === true), true);
  assert.equal(record.adapter.cases.some((entry) => entry.unavailable === true), false);
  // the record names the exact runtime, pin, paths and commands
  assert.equal(record.pin.expectedPin, PIN);
  assert.equal(record.inputs.sourceRoot, PREPARED_SOURCE);
  assert.equal(record.inputs.enginePort, port);
  assert.equal(record.host.identity.source, PREPARED_SOURCE);
  assert.equal(record.host.identity.lab, record.inputs.labDir);
  assert.equal(record.host.readiness.ok, true);
  const labels = record.commands.map((entry) => entry.label);
  for (const label of ['generate-fixtures', 'build-prebundle', 'boot-engine-host', 'run-adapter-contract']) {
    assert.ok(labels.includes(label), 'the record must name the ' + label + ' command');
  }
  // owned resources are released, and evidence survives the run
  assert.equal(record.cleanup.host.ok, true);
  assert.equal(record.cleanup.portReleased.released, true);
  assert.equal(fs.existsSync(record.evidencePath), true);
  const onDisk = JSON.parse(fs.readFileSync(record.evidencePath, 'utf8'));
  assert.equal(onDisk.adapter.passed, 11);
  assert.equal(onDisk.cleanup.portReleased.released, true);
  // the fixture bytes the run used are recorded, with volatile ones declared
  assert.ok(record.fixturePreparation.rows.length >= 3);
  const volatileRow = record.fixturePreparation.determinism.find((row) => row.name === 'g0-slides.pptx');
  assert.ok(volatileRow, 'the generated pptx must be recorded');
  assert.equal(volatileRow.volatileAcrossRuns, true);
  assert.match(volatileRow.reason, /volatile package ids\/timestamps/);
  // the port is genuinely free afterwards
  const probe = await probePortFree(port);
  assert.equal(probe.free, true, 'the engine port must be released');
});

test('a second run over the same port after a clean first run still passes (no leaked owner)', { skip: skipReal, timeout: 600000 }, async () => {
  const port = 5402;
  const first = await runLab(['--source', PREPARED_SOURCE, '--work', scratchDir('rerun-1'), '--node', PINNED_NODE, '--engine-port', String(port)], process.env);
  assert.equal(first.exitCode, 0, JSON.stringify(first.record.failure));
  const second = await runLab(['--source', PREPARED_SOURCE, '--work', scratchDir('rerun-2'), '--node', PINNED_NODE, '--engine-port', String(port)], process.env);
  assert.equal(second.exitCode, 0, JSON.stringify(second.record.failure));
  assert.equal(second.record.adapter.passed, 11);
  assert.equal(second.record.cleanup.portReleased.released, true);
  // The regression this pins: a second run on the same port must not be refused
  // because the owned host had already exited when cleanup looked at it.
  assert.equal(second.record.cleanup.host.ok, true, 'the owned tree must be proven on the rerun too');
  assert.equal(second.record.cleanup.host.treeProven, true);
  assert.match(second.record.cleanup.host.treeProof, /taskkill-tree-close|observed-descendants-gone/);
  assert.equal(second.record.ownedTree.observed, true, 'the run must have observed its owned tree while it was alive');
});

test('a real run with caller-supplied fixtures is recorded as declared, not generated', { skip: skipReal, timeout: 600000 }, async () => {
  const work = scratchDir('declared');
  const fixtures = path.join(work, 'declared-fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  // Build the declared fixtures from the PINNED source with the launcher's own
  // generator. This test must not borrow another lane's generated lab, and it must
  // never pass by returning early when such a lane happens to be absent.
  const sourcePlan = resolveDefaults({ source: PREPARED_SOURCE, work }, { cwd: WORKSPACE_ROOT || process.cwd() });
  sourcePlan.fixturesDir = fixtures;
  const generated = await generateFixtures(sourcePlan);
  assert.equal(generated.ok, true, 'the pinned fixture generator must succeed: ' + JSON.stringify(generated.result).slice(0, 400));
  const required = ['g0-kitchen-sink.docx', 'g0-text.pdf', 'g0-slides.pptx'];
  for (const name of required) {
    assert.equal(fs.existsSync(path.join(fixtures, name)), true, 'the generated fixture ' + name + ' must exist');
  }
  const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', '5403', '--fixtures', fixtures], process.env);
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.record.failure));
  assert.equal(outcome.record.fixturePreparation.mode, 'declared');
  assert.equal(outcome.record.adapter.passed, 11);
  assert.equal(outcome.record.ownedTree.observed, true, 'a real run observes its owned descendants before cleanup');
  assert.equal(outcome.record.cleanup.host.treeProven, true);
});

// M1 end to end, negative: a prepared source whose root identity was rewritten is
// refused at the source-provenance stage, BEFORE any host is booted, and the refusal
// survives in the retained evidence. This is the real run, not a unit call.
test('M1: a source whose recorded identity was tampered with is refused before any boot', { skip: skipReal, timeout: 120000 }, async () => {
  const work = scratchDir('tampered-source');
  const tampered = path.join(TEST_SCRATCH_ROOT, 'tampered-' + Date.now());
  // Copy the small identity files only, and junction node_modules: this test is about
  // the identity check, and a full copy of the dependency cache would take minutes.
  fs.mkdirSync(tampered, { recursive: true });
  fs.cpSync(PREPARED_SOURCE, tampered, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== 'node_modules',
  });
  fs.symlinkSync(path.join(PREPARED_SOURCE, 'node_modules'), path.join(tampered, 'node_modules'), 'junction');
  const pkgPath = path.join(tampered, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = 'not-the-pinned-package';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  try {
    const outcome = await runLab(['--source', tampered, '--work', work, '--node', PINNED_NODE, '--engine-port', '5405'], process.env);
    assert.equal(outcome.exitCode, 1, 'a tampered source is never a pass');
    assert.equal(outcome.record.failure.stage, 'source-provenance');
    assert.match(outcome.record.failure.message, /does not match the pinned provenance/);
    assert.equal(outcome.record.host, null, 'nothing may be booted from unproven source');
    assert.equal(outcome.record.provenance.verified, false);
    assert.ok(outcome.record.provenance.problems.length > 0, 'the refusal names what did not match');
  } finally {
    fs.rmSync(tampered, { recursive: true, force: true });
  }
});

// M1 end to end, positive: a run that names a real upstream checkout AT the pinned
// commit records that verification in the evidence rather than leaving it implied.
// The upstream checkout is an OPTIONAL declared input. Its absence is an explicit skip,
// never a bare return that could be misread as a pass. The absent-input behaviour is
// covered by the 'recorded as unproven' unit test.
const UPSTREAM_CHECKOUT = WORKSPACE_ROOT ? path.join(WORKSPACE_ROOT, 'genoffice') : null;
const skipUpstream = skipPrepared || (UPSTREAM_CHECKOUT && fs.existsSync(path.join(UPSTREAM_CHECKOUT, '.git')) ? false : 'no upstream git checkout is declared or present for this run');
test('M1: a run with --upstream-checkout records the pinned-commit verification', { skip: skipUpstream, timeout: 600000 }, async () => {
  const upstream = UPSTREAM_CHECKOUT;
  const work = scratchDir('upstream');
  const outcome = await runLab(['--source', PREPARED_SOURCE, '--work', work, '--node', PINNED_NODE, '--engine-port', '5406', '--upstream-checkout', upstream], process.env);
  const checkout = outcome.record.upstreamCheckout;
  assert.equal(checkout.checked, true);
  assert.equal(checkout.observedCommit, PIN, 'the observed commit must be the pinned commit');
  assert.equal(checkout.verified, true, JSON.stringify(checkout.problems));
  assert.equal(outcome.record.provenance.verified, true);
});

test('--work inside a shared tree or a sibling lane is refused', { skip: skipWorkspace }, () => {
  const refuses = (workPath, pattern) => {
    const plan = resolveDefaults({ source: PREPARED_SOURCE || 's', work: workPath }, { cwd: WORKSPACE_ROOT });
    assert.throws(() => assertWorkInsideWorkspace(plan, WORKSPACE_ROOT), pattern);
  };
  refuses(path.join(WORKSPACE_ROOT, '.uniwork-dev'), /must be a directory inside/);
  refuses(path.join(WORKSPACE_ROOT, '.uniwork-dev', 'office-g0', 'sneak'), /overlaps|must be a fresh directory under/);
  refuses(path.join(WORKSPACE_ROOT, '.uniwork-dev', 'worktrees', 'other-lane', 'lab'), /overlaps|must be a fresh directory under/);
  refuses(REPO_ROOT, /overlaps|must be a fresh directory under/);
});
