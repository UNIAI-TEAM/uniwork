// UNI-668 (DOC-004) - reproducible REAL engine contract lab launcher.
//
// WHY THIS EXISTS
// scripts/office-g0/engine-contract-adapter.mjs drives the REAL DOC-003 spike
// engine host over loopback HTTP, but it deliberately does not boot the host: an
// operator had to start one by hand on 127.0.0.1:5392 first. That manual
// prerequisite is the gap this launcher closes. One command prepares an owned
// lab, boots the real pinned engine host, waits for identity AND readiness, runs
// the frozen DOC-004 adapter fault contract against it, retains a structured
// evidence record, and releases every resource it started.
//
// WHAT IT DOES NOT DO
// It does not edit the adapter, the contract harness, the engine host, the shared
// evidence register or any contract. It imports the frozen adapter and calls its
// own exported runner, so the cases and the pass/fail policy are unchanged. It
// never installs, never mutates the prepared source tree, and never writes
// outside its explicit work directory: --work must be a FRESH directory under
// <workspace>/.uniwork-dev that does not overlap the pinned source, this
// checkout, the shared office-g0/tools trees, or another lane's worktree.
//
// USABLE COMMAND (all inputs explicit; nothing is discovered from a sibling lane)
//   <pinned node> scripts/office-g0/run-engine-contract-lab.mjs ^
//     --source <prepared source module root> ^
//     --work <fresh isolated dir under the workspace root> ^
//     [--engine-port 5392] [--fixtures <declared fixtures dir>] ^
//     [--prebundle <file>] [--evidence-dir <dir>] [--host-entry <file>] ^
//     [--tsx <file>] [--node <file>] [--expected-pin <sha>] ^
//     [--readiness-timeout-ms 60000] [--remove-lab-on-success]
//
// FAILURE SEMANTICS (all nonzero, all bounded, all truthful)
//   occupied engine port  -> refuses before spawning; never signals a foreign PID
//   missing dependency    -> refuses before spawning; names the exact missing path
//   wrong pin             -> refuses; names expected vs observed
//   readiness timeout     -> bounded; stops the host it started; still writes evidence
//   child crash           -> detected by exit code/signal; stops what it owns; nonzero
//   cleanup unproven      -> nonzero, even when every case passed
//
// Node built-ins plus the frozen sibling adapter only. Import-safe: importing this
// module defines exports and starts nothing; main() runs only as the process entry.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RUN_KIND = 'uniwork-office-engine-contract-lab-run';
export const RUN_SCHEMA_VERSION = 1;
export const ISSUE = 'UNI-668';
export const PARENT_ISSUE = 'UNI-656';
/** Same default the frozen adapter uses, so the historical lab port stays the default. */
export const DEFAULT_ENGINE_PORT = 5392;
export const PING_ROUTE = '/engine/ping';
/** A cheap real route used to prove the host serves, not merely that it listens. */
export const READINESS_ROUTE = '/engine/read-file';
export const PREBUNDLE_RELATIVE_TO_LAB = Object.freeze(['engine', 'pptx-ops.mjs']);
export const FIXTURES_SUBDIR = 'fixtures';
/**
 * The frozen adapter's outside-lab case reads <allowedRoot>/package.json and requires
 * the host to refuse it as OUTSIDE the lab. The allowed root is therefore the owned
 * work directory (which contains the lab), and a real file must exist there for the
 * case to exercise `outside_lab` instead of `not_found`.
 */
export const OUTSIDE_MARKER_NAME = 'package.json';
export const EVIDENCE_SUBDIR = 'evidence';
export const SOURCE_MANIFEST_RELATIVE = Object.freeze(['docs', 'office', 'g0', 'source-manifest.json']);
export const HOST_ENTRY_RELATIVE = Object.freeze(['e2e', 'office-g0', 'engine-host.mts']);
export const FIXTURE_SCRIPT_RELATIVE = Object.freeze(['e2e', 'office-g0', 'make-fixtures.mts']);
export const PREBUNDLE_SCRIPT_RELATIVE = Object.freeze(['scripts', 'office-g0', 'prebundle-engine.mjs']);
export const ADAPTER_SCRIPT_RELATIVE = Object.freeze(['scripts', 'office-g0', 'engine-contract-adapter.mjs']);
export const TSX_CLI_RELATIVE = Object.freeze(['node_modules', 'tsx', 'dist', 'cli.mjs']);
export const ESBUILD_PACKAGE_RELATIVE = Object.freeze(['node_modules', 'esbuild', 'package.json']);
export const DEFAULT_TIMEOUTS = Object.freeze({
  readinessMs: 60000,
  pingAttemptMs: 250,
  portProbeMs: 4000,
  fixtureMs: 300000,
  stopMs: 15000,
  killMs: 10000,
  portReleaseMs: 15000,
});
/** Fixtures whose generator embeds volatile bytes; recorded, never silently pinned. */
export const VOLATILE_FIXTURE_NAMES = Object.freeze([
  'g0-slides.pptx',
  'g0-text.pdf',
  // Observed byte drift between two runs of the same pinned generator (independent
  // tester, 2026-09-21): the sheets builder also stamps volatile package metadata.
  'g0-compatibility-edit.xlsx',
  'g0-compatibility-kitchen-sink.xlsx',
]);

const NL = String.fromCharCode(10);
/** Body of the owned marker file; built after NL so it can terminate the JSON. */
export const OUTSIDE_MARKER_BODY = JSON.stringify({
  name: 'uni668-lab-outside-marker',
  private: true,
  description: 'owned by run-engine-contract-lab.mjs: a real file OUTSIDE the lab that the engine host must refuse',
}, null, 2) + NL;
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (filePath) => sha256Bytes(fs.readFileSync(filePath));
export const describeError = (error) => {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const message = error.message === undefined || error.message === null ? String(error) : String(error.message);
  return message.length > 0 ? message : String(error);
};

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * When the operator names the upstream git checkout explicitly, verify it is AT the
 * pinned commit and tree. This is the only check that proves the prepared copy descends
 * from the real pinned source rather than from some other tree. It is optional and is
 * never discovered from a hardcoded sibling path: absent, the record says pin identity
 * rests on the manifest artifacts alone (explicitly left partially unproven, not claimed).
 */
export function verifyUpstreamCheckout({ upstreamRoot, manifestPath, readJsonImpl = readJson, runGit = null, existsSync = fs.existsSync, spawnSyncImpl = spawnSync } = {}) {
  const manifest = readJsonImpl(manifestPath);
  const pinnedCommit = (manifest.upstream && manifest.upstream.pinnedCommit) || null;
  const pinnedTree = (manifest.upstream && manifest.upstream.pinnedTree) || null;
  const git = runGit || ((args) => spawnSyncImpl('git', args, { cwd: upstreamRoot, encoding: 'utf8', windowsHide: true }));
  if (!upstreamRoot || !existsSync(path.join(upstreamRoot, '.git'))) {
    return { checked: false, reason: 'no upstream git checkout was supplied; pin identity rests on the manifest artifacts alone', pinnedCommit, pinnedTree, problems: [] };
  }
  const problems = [];
  const head = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const status = git(['status', '--porcelain']);
  const observedCommit = head.status === 0 ? String(head.stdout || '').trim() : null;
  const observedTree = tree.status === 0 ? String(tree.stdout || '').trim() : null;
  const dirty = status.status === 0 ? String(status.stdout || '').trim().length > 0 : null;
  if (observedCommit !== pinnedCommit) problems.push('the upstream checkout is at ' + observedCommit + ' not the pinned commit ' + pinnedCommit);
  if (pinnedTree && observedTree !== pinnedTree) problems.push('the upstream checkout tree is ' + observedTree + ' not the pinned tree ' + pinnedTree);
  if (dirty === true) problems.push('the upstream checkout has uncommitted changes, so it is not provably the pinned source');
  return { checked: true, upstreamRoot, observedCommit, observedTree, dirty, pinnedCommit, pinnedTree, verified: problems.length === 0, problems };
}

/** Shared-lab markers: only the real workspace .uniwork-dev owns the pinned tools or
 * the worktrees registry, so a checkout-local .uniwork-dev/office-g0 stub cannot
 * satisfy them. */
export const WORKSPACE_ROOT_SHARED_MARKERS = Object.freeze([
  Object.freeze(['.uniwork-dev', 'tools']),
  Object.freeze(['.uniwork-dev', 'worktrees']),
]);

/**
 * The workspace root, in three ordered tiers:
 *   1. the nearest ancestor whose .uniwork-dev holds a SHARED lab marker (the pinned
 *      tools or the worktrees registry) - only the real workspace has those;
 *   2. else the nearest ancestor whose .uniwork-dev holds office-g0;
 *   3. else the nearest ancestor that holds a .uniwork-dev at all.
 * Tier 1 exists because a git checkout can carry its own checkout-local
 * .uniwork-dev/office-g0 stub. Nearest-first lookup returned that stub, so every valid
 * --work dir looked like it overlapped the checkout and the pinned lockfile resolved
 * under the wrong root. Ranking the shared markers first keeps the root stable for
 * both the main checkout and a linked worktree. Injectable existsSync keeps it testable.
 */
export function findWorkspaceRoot(startDir, existsSync = fs.existsSync) {
  const chain = [];
  let dir = path.resolve(startDir);
  for (;;) {
    chain.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Tier 1: the shared lab root. A checkout-local office-g0 stub does not carry the
  // pinned tools or the worktrees registry, so it cannot satisfy this tier.
  const sharedRoot = chain.find((candidate) =>
    existsSync(path.join(candidate, '.uniwork-dev')) &&
    WORKSPACE_ROOT_SHARED_MARKERS.some((marker) => existsSync(path.join(candidate, ...marker))));
  if (sharedRoot) return sharedRoot;
  // Tier 2: a lab root identified by its office-g0 tree alone.
  const labRoot = chain.find((candidate) =>
    existsSync(path.join(candidate, '.uniwork-dev')) && existsSync(path.join(candidate, '.uniwork-dev', 'office-g0')));
  if (labRoot) return labRoot;
  // Tier 3: any .uniwork-dev ancestor.
  return chain.find((candidate) => existsSync(path.join(candidate, '.uniwork-dev'))) || null;
}

/** A resolved path must equal the root or keep it as an ancestor after resolution. */
export function isInside(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep);
}

/**
 * Physical containment, not just lexical: resolve symlinks/junctions on BOTH sides
 * before comparing. A junction under the workspace that points outside it must not
 * pass a lexical check, and the frozen host does the same for document paths.
 * For an absent target, resolve the nearest existing ancestor and append the missing
 * descendants. That matters on Windows: `junction\fresh-child` does not exist yet,
 * but the junction DOES and may lead outside the workspace.
 */
export function realPathOf(target, { realpathSync = fs.realpathSync, existsSync = fs.existsSync } = {}) {
  const resolved = path.resolve(target);
  let existing = resolved;
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return resolved;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  try { return path.join(realpathSync(existing), ...missing); } catch { return resolved; }
}

