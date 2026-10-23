#!/usr/bin/env node
// UNI-667 DOCX table-cycle runner (feature UNI-667-docx-table-cycle).
//
// Orchestrates ONE fresh, bounded DOCX TABLE browser acceptance run and builds
// nothing itself. It:
//   * validates explicit caller-supplied input paths plus the approved host-build
//     manifest (exactly one app: docs, pinned source commit, immutable source);
//   * refuses a spec that carries a skipped/fixme test and a fixture whose bytes
//     no longer match the pinned kitchen-sink identity;
//   * refuses to reuse any evidence target from an earlier run;
//   * refuses ports it did not mint, so it never drives another group lab;
//   * boots the real lab server over the docs build, discovers the Playwright
//     tests BEFORE running them, parses the run JSON evidence, and refuses a
//     zero-test, skipped, unexpected, retried, failed or flaky required test;
//   * captures child stdout/stderr/exit, lab records and the actual
//     source/build/spec/config/oracle/fixture hashes under a NEW evidence prefix;
//   * stops only children it owns, including after a launch failure.
//
// Import-safe: importing this module only defines exports. The pure
// input/manifest/evidence predicates below are unit-testable without spawning.
//
// Grounded references:
//   e2e/office-g0/lab-server.mjs   createLabServer({buildsDir,labDir,fixturesDir,sourceDir,port,previewPort})
//   e2e/office-g0/lab-server.mjs   LAB_APPS includes docs; appOf(/docs/...) serves builds/docs
//   e2e/office-g0/lab-storage.mjs  ViewSessions.open grants a working copy under <labDir>/views/<viewId>
//   scripts/office-g0/build-renderers.mjs  host-build-manifest.json pinnedSourceCommit/sourceUntouched/appSourcesUntouched/apps
//   e2e/playwright.office-g0.config.ts     shared config (chrome+edge, retries 0, workers 1)
//   e2e/playwright.office-g0.docx-table.config.ts  this slice: testMatch + JSON report name
//   scripts/office-g0/docx-table-oracle.mjs independent OOXML cell oracle the spec asserts on

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createLabServer } from '../../e2e/office-g0/lab-server.mjs';

