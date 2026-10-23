#!/usr/bin/env node
// UNI-667 wave2 PPTX cycle runner (lane UNI-667-office-pptx-runner-r1).
//
// Orchestrates ONE fresh, bounded PPTX browser acceptance run and builds nothing
// itself. It:
//   * validates explicit caller-supplied input paths plus an approved
//     host-build manifest (exactly one app: slides, pinned source commit,
//     immutable source closure);
//   * resolves the native engine through the real prepared engine entry
//     (packages/pptx-engine/src/index.ts) launched with the prepared tree's own
//     tsx under Node 22 - never Node's .mts stripping, never a fake fallback;
//   * binds the lab server to the REAL candidate engine routes with explicit
//     route-string engineHandlers, so a missing required capability is a named
//     hard failure instead of an unreachable base URL;
//   * discovers the Playwright tests before running them AND parses the run's
//     JSON execution evidence, so a zero-test, skipped, unexpected, retried,
//     timed-out, todo or interrupted required test cannot pass silently;
//   * captures child stdout/stderr/exit, lab server records and the actual
//     source/build/spec/helper hashes under a NEW evidence prefix;
//   * stops only children it owns, including on a launch failure.
//
// Import-safe: importing this module only defines exports. The runner executes
// when this file is the process entry, so the pure input/manifest/evidence
// predicates below are unit-testable without spawning anything.
//
// Grounded references:
//   e2e/office-g0/lab-server.mjs        createLabServer({buildsDir,labDir,fixturesDir,sourceDir,port,previewPort,engineBaseUrl,engineTimeoutMs})
//   e2e/office-g0/lab-server.mjs        LAB_APPS includes 'slides'; appOf('/slides/...') serves builds/slides
//   e2e/office-g0/engine-host.mts       --source <module root> --lab <doc root> --port --prebundle; POST /engine/<route>
//   e2e/office-g0/engine-pptx.mts       loadPptxEngineFromSource(sourceRoot) -> packages/pptx-engine/src/index.ts
//   e2e/office-g0/lab-engine.mjs        ENGINE_OPERATIONS allowlist; createEngineProxy handlers take a route string
//   e2e/office-g0/engine-pptx-routes.mts  /engine/pptx-open|save|edit-text|is-dirty; no txn/layouts/new-blank
//   scripts/office-g0/prebundle-engine.mjs  prepared tsx; esbuild from the prepared tree
//   scripts/office-g0/build-renderers.mjs   host-build-manifest.json fields pinnedSourceCommit/sourceUntouched/appSourcesUntouched/apps
//   e2e/playwright.office-g0.config.ts  shared config (chrome+edge, retries 0, workers 1) this config imports
//   office-g0/parallel-wave2-contract.md runner contract; PPTX ports 5470/5471/5472
//   e2e/office-g0/host-surface.mjs:9    PINNED_SOURCE_COMMIT

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createLabServer } from '../../e2e/office-g0/lab-server.mjs';
import { ENGINE_OPERATIONS } from '../../e2e/office-g0/lab-engine.mjs';

export const RUNNER_ID = 'office-g0-pptx-runner-r1';
export const PPTX_APP = 'slides';
export const PPTX_SPEC = 'pptx-cycle.spec.ts';
/** The separately owned image cycle: replace an EXISTING slide picture, save, reopen. */
export const PPTX_IMAGE_SPEC = 'pptx-image-cycle.spec.ts';
/**
 * The complete PPTX spec set. A run must load EVERY spec that exists; a missing one is a
 * named failure, so an absent image spec can never look like a silent pass.
 */
export const PPTX_SPECS = Object.freeze([PPTX_SPEC, PPTX_IMAGE_SPEC]);
/**
 * The bounded spec set for the image feature lane. The accepted Text1 cycle is frozen and
 * independently owned: on this environment its exact-substring run-marker assertion cannot
 * match (RenderText splits runs with spaces), and repairing that spec would reopen accepted
 * work, so the image lane runs its own spec as an EXPLICIT named choice instead of inheriting
 * the text cycle as an unrelated prerequisite. The default stays the complete matrix.
 */
export const PPTX_IMAGE_SPECS = Object.freeze([PPTX_IMAGE_SPEC]);
/** The selectable spec sets; `full` is the default so an unqualified run loses no coverage. */
export const SPEC_SETS = Object.freeze({ full: PPTX_SPECS, image: PPTX_IMAGE_SPECS });
export const DEFAULT_SPEC_SET = 'full';
export const PPTX_CONFIG_REL = 'e2e/playwright.office-g0.pptx.config.ts';
export const SHARED_CONFIG_REL = 'e2e/playwright.office-g0.config.ts';
/** e2e/office-g0/host-surface.mjs:9 */
export const PINNED_SOURCE_PIN = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
/** parallel-wave2-contract.md: pptx logical ports app/preview/engine. */
export const LOGICAL_PORTS = Object.freeze({ app: 5470, preview: 5471, engine: 5472 });
/** parallel-wave2-contract.md pinned PPTX fixture identity. */
export const EXPECTED_FIXTURE = Object.freeze({
  name: 'g0-slides.pptx',
  bytes: 58823,
  sha256: '4f85bdd59277a70bc94a66ebd39dd4882f88b5edd4211c0d3de6d09b6763d935',
});
/**
 * The deterministic PPTX image fixture and its replacement PNG, both produced by
 * scripts/office-g0/create-pptx-image-fixture.mjs. The authored deck is a DIFFERENT
 * deck from g0-slides.pptx on purpose: it carries TWO distinct pictures on slide 1
 * (a target and a control), so a wrong-image or lost-unrelated-object result is
 * observable. The replacement is a distinct 16x16 PNG whose decoded pixels differ
 * from BOTH authored pictures.
 */
export const EXPECTED_IMAGE_FIXTURE = Object.freeze({
  name: 'g0-image-slides.pptx',
  bytes: 8789,
  sha256: '6b60fb85bf9eebd799c8edd3869a9a51cc90a41f60c46faeb9bdc930270fcf7f',
});
export const EXPECTED_IMAGE_REPLACEMENT = Object.freeze({
  name: 'g0-image-slides-replacement.png',
  bytes: 466,
  sha256: 'a81422feafe706f00a9a93e98c7d48fa274ba9685315292190db10392299fb46',
});
/**
 * The accepted Text1 cycle is FROZEN and independently owned. `--spec-set image` proves only the
 * image spec, so without an explicit pin a later edit to the accepted text spec would drift
 * unnoticed by every image-lane run. This pin fails by name whichever set was selected, and it is
 * a pin only: the runner never rewrites or repairs the accepted spec.
 */
export const FROZEN_TEXT_SPEC = Object.freeze({
  name: PPTX_SPEC,
  bytes: 31750,
  sha256: '412fb9f94bed5cb44b94fdc6beb7f475a7164cf223ae977eba992c4cf97036f3',
});
/**
 * Decoded-pixel pins for the three deterministic 16x16 PNGs, independent of their
 * container bytes: a re-encode that decodes to different pixels still fails. Computed
 * from the fixture builder's own pixel generators
 * (create-pptx-image-fixture.mjs AUTHORED_PIXEL / CONTROL_PIXEL / REPLACEMENT_PIXEL).
 */