export function isReallyInside(root, target, { realpathSync = fs.realpathSync, existsSync = fs.existsSync } = {}) {
  const rootReal = realPathOf(root, { realpathSync, existsSync });
  const targetReal = realPathOf(target, { realpathSync, existsSync });
  return targetReal === rootReal || targetReal.startsWith(rootReal + path.sep);
}

export function assertReallyInside(root, target, label, { realpathSync = fs.realpathSync, existsSync = fs.existsSync } = {}) {
  const targetReal = realPathOf(target, { realpathSync, existsSync });
  if (!isReallyInside(root, target, { realpathSync, existsSync })) {
    throw new Error('[uni668-lab] ' + label + ' must stay inside ' + realPathOf(root, { realpathSync, existsSync }) + ': ' + targetReal);
  }
  return targetReal;
}

export function assertInside(root, target, label) {
  const resolved = path.resolve(target);
  if (!isInside(root, resolved)) {
    throw new Error('[uni668-lab] ' + label + ' must stay inside ' + path.resolve(root) + ': ' + resolved);
  }
  return resolved;
}

export function requireExistingFile(filePath, label, existsSync = fs.existsSync) {
  if (!existsSync(filePath)) {
    throw new Error('[uni668-lab] missing ' + label + ': ' + filePath);
  }
  return filePath;
}

const FLAGS = [
  ['source', 'OFFICE_G0_LAB_SOURCE'],
  ['work', 'OFFICE_G0_LAB_WORK'],
  ['fixtures', 'OFFICE_G0_LAB_FIXTURES'],
  ['prebundle', 'OFFICE_G0_LAB_PREBUNDLE'],
  ['evidence-dir', 'OFFICE_G0_LAB_EVIDENCE_DIR'],
  ['host-entry', 'OFFICE_G0_LAB_HOST_ENTRY'],
  ['tsx', 'OFFICE_G0_LAB_TSX'],
  ['node', 'OFFICE_G0_LAB_NODE'],
  ['manifest', 'OFFICE_G0_LAB_MANIFEST'],
  ['expected-pin', 'OFFICE_G0_LAB_EXPECTED_PIN'],
  ['upstream-checkout', 'OFFICE_G0_LAB_UPSTREAM_CHECKOUT'],
  ['engine-port', 'OFFICE_G0_LAB_ENGINE_PORT'],
  ['readiness-timeout-ms', 'OFFICE_G0_LAB_READINESS_TIMEOUT_MS'],
];

export function assertPortNumber(port, label = 'engine port') {
  const value = typeof port === 'number' ? port : Number(port);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error('[uni668-lab] invalid ' + label + ': ' + String(port));
  }
  return value;
}

/**
 * Parse the explicit inputs. Source and work are REQUIRED and never inferred from
 * a sibling lane, so a fresh isolated directory is the only thing a run can use.
 */