export const RUNNER_ID = 'office-g0-docx-table-runner-r1';
export const DOCX_APP = 'docs';
export const DOCX_TABLE_SPEC = 'docx-table-cycle.spec.ts';
export const SPEC_REL = 'e2e/office-g0/docx-table-cycle.spec.ts';
export const CONFIG_REL = 'e2e/playwright.office-g0.docx-table.config.ts';
export const SHARED_CONFIG_REL = 'e2e/playwright.office-g0.config.ts';
export const ORACLE_REL = 'scripts/office-g0/docx-table-oracle.mjs';
export const LAB_SERVER_REL = 'e2e/office-g0/lab-server.mjs';
export const REPORT_NAME = 'office-g0-docx-table-report.json';
export const REQUIRED_PROJECTS = Object.freeze(['chrome', 'edge']);
// e2e/office-g0/host-surface.mjs:9 PINNED_SOURCE_COMMIT; also the build manifest pin.
export const PINNED_SOURCE_PIN = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
// 5490/5491 are free of every other group's reserved pair (docx-r2 5440/5441,
// xlsx 5460-5462, pptx 5470-5472, pdf 5480-5482) and are minted by this runner.
export const LOGICAL_PORTS = Object.freeze({ app: 5490, preview: 5491 });
/** The authored fixture identity this feature edits; bytes+hash are pinned, not trusted. */
export const EXPECTED_FIXTURE = Object.freeze({
  name: 'g0-kitchen-sink.docx',
  bytes: 3415,
  sha256: '8b6de008b979174065aa43c58e17db5a3eb654b42eb61232c42945ecfa64dff9',
});
export const PREVIEW_URL_ENV = 'OFFICE_G0_PREVIEW_URL';
export const EXECUTION_TIMEOUT_MS = 1800000;
export const DISCOVERY_TIMEOUT_MS = 180000;
export const SERVER_CLOSE_TIMEOUT_MS = 5000;
export const CHILD_STOP_TIMEOUT_MS = 5000;
/** A skipped required test is a silent hole, so it is refused statically too. */
export const SKIPPED_TEST_PATTERNS = Object.freeze([
  /test\.skip\s*\(/,
  /test\.describe\.skip\s*\(/,
  /test\.fixme\s*\(/,
  /test\.describe\.fixme\s*\(/,
  /test\.todo\s*\(/,
]);
/** The spec test title the run evidence must carry in both projects. */
export const EXPECTED_TEST_TITLE = 'docs: edit an existing table cell, Ctrl+S, and reopen the persisted DOCX';
/** The oracle module this run's evidence must have exercised. */
export const EXPECTED_ORACLE_ID = 'office-g0-docx-table-oracle-r1';

export class RunnerInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunnerInputError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new RunnerInputError(code, message);
};

export const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (target) => sha256Bytes(fs.readFileSync(target));

/** Walk up from a directory to the workspace that owns .uniwork-dev. */
export function discoverWorkspaceRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.uniwork-dev'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

/** Lexical workspace containment for every caller-supplied path. */
export function assertInsideWorkspace(workspaceRoot, label, target) {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    fail('outside_workspace', label + ' must stay inside the workspace ' + root + ': ' + resolved);
  }
  return resolved;
}

const requirePattern = (code, label, value, pattern, hint) => {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!pattern.test(text)) fail(code, label + ' must be ' + hint + ', got ' + JSON.stringify(value));
  return text;
};

export const requireHex64 = (label, value) =>
  requirePattern('bad_manifest_hash', label, value, /^[0-9a-f]{64}$/, '64 lowercase hex chars');

export const requireHex40 = (label, value) =>
  requirePattern('bad_source_pin', label, value, /^[0-9a-f]{40}$/, 'a 40-char git commit id');

/** Evidence targets derived from one NEW prefix. */
export function evidencePaths(prefix) {
  const base = path.resolve(prefix);
  return {
    prefix: base,
    artifacts: base + '-artifacts',
    runtime: base + '-runtime',
    listLog: base + '-list.txt',
    runLog: base + '-run.txt',
    runJson: base + '-run.json',
    temp: base + '-temp',
    result: base + '-result.json',
  };
}

/** Refuse to reuse any evidence target; previous evidence is never deleted. */
export function assertEvidencePrefixFree(paths, existsSync = fs.existsSync) {
  const taken = [
    paths.artifacts,
    paths.runtime,
    paths.listLog,
    paths.runLog,
    paths.runJson,
    paths.temp,
    paths.result,
  ].filter((entry) => existsSync(entry));
  if (taken.length > 0) {
    fail('evidence_prefix_exists', 'refusing to reuse existing evidence targets: ' + taken.join(', '));
  }
  return paths;
}

/** The lab root this runner owns; one directory, never another group's lab. */
export function runtimeRoots(paths) {
  return { labDir: path.resolve(path.join(paths.runtime, 'lab')) };
}

/**
 * The approved host-build manifest must hash to the caller's expected SHA-256,
 * pin the expected source commit, carry exactly the expected single app, and
 * prove the prepared source was not mutated during its own build.
 */
export function validateBuildManifest({ manifestBytes, expectedSha256, expectedSourcePin, expectedApp = DOCX_APP }) {
  if (!Buffer.isBuffer(manifestBytes)) fail('manifest_not_bytes', 'manifestBytes must be a Buffer');
  const sha256 = sha256Bytes(manifestBytes);
  if (sha256 !== expectedSha256) {
    fail('manifest_sha256_mismatch', 'build manifest SHA256 mismatch: expected ' + expectedSha256 + ', read ' + sha256);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    fail('manifest_invalid_json', 'build manifest is not valid JSON: ' + String((error && error.message) || error));
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest_invalid_shape', 'build manifest must be a JSON object');
  }
  const appKeys = Object.keys(manifest.apps || {});
  if (appKeys.length !== 1 || appKeys[0] !== expectedApp) {
    fail('manifest_wrong_app', 'build manifest must describe exactly one app ' + expectedApp + ', found [' + appKeys.join(', ') + ']');
  }
  if (manifest.pinnedSourceCommit !== expectedSourcePin) {
    fail('manifest_pin_mismatch', 'manifest pin ' + String(manifest.pinnedSourceCommit) + ' != expected ' + expectedSourcePin);
  }
  if (manifest.sourceUntouched !== true || manifest.appSourcesUntouched !== true) {
    fail('manifest_source_mutated', 'build manifest does not prove the prepared source closure was untouched');
  }
  return { sha256, app: appKeys[0], pinnedSourceCommit: manifest.pinnedSourceCommit };
}

/** The authored fixture must be present at the pinned size and hash. */
export function assertFixturePin(fixturePath, expected = EXPECTED_FIXTURE) {
  if (!fs.existsSync(fixturePath)) fail('fixture_missing', 'pinned fixture is absent: ' + fixturePath);
  const bytes = fs.readFileSync(fixturePath);
  const sha256 = sha256Bytes(bytes);
  if (bytes.length !== expected.bytes || sha256 !== expected.sha256) {
    fail(
      'fixture_hash_mismatch',
      'authored fixture no longer matches the pinned identity: ' +
        bytes.length + 'B/' + sha256 + ' vs pinned ' + expected.bytes + 'B/' + expected.sha256,
    );
  }
  return { path: fixturePath, bytes: bytes.length, sha256 };
}

/** Refuse a spec file that contains a skipped/fixme/todo test. */
export function assertNoSkippedTests(specText, specPath = '<spec>') {
  if (typeof specText !== 'string') fail('spec_not_text', 'spec text must be a string');
  const hits = SKIPPED_TEST_PATTERNS.filter((pattern) => pattern.test(specText));
  if (hits.length > 0) {
    fail('spec_has_skipped_test', 'required spec contains a skipped/fixme/todo test: ' + specPath);
  }
  return true;
}

/** Every required input must exist; the message names all that are missing. */
export function requireFiles(entries) {
  const missing = entries.filter(([, target]) => !fs.existsSync(target)).map(([label, target]) => label + '=' + target);
  if (missing.length > 0) fail('required_input_missing', 'required inputs are absent: ' + missing.join('; '));
  return true;
}

/** Parse the list reporter output; a missing Total line is a failure, not zero tests. */
export function parseListOutput(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const tests = [];
  const projects = new Set();
  let total = null;
  for (const line of lines) {
    const totalMatch = /^\s*Total:\s*(\d+)\s+test/.exec(line);
    if (totalMatch) total = Number(totalMatch[1]);
    if (!line.includes('\u203a')) continue;
    const projectMatch = /^\s*\[([^\]]+)\]/.exec(line);
    if (projectMatch) projects.add(projectMatch[1].trim());
    tests.push(line.trim());
  }
  return { total, projects: [...projects].sort(), tests };
}

/** A discovery listing must be non-empty and cover both installed browsers. */
export function assertDiscovery(parsed, { requiredProjects = REQUIRED_PROJECTS, minimum = 1 } = {}) {
  if (!parsed || !Number.isInteger(parsed.total) || parsed.total < minimum) {
    fail('discovery_zero_tests', 'Playwright discovery found no tests: total=' + String(parsed && parsed.total));
  }
  const missing = requiredProjects.filter((project) => !parsed.projects.includes(project));
  if (missing.length > 0) {
    fail('discovery_missing_project', 'discovery omitted required Playwright project(s): ' + missing.join(', '));
  }
  return parsed;
}

/** Parse the Playwright JSON reporter output into outcome counts, or null if unreadable. */
export function parsePlaywrightJson(text) {
  let report;
  try {
    report = JSON.parse(String(text == null ? '' : text));
  } catch {
    return null;
  }
  if (!report || typeof report !== 'object' || !report.stats || !Array.isArray(report.suites)) return null;
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        tests.push({
          title: spec.title,
          project: test.projectName,
          status: test.status,
          expectedStatus: test.expectedStatus,
          ok: spec.ok === true,
          results: (test.results || []).map((result) => result.status),
        });
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  const executed = tests.reduce(
    (total, entry) => total + entry.results.filter((status) => status !== 'skipped').length,
    0,
  );
  return {
    expected: report.stats.expected || 0,
    skipped: report.stats.skipped || 0,
    unexpected: report.stats.unexpected || 0,
    flaky: report.stats.flaky || 0,
    tests,
    executed,
    projects: [...new Set(tests.map((entry) => entry.project))].sort(),
  };
}

/**
 * The real run evidence must show every required test executing and passing
 * exactly once in each installed browser, under the declared title. An exit 0
 * with a skipped, unexpected, flaky, retried, non-passed or renamed test is not
 * a pass, and the executed count must equal the discovery total.
 */
export function assertRunOutcome(
  report,
  { requiredProjects = REQUIRED_PROJECTS, expectedTotal, expectedTitle = EXPECTED_TEST_TITLE } = {},
) {
  if (!report) fail('run_report_missing', 'Playwright JSON execution evidence is missing or unreadable');
  const bad = [];
  for (const [name, count] of [
    ['skipped', report.skipped],
    ['unexpected', report.unexpected],
    ['flaky', report.flaky],
  ]) {
    if (count > 0) bad.push(name + '=' + count);
  }
  const perProject = new Map(requiredProjects.map((project) => [project, 0]));
  for (const entry of report.tests) {
    if (entry.expectedStatus === 'skipped') bad.push('todo/skipped expectedStatus: ' + entry.project + ' ' + entry.title);
    if (entry.ok !== true) bad.push('not ok: ' + entry.project + ' ' + entry.title);
    if (entry.results.length !== 1) bad.push('ran ' + entry.results.length + ' times: ' + entry.project + ' ' + entry.title);
    for (const status of entry.results) {
      if (status !== 'passed') bad.push(status + ': ' + entry.project + ' ' + entry.title);
    }
    if (expectedTitle && entry.title !== expectedTitle) {
      bad.push('unexpected title: ' + entry.project + ' ' + entry.title);
    }
    if (perProject.has(entry.project)) perProject.set(entry.project, perProject.get(entry.project) + 1);
  }
  for (const [project, count] of perProject) {
    if (count < 1) bad.push('missing required project: ' + project);
  }
  if (report.executed < 1) bad.push('no test executed');
  if (Number.isInteger(expectedTotal) && report.executed !== expectedTotal) {
    bad.push('executed ' + report.executed + ' != discovery total ' + expectedTotal);
  }
  if (bad.length > 0) {
    fail('run_outcome_not_clean', 'DOCX table browser run is not a clean pass: ' + bad.slice(0, 12).join('; '));
  }
  return { executed: report.executed, expected: report.expected, projects: [...perProject.keys()] };
}

/** The pinned child environment: TEMP/TMP/TMPDIR, JSON report target, preview URL. */
export function buildChildEnv({ env = {}, options, paths, manifest, previewUrl = previewUrlFor() }) {
  return {
    ...env,
    OFFICE_G0_LAB_URL: 'http://127.0.0.1:' + LOGICAL_PORTS.app,
    OFFICE_G0_FIXTURES_DIR: options.fixtures,
    PLAYWRIGHT_OUTPUT_DIR: paths.artifacts,
    PLAYWRIGHT_JSON_OUTPUT_FILE: paths.runJson,
    OFFICE_G0_SOURCE_PIN: manifest.pinnedSourceCommit,
    OFFICE_G0_BUILD_MANIFEST_SHA256: manifest.sha256,
    [PREVIEW_URL_ENV]: previewUrl,
    TEMP: paths.temp,
    TMP: paths.temp,
    TMPDIR: paths.temp,
  };
}

/** The preview origin this runner owns; the docs slice does not require it. */
export function previewUrlFor(ports = LOGICAL_PORTS) {
  return 'http://127.0.0.1:' + ports.preview;
}

export function buildPlaywrightPlan({ nodeExe, cli, candidate, configPath, listing = false }) {
  const args = [cli, 'test', DOCX_TABLE_SPEC, '--config', configPath];
  if (listing) args.push('--list');
  return { command: nodeExe, args, cwd: path.join(candidate, 'e2e') };
}

export function resolvePlaywrightCli(candidate) {
  const require = createRequire(path.join(candidate, 'e2e', 'package.json'));
  return path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
}

const readFlag = (argv, name) => {
  const index = argv.indexOf('--' + name);
  return index === -1 ? undefined : argv[index + 1];
};

/** Parse and validate every runner input; throws RunnerInputError on any gap. */
export function parseRunnerArgs(argv, env = process.env, { cwd = process.cwd() } = {}) {
  const rawWorkspace = readFlag(argv, 'workspace-root') || env.OFFICE_G0_WORKSPACE_ROOT;
  const workspaceRoot = path.resolve(cwd, rawWorkspace || discoverWorkspaceRoot(cwd));
  const inside = (flag, envName) => {
    const raw = readFlag(argv, flag);
    const value = raw === undefined ? env[envName] : raw;
    if (typeof value !== 'string' || value.trim() === '') {
      fail('missing_' + flag, '--' + flag + ' (or ' + envName + ') is required');
    }
    return assertInsideWorkspace(workspaceRoot, flag, path.resolve(cwd, value.trim()));
  };
  const candidate = inside('candidate', 'OFFICE_G0_CANDIDATE');
  const fixtures = inside('fixtures', 'OFFICE_G0_FIXTURES_DIR');
  const builds = inside('builds', 'OFFICE_G0_BUILDS_DIR');
  const prefix = inside('evidence-prefix', 'OFFICE_G0_EVIDENCE_PREFIX');
  const expectedManifestSha256 = requireHex64(
    'expected-manifest-sha256',
    readFlag(argv, 'expected-manifest-sha256') || env.OFFICE_G0_EXPECTED_MANIFEST_SHA256,
  );
  const expectedSourcePin = requireHex40(
    'expected-source-pin',
    readFlag(argv, 'expected-source-pin') || env.OFFICE_G0_EXPECTED_SOURCE_PIN || PINNED_SOURCE_PIN,
  );
  return Object.freeze({
    workspaceRoot,
    candidate,
    fixtures,
    builds,
    expectedManifestSha256,
    expectedSourcePin,
    paths: evidencePaths(prefix),
  });
}

/** A loopback port is free only if nothing owns it right now. */
export function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

export async function assertPortsFree(ports = LOGICAL_PORTS) {
  const busy = [];
  for (const [name, port] of Object.entries(ports)) {
    // eslint-disable-next-line no-await-in-loop -- two probes, deterministic order
    if (!(await portFree(port))) busy.push(name + '=' + port);
  }
  if (busy.length > 0) {
    fail('port_in_use', 'refusing to reuse a port this runner did not mint: ' + busy.join(', '));
  }
  return { ...ports };
}

function spawnLogged(plan, logPath, env) {
  const fd = fs.openSync(logPath, 'wx');
  try {
    return spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env,
    });
  } finally {
    fs.closeSync(fd);
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ status: child.exitCode, signal: child.signalCode == null ? null : child.signalCode, launchError: null });
  }
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ status: null, signal: null, launchError: String((error && error.message) || error) }));
    child.once('exit', (status, signal) => resolve({ status, signal: signal == null ? null : signal, launchError: null }));
  });
}