export const IMAGE_PIXEL_PINS = Object.freeze({
  authoredRgbSha256: '85e8d8039ec3f1551c37eb17a833afbcd8338052d788c0899202d2005b9e696a',
  controlRgbSha256: '762346ee7d4c09991a0e741a8829411327e01f4624513c0da6661110ae643c17',
  replacementRgbSha256: '7a74d2c1d64839a6c60e7317f87aea29d0b0b5cd3f28a2c4b5d800472855810b',
  replacementSize: 16,
});
/** A skipped required test is a silent hole, so it is refused statically too. */
export const SKIPPED_TEST_PATTERNS = Object.freeze([
  /test\.skip\s*\(/,
  /test\.describe\.skip\s*\(/,
  /test\.fixme\s*\(/,
  /test\.describe\.fixme\s*\(/,
]);

/**
 * Engine operations one honest PPTX cycle needs. pptx-open/pptx-save are in the
 * shared ENGINE_OPERATIONS allowlist today; pptx-edit-text/pptx-is-dirty are added
 * to that shared allowlist by the MOUNT OWNER, so the runner never edits or
 * duplicates that shared mutation binding - it only verifies the capability exists.
 */
/**
 * Engine operations one honest PPTX cycle needs. pptx-open/pptx-save are in the
 * shared ENGINE_OPERATIONS allowlist today; pptx-edit-text/pptx-is-dirty are added
 * to that shared allowlist by the MOUNT OWNER, so the runner never edits or
 * duplicates that shared mutation binding - it only verifies the capability exists.
 * pptx-layouts is required too: the renderer's new-slide picker mounts through
 * host:slides-layouts, and engine-pptx-routes.mts now serves it from the real
 * pptx-engine layout catalog, so a host that cannot serve it must fail by name.
 */
export const REQUIRED_ENGINE_OPERATIONS = Object.freeze([
  'pptx-open',
  'pptx-save',
  'pptx-edit-text',
  'pptx-is-dirty',
  'pptx-layouts',
  // Picture Format > Replace Picture reaches the engine through
  // host:slides-replace-picture-bytes; engine-pptx-routes.mts already serves
  // /engine/pptx-replace-picture from the real pptx-engine replacePictureBytes, so a
  // host that cannot serve it must fail by name rather than skip the image cycle.
  'pptx-replace-picture',
]);
/** Engine operations the candidate host genuinely does not route; never bound, never faked. */
export const UNROUTED_ENGINE_OPERATIONS = Object.freeze(['pptx-txn', 'pptx-new-blank']);
/** The preview origin env the shared config deliberately does not require. */
export const PREVIEW_URL_ENV = 'OFFICE_G0_PREVIEW_URL';

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

/** Evidence targets derived from one NEW prefix; mirrors the DOCX runner precedent. */
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
  const taken = [paths.artifacts, paths.runtime, paths.listLog, paths.runLog, paths.runJson, paths.temp, paths.result].filter(
    (entry) => existsSync(entry),
  );
  if (taken.length > 0) {
    fail('evidence_prefix_exists', 'refusing to reuse existing evidence targets: ' + taken.join(', '));
  }
  return paths;
}

/**
 * The approved host-build manifest must hash to the caller's expected SHA-256,
 * pin the expected source commit, carry exactly the expected single app, and
 * prove the prepared source was not mutated during its own build.
 */
export function validateBuildManifest({ manifestBytes, expectedSha256, expectedSourcePin, expectedApp = PPTX_APP }) {
  if (!Buffer.isBuffer(manifestBytes)) fail('manifest_not_bytes', 'manifestBytes must be a Buffer');
  const sha256 = sha256Bytes(manifestBytes);
  if (sha256 !== expectedSha256) {
    fail('manifest_sha256_mismatch', 'build manifest SHA256 mismatch: expected ' + expectedSha256 + ', read ' + sha256);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    fail('manifest_invalid_json', 'build manifest is not valid JSON: ' + String(error.message ?? error));
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest_invalid_shape', 'build manifest must be a JSON object');
  }
  const appKeys = Object.keys(manifest.apps ?? {});
  if (appKeys.length !== 1 || appKeys[0] !== expectedApp) {
    fail(
      'manifest_wrong_app',
      'build manifest must describe exactly one app "' + expectedApp + '", found [' + appKeys.join(', ') + ']',
    );
  }
  if (manifest.pinnedSourceCommit !== expectedSourcePin) {
    fail(
      'manifest_pin_mismatch',
      'build manifest pinnedSourceCommit ' + String(manifest.pinnedSourceCommit) + ' != expected ' + expectedSourcePin,
    );
  }
  if (manifest.sourceUntouched !== true || manifest.appSourcesUntouched !== true) {
    fail('manifest_source_mutated', 'build manifest does not prove the prepared source closure was untouched');
  }
  return { sha256, app: appKeys[0], pinnedSourceCommit: manifest.pinnedSourceCommit };
}

/**
 * The authored fixture (or any pinned input) must be present at the pinned size and hash. The
 * failure code defaults to the fixture spelling; callers pinning a different kind of file name
 * their own code so the reason is never confused with an authored-deck mismatch.
 */
export function assertFixturePin(fixturePath, expected = EXPECTED_FIXTURE, code = 'fixture_hash_mismatch', label = 'authored fixture') {
  if (!fs.existsSync(fixturePath)) fail('fixture_missing', 'pinned file is absent: ' + fixturePath);
  const bytes = fs.readFileSync(fixturePath);
  const sha256 = sha256Bytes(bytes);
  if (bytes.length !== expected.bytes || sha256 !== expected.sha256) {
    fail(
      code,
      label + ' no longer matches the pinned identity: ' +
        bytes.length +
        'B/' +
        sha256 +
        ' vs pinned ' +
        expected.bytes +
        'B/' +
        expected.sha256,
    );
  }
  return { path: fixturePath, bytes: bytes.length, sha256 };
}

/** Refuse a spec file that contains a skipped/fixme test. */
export function assertNoSkippedTests(specText, specPath = '<spec>') {
  if (typeof specText !== 'string') fail('spec_not_text', 'spec text must be a string');
  const hits = SKIPPED_TEST_PATTERNS.filter((pattern) => pattern.test(specText));
  if (hits.length > 0) {
    fail('spec_has_skipped_test', 'required spec contains a skipped/fixme test: ' + specPath);
  }
  return true;
}

/** Every required input must exist; the message names all that are missing. */
export function requireFiles(entries) {
  const missing = entries.filter(([, target]) => !fs.existsSync(target)).map(([label, target]) => label + '=' + target);
  if (missing.length > 0) fail('required_input_missing', 'required inputs are absent: ' + missing.join('; '));
  return true;
}

/** A discovery listing must be non-empty and cover both installed browsers. */
export function assertDiscovery(parsed, { requiredProjects = ['chrome', 'edge'], minimum = 1 } = {}) {
  if (!parsed || !Number.isInteger(parsed.total) || parsed.total < minimum) {
    fail('discovery_zero_tests', 'Playwright discovery found no tests: total=' + String(parsed && parsed.total));
  }
  const missing = requiredProjects.filter((project) => !parsed.projects.includes(project));
  if (missing.length > 0) {
    fail('discovery_missing_project', 'discovery omitted required Playwright project(s): ' + missing.join(', '));
  }
  return parsed;
}

/**
 * Every required PPTX spec must appear in the discovery listing. Playwright prints one
 * line per test as `<path>:<line>:<col> > <title>`, so a spec that the config's testMatch
 * forgot is a NAMED failure here rather than a quietly smaller run.
 */
export function assertPptxSpecCoverage(listText, { specs = PPTX_SPECS } = {}) {
  const text = String(listText ?? '');
  const missing = specs.filter((spec) => !text.includes(spec));
  if (missing.length > 0) {
    fail('discovery_missing_spec', 'Playwright discovery omitted required PPTX spec(s): ' + missing.join(', '));
  }
  return specs.slice();
}

/** The PPTX specs present in the candidate, in the canonical PPTX_SPECS order. */
export function presentPptxSpecs(candidate, { specs = PPTX_SPECS, existsSync = fs.existsSync } = {}) {
  return specs.filter((spec) => existsSync(path.join(candidate, 'e2e', 'office-g0', spec)));
}

/** Parse the list reporter output; a missing Total line is not zero tests, it is a failure. */
export function parseListOutput(text) {
  const lines = String(text ?? '').split(/\r?\n/);
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

/** Parse the Playwright JSON reporter output into outcome counts, or null if unreadable. */
export function parsePlaywrightJson(text) {
  let report;
  try {
    report = JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
  if (!report || typeof report !== 'object' || !report.stats || !Array.isArray(report.suites)) return null;
  const stats = report.stats;
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        tests.push({
          title: spec.title,
          project: test.projectName,
          status: test.status,
          expectedStatus: test.expectedStatus,
          ok: spec.ok === true,
          results: (test.results ?? []).map((result) => result.status),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  const executed = tests.reduce(
    (total, entry) => total + entry.results.filter((status) => status !== 'skipped').length,
    0,
  );
  return {
    expected: stats.expected ?? 0,
    skipped: stats.skipped ?? 0,
    unexpected: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    tests,
    executed,
    projects: [...new Set(tests.map((entry) => entry.project))].sort(),
  };
}

/**
 * The real run's execution evidence must show every required test executing and
 * passing exactly once in each installed browser. An exit 0 with a skipped,
 * unexpected, flaky, retried, timed-out, todo or interrupted test is not a pass,
 * and the executed count must equal the discovery total for this run.
 */
export function assertRunOutcome(report, { requiredProjects = ['chrome', 'edge'], expectedTotal } = {}) {
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
    fail('run_outcome_not_clean', 'PPTX browser run is not a clean pass: ' + bad.slice(0, 12).join('; '));
  }
  return { executed: report.executed, expected: report.expected, projects: [...perProject.keys()] };
}

/**
 * The ONE document root an honest cycle needs. The engine host's --lab containment root and
 * the lab server's labDir must be the SAME directory: the engine publishes a view's result to
 * <lab>/out/<viewId> and the lab server grants <labDir>/out/<viewId> as that view's native
 * output, so a second root makes every publication land outside its own grant. Mirrors the
 * PDF runner, which already passes one runtimeDir to both (run-pdf-cycle.mjs:1361,1371).
 */
export function runtimeRoots(paths) {
  const labDir = path.resolve(path.join(paths.runtime, 'lab'));
  return { labDir, engineLabDir: labDir };
}

/** Refuse a split engine/lab root before any child is spawned; a named failure, never a silent repair. */
export function assertSharedRuntimeRoot(roots) {
  const engineLabDir = path.resolve(roots.engineLabDir);
  const labDir = path.resolve(roots.labDir);
  if (engineLabDir !== labDir) {
    fail(
      'runtime_root_split',
      'the engine --lab root and the lab server root must be one directory: engine=' +
        engineLabDir + ' lab=' + labDir,
    );
  }
  return roots;
}

/** The prepared engine host launch: prepared tsx + real prepared engine entry. */
export function buildEngineHostPlan({ nodeExe, engineSource, candidate, engineLabDir, enginePort, prebundle }) {
  const tsxCli = path.join(engineSource, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const hostEntry = path.join(candidate, 'e2e', 'office-g0', 'engine-host.mts');
  const engineEntry = path.join(engineSource, 'packages', 'pptx-engine', 'src', 'index.ts');
  return {
    command: nodeExe,
    args: [tsxCli, hostEntry, '--source', engineSource, '--lab', engineLabDir, '--port', String(enginePort), '--prebundle', prebundle],
    cwd: engineSource,
    route: 'http://127.0.0.1:' + enginePort + '/engine/ping',
    requiredPaths: [tsxCli, hostEntry, engineEntry, prebundle],
  };
}

/**
 * Bind the lab engine proxy to the REAL candidate route map. A binding is a route
 * STRING the proxy calls at <baseUrl>/engine/<route>; only operations the host
 * actually routes AND the shared allowlist already permits are bound. Nothing is
 * invented for an operation the host does not serve, so a route the candidate
 * lacks surfaces as a named unsupported failure instead of a fake success.
 */
export function selectEngineBindings({ requiredOperations = REQUIRED_ENGINE_OPERATIONS, hostRoutes = [], operations = [] } = {}) {
  const permitted = new Set(operations);
  const routed = new Set(hostRoutes);
  const handlers = {};
  const unbound = [];
  for (const operation of requiredOperations) {
    const route = '/engine/' + operation;
    if (!permitted.has(operation) || !routed.has(route)) {
      unbound.push({ operation, allowed: permitted.has(operation), routed: routed.has(route) });
      continue;
    }
    handlers[operation] = operation;
  }
  return { handlers, unbound };
}

/** A required candidate capability that is absent is a named hard failure, never a fallback. */
export function assertRequiredEngineCapability(selection, { requiredOperations = REQUIRED_ENGINE_OPERATIONS } = {}) {
  if (selection.unbound.length > 0) {
    fail(
      'engine_capability_missing',
      'candidate engine cannot serve required PPTX operation(s): ' +
        selection.unbound
          .map((entry) => entry.operation + '(allowlist=' + entry.allowed + ',route=' + entry.routed + ')')
          .join(', ') +
        '; required=[' + requiredOperations.join(', ') + ']. The mount owner supplies the shared ' +
        'pptx-edit-text/pptx-is-dirty allowlist; this runner never fakes an unrouted operation ' +
        '(no pptx-txn/pptx-new-blank binding).',
    );
  }
  return selection;
}

/** The preview origin the runner owns; identical to the owned lab preview port. */
export function previewUrlFor(ports = LOGICAL_PORTS) {
  return 'http://127.0.0.1:' + ports.preview;
}

export function buildPlaywrightPlan({ nodeExe, cli, candidate, configPath, listing = false, specs = PPTX_SPECS }) {
  // Every present spec is named explicitly, so a run can never quietly load a subset
  // of the PPTX set (the config testMatch and the discovery/run report are cross-checked
  // against the same list by assertPptxSpecCoverage).
  const args = [cli, 'test', ...specs, '--config', configPath];
  if (listing) args.push('--list');
  return { command: nodeExe, args, cwd: path.join(candidate, 'e2e') };
}

export function resolvePlaywrightCli(candidate) {
  const require = createRequire(path.join(candidate, 'e2e', 'package.json'));
  return path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
}

export function evidenceRefs({ candidate, options, manifest, fixture, enginePlan, paths }) {
  const files = {
    runner: path.join(candidate, 'scripts', 'office-g0', 'run-pptx-cycle.mjs'),
    pptxConfig: path.join(candidate, PPTX_CONFIG_REL),
    sharedConfig: path.join(candidate, SHARED_CONFIG_REL),
    spec: path.join(candidate, 'e2e', 'office-g0', PPTX_SPEC),
    imageSpec: path.join(candidate, 'e2e', 'office-g0', PPTX_IMAGE_SPEC),
    imageFixture: path.join(options.fixtures, EXPECTED_IMAGE_FIXTURE.name),
    imageReplacement: path.join(options.fixtures, EXPECTED_IMAGE_REPLACEMENT.name),
    labServer: path.join(candidate, 'e2e', 'office-g0', 'lab-server.mjs'),
    labEngine: path.join(candidate, 'e2e', 'office-g0', 'lab-engine.mjs'),
    engineHost: path.join(candidate, 'e2e', 'office-g0', 'engine-host.mts'),
    engineEntry: path.join(options.engineSource, 'packages', 'pptx-engine', 'src', 'index.ts'),
    buildManifest: path.join(options.builds, 'host-build-manifest.json'),
    fixture: fixture ? fixture.path : path.join(options.fixtures, EXPECTED_FIXTURE.name),
    prebundle: options.prebundle,
  };
  const hashes = {};
  for (const [label, target] of Object.entries(files)) {
    hashes[label] = fs.existsSync(target) ? { path: target, sha256: sha256File(target) } : { path: target, sha256: null };
  }
  return {
    hashes,
    manifest: manifest
      ? {
          path: files.buildManifest,
          sha256: manifest.sha256,
          app: manifest.app,
          pinnedSourceCommit: manifest.pinnedSourceCommit,
        }
      : null,
    enginePlan: enginePlan ? { route: enginePlan.route, source: options.engineSource } : null,
    paths,
  };
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
    OFFICE_G0_ENGINE_BASE_URL: 'http://127.0.0.1:' + LOGICAL_PORTS.engine,
    OFFICE_G0_PPTX_PREBUNDLE: options.prebundle,
    // The image cycle's authored deck, its replacement PNG and the independent content
    // pins the spec re-checks rather than trusting. PICK_PATH is the operator-named file
    // the lab picker reads for real; it is the replacement itself, so the picker's bytes
    // and the oracle's pinned bytes are provably the same file.
    OFFICE_G0_PPTX_IMAGE_FIXTURE: EXPECTED_IMAGE_FIXTURE.name,
    OFFICE_G0_PPTX_IMAGE_REPLACEMENT: EXPECTED_IMAGE_REPLACEMENT.name,
    OFFICE_G0_PPTX_IMAGE_FIXTURE_SHA256: EXPECTED_IMAGE_FIXTURE.sha256,
    OFFICE_G0_PPTX_IMAGE_REPLACEMENT_SHA256: EXPECTED_IMAGE_REPLACEMENT.sha256,
    OFFICE_G0_PPTX_IMAGE_AUTHORED_RGB_SHA256: IMAGE_PIXEL_PINS.authoredRgbSha256,
    OFFICE_G0_PPTX_IMAGE_CONTROL_RGB_SHA256: IMAGE_PIXEL_PINS.controlRgbSha256,
    OFFICE_G0_PPTX_IMAGE_REPLACEMENT_RGB_SHA256: IMAGE_PIXEL_PINS.replacementRgbSha256,
    [PREVIEW_URL_ENV]: previewUrl,
    TEMP: paths.temp,
    TMP: paths.temp,
    TMPDIR: paths.temp,
  };
}

const readFlag = (argv, name) => {
  const index = argv.indexOf('--' + name);
  return index === -1 ? undefined : argv[index + 1];
};

/** Parse and validate every runner input; throws RunnerInputError on any gap. */
export function parseRunnerArgs(argv, env = process.env, { cwd = process.cwd() } = {}) {
  const rawWorkspace = readFlag(argv, 'workspace-root') ?? env.OFFICE_G0_WORKSPACE_ROOT;
  const workspaceRoot = path.resolve(cwd, rawWorkspace ?? discoverWorkspaceRoot(cwd));
  const inside = (flag, envName) => {
    const value = readFlag(argv, flag) ?? env[envName];
    if (typeof value !== 'string' || value.trim() === '') {
      fail('missing_' + flag, '--' + flag + ' (or ' + envName + ') is required');
    }
    return assertInsideWorkspace(workspaceRoot, flag, path.resolve(cwd, value.trim()));
  };
  const candidate = inside('candidate', 'OFFICE_G0_CANDIDATE');
  const fixtures = inside('fixtures', 'OFFICE_G0_FIXTURES_DIR');
  const builds = inside('builds', 'OFFICE_G0_BUILDS_DIR');
  const engineSource = inside('engine-source', 'OFFICE_G0_ENGINE_SOURCE');
  const prebundle = inside('prebundle', 'OFFICE_G0_PPTX_PREBUNDLE');
  const prefix = inside('evidence-prefix', 'OFFICE_G0_EVIDENCE_PREFIX');
  const expectedManifestSha256 = requireHex64(
    'expected-manifest-sha256',
    readFlag(argv, 'expected-manifest-sha256') ?? env.OFFICE_G0_EXPECTED_MANIFEST_SHA256,
  );
  const expectedSourcePin = requireHex40(
    'expected-source-pin',
    readFlag(argv, 'expected-source-pin') ?? env.OFFICE_G0_EXPECTED_SOURCE_PIN ?? PINNED_SOURCE_PIN,
  );
  // Which spec set this run must prove. An unknown name is a named failure rather than a
  // silent fallback to the default, so a typo can never shrink the required matrix.
  const specSet = String(readFlag(argv, 'spec-set') ?? env.OFFICE_G0_PPTX_SPEC_SET ?? DEFAULT_SPEC_SET).trim();
  if (!Object.hasOwn(SPEC_SETS, specSet)) {
    fail('unknown_spec_set', '--spec-set must be one of ' + Object.keys(SPEC_SETS).join(', ') + '; got ' + specSet);
  }
  return Object.freeze({
    workspaceRoot,
    candidate,
    fixtures,
    builds,
    engineSource,
    prebundle,
    expectedManifestSha256,
    expectedSourcePin,
    specSet,
    specs: SPEC_SETS[specSet],
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
    // eslint-disable-next-line no-await-in-loop -- three probes, deterministic order
    if (!(await portFree(port))) busy.push(name + '=' + port);
  }
  if (busy.length > 0) {
    fail('port_in_use', 'refusing to reuse a port this runner did not mint: ' + busy.join(', '));
  }
  return { ...ports };
}

function spawnLogged(plan, logPath, env) {
  const fd = fs.openSync(logPath, 'wx');
  let child;
  try {
    child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env,
    });
  } finally {
    fs.closeSync(fd);
  }
  return child;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ status: child.exitCode, signal: child.signalCode ?? null, launchError: null });
  }
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ status: null, signal: null, launchError: String(error.message ?? error) }));
    child.once('exit', (status, signal) => resolve({ status, signal, launchError: null }));
  });
}