export function parseArgs(argv, env = process.env, { existsSync = fs.existsSync } = {}) {
  const flagOf = (name) => {
    const index = argv.indexOf('--' + name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const pick = (name, envName) => {
    const raw = flagOf(name) !== undefined ? flagOf(name) : env[envName];
    return String(raw === undefined || raw === null ? '' : raw).trim() || null;
  };
  // Walk the argv as flag/value pairs so a value that happens to start with --
  // is never misread as an unknown flag.
  const BOOLEAN_FLAGS = new Set(['--help', '-h', '--remove-lab-on-success', '--allow-unknown-cleanup']);
  const VALUE_FLAGS = new Set(FLAGS.map((entry) => '--' + entry[0]));
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (BOOLEAN_FLAGS.has(token)) continue;
    if (VALUE_FLAGS.has(token)) { index += 1; continue; }
    unknown.push(token);
  }
  if (unknown.length > 0) {
    throw new Error('[uni668-lab] unknown argument(s): ' + unknown.join(', '));
  }
  const args = {
    source: pick('source', 'OFFICE_G0_LAB_SOURCE'),
    work: pick('work', 'OFFICE_G0_LAB_WORK'),
    fixtures: pick('fixtures', 'OFFICE_G0_LAB_FIXTURES'),
    prebundle: pick('prebundle', 'OFFICE_G0_LAB_PREBUNDLE'),
    evidenceDir: pick('evidence-dir', 'OFFICE_G0_LAB_EVIDENCE_DIR'),
    hostEntry: pick('host-entry', 'OFFICE_G0_LAB_HOST_ENTRY'),
    tsx: pick('tsx', 'OFFICE_G0_LAB_TSX'),
    node: pick('node', 'OFFICE_G0_LAB_NODE'),
    manifest: pick('manifest', 'OFFICE_G0_LAB_MANIFEST'),
    expectedPin: pick('expected-pin', 'OFFICE_G0_LAB_EXPECTED_PIN'),
    upstreamCheckout: pick('upstream-checkout', 'OFFICE_G0_LAB_UPSTREAM_CHECKOUT'),
    enginePort: assertPortNumber(pick('engine-port', 'OFFICE_G0_LAB_ENGINE_PORT') ?? DEFAULT_ENGINE_PORT),
    readinessTimeoutMs: Number(pick('readiness-timeout-ms', 'OFFICE_G0_LAB_READINESS_TIMEOUT_MS') ?? DEFAULT_TIMEOUTS.readinessMs),
    removeLabOnSuccess: argv.includes('--remove-lab-on-success'),
    allowUnknownCleanup: argv.includes('--allow-unknown-cleanup'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
  if (!Number.isFinite(args.readinessTimeoutMs) || args.readinessTimeoutMs <= 0) {
    throw new Error('[uni668-lab] --readiness-timeout-ms must be a positive number');
  }
  if (args.help) return args;
  const missing = [];
  if (!args.source) missing.push('--source (or OFFICE_G0_LAB_SOURCE)');
  if (!args.work) missing.push('--work (or OFFICE_G0_LAB_WORK)');
  if (missing.length > 0) {
    throw new Error('[uni668-lab] missing required input(s): ' + missing.join(', '));
  }
  return args;
}

/** Default paths the layout implies, resolved against this checkout and the source. */
export function resolveDefaults(args, { cwd = process.cwd(), repoRoot = REPO_ROOT, existsSync = fs.existsSync } = {}) {
  const sourceRoot = path.resolve(cwd, args.source);
  const workDir = path.resolve(cwd, args.work);
  const manifest = args.manifest ? path.resolve(cwd, args.manifest) : path.join(repoRoot, ...SOURCE_MANIFEST_RELATIVE);
  const tsx = args.tsx ? path.resolve(cwd, args.tsx) : path.join(sourceRoot, ...TSX_CLI_RELATIVE);
  const nodeExe = args.node ? path.resolve(cwd, args.node) : process.execPath;
  const hostEntry = args.hostEntry ? path.resolve(cwd, args.hostEntry) : path.join(repoRoot, ...HOST_ENTRY_RELATIVE);
  const fixturesScript = path.join(repoRoot, ...FIXTURE_SCRIPT_RELATIVE);
  const prebundleScript = path.join(repoRoot, ...PREBUNDLE_SCRIPT_RELATIVE);
  const adapterScript = path.join(repoRoot, ...ADAPTER_SCRIPT_RELATIVE);
  return {
    cwd, sourceRoot, workDir, manifest, tsx, nodeExe, hostEntry, fixturesScript, prebundleScript, adapterScript,
    labDir: path.join(workDir, 'lab'),
    // The adapter's containment root: the owned work dir, which contains the lab.
    allowedRoot: workDir,
    outsideMarkerPath: path.join(workDir, OUTSIDE_MARKER_NAME),
    fixturesDir: args.fixtures ? path.resolve(cwd, args.fixtures) : path.join(workDir, FIXTURES_SUBDIR),
    prebundlePath: args.prebundle ? path.resolve(cwd, args.prebundle) : path.join(workDir, 'lab', ...PREBUNDLE_RELATIVE_TO_LAB),
    evidenceDir: args.evidenceDir ? path.resolve(cwd, args.evidenceDir) : path.join(workDir, EVIDENCE_SUBDIR),
    logDir: path.join(workDir, 'logs'),
    tmpDir: path.join(workDir, 'tmp'),
    enginePort: args.enginePort,
    expectedPin: args.expectedPin,
    upstreamCheckout: args.upstreamCheckout ? path.resolve(cwd, args.upstreamCheckout) : null,
    readinessTimeoutMs: args.readinessTimeoutMs,
    removeLabOnSuccess: args.removeLabOnSuccess,
    allowUnknownCleanup: args.allowUnknownCleanup === true,
    fixturesProvided: Boolean(args.fixtures),
    prebundleProvided: Boolean(args.prebundle),
    existsSync,
  };
}

/**
 * The work directory must be a FRESH directory owned by this run, under
 * <workspace>/.uniwork-dev, overlapping nothing that already exists and matters.
 */
export function assertWorkInsideWorkspace(plan, workspaceRoot = findWorkspaceRoot(plan.cwd), deps = {}) {
  const realpathSync = deps.realpathSync || fs.realpathSync;
  if (!workspaceRoot) {
    throw new Error('[uni668-lab] no workspace root (a directory holding .uniwork-dev) above ' + plan.cwd);
  }
  const workspaceReal = realPathOf(workspaceRoot, { realpathSync });
  const scratchRoot = path.join(workspaceReal, '.uniwork-dev');
  const workReal = realPathOf(plan.workDir, { realpathSync });
  if (workReal === realPathOf(scratchRoot, { realpathSync })) {
    throw new Error('[uni668-lab] --work must be a directory inside ' + scratchRoot + ': ' + workReal);
  }
  if (!isReallyInside(scratchRoot, workReal, { realpathSync })) {
    throw new Error('[uni668-lab] --work must be a fresh directory under ' + scratchRoot + ': ' + workReal);
  }
  // Refuse overlap with any tree this run must not touch. Overlap is symmetric:
  // --work inside a forbidden tree, or a forbidden tree inside --work, both mutate it.
  const forbidden = [
    ['--source (the pinned source)', plan.sourceRoot],
    ['this git checkout', REPO_ROOT],
    ['the shared office-g0 evidence/tooling tree', path.join(workspaceReal, '.uniwork-dev', 'office-g0')],
    ['the pinned tools tree', path.join(workspaceReal, '.uniwork-dev', 'tools')],
    ['the worktrees directory (all sibling lanes)', path.join(workspaceReal, '.uniwork-dev', 'worktrees')],
  ];
  for (const [label, target] of forbidden) {
    if (!target) continue;
    const targetReal = realPathOf(target, { realpathSync });
    if (isReallyInside(targetReal, workReal, { realpathSync }) || isReallyInside(workReal, targetReal, { realpathSync })) {
      throw new Error('[uni668-lab] --work overlaps ' + label + ' and must be a separate fresh directory: ' + workReal);
    }
  }
  assertInside(plan.workDir, plan.labDir, 'lab dir');
  assertInside(plan.workDir, plan.evidenceDir, 'evidence dir');
  // Freshness, scoped to what it actually protects: a leftover LAB tree means --work
  // already belongs to an earlier run, and adopting it would mix two runs into one
  // record. Declared operator inputs (a stub host, fixtures) are legitimate, so the
  // scratch and log trees are NOT treated as a reason to refuse.
  if ((deps.existsSync || fs.existsSync)(plan.labDir)) {
    throw new Error('[uni668-lab] --work is not fresh: it already holds a lab tree (' + path.resolve(plan.labDir) + '). Use a NEW directory rather than adopting another run tree.');
  }
  // Caller-supplied fixtures/prebundle are READ-ONLY inputs and may live at any
  // explicit path; a path this launcher would create stays inside its own work tree.
  if (plan.prebundleProvided) {
    assertReallyInside(workspaceRoot, plan.prebundlePath, '--prebundle', { realpathSync });
  } else {
    assertInside(plan.workDir, plan.prebundlePath, 'prebundle path');
  }
  if (plan.fixturesProvided) {
    assertReallyInside(workspaceRoot, plan.fixturesDir, '--fixtures', { realpathSync });
  } else {
    assertInside(plan.workDir, plan.fixturesDir, 'fixtures dir');
  }
  return workspaceRoot;
}

/**
 * Read the pinned source manifest and the adapter's own declared upstream pin, and
 * refuse when either disagrees with the expected pin or with each other. A wrong
 * pin is a hard stop: the run would not be evidence about the pinned engine.
 */
export function resolvePinState({ manifestPath, sourceRoot, expectedPin, adapterUpstreamPin, readJsonImpl = readJson, sha256 = sha256File, existsSync = fs.existsSync }) {
  const manifest = readJsonImpl(manifestPath);
  const manifestPin = manifest && manifest.upstream ? manifest.upstream.pinnedCommit : null;
  const manifestTree = manifest && manifest.upstream ? manifest.upstream.pinnedTree : null;
  const lockfileRel = manifest && manifest.lockfile ? manifest.lockfile.path : null;
  const lockfileExpected = manifest && manifest.lockfile ? manifest.lockfile.sha256Lower : null;
  const lockfilePath = lockfileRel ? path.join(sourceRoot, lockfileRel) : null;
  const lockfileSha256 = lockfilePath && existsSync(lockfilePath) ? sha256(lockfilePath) : null;
  const expected = expectedPin || manifestPin;
  const problems = [];
  if (!manifestPin) problems.push('the source manifest declares no upstream.pinnedCommit');
  if (expectedPin && manifestPin && expectedPin !== manifestPin) {
    problems.push('--expected-pin ' + expectedPin + ' disagrees with the manifest pin ' + manifestPin);
  }
  if (adapterUpstreamPin && manifestPin && adapterUpstreamPin !== manifestPin) {
    problems.push('the frozen adapter declares upstream pin ' + adapterUpstreamPin + ' but the manifest declares ' + manifestPin);
  }
  if (!lockfilePath) {
    problems.push('the source manifest declares no lockfile path');
  } else if (!existsSync(lockfilePath)) {
    problems.push('the pinned lockfile is absent in the source tree: ' + lockfilePath);
  } else if (lockfileExpected && lockfileSha256 !== lockfileExpected) {
    problems.push('the source lockfile is not the pinned one: expected ' + lockfileExpected + ', observed ' + lockfileSha256);
  }
  return {
    manifestPin, adapterUpstreamPin: adapterUpstreamPin || null, expectedPin: expected, lockfilePath, lockfileExpected, lockfileSha256,
    verified: problems.length === 0,
    problems,
    manifestPath,
  };
}

export function assertPinState(pinState) {
  if (!pinState.verified) {
    throw new Error('[uni668-lab] wrong pin: ' + pinState.problems.join('; '));
  }
  return pinState;
}

/**
 * Verify the prepared source carries the bytes the pin claims. A commit string plus a
 * lockfile hash proves which pin a run BELIEVED; it does not prove the source tree is
 * that pin. This reads the manifest's own independently recorded artifacts -- the
 * license/notice file hashes, the lockfile hash and the pinned root package.json -- plus
 * an optional git checkout at the pinned commit/tree, so identity rests on accepted
 * provenance rather than on a digest this run observed about itself.
 */
export function verifySourceProvenance({
  manifestPath, sourceRoot, cloneRoot = null, readJsonImpl = readJson, sha256 = sha256File,
  existsSync = fs.existsSync, readFileImpl = (p) => fs.readFileSync(p, 'utf8'), execGit = null,
} = {}) {
  const manifest = readJsonImpl(manifestPath);
  const problems = [];
  const evidence = { checked: [], cloneRoot: cloneRoot || null };
  const hashOf = (rel) => {
    const abs = path.join(sourceRoot, rel);
    if (!existsSync(abs)) return { rel, exists: false, sha256: null, bytes: null };
    const stat = fs.statSync(abs);
    return { rel, exists: true, bytes: stat.size, sha256: sha256(abs) };
  };
  // 1. Every in-trial license/notice file must match the manifest's recorded bytes/hash.
  const licenseFiles = (manifest.licenses && manifest.licenses.licenseFiles) || [];
  for (const entry of licenseFiles) {
    if (entry.inTrial === false) continue;
    const observed = hashOf(entry.path);
    const wanted = String(entry.sha256 || '').toLowerCase();
    const ok = observed.exists && observed.bytes === entry.bytes && String(observed.sha256 || '').toLowerCase() === wanted;
    evidence.checked.push({ kind: 'license', path: entry.path, ok, expectedSha256: wanted, observedSha256: observed.sha256 });
    if (!ok) problems.push('license/notice ' + entry.path + ' does not match the pinned bytes: expected ' + wanted + ', observed ' + observed.sha256);
  }
  // 2. The pinned lockfile must be the manifest's lockfile.
  const lockPath = manifest.lockfile && manifest.lockfile.path;
  if (lockPath) {
    const observed = hashOf(lockPath);
    const wanted = String((manifest.lockfile && manifest.lockfile.sha256) || '').toLowerCase();
    const ok = observed.exists && String(observed.sha256 || '').toLowerCase() === wanted;
    evidence.checked.push({ kind: 'lockfile', path: lockPath, ok, expectedSha256: wanted, observedSha256: observed.sha256 });
    if (!ok) problems.push('lockfile ' + lockPath + ' does not match the pinned bytes: expected ' + wanted + ', observed ' + observed.sha256);
  }
  // 3. The prepared root package.json must name the pinned upstream package/version and
  //    declare the manifest's supported node range, so the binary/source identity and the
  //    runtime identity come from the same accepted manifest.
  const pkgRel = 'package.json';
  const pkgAbs = path.join(sourceRoot, pkgRel);
  if (!existsSync(pkgAbs)) {
    problems.push('the prepared source has no root package.json; its identity cannot be checked');
    evidence.checked.push({ kind: 'package', path: pkgRel, ok: false });
  } else {
    let pkg = null;
    try { pkg = JSON.parse(readFileImpl(pkgAbs)); } catch (error) { problems.push('the prepared root package.json is not readable JSON: ' + describeError(error)); }
    const declaredName = manifest.upstream && manifest.upstream.rootPackageName;
    const declaredVersion = manifest.upstream && manifest.upstream.rootPackageVersion;
    const enginesNode = pkg && pkg.engines ? pkg.engines.node : null;
    const rangeOk = enginesNode !== null && enginesNode !== undefined && String(enginesNode) === String((manifest.runtime && manifest.runtime.node && manifest.runtime.node.requiredRange) || '');
    const nameOk = !declaredName || (pkg && pkg.name === declaredName);
    const versionOk = !declaredVersion || (pkg && pkg.version === declaredVersion);
    const ok = Boolean(pkg) && nameOk && versionOk && rangeOk;
    evidence.checked.push({ kind: 'package', path: pkgRel, ok, observed: pkg ? { name: pkg.name, version: pkg.version, enginesNode } : null, expected: { name: declaredName, version: declaredVersion, enginesNode: (manifest.runtime && manifest.runtime.node && manifest.runtime.node.requiredRange) || null } });
    if (!ok) problems.push('the prepared root package.json does not match the pinned upstream identity: ' + JSON.stringify(pkg ? { name: pkg.name, version: pkg.version, enginesNode } : null));
  }
  return { manifestPin: (manifest.upstream && manifest.upstream.pinnedCommit) || null, manifestTree: (manifest.upstream && manifest.upstream.pinnedTree) || null, verified: problems.length === 0, problems, evidence };
}


/** Every path this run needs, checked before anything is spawned. */
export function dependencyChecks(plan, { existsSync = fs.existsSync } = {}) {
  const entries = [
    { role: 'source root', path: plan.sourceRoot, kind: 'dir' },
    { role: 'pinned node executable', path: plan.nodeExe, kind: 'file' },
    { role: 'tsx cli in the prepared source', path: plan.tsx, kind: 'file' },
    { role: 'esbuild in the prepared source', path: path.join(plan.sourceRoot, ...ESBUILD_PACKAGE_RELATIVE), kind: 'file' },
    { role: 'engine host entry', path: plan.hostEntry, kind: 'file' },
    { role: 'fixture generator', path: plan.fixturesScript, kind: 'file' },
    { role: 'prebundle builder', path: plan.prebundleScript, kind: 'file' },
    { role: 'frozen adapter contract', path: plan.adapterScript, kind: 'file' },
    { role: 'source manifest', path: plan.manifest, kind: 'file' },
  ];
  return entries.map((entry) => {
    let ok = false;
    try {
      const stat = existsSync(entry.path) ? fs.statSync(entry.path) : null;
      ok = entry.kind === 'dir' ? Boolean(stat && stat.isDirectory()) : Boolean(stat && stat.isFile());
    } catch { ok = false; }
    return Object.assign({}, entry, { ok });
  });
}

export function assertDependencies(checks) {
  const missing = checks.filter((entry) => !entry.ok);
  if (missing.length > 0) {
    throw new Error('[uni668-lab] missing dependency: ' + missing.map((entry) => entry.role + ' -> ' + entry.path).join('; '));
  }
  return checks;
}

/** A port is free only when this process can bind it; nothing is killed either way. */
export function probePortFree(port, { netImpl = net, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const probe = netImpl.createServer();
    probe.once('error', (error) => {
      resolve({ free: false, port, reason: describeError(error) });
    });
    probe.listen(port, host, () => {
      probe.close(() => resolve({ free: true, port, reason: null }));
    });
  });
}

export async function assertPortFreeOrRefuse(port, { probe = probePortFree } = {}) {
  const result = await probe(port);
  if (!result.free) {
    throw new Error('[uni668-lab] engine port ' + port + ' is already in use; refusing to boot and refusing to signal a foreign process: ' + result.reason);
  }
  return result;
}

/** Bounded wait for the port to become free again after the owned host is stopped. */
export async function waitForPortRelease(port, { timeoutMs = DEFAULT_TIMEOUTS.portReleaseMs, probe = probePortFree, now = Date.now, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const deadline = now() + timeoutMs;
  let last = { free: false, port, reason: "not probed" };
  for (;;) {
    last = await probe(port);
    if (last.free) return { released: true, port, waitedMs: timeoutMs - (deadline - now()), last };
    const left = deadline - now();
    if (left <= 0) break;
    await wait(Math.min(250, left));
  }
  return { released: false, port, waitedMs: timeoutMs, last };
}

/** One bounded HTTP POST; never throws, a transport failure is an observed result. */
export function httpPost({ baseUrl, route, body = {}, timeoutMs = 5000, fetchImpl = fetch, AbortControllerImpl = AbortController }) {
  const controller = new AbortControllerImpl();
  const timer = setTimeout(() => controller.abort(new Error('request deadline')), timeoutMs);
  return fetchImpl(String(baseUrl).replace(/[/]+$/, '') + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(
    async (response) => {
      const text = await response.text();
      let parsed = null;
      let parseError = null;
      try { parsed = text.length === 0 ? null : JSON.parse(text); } catch (error) { parseError = describeError(error); }
      return { reachable: true, status: response.status, parsed, parseError, bodyBytes: Buffer.byteLength(text) };
    },
    (error) => ({ reachable: false, status: null, parsed: null, parseError: null, bodyBytes: 0, transportError: describeError(error) }),
  ).finally(() => clearTimeout(timer));
}

/** An exit by code OR signal, or a spawn error, is an honest failure, never a retry. */
export function readChildFailure(child, childError = null) {
  const failure = typeof childError === 'function' ? childError() : childError;
  if (failure) return 'engine host errored before identifying itself: ' + describeError(failure);
  if (!child) return null;
  const code = child.exitCode === undefined ? null : child.exitCode;
  const signal = child.signalCode === undefined ? null : child.signalCode;
  if (code !== null) return 'engine host exited (code ' + code + ') before identifying itself';
  if (signal !== null) return 'engine host exited by signal ' + signal + ' before identifying itself';
  return null;
}

/**
 * Wait for the host to IDENTIFY as this exact source/lab/prebundle, bounded by one
 * shared deadline. A child that exited, or a ping that never matches, both fail.
 */
export async function waitForIdentity({
  baseUrl, expected, child, childError = null, timeoutMs = DEFAULT_TIMEOUTS.readinessMs,
  post = httpPost, now = Date.now, sleep, pingAttemptMs = DEFAULT_TIMEOUTS.pingAttemptMs,
  requiredRoutes = [], termination = null,
}) {
  const wait = sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const deadline = now() + timeoutMs;
  const initial = readChildFailure(child, childError);
  if (initial) throw new Error('[uni668-lab] ' + initial);
  let last = 'no attempt';
  while (now() < deadline) {
    // An operator interrupt during the bounded wait stops at the next ping rather
    // than running out the whole readiness budget.
    assertNotTerminated(termination);
    const failure = readChildFailure(child, childError);
    if (failure) throw new Error('[uni668-lab] ' + failure);
    const remaining = Math.max(pingAttemptMs, deadline - now());
    const envelope = await post({ baseUrl, route: PING_ROUTE, body: {}, timeoutMs: remaining });
    const failedAfter = readChildFailure(child, childError);
    if (failedAfter) throw new Error('[uni668-lab] ' + failedAfter);
    if (envelope.reachable && envelope.parsed && envelope.parsed.ok === true) {
      const result = envelope.parsed.result || {};
      const identity = {
        source: result.source === undefined ? null : result.source,
        lab: result.lab === undefined ? null : result.lab,
        prebundle: result.prebundle === undefined ? null : result.prebundle,
        routes: Array.isArray(result.routes) ? result.routes : [],
      };
      const matches = identity.source === expected.source && identity.lab === expected.lab;
      const prebundleOk = !expected.prebundle || identity.prebundle === expected.prebundle;
      const routesOk = requiredRoutes.every((route) => identity.routes.includes(route));
      if (matches && prebundleOk && routesOk) {
        return identity;
      }
      last = 'ping did not identify the intended source/lab/prebundle: ' + JSON.stringify(identity);
    } else {
      last = envelope.reachable ? ('ping refused with status ' + envelope.status) : ('ping unreachable: ' + envelope.transportError);
    }
    const left = deadline - now();
    if (left <= 0) break;
    await wait(Math.max(0, Math.min(250, left)));
  }
  throw new Error('[uni668-lab] engine readiness timeout: the host never identified as ' + expected.source + ' / ' + expected.lab + ' within ' + timeoutMs + 'ms: ' + last);
}

/** Readiness, not just liveness: one real route must answer from the owned lab. */
export async function readinessProbe({ baseUrl, fixturePath, post = httpPost, timeoutMs = 10000 }) {
  const envelope = await post({ baseUrl, route: READINESS_ROUTE, body: { path: fixturePath }, timeoutMs });
  const ok = envelope.reachable && envelope.parsed && envelope.parsed.ok === true;
  return { ok, route: READINESS_ROUTE, fixturePath, envelope };
}

/**
 * Enumerate live processes as {pid, ppid} pairs, so cleanup can VERIFY that the
 * processes this run observed under its owned host are really gone, instead of
 * inferring the whole tree from one taskkill exit code. Returns ok:false when
 * enumeration is unavailable, so a caller stays honestly unproven rather than
 * guessing. Windows-only: the tree proof this feeds is documented as
 * Windows-specific, and no Unix tree proof is claimed from it.
 */
export function listProcesses({ platform = process.platform, execFileImpl = spawnSync, timeoutMs = DEFAULT_TIMEOUTS.killMs } = {}) {
  if (platform !== 'win32') {
    return { ok: false, rows: null, reason: 'process enumeration is implemented for Windows in this lab' };
  }
  const script = 'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | '
    + 'ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)" }';
  let result = null;
  try {
    result = execFileImpl('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  } catch (error) {
    return { ok: false, rows: null, reason: describeError(error) };
  }
  if (!result || result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    const why = result && result.error ? describeError(result.error) : 'process enumeration returned status ' + (result ? result.status : 'none');
    return { ok: false, rows: null, reason: why };
  }
  const rows = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (text.length === 0) continue;
    const parts = text.split('|');
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) rows.push({ pid, ppid });
  }
  if (rows.length === 0) return { ok: false, rows: null, reason: 'process enumeration returned no rows' };
  return { ok: true, rows, reason: null };
}

/** Every descendant pid of rootPid, resolved from one enumeration snapshot. */
export function descendantPids(rootPid, rows) {
  const byParent = new Map();
  for (const row of rows || []) {
    if (!byParent.has(row.ppid)) byParent.set(row.ppid, []);
    byParent.get(row.ppid).push(row.pid);
  }
  const seen = new Set([rootPid]);
  const out = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const childPid of byParent.get(current) || []) {
      if (seen.has(childPid)) continue;
      seen.add(childPid);
      out.push(childPid);
      stack.push(childPid);
    }
  }
  return out;
}

/**
 * Observe the owned host's descendant processes WHILE THE HOST IS STILL ALIVE.
 * The launcher owns the tsx wrapper pid, but tsx runs the real host in a
 * GRANDCHILD, so "the wrapper exited" says nothing about the process holding the
 * port. Capturing the live descendants early is what lets cleanup PROVE them gone
 * later, instead of reporting an unproven tree for a run that leaked nothing.
 */
export function captureOwnedDescendants(rootPid, { list = listProcesses } = {}) {
  if (!Number.isInteger(rootPid)) return { ok: false, pids: [], reason: 'no owned pid was recorded' };
  const listed = list();
  if (!listed.ok) return { ok: false, pids: [], reason: listed.reason };
  return { ok: true, pids: descendantPids(rootPid, listed.rows), reason: null };
}

/**
 * Capture the owned host's live descendants for a run, retrying briefly because the
 * tsx wrapper spawns the real host asynchronously: immediately after spawn the
 * grandchild may not exist yet. Bounded, and returns ok:false (never a silent empty
 * tree) when nothing was ever observed, so cleanup stays honestly unproven.
 */
export async function captureOwnedChildDescendants(child, { list = listProcesses, sleep, attempts = 12, delayMs = 250 } = {}) {
  const pid = child && Number.isInteger(child.pid) ? child.pid : null;
  if (pid === null) return { ok: false, pids: [], reason: 'no owned pid was recorded' };
  const wait = sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  let last = { ok: false, pids: [], reason: 'no enumeration was attempted' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = captureOwnedDescendants(pid, { list });
    if (last.ok && last.pids.length > 0) return last;
    if (attempt < attempts - 1) await wait(delayMs);
  }
  return last;
}

/** Which of the captured pids are still alive, from a fresh enumeration. */
export function liveCapturedPids(pids, { list = listProcesses } = {}) {
  if (!Array.isArray(pids) || pids.length === 0) return { ok: false, live: null, reason: 'no descendant was ever observed under the live host' };
  const listed = list();
  if (!listed.ok) return { ok: false, live: null, reason: listed.reason };
  const alive = new Set(listed.rows.map((row) => row.pid));
  return { ok: true, live: pids.filter((pid) => alive.has(pid)), reason: null };
}

/**
 * Stop only the child this run owns, as a whole process tree on Windows
 * (taskkill /T on the held PID). Never by image name and never on a foreign PID.
 */
export async function stopOwnedChild(child, {
  timeoutMs = DEFAULT_TIMEOUTS.stopMs, platform = process.platform, spawnImpl = spawn,
  now = Date.now, sleep, killTimeoutMs = DEFAULT_TIMEOUTS.killMs,
  knownDescendants = null, list = listProcesses,
} = {}) {
  const captured = Array.isArray(knownDescendants) ? knownDescendants.filter((value) => Number.isInteger(value)) : [];
  // Prove the observed descendants are gone. With none observed there is nothing to
  // prove, so the caller stays unproven rather than assuming an empty tree.
  const proveCapturedDescendants = () => {
    if (captured.length === 0) return { proven: false, live: null, reason: 'the owned host never had an observed descendant' };
    const check = liveCapturedPids(captured, { list });
    if (!check.ok) return { proven: false, live: null, reason: check.reason };
    return { proven: check.live.length === 0, live: check.live, reason: null };
  };
  const wait = sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const pid = child && Number.isInteger(child.pid) ? child.pid : null;
  const killCommand = platform === 'win32' ? 'taskkill /PID ' + pid + ' /T /F' : 'kill SIGKILL ' + pid;
  if (!child || pid === null) {
    return { stopped: true, existed: false, exited: true, forced: false, treeProven: true, killCommand, note: 'no child was owned' };
  }
  const code = child.exitCode === undefined ? null : child.exitCode;
  const signal = child.signalCode === undefined ? null : child.signalCode;
  if (code !== null || signal !== null) {
    // A parent that exited on its own is NOT automatically an unproven tree. When
    // every process observed under it while it was alive is now gone, the tree is
    // proven clean by observation, which is stronger than an exit code.
    const observed = proveCapturedDescendants();
    const base = { stopped: true, existed: true, exited: true, forced: false, exitCode: code, signal, killCommand, descendantsObserved: captured.length, descendantsStillAlive: observed.live };
    if (observed.proven) {
      return Object.assign(base, {
        treeProven: true, unknown: false, descendantsProven: true,
        note: 'the parent had already exited, and every process observed under it while it was alive is gone',
      });
    }
    return Object.assign(base, {
      treeProven: false, unknown: true, descendantsProven: false,
      note: 'parent already exited before cleanup; descendants are unproven, not killed' + (observed.reason ? ' (' + observed.reason + ')' : ''),
    });
  }
  let exitObserved = false;
  const onExit = () => { exitObserved = true; };
  if (typeof child.once === 'function') child.once('exit', onExit);
  let killExitCode = null;
  let killError = null;
  if (platform === 'win32') {
    try {
      const killer = spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      if (!killer || typeof killer.once !== 'function') {
        killError = 'taskkill produced no process';
      } else {
        killer.stdout && killer.stdout.resume && killer.stdout.resume();
        killer.stderr && killer.stderr.resume && killer.stderr.resume();
        killExitCode = await new Promise((ok) => {
          let done = false;
          const finish = (value) => { if (!done) { done = true; ok(value); } };
          const timer = setTimeout(() => finish(null), killTimeoutMs);
          killer.once('close', (closeCode) => { clearTimeout(timer); finish(closeCode === undefined ? null : closeCode); });
          killer.once('error', (error) => { clearTimeout(timer); killError = describeError(error); finish(null); });
        });
      }
    } catch (error) { killError = describeError(error); }
  } else {
    try { child.kill('SIGKILL'); } catch (error) { killError = describeError(error); }
  }
  const deadline = now() + timeoutMs;
  while (!exitObserved && child.exitCode === null && now() < deadline) await wait(25);
  if (typeof child.removeListener === 'function') child.removeListener('exit', onExit);
  const finalCode = child.exitCode === undefined ? null : child.exitCode;
  const finalSignal = child.signalCode === undefined ? null : child.signalCode;
  const exited = exitObserved || finalCode !== null || finalSignal !== null;
  const killProved = platform === 'win32' ? (exited && killExitCode === 0 && !killError) : (exited && !killError);
  // Either the kill itself proved the tree, or every process observed under the live
  // host is gone. The second path is what makes a self-exited parent (and the
  // taskkill "not found" race) a truthful pass instead of a refused green run.
  const observed = exited && !killProved ? proveCapturedDescendants() : { proven: false, live: null, reason: null };
  const treeProven = killProved || observed.proven;
  return {
    stopped: exited && treeProven, existed: true, exited, forced: true, exitCode: finalCode, signal: finalSignal,
    treeProven, killExitCode, killError, killCommand, unknown: false,
    descendantsObserved: captured.length, descendantsProven: observed.proven === true, descendantsStillAlive: observed.live,
    note: treeProven
      ? (killProved
        ? 'parent exit observed and taskkill reported a clean tree close'
        : 'parent exit observed and every process observed under it while it was alive is gone')
      : (exited ? 'parent exit observed but the descendant tree is unproven' : 'cleanup unobserved within ' + timeoutMs + 'ms'),
  };
}

/** Build the exact argv used to boot the real host through the prepared source tsx. */
export function buildHostCommand(plan) {
  return {
    executable: plan.nodeExe,
    args: [
      plan.tsx, plan.hostEntry,
      '--source', plan.sourceRoot,
      '--lab', plan.labDir,
      '--prebundle', plan.prebundlePath,
      '--port', String(plan.enginePort),
    ],
  };
}

export function renderCommand(command) {
  const quote = (value) => (/\s/.test(value) ? "\"" + value + "\"" : value);
  return quote(command.executable) + ' ' + command.args.map(quote).join(' ');
}

export function spawnHost(plan, { spawnImpl = spawn, env = process.env, stdio } = {}) {
  const command = buildHostCommand(plan);
  const childEnv = Object.assign({}, env, { TEMP: plan.tmpDir, TMP: plan.tmpDir, TMPDIR: plan.tmpDir });
  fs.mkdirSync(plan.tmpDir, { recursive: true });
  fs.mkdirSync(plan.logDir, { recursive: true });
  const outPath = path.join(plan.logDir, 'engine-host.out.log');
  const errPath = path.join(plan.logDir, 'engine-host.err.log');
  const outFd = fs.openSync(outPath, 'a');
  const errFd = fs.openSync(errPath, 'a');
  const options = {
    cwd: plan.sourceRoot,
    env: childEnv,
    windowsHide: true,
    stdio: stdio || ['ignore', outFd, errFd],
  };
  const child = spawnImpl(command.executable, command.args, options);
  if (typeof child.once === 'function') {
    child.once('exit', () => { try { fs.closeSync(outFd); } catch { /* already closed */ } try { fs.closeSync(errFd); } catch { /* already closed */ } });
  }
  return { child, command, commandLine: renderCommand(command), outPath, errPath, logFds: [outFd, errFd] };
}

export function tailFile(filePath, maxChars = 4000) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const text = fs.readFileSync(filePath, 'utf8');
    return text.length <= maxChars ? text : text.slice(text.length - maxChars);
  } catch (error) { return 'unreadable: ' + describeError(error); }
}