/**
 * A bounded settle-or-null wait. The deadline is cleared as soon as it fires and
 * is NOT unref'd: it is the only bound on a child stop, so it must fire even when
 * nothing else keeps the event loop alive.
 */
function graceTimeout(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    if (typeof timer.ref === 'function') timer.ref();
  });
}

/** Reject a child wait that outlives its bound instead of hanging the runner. */
export function withTimeout(promise, timeoutMs, code, detail) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new RunnerInputError(code, detail + ' exceeded ' + timeoutMs + 'ms')), timeoutMs);
      // The deadline is CLEARED when the raced promise settles. It is deliberately
      // not unref'd: an unref'd deadline can silently fail to fire, which would
      // turn a bounded wait into an unbounded one.
      promise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      );
    }),
  ]);
}

/**
 * Run one taskkill of OUR child pid tree; capture error AND nonzero exit instead
 * of swallowing them, and BOUND the killer itself so a hung taskkill can never
 * hang cleanup. On the deadline ONLY OUR taskkill process is stopped and the
 * stop is reported UNPROVEN (ok:false + error), never as a success.
 * killSpawn is an injectable seam: production passes node spawn, a test passes a
 * fake so a fabricated pid never reaches a real OS kill.
 */
export function taskkillTree(pid, timeoutMs = CHILD_STOP_TIMEOUT_MS, killSpawn = spawn) {
  return new Promise((resolve) => {
    let settled = false;
    let killer = null;
    const done = (r) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    const timer = setTimeout(() => {
      try {
        if (killer && typeof killer.kill === 'function') killer.kill('SIGKILL');
      } catch {
        /* the owned killer is already gone */
      }
      done({ ok: false, status: null, signal: null, error: 'taskkill did not exit within ' + timeoutMs + 'ms' });
    }, timeoutMs);
    // Deliberately NOT unref'd: this deadline is the only thing that bounds a hung
    // taskkill, so it must be able to fire even when nothing else keeps the loop alive.
    try {
      killer = killSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      done({ ok: false, status: null, signal: null, error: String((error && error.message) || error) });
      return;
    }
    killer.once('error', (error) => done({ ok: false, status: null, signal: null, error: String((error && error.message) || error) }));
    killer.once('exit', (status, signal) =>
      done({ ok: status === 0, status, signal: signal == null ? null : signal, error: status === 0 ? null : 'taskkill exited with ' + status }),
    );
  });
}