/** Reject a child wait that outlives its bound instead of hanging the runner. */
export function withTimeout(promise, timeoutMs, code, detail) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new RunnerInputError(code, detail + ' exceeded ' + timeoutMs + 'ms')), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

/** Poll the host, and fail fast if the child we spawned has already exited. */
async function waitForEnginePing(route, { timeoutMs = 30000, child = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  const exitNotice = child ? childExitNotice(child) : null;
  let last = 'no attempt';
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      fail('engine_exited', 'prepared engine host exited (code ' + child.exitCode + ', signal ' + (child.signalCode ?? null) + ') before answering ' + route + ': ' + last);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('engine ping deadline exceeded')), Math.max(1, remaining));
    if (typeof timer.unref === 'function') timer.unref();
    try {
      // Request AND body read happen under the same signal, and the whole attempt is
      // raced against child exit/error so no fetch can outlive the engine it probes.
      const attempt = (async () => {
        const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal });
        if (!response.ok) return { kind: 'http', status: response.status };
        const text = await response.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = null; }
        return body && body.ok === true ? { kind: 'ok', result: body.result } : { kind: 'body' };
      })();
      const outcome = exitNotice ? await Promise.race([attempt, exitNotice]) : await attempt;
      if (outcome.kind === 'exit') {
        fail('engine_exited', 'prepared engine host exited (' + JSON.stringify(outcome.exit) + ') before answering ' + route + ': ' + last);
      }
      if (outcome.kind === 'ok') {
        // Recheck AFTER the body read: a result read from a child that has since died is not a ready engine.
        if (child && (child.exitCode !== null || child.signalCode !== null)) {
          fail('engine_exited', 'prepared engine host exited (code ' + child.exitCode + ', signal ' + (child.signalCode ?? null) + ') while answering ' + route);
        }
        return outcome.result;
      }
      last = outcome.kind === 'http' ? 'HTTP ' + outcome.status : 'non-envelope body';
    } catch (error) {
      if (error instanceof RunnerInputError) throw error;
      last = String(error.message ?? error);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
  fail('engine_not_ready', 'prepared engine host never answered ' + route + ' within ' + timeoutMs + 'ms: ' + last);
}