/** Run one short child to completion under a bound; returns code/stdout/stderr. */
/** The environment for an owned short child: TEMP/TMP/TMPDIR all inside --work. */
export function childScratchEnv(plan, base = process.env) {
  return Object.assign({}, base, { TEMP: plan.tmpDir, TMP: plan.tmpDir, TMPDIR: plan.tmpDir });
}

export function runChild(command, { timeoutMs, cwd, env = process.env, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command.executable, command.args, { cwd, env: Object.assign({}, env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: describeError(error), spawnError: describeError(error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => {
      try { if (process.platform === 'win32') spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else child.kill('SIGKILL'); } catch { /* best effort */ }
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout && child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr && child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', (error) => finish({ code: null, stdout, stderr, spawnError: describeError(error), timedOut: false }));
    child.once('close', (code) => finish({ code, stdout, stderr, timedOut: false }));
  });
}

/** Ask the PINNED node for its own version, so the record names the real runtime. */
export async function probeNodeVersion(plan, { run = runChild } = {}) {
  const result = await run({ executable: plan.nodeExe, args: ['--version'] }, { timeoutMs: 15000, cwd: plan.workDir });
  const version = String(result.stdout || '').trim().split(String.fromCharCode(10)).pop() || null;
  return { version: result.code === 0 ? version : null, exitCode: result.code, stderrTail: (result.stderr || '').slice(-400) };
}

/**
 * Compare one node version string against a simple range (e.g. >=22.12.0). Only
 * the comparators the manifests actually use are supported: >= > <= < = and an exact
 * version. Returns null when the range cannot be interpreted, so a caller must not
 * treat an unparsed range as a pass.
 */
export function parseVersion(text) {
  const match = String(text || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function satisfiesNodeRange(version, range) {
  const actual = parseVersion(version);
  if (!actual) return { satisfied: null, reason: 'the observed node version is not parseable: ' + String(version) };
  const text = String(range || '').trim();
  if (!text) return { satisfied: null, reason: 'no supported node range is declared' };
  for (const clause of text.split(/\s+/)) {
    const match = clause.match(/^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/);
    if (!match) return { satisfied: null, reason: 'unsupported node range clause: ' + clause };
    const operator = match[1] || '=';
    const wanted = parseVersion(match[2]);
    if (!wanted) return { satisfied: null, reason: 'the declared node version is not parseable: ' + match[2] };
    const order = compareVersions(actual, wanted);
    const ok = operator === '>=' ? order >= 0 : operator === '>' ? order > 0 : operator === '<=' ? order <= 0 : operator === '<' ? order < 0 : order === 0;
    if (!ok) return { satisfied: false, reason: 'node ' + version + ' does not satisfy ' + text };
  }
  return { satisfied: true, reason: 'node ' + version + ' satisfies ' + text };
}

/**
 * M1, binary half. The manifest records the node version and the workspace-relative
 * path it was checked with. This compares the ACTUAL executable and observed version
 * against those records, so a different binary cannot pass under the pinned name.
 * The manifest does not record a binary hash, so this proves the declared name,
 * version and path - and records the observed binary bytes/hash - rather than
 * pretending the bytes were pinned when they were not.
 */
export function verifyNodeIdentity({ plan, manifestNode = {}, observedVersion = null, workspaceRoot = null, sha256 = sha256File, existsSync = fs.existsSync } = {}) {
  const problems = [];
  const declaredVersion = manifestNode.usedForChecks ? String(manifestNode.usedForChecks).trim() : null;
  const declaredPath = manifestNode.usedForChecksPath ? String(manifestNode.usedForChecksPath).trim() : null;
  const observed = observedVersion ? String(observedVersion).trim().replace(/^v/, '') : null;
  const versionOk = !declaredVersion || observed === declaredVersion.replace(/^v/, '');
  if (!versionOk) problems.push('the pinned node reports ' + observedVersion + ' but the manifest was checked with ' + declaredVersion);
  let pathOk = true;
  let declaredAbsolute = null;
  if (declaredPath) {
    declaredAbsolute = path.isAbsolute(declaredPath)
      ? path.resolve(declaredPath)
      : path.resolve(workspaceRoot || process.cwd(), declaredPath);
    pathOk = realPathOf(declaredAbsolute) === realPathOf(plan.nodeExe);
    if (!pathOk) problems.push('the pinned node is ' + path.resolve(plan.nodeExe) + ' but the manifest names ' + declaredAbsolute);
  }
  const binary = existsSync(plan.nodeExe)
    ? { path: path.resolve(plan.nodeExe), bytes: fs.statSync(plan.nodeExe).size, sha256: sha256(plan.nodeExe) }
    : { path: path.resolve(plan.nodeExe), bytes: null, sha256: null };
  return {
    verified: problems.length === 0,
    declaredVersion, declaredPath, declaredAbsolute,
    observedVersion: observedVersion || null,
    observedExecutable: path.resolve(plan.nodeExe), binary,
    note: 'the manifest does not record a binary hash, so this proves the declared name/version/path, not the binary bytes',
    problems,
  };
}

/**
 * A bounded digest of the prepared SOURCE tree (excluding node_modules), so the
 * record can show whether the pinned source was mutated by the run. node_modules is
 * skipped because it is a cache; everything else is folded in sorted path order.
 */
export function sourceTreeDigest(root, { fsImpl = fs, pathImpl = path, maxFiles = 20000 } = {}) {
  const rows = [];
  const walk = (dir) => {
    if (rows.length >= maxFiles) return;
    let entries = [];
    try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = pathImpl.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      try {
        const stat = fsImpl.statSync(full);
        rows.push({ rel: pathImpl.relative(root, full).split(pathImpl.sep).join('/'), bytes: stat.size, sha256: sha256File(full) });
      } catch { /* an unreadable file is not a reason to fail the digest */ }
      if (rows.length >= maxFiles) return;
    }
  };
  if (fsImpl.existsSync(root)) walk(root);
  rows.sort((a, b) => (a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0)));
  const folded = rows.map((row) => row.rel + ' ' + row.sha256).join(String.fromCharCode(10));
  return { root: pathImpl.resolve(root), fileCount: rows.length, totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), digest: sha256Bytes(Buffer.from(folded, 'utf8')), truncated: rows.length >= maxFiles };
}

export async function generateFixtures(plan, { run = runChild } = {}) {
  const command = {
    executable: plan.nodeExe,
    args: [plan.tsx, plan.fixturesScript, '--out', plan.fixturesDir, '--source', plan.sourceRoot],
  };
  // cwd stays at the source (module resolution needs it) but TEMP is redirected into
  // the owned work tree, so a tool cache cannot land in the shared source or machine TEMP.
  fs.mkdirSync(plan.tmpDir, { recursive: true });
  const result = await run(command, { timeoutMs: DEFAULT_TIMEOUTS.fixtureMs, cwd: plan.sourceRoot, env: childScratchEnv(plan) });
  const rows = plan.existsSync(plan.fixturesDir)
    ? fs.readdirSync(plan.fixturesDir).filter((name) => !name.startsWith('.')).map((name) => {
        const filePath = path.join(plan.fixturesDir, name);
        const stat = fs.statSync(filePath);
        return { name, bytes: stat.size, sha256: stat.isFile() ? sha256File(filePath) : null, isFile: stat.isFile() };
      })
    : [];
  return { command, commandLine: renderCommand(command), result, rows, ok: result.code === 0 && !result.timedOut && !result.spawnError };
}

export async function buildPrebundle(plan, { run = runChild } = {}) {
  const command = {
    executable: plan.nodeExe,
    args: [plan.prebundleScript, '--source', plan.sourceRoot, '--out', plan.prebundlePath],
  };
  fs.mkdirSync(plan.tmpDir, { recursive: true });
  const result = await run(command, { timeoutMs: DEFAULT_TIMEOUTS.fixtureMs, cwd: plan.sourceRoot, env: childScratchEnv(plan) });
  const exists = plan.existsSync(plan.prebundlePath);
  return {
    command, commandLine: renderCommand(command), result, exists,
    bytes: exists ? fs.statSync(plan.prebundlePath).size : null,
    sha256: exists ? sha256File(plan.prebundlePath) : null,
    ok: result.code === 0 && !result.timedOut && !result.spawnError && exists,
  };
}

/**
 * Run the FROZEN adapter contract against the booted host. The adapter module is
 * imported and its own exported runner is called, so the cases and the exit policy
 * (failed>0 OR unavailable>0 is a nonzero result) are exactly the accepted ones.
 */
export async function runAdapterContract({ adapterScript, labDir, allowedRoot, baseUrl, timeoutMs = 30000, importModule }) {
  const load = importModule || (async (specifier) => import(pathToFileURL(specifier).href));
  const adapter = await load(adapterScript);
  const report = await adapter.runAllAdapterCases({ baseUrl, labDir, allowedRoot, timeoutMs });
  const evidence = adapter.buildAdapterEvidence(report, { baseUrl, labDir });
  const ok = report.failed === 0 && report.unavailable === 0;
  return { report, evidence, ok, adapterUpstreamPin: adapter.ADAPTER_EVIDENCE.upstream_pin, requiredFixtures: adapter.REQUIRED_FIXTURES };
}

export function ensureDirs(plan) {
  for (const dir of [plan.workDir, plan.labDir, plan.evidenceDir, plan.logDir, plan.tmpDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return plan;
}

/**
 * Guarantee a real file OUTSIDE the lab but inside the allowed root, so the frozen
 * adapter's outside-lab case exercises the contract code `outside_lab` rather than
 * tripping over an absent path. Only ever written inside this run's own work dir.
 */
export function ensureOutsideMarker(plan, { existsSync = fs.existsSync } = {}) {
  const target = plan.outsideMarkerPath;
  let created = false;
  if (!existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, OUTSIDE_MARKER_BODY);
    created = true;
  }
  return {
    path: target,
    name: OUTSIDE_MARKER_NAME,
    allowedRoot: plan.allowedRoot,
    created,
    bytes: fs.statSync(target).size,
    sha256: sha256File(target),
    insideLab: isInside(plan.labDir, target),
  };
}

export function writeEvidence(evidenceDir, record, { name = 'engine-contract-lab-run.json' } = {}) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const target = path.join(evidenceDir, name);
  fs.writeFileSync(target, JSON.stringify(record, null, 2) + NL);
  record.evidencePath = target;
  record.evidenceSha256 = sha256File(target);
  return target;
}

export function buildFailureRecord({ stage, error, startedAt }) {
  return {
    schemaVersion: RUN_SCHEMA_VERSION, kind: RUN_KIND, issue: ISSUE, parentIssue: PARENT_ISSUE,
    startedAt, finishedAt: new Date().toISOString(), ok: false, exitCode: 1,
    failure: { stage, message: describeError(error) },
    // Present on every record, so "no host was booted" is stated rather than inferred
    // from a missing key. A pre-boot failure has no host, no adapter result and no
    // owned resource to have released.
    host: null,
    adapter: null,
    cleanup: { host: null, portReleased: null, labRemoved: false, workspaceMutation: 'none' },
  };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  return runLab(argv, env);
}

export async function runLab(argv, env = process.env, deps = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let plan = null;
  const stage = { name: 'parse-args', error: null, startedAt };
  // Observations a refusal must still show: a reader of a failed record needs to see
  // WHAT was observed about the runtime and the source, not just that it was refused.
  const observed = { runtime: null, provenance: null, upstreamCheckout: null };
  // Normal termination: a cooperative signal makes the run stop at the next stage
  // boundary and report nonzero, instead of continuing and leaking the owned host.
  const termination = { requested: false, signal: null };
  const terminationHandler = installTerminationHandler({
    onSignal: (name) => { termination.requested = true; termination.signal = name; },
    processImpl: deps.processImpl || process,
  });
  try {
    const args = parseArgs(argv, env);
    if (args.help) {
      process.stdout.write(usageText() + NL);
      return { ok: true, exitCode: 0, record: null };
    }
    plan = resolveDefaults(args, deps);
    stage.name = 'work-ownership';
    const workspaceRoot = assertWorkInsideWorkspace(plan, deps.workspaceRoot || findWorkspaceRoot(plan.cwd), deps);
    // Only a plan whose work directory was ACCEPTED may create anything, so every
    // later stage can safely write its evidence under the owned tree.
    plan.workAccepted = true;
    ensureDirs(plan);
    const outsideMarker = ensureOutsideMarker(plan);
    // Dependency presence is checked first: a missing source tree is a dependency
    // problem and must be named as one, not reported as a lockfile/pin symptom.
    stage.name = 'dependencies';
    const checks = dependencyChecks(plan);
    assertDependencies(checks);
    stage.name = 'pin';
    const adapterForPin = await (deps.importAdapter || (async (specifier) => import(pathToFileURL(specifier).href)))(plan.adapterScript);
    const pinState = resolvePinState({
      manifestPath: plan.manifest, sourceRoot: plan.sourceRoot, expectedPin: plan.expectedPin,
      adapterUpstreamPin: adapterForPin.ADAPTER_EVIDENCE.upstream_pin,
    });
    assertPinState(pinState);
    // Observe the PINNED node it will actually boot the host with, so the evidence
    // names the real runtime rather than the launcher process by accident.
    stage.name = 'pinned-runtime';
    const nodeProbe = await probeNodeVersion(plan, { run: deps.run || runChild });
    observed.runtime = { hostNodeExecutable: plan.nodeExe, hostNodeVersion: nodeProbe.version, probeExitCode: nodeProbe.exitCode };
    if (!nodeProbe.version) {
      throw new Error('[uni668-lab] the pinned node did not report a version (exit ' + nodeProbe.exitCode + '): ' + nodeProbe.stderrTail);
    }
    // A declared supported range in the manifest is enforced BEFORE any spawn: a node
    // outside it is a wrong-runtime refusal, not a silently different result. The
    // manifest is not changed to fit the environment.
    const nodeRange = (deps.manifestNodeRange !== undefined)
      ? deps.manifestNodeRange
      : ((readJson(plan.manifest).runtime || {}).node || {}).requiredRange || null;
    const rangeCheck = satisfiesNodeRange(nodeProbe.version, nodeRange);
    if (rangeCheck.satisfied !== true) {
      throw new Error('[uni668-lab] the pinned node version is not the supported runtime: ' + rangeCheck.reason);
    }
    // Anchor the BINARY to the manifest rather than to this run own observation: the
    // manifest names the exact version and path it was checked with. A mismatch is a
    // wrong-runtime refusal, not a footnote.
    const manifestNode = ((readJson(plan.manifest).runtime || {}).node) || {};
    const nodeIdentity = verifyNodeIdentity({
      plan, manifestNode, observedVersion: nodeProbe.version,
      workspaceRoot: deps.workspaceRoot || findWorkspaceRoot(plan.cwd),
    });
    observed.runtime.nodeIdentity = nodeIdentity;
    if (!nodeIdentity.verified) {
      throw new Error('[uni668-lab] the pinned node is not the manifest declared runtime: ' + nodeIdentity.problems.join('; '));
    }
    deps = Object.assign({}, deps, { nodeVersionForRecord: nodeProbe.version, nodeIdentityForRecord: nodeIdentity });
    // M1: prove the prepared source carries the pinned bytes, from the manifest's own
    // recorded artifacts and (when supplied) the upstream checkout at the pinned commit.
    stage.name = 'source-provenance';
    const provenance = verifySourceProvenance({ manifestPath: plan.manifest, sourceRoot: plan.sourceRoot });
    observed.provenance = provenance;
    const checkout = plan.upstreamCheckout
      ? verifyUpstreamCheckout({ upstreamRoot: plan.upstreamCheckout, manifestPath: plan.manifest })
      : null;
    observed.upstreamCheckout = checkout;
    if (!provenance.verified) {
      throw new Error('[uni668-lab] the prepared source does not match the pinned provenance: ' + provenance.problems.join('; '));
    }
    if (checkout && checkout.checked && !checkout.verified) {
      throw new Error('[uni668-lab] the upstream checkout is not at the pinned source: ' + checkout.problems.join('; '));
    }
    deps = Object.assign({}, deps, { provenanceForRecord: provenance, checkoutForRecord: checkout, nodeRangeForRecord: nodeRange });
    stage.name = 'port-collision';
    await assertPortFreeOrRefuse(plan.enginePort, deps);
    // Last boundary before the run starts spawning: an operator interrupt arriving
    // while pins/provenance were being checked must not still boot a host.
    assertNotTerminated(termination);
    deps = Object.assign({}, deps, { termination });
    return await stageAndRun({ plan, workspaceRoot, pinState, checks, adapterForPin, startedAt, started, outsideMarker, deps });
  } catch (error) {
    stage.error = describeError(error);
    const failure = buildFailureRecord({ stage: stage.name, error, startedAt });
    // A refused run still reports what it OBSERVED before refusing.
    failure.runtime = observed.runtime;
    failure.provenance = observed.provenance;
    failure.upstreamCheckout = observed.upstreamCheckout;
    if (plan) {
      failure.inputs = describeInputs(plan);
      // The work dir was ACCEPTED, so dirs and the outside marker already exist here.
      // Saying 'none' would contradict the bytes on disk.
      failure.cleanup = {
        host: null, portReleased: null, labRemoved: false,
        workspaceMutation: 'own-work-dir-only: ' + path.resolve(plan.workDir),
      };
      // Only write evidence once the work directory was ACCEPTED. A refused --work
      // must not create anything, least of all a record inside the refused tree.
      if (plan.workAccepted) {
        try { writeEvidence(plan.evidenceDir, failure); } catch { /* evidence dir unproven; the exit code still reports the failure */ }
      } else {
        failure.evidencePath = null;
        failure.environmentNotes = ['the run was refused before any work directory was accepted, so no evidence record was written'];
      }
    }
    process.stderr.write('[uni668-lab] failed at ' + stage.name + ': ' + describeError(error) + NL);
    return { ok: false, exitCode: 1, record: failure };
  } finally {
    terminationHandler.remove();
  }
}

function usageText() {
  return [
    'usage: node scripts/office-g0/run-engine-contract-lab.mjs --source <prepared source>' +
      ' --work <fresh isolated dir under <workspace>/.uniwork-dev> [options]',
    '  --engine-port <n>             default ' + DEFAULT_ENGINE_PORT,
    '  --fixtures <dir>              use declared fixtures instead of generating them',
    '  --prebundle <file>            use a declared prebundle instead of building one',
    '  --evidence-dir <dir>          default <work>/evidence',
    '  --host-entry <file>           default e2e/office-g0/engine-host.mts',
    '  --tsx <file>                  default <source>/node_modules/tsx/dist/cli.mjs',
    '  --node <file>                 pinned node executable; default the running one',
    '  --manifest <file>             default docs/office/g0/source-manifest.json',
    '  --expected-pin <sha>          refuse unless the manifest pin matches',
    '  --upstream-checkout <dir>     verify this git checkout is AT the pinned commit/tree',
    '  --readiness-timeout-ms <n>    default ' + DEFAULT_TIMEOUTS.readinessMs,
    '  --remove-lab-on-success       remove the lab tree after a fully clean pass',
    '  --allow-unknown-cleanup       accept an unproven descendant tree (still recorded)',
  ].join(NL);
}

function describeInputs(plan) {
  return {
    sourceRoot: plan.sourceRoot, workDir: plan.workDir, labDir: plan.labDir, fixturesDir: plan.fixturesDir,
    prebundlePath: plan.prebundlePath, evidenceDir: plan.evidenceDir, hostEntry: plan.hostEntry,
    tsx: plan.tsx, nodeExecutable: plan.nodeExe, manifest: plan.manifest, enginePort: plan.enginePort,
    readinessTimeoutMs: plan.readinessTimeoutMs,
  };
}

function hashInputs(plan, extra = []) {
  // The pinned node BINARY is an input like any other: M1 asks for the binary/source
  // identity, so it is hashed here rather than only named.
  const targets = [plan.hostEntry, plan.adapterScript, plan.fixturesScript, plan.prebundleScript, plan.manifest, plan.tsx, plan.nodeExe, ...extra];
  const seen = new Set();
  const rows = [];
  for (const target of targets) {
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const row = { path: target, exists: false, bytes: null, sha256: null };
    try {
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        row.exists = true;
        row.bytes = fs.statSync(target).size;
        row.sha256 = sha256File(target);
      }
    } catch { row.exists = false; }
    rows.push(row);
  }
  return rows;
}

/** The body of a run once inputs, pin and port have been accepted. */
export async function stageAndRun({ plan, workspaceRoot, pinState, checks, adapterForPin, startedAt, started, outsideMarker, deps }) {
  const run = deps.run || runChild;
  const evidence = {
    schemaVersion: RUN_SCHEMA_VERSION, kind: RUN_KIND, issue: ISSUE, parentIssue: PARENT_ISSUE,
    task: 'DOC-004 real-adapter fault contract - reproducible owned lab launcher',
    startedAt, finishedAt: null, ok: false, exitCode: 1,
    runtime: {
      // The PINNED node that boots the host, not the node that happens to run this
      // launcher: a run driven by a different node must not be attributed to it.
      hostNodeExecutable: plan.nodeExe,
      hostNodeVersion: deps.nodeVersionForRecord || null,
      hostNodeRangeRequired: deps.nodeRangeForRecord || null,
      hostNodeIdentity: deps.nodeIdentityForRecord || null,
      launcherNodeVersion: process.version, launcherNodeExecutable: process.execPath,
      platform: process.platform, arch: process.arch, cwd: plan.cwd, tsxCli: plan.tsx,
    },
    workspaceRoot,
    allowedRoot: plan.allowedRoot,
    outsideLabMarker: outsideMarker || null,
    pin: Object.assign({}, pinState),
    // M1: what was actually proven about the prepared source, and what was not.
    provenance: deps.provenanceForRecord || null,
    upstreamCheckout: deps.checkoutForRecord || null,
    inputs: describeInputs(plan),
    dependencyChecks: checks,
    adapterScript: plan.adapterScript,
    hashes: hashInputs(plan),
    commands: [],
    fixturePreparation: null,
    host: null,
    adapter: null,
    // No work directory has been written yet at this point in the run.
    cleanup: { host: null, portReleased: null, labRemoved: false, workspaceMutation: 'none-before-run' },
    ownedTree: null,
    failure: null,
    termination: null,
    environmentNotes: [],
  };
  if (plan.existsSync(plan.prebundlePath) && plan.prebundleProvided) {
    evidence.environmentNotes.push('a caller-supplied prebundle was used and hashed');
  }
  if (plan.fixturesProvided) {
    evidence.environmentNotes.push('caller-supplied fixtures were used instead of generating them');
  }
  let host = null;
  let hostOwned = null;
  let ownedDescendants = null;
  let cleanupResult = null;
  // Name each in-run stage so a failure says WHICH step failed, not just run.
  let runStage = 'prepare-fixtures';
  // Fingerprint the pinned source BEFORE any child runs, so the record can show the
  // run did not mutate the tree it claims to leave untouched (M4/M1 honesty).
  const sourceDigestBefore = sourceTreeDigest(plan.sourceRoot, { maxFiles: deps.sourceDigestMaxFiles || 20000 });
  evidence.sourceTree = { before: sourceDigestBefore, after: null, unchanged: null };
  try {
    // ---- fixtures (declared or generated) ----
    assertNotTerminated(deps.termination);
    if (plan.fixturesProvided) {
      const names = plan.existsSync(plan.fixturesDir) ? fs.readdirSync(plan.fixturesDir) : [];
      evidence.fixturePreparation = {
        mode: 'declared',
        source: plan.fixturesDir,
        rows: names.map((name) => {
          const filePath = path.join(plan.fixturesDir, name);
          const stat = fs.statSync(filePath);
          return { name, bytes: stat.size, sha256: stat.isFile() ? sha256File(filePath) : null };
        }),
      };
    } else {
      const generated = await generateFixtures(plan, { run });
      evidence.commands.push({ label: 'generate-fixtures', command: generated.commandLine, exitCode: generated.result.code, timedOut: generated.result.timedOut === true });
      evidence.fixturePreparation = {
        mode: 'generated-from-pinned-source',
        source: plan.fixturesDir,
        command: generated.commandLine,
        exitCode: generated.result.code,
        rows: generated.rows,
        determinism: generated.rows.filter((row) => row.isFile).map((row) => ({
          name: row.name,
          sha256: row.sha256,
          volatileAcrossRuns: VOLATILE_FIXTURE_NAMES.includes(row.name),
          reason: VOLATILE_FIXTURE_NAMES.includes(row.name)
            ? 'the generator embeds volatile package ids/timestamps, so the bytes differ per run while the case oracles stay behavioural'
            : 'generated from pinned source bytes and stable across runs observed in this lab',
        })),
        stderrTail: (generated.result.stderr || '').slice(-2000),
      };
      if (!generated.ok) {
        throw new Error('[uni668-lab] fixture generation failed (exit ' + generated.result.code + '): ' + (generated.result.stderr || '').slice(-500));
      }
    }

    // ---- prebundle ----
    runStage = 'prepare-prebundle';
    if (plan.prebundleProvided) {
      evidence.prebundle = { mode: 'declared', path: plan.prebundlePath, exists: plan.existsSync(plan.prebundlePath) };
      requireExistingFile(plan.prebundlePath, 'declared prebundle');
    } else {
      const built = await buildPrebundle(plan, { run });
      evidence.commands.push({ label: 'build-prebundle', command: built.commandLine, exitCode: built.result.code, timedOut: built.result.timedOut === true });
      evidence.prebundle = { mode: 'built-from-pinned-source', path: plan.prebundlePath, bytes: built.bytes, sha256: built.sha256, exists: built.exists, exitCode: built.result.code };
      if (!built.ok) {
        throw new Error('[uni668-lab] prebundle build failed (exit ' + built.result.code + '): ' + (built.result.stderr || '').slice(-500));
      }
    }

    // ---- lab owned by this run ----
    runStage = 'prepare-lab';
    assertNotTerminated(deps.termination);
    const prepared = adapterForPin.prepareLab({ labDir: plan.labDir, fixturesDir: plan.fixturesDir, allowedRoot: plan.allowedRoot });
    evidence.fixturePreparation.placed = prepared.placed;
    const requiredNames = adapterForPin.REQUIRED_FIXTURES;
    const placedNames = prepared.placed.map((entry) => entry.name);
    const absent = requiredNames.filter((name) => !placedNames.includes(name));
    if (absent.length > 0) {
      throw new Error('[uni668-lab] lab is incomplete: the adapter requires ' + requiredNames.join(', ') + ' but these are absent: ' + absent.join(', '));
    }

    // ---- boot the REAL host through the prepared source tsx ----
    assertNotTerminated(deps.termination);
    host = spawnHost(plan, { spawnImpl: deps.spawnImpl });
    hostOwned = host.child;
    evidence.host = {
      pid: hostOwned.pid || null, command: host.commandLine, cwd: plan.sourceRoot,
      stdoutLog: host.outPath, stderrLog: host.errPath, identity: null, readiness: null,
    };
    evidence.commands.push({ label: 'boot-engine-host', command: host.commandLine, exitCode: null, longRunning: true });

    const baseUrl = 'http://127.0.0.1:' + plan.enginePort;
    evidence.host.baseUrl = baseUrl;
    runStage = 'identity-readiness';
    const identity = await waitForIdentity({
      baseUrl,
      expected: { source: plan.sourceRoot, lab: plan.labDir, prebundle: plan.prebundlePath },
      child: hostOwned,
      timeoutMs: plan.readinessTimeoutMs,
      requiredRoutes: ['/engine/docx-edit', '/engine/pdf-text-read', '/engine/pptx-open', '/engine/session-close'],
      termination: deps.termination || null,
    });
    evidence.host.identity = identity;
    const readiness = await readinessProbe({ baseUrl, fixturePath: path.join(plan.labDir, FIXTURES_SUBDIR, requiredNames[0]) });
    evidence.host.readiness = { ok: readiness.ok, route: readiness.route, fixturePath: readiness.fixturePath, status: readiness.envelope.status };
    if (!readiness.ok) {
      throw new Error('[uni668-lab] readiness probe failed on ' + readiness.route + ' (status ' + readiness.envelope.status + ')');
    }
    // The host is serving now, so the process that owns the port definitely exists.
    // Observe the owned tree HERE, while it is alive: cleanup later VERIFIES these
    // exact pids are gone. tsx runs the real host in a GRANDCHILD, so the wrapper
    // pid alone cannot show whether the engine was actually released.
    ownedDescendants = await captureOwnedChildDescendants(hostOwned, deps);

    // ---- the frozen adapter contract, against the real host ----
    runStage = 'adapter-contract';
    assertNotTerminated(deps.termination);
    const adapterRun = await runAdapterContract({
      adapterScript: plan.adapterScript, labDir: plan.labDir, allowedRoot: plan.allowedRoot, baseUrl,
      importModule: deps.importAdapter,
    });
    evidence.commands.push({
      label: 'run-adapter-contract',
      command: renderCommand({ executable: plan.nodeExe, args: [plan.adapterScript, '--base-url', baseUrl, '--lab', plan.labDir, '--allow-root', plan.allowedRoot, '--print'] }),
      note: 'the frozen runner is invoked in-process; this is the equivalent operator command',
      passed: adapterRun.report.passed, failed: adapterRun.report.failed, unavailable: adapterRun.report.unavailable,
    });
    evidence.adapter = {
      contractVersion: adapterRun.evidence.contract_version, transport: adapterRun.evidence.transport,
      oracleDigest: adapterRun.evidence.oracle_digest, upstreamPin: adapterRun.adapterUpstreamPin,
      total: adapterRun.report.total, passed: adapterRun.report.passed, failed: adapterRun.report.failed, unavailable: adapterRun.report.unavailable,
      cases: adapterRun.report.results.map((result) => ({
        id: result.id, pass: result.pass, unavailable: result.unavailable === true,
        mismatches: result.mismatches, observed: result.observed,
      })),
      evidence: adapterRun.evidence,
    };
    if (!adapterRun.ok) {
      const detail = adapterRun.report.results.filter((result) => !result.pass).map((result) => result.id + '(' + (result.unavailable ? 'unavailable' : 'failed') + ')').join(', ');
      throw new Error('[uni668-lab] the real adapter contract did not fully pass: failed=' + adapterRun.report.failed + ' unavailable=' + adapterRun.report.unavailable + ' -> ' + detail);
    }
  } catch (error) {
    evidence.failure = { stage: runStage, message: describeError(error) };
  } finally {
    // Cleanup ALWAYS runs, and the evidence record ALWAYS survives it.
    if (!ownedDescendants || !ownedDescendants.ok || ownedDescendants.pids.length === 0) {
      // A run that failed before readiness never reached the happy capture point.
      // Try once more here, before cleanup, so a self-exited parent is still provable
      // whenever the hosts' descendants are observable at all.
      const retry = await captureOwnedChildDescendants(hostOwned, Object.assign({}, deps, { attempts: 3, delayMs: 100 }));
      if (retry.ok && retry.pids.length > 0) ownedDescendants = retry;
    }
    cleanupResult = await cleanupOwned({
      plan, host: hostOwned,
      descendants: ownedDescendants && ownedDescendants.ok ? ownedDescendants.pids : null,
    });
    evidence.cleanup = cleanupResult;
    evidence.ownedTree = ownedDescendants
      ? { observed: ownedDescendants.ok === true, pids: ownedDescendants.pids || [], reason: ownedDescendants.reason || null }
      : { observed: false, pids: [], reason: 'the run never reached a point where its descendants could be observed' };
    evidence.host = evidence.host || null;
    if (evidence.host) {
      evidence.host.stdoutTail = tailFile(host ? host.outPath : null);
      evidence.host.stderrTail = tailFile(host ? host.errPath : null);
    }
    // After the owned children have finished: the pinned source must be byte-identical.
    const sourceDigestAfter = sourceTreeDigest(plan.sourceRoot, { maxFiles: deps.sourceDigestMaxFiles || 20000 });
    evidence.sourceTree.after = sourceDigestAfter;
    evidence.sourceTree.unchanged = sourceDigestAfter.digest === sourceDigestBefore.digest;
    if (!evidence.sourceTree.unchanged) {
      evidence.environmentNotes.push('the prepared source tree digest CHANGED during this run; the source is no longer provably the pinned tree');
    }
  }
  const adapterOk = Boolean(evidence.adapter) && evidence.adapter.failed === 0 && evidence.adapter.unavailable === 0;
  const cleanupOk = cleanupResult.host.ok && cleanupResult.portReleased.released;
  // A mode that mutated the pinned source is not feature-ready even if every case passed.
  const sourceOk = evidence.sourceTree.unchanged === true || plan.allowSourceMutation === true;
  // A cooperative interrupt is a REFUSAL, never a pass, whatever stage it lands in -
  // including during the adapter contract, where the cases may already all be green.
  const terminated = Boolean(deps.termination && deps.termination.requested);
  if (terminated) {
    evidence.termination = { requested: true, signal: deps.termination.signal, honored: true };
  }
  const ok = adapterOk && cleanupOk && sourceOk && !terminated && evidence.failure === null;
  if (!ok && evidence.failure === null) {
    evidence.failure = {
      stage: terminated ? 'interrupt' : 'cleanup',
      message: !sourceOk
        ? 'the prepared source tree changed during the run: before=' + evidence.sourceTree.before.digest + ', after=' + (evidence.sourceTree.after ? evidence.sourceTree.after.digest : 'unknown')
        : (terminated
          ? 'the launcher received ' + deps.termination.signal + '; the run is a refusal even though the adapter cases had passed'
          : (cleanupOk ? 'the run did not complete' : ('cleanup did not prove release: host ok=' + cleanupResult.host.ok + ', port released=' + cleanupResult.portReleased.released))),
    };
  }
  evidence.ok = ok;
  evidence.exitCode = ok ? 0 : 1;
  evidence.finishedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - started;
  if (ok && plan.removeLabOnSuccess) {
    try { fs.rmSync(plan.labDir, { recursive: true, force: true }); evidence.cleanup.labRemoved = true; } catch { evidence.cleanup.labRemoved = false; }
  }
  writeEvidence(plan.evidenceDir, evidence);
  process.stdout.write(summaryText(evidence) + NL);
  if (!ok) process.stderr.write('[uni668-lab] failed: ' + (evidence.failure ? evidence.failure.message : 'unknown') + NL);
  return { ok, exitCode: evidence.exitCode, record: evidence };
}

/**
 * Normal termination handling. A signal delivered to THIS launcher (Ctrl+C, or a
 * cooperative SIGTERM/SIGHUP) must stop the host this run owns before the process
 * ends, otherwise an interrupt is a way to leave a host holding the engine port.
 *
 * Scope, stated honestly: this covers the COOPERATIVE path only. An external forced
 * kill of this launcher PID (an orchestrator `taskkill` with no signal) cannot run
 * any JavaScript, so descendants can still be orphaned. On Windows a Job Object with
 * KILL_ON_JOB_CLOSE would close that hole; it is NOT implemented here and remains a
 * named G0 limitation rather than a claimed guarantee. Neither path is proof about a
 * Unix process tree: these tests run on Windows.
 */
export function installTerminationHandler({ onSignal, processImpl = process, signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] } = {}) {
  const handlers = new Map();
  for (const name of signals) {
    const handler = () => { try { onSignal(name); } catch { /* the run loop still fails on the flag */ } };
    handlers.set(name, handler);
    processImpl.on(name, handler);
  }
  return {
    signals,
    remove() {
      for (const [name, handler] of handlers) processImpl.removeListener(name, handler);
      handlers.clear();
    },
  };
}