/**
 * Stop ONLY the process tree this runner spawned. On Windows the tree is walked
 * with taskkill /PID <our child pid> /T /F - never by image name, never a global
 * kill - and only while our own spawn handle is still alive, so a recycled
 * unrelated pid can never become the target. POSIX gets SIGTERM grace then
 * SIGKILL on the same child only.
 */
export async function stopChildTree(child, { graceMs = 5000, killWaitMs = CHILD_STOP_TIMEOUT_MS, killSpawn = spawn } = {}) {
  const base = {
    owned: false,
    pid: child ? child.pid : null,
    tree: 'unknown',
    command: null,
    killStatus: null,
    killSignal: null,
    exited: false,
    exit: null,
    error: null,
  };
  if (!child || child.exitCode !== null || child.signalCode !== null) return { ...base, exited: true };
  const pid = child.pid;
  const evidence = { ...base, owned: true, pid };
  if (process.platform === 'win32' && typeof pid === 'number') {
    const killed = await taskkillTree(pid, killWaitMs, killSpawn);
    evidence.command = 'taskkill /PID ' + pid + ' /T /F';
    evidence.killStatus = killed.status;
    evidence.killSignal = killed.signal;
    evidence.error = killed.error;
    const settled = await Promise.race([waitForExit(child), graceTimeout(killWaitMs)]);
    evidence.exit = settled;
    evidence.exited = child.exitCode !== null;
    if (!evidence.exited && !evidence.error) evidence.error = 'owned child did not exit within ' + killWaitMs + 'ms of taskkill';
    return evidence;
  }
  child.kill('SIGTERM');
  let settled = await Promise.race([waitForExit(child), graceTimeout(graceMs)]);
  if (settled === null) {
    child.kill('SIGKILL');
    settled = await Promise.race([waitForExit(child), graceTimeout(killWaitMs)]);
  }
  evidence.exit = settled;
  evidence.exited = child.exitCode !== null;
  if (!evidence.exited && !evidence.error) evidence.error = 'owned child did not exit within ' + killWaitMs + 'ms of SIGKILL';
  return evidence;
}