/**
 * Stop ONLY the process tree this runner spawned. On Windows the tree is walked
 * with taskkill /PID <our child pid> /T /F - never by image name and never a
 * global kill - and the call is made only while our spawn handle is still alive
 * (exitCode === null), so a recycled unrelated PID cannot become the target.
 * POSIX gets SIGTERM grace, then SIGKILL on the same child only.
 */
/** Resolve once the child we spawned exits OR errors, so a request cannot outlive a dead engine. */
function childExitNotice(child) {
  return new Promise((resolve) => {
    child.once('exit', (status, signal) => resolve({ kind: 'exit', exit: { status, signal: signal ?? null } }));
    child.once('error', (error) =>
      resolve({ kind: 'exit', exit: { status: null, signal: null, error: String(error.message ?? error) } }),
    );
  });
}

/** Bound server.close and KEEP its error instead of swallowing it (never blocks cleanup forever). */
async function closeServer(server, timeoutMs = 5000) {
  const bounded = await Promise.race([
    Promise.resolve()
      .then(() => server.close())
      .then(() => ({ error: null }))
      .catch((error) => ({ error: String(error.message ?? error) })),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: 'server.close did not settle within ' + timeoutMs + 'ms' }), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
  return bounded;
}

/**
 * Run one taskkill of OUR child pid tree; capture error AND nonzero exit instead of
 * swallowing them, and BOUND the killer itself: a hung taskkill must never hang
 * cleanup. On the deadline ONLY OUR taskkill process is stopped and the stop is
 * reported UNPROVEN (ok:false + error), never as a success.
 * killSpawn is an injectable seam: production passes node's spawn; a test passes a
 * fake, so a fabricated pid never reaches a real OS kill.
 */