/**
 * A signal is a refusal, not an interruption that may be ignored: the run stops at the
 * next stage boundary and reports nonzero. It never pretends the run completed.
 */
export function assertNotTerminated(termination) {
  if (termination && termination.requested) {
    throw new Error('[uni668-lab] the launcher received ' + termination.signal + '; the run stopped and the owned host is being stopped instead of continuing');
  }
}

export async function cleanupOwned({ plan, host, stop = stopOwnedChild, releaseWait = waitForPortRelease, descendants = null, list = listProcesses }) {
  let hostResult;
  try {
    hostResult = await stop(host, descendants ? { knownDescendants: descendants, list } : {});
  } catch (error) {
    hostResult = { stopped: false, existed: Boolean(host), exited: false, treeProven: false, killError: describeError(error), note: 'cleanup threw' };
  }
  // An already-exited parent is an honest bounded unknown, never a fabricated proof.
  // By DEFAULT an unproven tree is NOT a clean cleanup, so it cannot carry exit 0.
  // --allow-unknown-cleanup is an explicit operator opt-in that still records the
  // unknown rather than pretending the tree was proven.
  const unknownAccepted = hostResult.unknown === true && plan.allowUnknownCleanup === true;
  const ok = hostResult.stopped === true && (hostResult.treeProven === true || unknownAccepted);
  // A run whose owned tree is proven clean either closed it through taskkill, or every
  // process it observed under the live host is now gone. Record WHICH, so the record
  // never implies a tree close it did not actually observe.
  const treeProof = hostResult.treeProven === true
    ? (hostResult.descendantsProven === true ? 'observed-descendants-gone' : 'taskkill-tree-close')
    : (unknownAccepted ? 'unproven-accepted-by-flag' : 'unproven');
  const portReleased = await releaseWait(plan.enginePort);
  return {
    host: Object.assign({ ok, unknownAccepted, treeProof }, hostResult),
    portReleased,
    labRetained: plan.existsSync(plan.labDir),
    evidenceRetained: plan.existsSync(plan.evidenceDir),
    labRemoved: false,
    // This run only ever writes inside its own accepted --work tree: lab/,
    // evidence/, logs/, tmp/ and the outside marker are all inside it.
    workspaceMutation: 'own-work-dir-only: ' + path.resolve(plan.workDir),
    note: ok && portReleased.released
      ? (hostResult.treeProven === true
        ? 'the owned host tree stopped and the engine port is free again'
        : 'the owned host stopped and the port is free; the descendant tree is UNPROVEN (accepted by --allow-unknown-cleanup)')
      : 'cleanup is not proven clean; the exit code is nonzero',
  };
}

export function summaryText(evidence) {
  const adapter = evidence.adapter;
  return JSON.stringify({
    ok: evidence.ok,
    pin: evidence.pin ? evidence.pin.expectedPin : null,
    source: evidence.inputs ? evidence.inputs.sourceRoot : null,
    lab: evidence.inputs ? evidence.inputs.labDir : null,
    enginePort: evidence.inputs ? evidence.inputs.enginePort : null,
    adapter: adapter ? { passed: adapter.passed, total: adapter.total, failed: adapter.failed, unavailable: adapter.unavailable } : null,
    portReleased: evidence.cleanup ? evidence.cleanup.portReleased.released : null,
    evidencePath: evidence.evidencePath || null,
  });
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
})();

if (isDirectRun) {
  main().then(
    (outcome) => { process.exitCode = outcome.exitCode; },
    (error) => {
      process.stderr.write('[uni668-lab] launcher failed: ' + String((error && error.stack) || error) + NL);
      process.exitCode = 1;
    },
  );
}