/** Violations from the owned-tree cleanup and the bounded server close. */
export function cleanupViolations(cleanup, serverClose = null) {
  const violations = [];
  if (serverClose && serverClose.error) violations.push('server_close: ' + serverClose.error);
  for (const entry of cleanup || []) {
    if (!entry || entry.owned !== true) continue;
    if (entry.error) violations.push('pid ' + entry.pid + ': ' + entry.error);
    else if (entry.exited !== true) violations.push('pid ' + entry.pid + ': exit unproven');
  }
  return violations;
}

/** Bound server.close and KEEP its error instead of swallowing it. */
async function closeServer(server, timeoutMs = SERVER_CLOSE_TIMEOUT_MS) {
  const closing = Promise.resolve()
    .then(() => server.close())
    .then(() => ({ error: null }))
    .catch((error) => ({ error: String((error && error.message) || error) }));
  return Promise.race([
    closing,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: 'server.close did not settle within ' + timeoutMs + 'ms' }), timeoutMs);
      closing.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      );
    }),
  ]);
}

/**
 * The ONE finalization path. Builds the record main persists and decides the
 * final outcome: a browser success survives ONLY when the server close and every
 * owned tree are clean. Any cleanup failure is folded into a failed record, and
 * a pre-existing primary failure keeps its own code.
 */