function taskkillTree(pid, timeoutMs = 5000, killSpawn = spawn) {
  return new Promise((resolve) => {
    let settled = false;
    let killer = null;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      try { if (killer && typeof killer.kill === 'function') killer.kill('SIGKILL'); } catch { /* owned killer already gone */ }
      done({ ok: false, status: null, signal: null, error: 'taskkill did not exit within ' + timeoutMs + 'ms' });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      killer = killSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      done({ ok: false, status: null, signal: null, error: String(error.message ?? error) });
      return;
    }
    killer.once('error', (error) => done({ ok: false, status: null, signal: null, error: String(error.message ?? error) }));
    killer.once('exit', (status, signal) =>
      done({ ok: status === 0, status, signal, error: status === 0 ? null : 'taskkill exited with ' + status }),
    );
  });
}

export async function stopChildTree(child, { graceMs = 5000, killWaitMs = 5000, killSpawn = spawn } = {}) {
  // tree stays 'unknown': neither a taskkill exit nor a signal proves the DESCENDANT set,
  // and a parent that already exited can still leave orphans. Only an OBSERVED exit is
  // claimed, and the parent PID is only ever a target while our live handle owns it.
  const base = { owned: false, pid: child ? child.pid : null, tree: 'unknown', command: null, killStatus: null, killSignal: null, exited: false, exit: null, error: null };
  if (!child || child.exitCode !== null || child.signalCode !== null) return { ...base, exited: true };
  const pid = child.pid;
  const evidence = { ...base, owned: true, pid };
  if (process.platform === 'win32' && typeof pid === 'number') {
    const killed = await taskkillTree(pid, killWaitMs, killSpawn);
    evidence.command = 'taskkill /PID ' + pid + ' /T /F';
    evidence.killStatus = killed.status;
    evidence.killSignal = killed.signal;
    evidence.error = killed.error;
    const settled = await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(() => resolve(null), killWaitMs)),
    ]);
    evidence.exit = settled;
    evidence.exited = child.exitCode !== null;
    if (!evidence.exited && !evidence.error) evidence.error = 'owned child did not exit within ' + killWaitMs + 'ms of taskkill';
    return evidence;
  }
  child.kill('SIGTERM');
  let settled = await Promise.race([
    waitForExit(child),
    new Promise((resolve) => setTimeout(() => resolve(null), graceMs)),
  ]);
  if (settled === null) {
    child.kill('SIGKILL');
    settled = await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(() => resolve(null), killWaitMs)),
    ]);
  }
  evidence.exit = settled;
  evidence.exited = child.exitCode !== null;
  if (!evidence.exited && !evidence.error) evidence.error = 'owned child did not exit within ' + killWaitMs + 'ms of SIGKILL';
  return evidence;
}