export function finalizeRecord({ result = null, failure = null, started, cleanup = [], serverClose = null, refs = {}, records = [] }) {
  started.cleanup = cleanup;
  started.serverClose = serverClose;
  const violations = cleanupViolations(cleanup, serverClose);
  let finalFailure = failure;
  if (violations.length > 0) {
    started.cleanupFailure = { code: 'cleanup_failed', violations };
    if (!finalFailure) {
      finalFailure = new RunnerInputError('cleanup_failed', 'owned cleanup failed: ' + violations.join('; '));
    }
    if (!started.failure) {
      started.failure = { code: finalFailure.code || 'cleanup_failed', message: String(finalFailure.message || finalFailure) };
    }
  } else if (failure && !started.failure) {
    started.failure = { code: failure.code || 'runner_error', message: String(failure.message || failure) };
  }
  const record = finalFailure
    ? { runner: RUNNER_ID, failure: started.failure, started, ...refs, records }
    : { ...result, cleanup, serverClose };
  return { record, failure: finalFailure };
}

/**
 * The ONE finalization + persistence seam, exported so main and the seam tests
 * run the SAME production code. Order is fixed and bounded: lift a latched
 * failure, bound server.close keeping its error, stop every owned tree, re-read
 * the latch, build refs/records, decide the record, re-read the latch once more,
 * write exactly ONE result file (a write failure forces a nonzero outcome), and
 * dispose the named signal guards LAST.
 */
export async function finalizeCycle({
  started,
  result = null,
  failure = null,
  latch = { signal: null, failure: null },
  server = null,
  closeTimeoutMs = SERVER_CLOSE_TIMEOUT_MS,
  stopOwnedChildren = async () => [],
  buildRefs = () => ({}),
  records = () => [],
  resultPath = null,
  writeRecord = null,
  signalHandlers = [],
  removeSignalListener = (signal, handler) => process.removeListener(signal, handler),
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  let serverClose = { error: null };
  let cleanup = [];
  let refs = {};
  let recordList = [];
  const liftLatched = () => {
    if (latch.failure && !failure) {
      failure = latch.failure;
      if (!started.failure) {
        started.failure = { code: failure.code || 'runner_signal', message: String(failure.message || failure) };
      }
    }
  };
  const decide = () => finalizeRecord({ result, failure, started, cleanup, serverClose, refs, records: recordList });
  const decideFallback = (error) => {
    const fallback = failure || new RunnerInputError('finalize_failed', 'finalization failed: ' + String((error && error.message) || error));
    const fallbackFailure = { code: fallback.code || 'finalize_failed', message: String(fallback.message || fallback) };
    started.failure = fallbackFailure;
    failure = fallback;
    return { record: { runner: RUNNER_ID, failure: fallbackFailure, started, records: recordList }, failure: fallback };
  };

  liftLatched();
  try {
    if (server) serverClose = await closeServer(server, closeTimeoutMs);
  } catch (error) {
    serverClose = { error: 'server_close_threw: ' + String((error && error.message) || error) };
  }
  try {
    cleanup = (await stopOwnedChildren()) || [];
  } catch (error) {
    cleanup = [{ owned: true, pid: null, exited: false, error: 'stop_failed: ' + String((error && error.message) || error) }];
  }
  liftLatched();
  try {
    refs = buildRefs() || {};
  } catch (error) {
    refs = { refsError: String((error && error.message) || error) };
  }
  try {
    recordList = records() || [];
  } catch (error) {
    recordList = [];
    started.recordsError = String((error && error.message) || error);
  }
  liftLatched();
  let decided = decide();

  let persistenceError = null;
  if (resultPath && typeof writeRecord === 'function') {
    try {
      writeRecord(resultPath, JSON.stringify(decided.record, null, 2) + '\n');
    } catch (error) {
      persistenceError = { code: 'result_persist_failed', message: String((error && error.message) || error) };
      const forced = failure || new RunnerInputError(persistenceError.code, persistenceError.message);
      failure = forced;
      started.persistenceFailure = { code: forced.code || persistenceError.code, message: String(forced.message || forced) };
      if (!started.failure) started.failure = started.persistenceFailure;
      decided = decide();
    }
  }
  if (persistenceError) {
    failure = failure || new RunnerInputError(persistenceError.code, persistenceError.message);
    setExitCode(1);
  }
  for (const { signal, handler } of signalHandlers) {
    try {
      removeSignalListener(signal, handler);
    } catch {
      /* a guard that is already gone is not a failure */
    }
  }
  if (failure) setExitCode(1);
  return { record: decided.record, failure: failure || decided.failure || null, persistenceError };
}

/** Every input/evidence file this run's provenance record pins by hash. */
export function evidenceRefs({ candidate, options, manifest, fixture, paths }) {
  const files = {
    runner: path.join(candidate, 'scripts', 'office-g0', 'run-docx-table-cycle.mjs'),
    oracle: path.join(candidate, ORACLE_REL),
    sliceConfig: path.join(candidate, CONFIG_REL),
    sharedConfig: path.join(candidate, SHARED_CONFIG_REL),
    spec: path.join(candidate, SPEC_REL),
    labServer: path.join(candidate, LAB_SERVER_REL),
    buildManifest: path.join(options.builds, 'host-build-manifest.json'),
    fixture: fixture ? fixture.path : path.join(options.fixtures, EXPECTED_FIXTURE.name),
  };
  const hashes = {};
  for (const [label, target] of Object.entries(files)) {
    hashes[label] = fs.existsSync(target) ? { path: target, sha256: sha256File(target) } : { path: target, sha256: null };
  }
  return {
    hashes,
    manifest: manifest
      ? { path: files.buildManifest, sha256: manifest.sha256, app: manifest.app, pinnedSourceCommit: manifest.pinnedSourceCommit }
      : null,
    paths,
  };
}

/**
 * Run ONE bounded DOCX table browser acceptance cycle. Nothing is built here:
 * every input is caller-supplied and validated, and the lab binds to the real
 * candidate routes.
 */
export async function main(argv = process.argv.slice(2), env = process.env, { cwd = process.cwd() } = {}) {
  const options = parseRunnerArgs(argv, env, { cwd });
  const paths = assertEvidencePrefixFree(options.paths);
  const manifestPath = path.join(options.builds, 'host-build-manifest.json');
  const fixturePath = path.join(options.fixtures, EXPECTED_FIXTURE.name);
  const { labDir } = runtimeRoots(paths);

  requireFiles([
    ['candidate', options.candidate],
    ['slice playwright config', path.join(options.candidate, CONFIG_REL)],
    ['shared playwright config', path.join(options.candidate, SHARED_CONFIG_REL)],
    ['table-cycle spec', path.join(options.candidate, SPEC_REL)],
    ['oracle module', path.join(options.candidate, ORACLE_REL)],
    ['lab server', path.join(options.candidate, LAB_SERVER_REL)],
    ['docs build index', path.join(options.builds, DOCX_APP, 'index.html')],
    ['build manifest', manifestPath],
    ['fixture', fixturePath],
  ]);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    fail('node_too_old', 'this lab requires Node 22+, running ' + process.version);
  }

  let manifest = null;
  let fixture = null;
  let server = null;
  const ownedChildren = new Set();
  const started = {
    discovery: null,
    run: null,
    cleanup: null,
    serverClose: null,
    signals: [],
    failure: null,
  };
  let result = null;
  let failure = null;
  let finalized = null;
  const latch = { signal: null, failure: null };
  const signals = ['SIGINT', 'SIGTERM'];

  const spawnOwned = (plan, logPath, childEnv) => {
    const child = spawnLogged(plan, logPath, childEnv);
    ownedChildren.add(child);
    return child;
  };
  const stopOwnedChildren = async () => {
    const evidence = [];
    for (const owned of ownedChildren) {
      evidence.push(await stopChildTree(owned));
    }
    return evidence;
  };
  const finalize = () => {
    if (!finalized) {
      finalized = finalizeCycle({
        started,
        result,
        failure,
        latch,
        server,
        stopOwnedChildren,
        buildRefs: () => evidenceRefs({ candidate: options.candidate, options, manifest, fixture, paths }),
        records: () => (server ? server.records() : []),
        resultPath: paths.result,
        writeRecord: (target, text) => fs.writeFileSync(target, text, { flag: 'wx' }),
        signalHandlers: signals.map((signal) => ({ signal, handler: onSignal })),
        setExitCode: (code) => {
          process.exitCode = code;
        },
      }).then((outcome) => {
        failure = outcome.failure;
        return outcome.record;
      });
    }
    return finalized;
  };
  const onSignal = (signal) => {
    started.signals.push(signal);
    latch.signal = latch.signal || signal;
    if (!latch.failure) {
      latch.failure = new RunnerInputError('runner_signal', 'received ' + signal + ' before the cycle finished');
      started.signalFailure = { code: latch.failure.code, message: String(latch.failure.message) };
      if (!started.failure) started.failure = { code: latch.failure.code, message: String(latch.failure.message) };
    }
    void finalize()
      .catch(() => undefined)
      .then(() => process.exit(130));
  };

  try {
    manifest = validateBuildManifest({
      manifestBytes: fs.readFileSync(manifestPath),
      expectedSha256: options.expectedManifestSha256,
      expectedSourcePin: options.expectedSourcePin,
      expectedApp: DOCX_APP,
    });
    fixture = assertFixturePin(fixturePath);
    assertNoSkippedTests(fs.readFileSync(path.join(options.candidate, SPEC_REL), 'utf8'), SPEC_REL);
    await assertPortsFree(LOGICAL_PORTS);

    fs.mkdirSync(paths.runtime, { recursive: true });
    fs.mkdirSync(paths.artifacts, { recursive: true });
    fs.mkdirSync(paths.temp, { recursive: true });
    fs.mkdirSync(labDir, { recursive: true });

    const cli = resolvePlaywrightCli(options.candidate);
    const childEnv = buildChildEnv({ env, options, paths, manifest });
    for (const signal of signals) process.once(signal, onSignal);

    server = createLabServer({
      buildsDir: options.builds,
      labDir,
      fixturesDir: options.fixtures,
      sourceDir: options.candidate,
      port: LOGICAL_PORTS.app,
      previewPort: LOGICAL_PORTS.preview,
    });
    const listening = await server.listen();

    const listChild = spawnOwned(
      buildPlaywrightPlan({ nodeExe: process.execPath, cli, candidate: options.candidate, configPath: path.join(options.candidate, CONFIG_REL), listing: true }),
      paths.listLog,
      childEnv,
    );
    const listExit = await withTimeout(waitForExit(listChild), DISCOVERY_TIMEOUT_MS, 'discovery_timeout', 'Playwright discovery');
    const listed = parseListOutput(fs.existsSync(paths.listLog) ? fs.readFileSync(paths.listLog, 'utf8') : '');
    if (listExit.status !== 0) fail('discovery_failed', 'Playwright discovery exited with ' + JSON.stringify(listExit));
    started.discovery = { exit: listExit, ...assertDiscovery(listed) };

    const runChild = spawnOwned(
      buildPlaywrightPlan({ nodeExe: process.execPath, cli, candidate: options.candidate, configPath: path.join(options.candidate, CONFIG_REL) }),
      paths.runLog,
      childEnv,
    );
    const runExit = await withTimeout(waitForExit(runChild), EXECUTION_TIMEOUT_MS, 'run_timeout', 'Playwright run');
    const runReport = fs.existsSync(paths.runJson) ? parsePlaywrightJson(fs.readFileSync(paths.runJson, 'utf8')) : null;
    const outcome = assertRunOutcome(runReport, { expectedTotal: started.discovery.total });
    started.run = { exit: runExit, report: runReport, outcome };
    if (runExit.status !== 0) fail('run_failed', 'Playwright run exited with ' + JSON.stringify(runExit));

    result = {
      runner: RUNNER_ID,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      fixture,
      ...evidenceRefs({ candidate: options.candidate, options, manifest, fixture, paths }),
      ports: LOGICAL_PORTS,
      origins: listening,
      discovery: started.discovery,
      playwright: runExit,
      outcome,
      records: server.records(),
    };
  } catch (error) {
    failure = error;
    started.failure = { code: error.code || 'runner_error', message: String((error && error.message) || error) };
  } finally {
    await finalize();
  }
  if (failure) process.exitCode = 1;
  if (failure) throw failure;
  return result;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().then(
    (result) => {
      process.stdout.write(JSON.stringify({ runner: RUNNER_ID, playwright: result.playwright, fixture: result.fixture }, null, 2) + '\n');
    },
    (error) => {
      process.stderr.write('docx-table runner failed: ' + String((error && error.stack) || error) + '\n');
      process.exitCode = 1;
    },
  );
}