/** Violations from the owned-tree cleanup and the bounded server close; empty array means clean. */
export function cleanupViolations(cleanup, serverClose = null) {
  const violations = [];
  if (serverClose && serverClose.error) violations.push('server_close: ' + serverClose.error);
  for (const entry of cleanup ?? []) {
    if (!entry || entry.owned !== true) continue;
    if (entry.error) violations.push('pid ' + entry.pid + ': ' + entry.error);
    else if (entry.exited !== true) violations.push('pid ' + entry.pid + ': exit unproven');
  }
  return violations;
}

/**
 * The ONE finalization path. Builds the record main persists and decides the final
 * outcome: a browser/engine success survives ONLY when the server close and every
 * owned tree are clean. Any cleanup failure is folded into a failed record, and a
 * pre-existing primary failure keeps its own code (recorded alongside cleanupFailure).
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
    // The record must ALWAYS carry a failure when finalFailure is set. A primary failure that arrived
    // with an unpopulated started.failure keeps its own code/message here, beside cleanupFailure,
    // instead of being dropped by the first branch.
    if (!started.failure) {
      started.failure = {
        code: finalFailure.code ?? 'cleanup_failed',
        message: String(finalFailure.message ?? finalFailure),
      };
    }
  } else if (failure && !started.failure) {
    started.failure = { code: failure.code ?? 'runner_error', message: String(failure.message ?? failure) };
  }
  const record = finalFailure
    ? { runner: RUNNER_ID, failure: started.failure, started, ...refs, records }
    : { ...result, cleanup, serverClose };
  return { record, failure: finalFailure };
}

/**
 * The ONE finalization + persistence seam, exported so main and the seam tests run the SAME production
 * code (a hypothetical flow is never copied into the tests). Order is fixed and bounded:
 *   1. lift any already-latched signalled failure BEFORE touching cleanup;
 *   2. bound server.close, KEEPING its error (a rejection becomes an error, never a hang);
 *   3. stop every owned child tree (a rejection becomes a bounded failed evidence entry);
 *   4. RE-READ the latch after the bounded close/cleanup, so a signal landing in that window is folded in;
 *   5. build refs/records under bounded fallbacks, then decide the record (finalizeRecord);
 *   6. RE-READ the latch once more immediately before the write, so the persisted record reflects it;
 *   7. write exactly ONE result file; a write failure is preserved SEPARATELY as persistenceError and
 *      forces BOTH a nonzero outcome AND a failure on the returned outcome, even when there is no primary
 *      failure - a swallowed write can never look green;
 *   8. dispose the named signal guards LAST, after the record is on disk.
 * Every await is wrapped so a rejection produces an honest failed record rather than an unhandled throw.
 */
export async function finalizeCycle({
  started,
  result = null,
  failure = null,
  latch = { signal: null, failure: null },
  server = null,
  closeTimeoutMs = 5000,
  stopOwnedChildren = async () => [],
  buildRefs = () => ({}),
  records = () => [],
  resultPath = null,
  writeRecord = null,
  signalHandlers = [],
  removeSignalListener = (signal, handler) => process.removeListener(signal, handler),
  setExitCode = (code) => { process.exitCode = code; },
  writeStderr = (text) => process.stderr.write(text),
} = {}) {
  let serverClose = { error: null };
  let cleanup = [];
  let refs = {};
  let recordList = [];
  // Fold a latched signal/failure into the primary failure slot ONLY when no primary failure exists, so
  // a late signal can never erase a primary failure; started.failure is only filled when the caller did
  // not already populate it, so a caller-set code is never overwritten.
  const liftLatched = () => {
    if (latch.failure && !failure) {
      failure = latch.failure;
      if (!started.failure) {
        started.failure = { code: failure.code ?? 'runner_signal', message: String(failure.message ?? failure) };
      }
    }
  };
  const decide = () => finalizeRecord({ result, failure, started, cleanup, serverClose, refs, records: recordList });
  const decideFallback = (error) => {
    const fallback = failure ?? new RunnerInputError('finalize_failed', 'finalization failed: ' + String(error.message ?? error));
    const fallbackFailure = { code: fallback.code ?? 'finalize_failed', message: String(fallback.message ?? fallback) };
    started.failure = fallbackFailure;
    failure = fallback;
    return { record: { runner: RUNNER_ID, failure: fallbackFailure, started, records: recordList }, failure: fallback };
  };

  liftLatched();

  try {
    serverClose = server ? await closeServer(server, closeTimeoutMs) : { error: null };
  } catch (error) {
    serverClose = { error: 'server.close threw: ' + String(error.message ?? error) };
  }

  try {
    cleanup = (await stopOwnedChildren()) ?? [];
  } catch (error) {
    cleanup = [{ owned: true, pid: null, tree: 'unknown', exited: false, error: 'stopOwnedChildren threw: ' + String(error.message ?? error) }];
  }

  // A signal during the bounded close or the tree stop is folded in HERE, before refs/records/decision.
  liftLatched();

  try {
    refs = buildRefs() ?? {};
  } catch (error) {
    started.evidenceError = String(error.message ?? error);
    if (!failure) failure = new RunnerInputError('evidence_refs_failed', 'evidence refs failed: ' + started.evidenceError);
  }

  try {
    recordList = records() ?? [];
  } catch (error) {
    started.recordsError = String(error.message ?? error);
    if (!failure) failure = new RunnerInputError('records_failed', 'server records failed: ' + started.recordsError);
  }

  let decided;
  try {
    decided = decide();
  } catch (error) {
    decided = decideFallback(error);
  }
  failure = decided.failure;

  // Re-read the latch one last time immediately before the single write: a signal that landed during
  // refs/records/decision must still be reflected in the record we persist.
  if (latch.failure && !failure) {
    liftLatched();
    try {
      decided = decide();
    } catch (error) {
      decided = decideFallback(error);
    }
    failure = decided.failure;
  }

  let persistenceError = null;
  try {
    if (typeof writeRecord !== 'function') throw new RunnerInputError('result_writer_missing', 'no result writer was provided');
    if (typeof resultPath !== 'string' || resultPath === '') throw new RunnerInputError('result_path_missing', 'no result path to persist');
    writeRecord(resultPath, JSON.stringify(decided.record, null, 2) + '\n');
  } catch (writeError) {
    persistenceError = { code: 'result_persist_failed', message: String(writeError.message ?? writeError) };
    writeStderr('failed to persist result record: ' + persistenceError.message + '\n');
  }

  // A failed write with no primary failure IS the outcome: fold it in so it can never look green.
  if (persistenceError && !failure) {
    failure = new RunnerInputError(persistenceError.code, 'result persistence failed: ' + persistenceError.message);
    if (!started.failure) {
      started.failure = { code: failure.code, message: String(failure.message) };
    }
    try {
      decided = decide();
    } catch (error) {
      decided = decideFallback(error);
    }
    failure = decided.failure;
  }

  // Dispose the named guards LAST: they stayed active through the bounded close, the tree stop and the
  // single persistence, so a signal in that window was latched and recorded.
  for (const entry of signalHandlers) {
    if (entry && entry.signal && typeof entry.handler === 'function') removeSignalListener(entry.signal, entry.handler);
  }

  if (persistenceError || failure) setExitCode(1);
  return { record: decided.record, failure, persistenceError };
}

export async function main(argv = process.argv.slice(2), env = process.env, { cwd = process.cwd() } = {}) {
  const options = parseRunnerArgs(argv, env, { cwd });
  const paths = assertEvidencePrefixFree(options.paths);
  const manifestPath = path.join(options.builds, 'host-build-manifest.json');
  const fixturePath = path.join(options.fixtures, EXPECTED_FIXTURE.name);
  const imageFixturePath = path.join(options.fixtures, EXPECTED_IMAGE_FIXTURE.name);
  const imageReplacementPath = path.join(options.fixtures, EXPECTED_IMAGE_REPLACEMENT.name);
  // ONE shared document root, resolved before anything is launched. The engine host publishes
  // under <lab>/out/<viewId> (engine-host-context.mts outDir) and the lab server grants that
  // same directory as this view's native output (lab-storage.mjs requireNativeOutput); while
  // the two roots differed, the engine published outside the granted root and every save was
  // refused as not_native_output. runtimeRoots() is the single source of the pair and
  // assertSharedRuntimeRoot() refuses a split pair by name before any child starts.
  const sharedRoots = runtimeRoots(paths);
  assertSharedRuntimeRoot(sharedRoots);
  const { engineLabDir, labDir } = sharedRoots;
  const enginePlan = buildEngineHostPlan({
    nodeExe: process.execPath,
    engineSource: options.engineSource,
    candidate: options.candidate,
    engineLabDir,
    enginePort: LOGICAL_PORTS.engine,
    prebundle: options.prebundle,
  });
  requireFiles([
    ['candidate', options.candidate],
    ['playwright pptx config', path.join(options.candidate, PPTX_CONFIG_REL)],
    ['shared playwright config', path.join(options.candidate, SHARED_CONFIG_REL)],
    // Only the specs THIS run must prove are required, so the named input list and the
    // required matrix can never disagree about which specs are in scope.
    ...options.specs.map((spec) => ['required spec ' + spec, path.join(options.candidate, 'e2e', 'office-g0', spec)]),
    ['pptx image fixture', path.join(options.fixtures, EXPECTED_IMAGE_FIXTURE.name)],
    ['pptx image replacement', path.join(options.fixtures, EXPECTED_IMAGE_REPLACEMENT.name)],
    ['lab server', path.join(options.candidate, 'e2e', 'office-g0', 'lab-server.mjs')],
    ['slides build index', path.join(options.builds, PPTX_APP, 'index.html')],
    ['build manifest', manifestPath],
    ['fixture', fixturePath],
    ...enginePlan.requiredPaths.map((target) => ['engine host input', target]),
  ]);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    fail('node_too_old', 'the prepared pptx engine requires Node 22+, running ' + process.version);
  }

  let manifest = null;
  let fixture = null;
  let imageFixture = null;
  let imageReplacement = null;
  let frozenTextSpec = null;
  let server = null;
  const closeTimeoutMs = 5000;
  const ownedChildren = new Set();
  let record = null;
  let failure = null;
  let result = null;
  let finalized = null;
  let persistenceError = null;
  // Live signal latch: a signal that lands DURING close/cleanup/persistence is still folded into the
  // record, because the named guards stay installed until after the record is on disk (disposed LAST)
  // and the latch is re-read before the single write.
  const latch = { signal: null, failure: null };
  const signals = ['SIGINT', 'SIGTERM'];
  const started = { engineReady: null, engineBindings: null, discovery: null, run: null, cleanup: null, serverClose: null, signals: [], failure: null };
  const spawnOwned = (plan, logPath, childEnv) => {
    const child = spawnLogged(plan, logPath, childEnv);
    ownedChildren.add(child);
    return child;
  };
  const stopOwnedChildren = async () => {
    const evidence = [];
    for (const owned of ownedChildren) {
      // eslint-disable-next-line no-await-in-loop -- few children, each stop is bounded
      evidence.push(await stopChildTree(owned));
    }
    return evidence;
  };
  // The SINGLE finalization + persistence path, shared by main's finally and onSignal and delegating
  // to the exported production seam. Memoized, so a signal race can never double-clean or double-write.
  const finalize = () => {
    if (!finalized) {
      finalized = (async () => {
        const outcome = await finalizeCycle({
          started,
          result,
          failure,
          latch,
          server,
          closeTimeoutMs,
          stopOwnedChildren,
          buildRefs: () => evidenceRefs({ candidate: options.candidate, options, manifest, fixture, enginePlan, paths }),
          records: () => (server ? server.records() : []),
          resultPath: paths.result,
          signalHandlers: signals.map((signal) => ({ signal, handler: onSignal })),
          writeRecord: (target, text) => fs.writeFileSync(target, text, { flag: 'wx' }),
          setExitCode: (code) => { process.exitCode = code; },
        });
        failure = outcome.failure;
        persistenceError = outcome.persistenceError;
        return outcome.record;
      })();
    }
    return finalized;
  };
  const onSignal = (signal) => {
    started.signals.push(signal);
    // Latch the signal even if a memoized finalize already ran, so a late signal can never be
    // default-exited with no record and the exit stays nonzero.
    latch.signal = latch.signal ?? signal;
    if (!latch.failure) {
      latch.failure = new RunnerInputError('runner_signal', 'received ' + signal + ' before the cycle finished');
      // Record the signal SEPARATELY, and promote it to the recorded failure ONLY when no primary
      // failure is already recorded: record.failure is started.failure, so an unconditional overwrite
      // here would erase a primary failure (e.g. run_timeout) that main already caught.
      started.signalFailure = { code: latch.failure.code, message: String(latch.failure.message) };
      if (!started.failure) {
        started.failure = { code: latch.failure.code, message: String(latch.failure.message) };
      }
    }
    // Persist through the SAME finalization path BEFORE exiting; the old exit-first signal path
    // dropped the failure record entirely. The catch keeps a rejected finalization from surfacing
    // as an unhandled async rejection.
    void finalize()
      .catch(() => undefined)
      .then(() => process.exit(130));
  };
  try {
    manifest = validateBuildManifest({
      manifestBytes: fs.readFileSync(manifestPath),
      expectedSha256: options.expectedManifestSha256,
      expectedSourcePin: options.expectedSourcePin,
      expectedApp: PPTX_APP,
    });
    fixture = assertFixturePin(fixturePath);
    imageFixture = assertFixturePin(imageFixturePath, EXPECTED_IMAGE_FIXTURE);
    imageReplacement = assertFixturePin(imageReplacementPath, EXPECTED_IMAGE_REPLACEMENT);
    // The accepted Text1 spec is frozen evidence, not this lane's input: pin its bytes whichever
    // spec set was selected, so the image lane cannot be green while the accepted spec drifts.
    frozenTextSpec = assertFixturePin(
      path.join(options.candidate, 'e2e', 'office-g0', FROZEN_TEXT_SPEC.name),
      FROZEN_TEXT_SPEC,
      'frozen_text_spec_mismatch',
      'the accepted text spec',
    );
    // Every spec in THIS run's selected set is scanned, so a skipped or fixme'd
    // required test is refused statically before any browser starts.
    for (const spec of options.specs) {
      assertNoSkippedTests(fs.readFileSync(path.join(options.candidate, 'e2e', 'office-g0', spec), 'utf8'), spec);
    }
    await assertPortsFree(LOGICAL_PORTS);

    fs.mkdirSync(paths.runtime, { recursive: true });
    fs.mkdirSync(paths.artifacts, { recursive: true });
    fs.mkdirSync(paths.temp, { recursive: true });
    fs.mkdirSync(engineLabDir, { recursive: true });

    const cli = resolvePlaywrightCli(options.candidate);
    // TEMP/TMP/TMPDIR, the JSON report target and the preview URL are pinned
    // before any child starts, so no browser or engine scratch escapes the prefix.
    const childEnv = buildChildEnv({ env, options, paths, manifest });

    for (const signal of signals) process.once(signal, onSignal);

    const engineChild = spawnOwned(enginePlan, path.join(paths.runtime, 'engine.log'), childEnv);
    started.engineReady = await waitForEnginePing(enginePlan.route, { child: engineChild });

    // Bind the lab proxy to the REAL candidate routes: route strings only for an
    // operation the host serves AND the shared allowlist permits. Nothing is
    // invented for txn/layouts/new-blank, and a missing required capability is a
    // named failure rather than a base URL that silently leaves `bound` empty.
    const selection = assertRequiredEngineCapability(
      selectEngineBindings({
        hostRoutes: started.engineReady?.routes ?? [],
        operations: ENGINE_OPERATIONS,
      }),
    );
    started.engineBindings = { handlers: selection.handlers, unbound: selection.unbound };

    server = createLabServer({
      buildsDir: options.builds,
      labDir,
      fixturesDir: options.fixtures,
      sourceDir: options.candidate,
      // The operator-named image the lab picker answers with. The channel still does a
      // real read-granted file read of it; this only names WHICH granted file a pick
      // selects, because the lab has no OS file chooser.
      picturePickPath: imageReplacementPath,
      port: LOGICAL_PORTS.app,
      previewPort: LOGICAL_PORTS.preview,
      engineBaseUrl: 'http://127.0.0.1:' + LOGICAL_PORTS.engine,
      engineHandlers: { handlers: selection.handlers },
    });
    const listening = await server.listen();

    // Discovery is separate from the real run: a zero-test or missing-project
    // listing must fail before any browser is launched.
    const listChild = spawnOwned(
      buildPlaywrightPlan({
        nodeExe: process.execPath,
        cli,
        candidate: options.candidate,
        configPath: path.join(options.candidate, PPTX_CONFIG_REL),
        listing: true,
        specs: presentPptxSpecs(options.candidate, { specs: options.specs }),
      }),
      paths.listLog,
      childEnv,
    );
    const listExit = await withTimeout(waitForExit(listChild), 180000, 'discovery_timeout', 'Playwright discovery');
    const listed = parseListOutput(fs.existsSync(paths.listLog) ? fs.readFileSync(paths.listLog, 'utf8') : '');
    if (listExit.status !== 0) {
      fail('discovery_failed', 'Playwright discovery exited with ' + JSON.stringify(listExit));
    }
    started.discovery = {
      exit: listExit,
      ...assertDiscovery(listed),
      specSet: options.specSet,
      specs: assertPptxSpecCoverage(
        fs.existsSync(paths.listLog) ? fs.readFileSync(paths.listLog, 'utf8') : '',
        { specs: options.specs },
      ),
    };

    const runChild = spawnOwned(
      buildPlaywrightPlan({
        nodeExe: process.execPath,
        cli,
        candidate: options.candidate,
        configPath: path.join(options.candidate, PPTX_CONFIG_REL),
        specs: presentPptxSpecs(options.candidate, { specs: options.specs }),
      }),
      paths.runLog,
      childEnv,
    );
    const runExit = await withTimeout(waitForExit(runChild), 900000, 'run_timeout', 'Playwright run');
    // Exit 0 alone is not a pass: the JSON execution evidence must show every
    // required test executing and passing exactly once in both installed browsers.
    const runReport = fs.existsSync(paths.runJson) ? parsePlaywrightJson(fs.readFileSync(paths.runJson, 'utf8')) : null;
    const outcome = assertRunOutcome(runReport, { expectedTotal: started.discovery.total });
    started.run = { exit: runExit, report: runReport, outcome };
    if (runExit.status !== 0) {
      fail('run_failed', 'Playwright run exited with ' + JSON.stringify(runExit));
    }

    result = {
      runner: RUNNER_ID,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      fixture,
      imageFixture,
      imageReplacement,
      frozenTextSpec,
      ...evidenceRefs({ candidate: options.candidate, options, manifest, fixture, enginePlan, paths }),
      ports: LOGICAL_PORTS,
      origins: listening,
      engine: { route: enginePlan.route, ready: started.engineReady, bindings: started.engineBindings },
      discovery: started.discovery,
      playwright: runExit,
      outcome,
      records: server.records(),
    };
    // Persisted in finally so the record carries the actual owned-tree cleanup result.
  } catch (error) {
    failure = error;
    started.failure = { code: error.code ?? 'runner_error', message: String(error.message ?? error) };
  } finally {
    // ONE finalization path (also used by onSignal): latch any signal, bounded server.close, every
    // owned tree, exactly one persistence, and the named guards disposed LAST.
    record = await finalize();
  }
  // Defensive: the seam folds a persistence failure into 'failure', but main never assumes it did.
  if (persistenceError && !failure) {
    failure = new RunnerInputError(
      persistenceError.code ?? 'result_persist_failed',
      'result persistence failed: ' + persistenceError.message,
    );
  }
  if (persistenceError && failure && typeof failure === 'object') {
    failure.persistenceError = persistenceError;
  }
  if (failure) process.exitCode = 1;
  if (failure) throw failure;
  return record;
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
      process.stdout.write(JSON.stringify({ runner: RUNNER_ID, playwright: result.playwright }, null, 2) + '\n');
    },
    (error) => {
      process.stderr.write('pptx runner failed: ' + String((error && error.stack) || error) + '\n');
      process.exitCode = 1;
    },
  );
}
