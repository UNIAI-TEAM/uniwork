#!/usr/bin/env node
// UNI-667 narrow unit tests for the PPTX cycle runner's pure input / manifest /
// evidence-boundary predicates. These run with node:test on Node 22 built-ins and
// touch no browser, engine, build or fixture bytes beyond reading. Every case is
// a real behavior assertion against scripts/office-g0/run-pptx-cycle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  RunnerInputError,
  EXPECTED_FIXTURE,
  EXPECTED_IMAGE_FIXTURE,
  EXPECTED_IMAGE_REPLACEMENT,
  FROZEN_TEXT_SPEC,
  LOGICAL_PORTS,
  PINNED_SOURCE_PIN,
  PREVIEW_URL_ENV,
  PPTX_APP,
  PPTX_IMAGE_SPEC,
  PPTX_IMAGE_SPECS,
  PPTX_SPEC,
  PPTX_SPECS,
  REQUIRED_ENGINE_OPERATIONS,
  SPEC_SETS,
  DEFAULT_SPEC_SET,
  UNROUTED_ENGINE_OPERATIONS,
  assertDiscovery,
  assertEvidencePrefixFree,
  assertFixturePin,
  assertInsideWorkspace,
  assertNoSkippedTests,
  assertPptxSpecCoverage,
  assertRequiredEngineCapability,
  assertRunOutcome,
  assertSharedRuntimeRoot,
  buildChildEnv,
  buildEngineHostPlan,
  buildPlaywrightPlan,
  discoverWorkspaceRoot,
  evidencePaths,
  parseListOutput,
  parsePlaywrightJson,
  parseRunnerArgs,
  presentPptxSpecs,
  previewUrlFor,
  withTimeout,
  RUNNER_ID,
  cleanupViolations,
  finalizeCycle,
  finalizeRecord,
  requireHex40,
  requireHex64,
  requireFiles,
  runtimeRoots,
  selectEngineBindings,
  sha256Bytes,
  stopChildTree,
  validateBuildManifest,
} from './run-pptx-cycle.mjs';

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-runner-test-'));
const scratch = (name) => path.join(scratchRoot, name);
const sha256 = (text) => sha256Bytes(Buffer.from(text, 'utf8'));

/** A minimal manifest matching scripts/office-g0/build-renderers.mjs output fields. */
const manifestText = (overrides = {}) =>
  JSON.stringify({
    generator: 'scripts/office-g0/build-renderers.mjs',
    pinnedSourceCommit: PINNED_SOURCE_PIN,
    preparedSource: 'D:/prepared',
    apps: { [PPTX_APP]: { rendererDir: 'apps/slides/src/renderer' } },
    sourceUntouched: true,
    appSourcesUntouched: true,
    ...overrides,
  });

const expectCode = (code, run) => {
  assert.throws(run, (error) => {
    assert.ok(error instanceof RunnerInputError, 'expected a RunnerInputError, got ' + error);
    assert.equal(error.code, code);
    return true;
  });
};

test('manifest: the approved single-slides manifest validates and reports its hash', () => {
  const bytes = Buffer.from(manifestText(), 'utf8');
  const result = validateBuildManifest({
    manifestBytes: bytes,
    expectedSha256: sha256Bytes(bytes),
    expectedSourcePin: PINNED_SOURCE_PIN,
  });
  assert.equal(result.app, 'slides');
  assert.equal(result.pinnedSourceCommit, PINNED_SOURCE_PIN);
  assert.equal(result.sha256, sha256Bytes(bytes));
});

test('manifest: hash mismatch, wrong app, wrong pin and mutated source all fail', () => {
  const bytes = Buffer.from(manifestText(), 'utf8');
  expectCode('manifest_sha256_mismatch', () =>
    validateBuildManifest({ manifestBytes: bytes, expectedSha256: 'f'.repeat(64), expectedSourcePin: PINNED_SOURCE_PIN }),
  );
  const docsBytes = Buffer.from(manifestText({ apps: { docs: {} } }), 'utf8');
  expectCode('manifest_wrong_app', () =>
    validateBuildManifest({ manifestBytes: docsBytes, expectedSha256: sha256Bytes(docsBytes), expectedSourcePin: PINNED_SOURCE_PIN }),
  );
  const strayBytes = Buffer.from(manifestText({ apps: { slides: {}, pdf: {} } }), 'utf8');
  expectCode('manifest_wrong_app', () =>
    validateBuildManifest({ manifestBytes: strayBytes, expectedSha256: sha256Bytes(strayBytes), expectedSourcePin: PINNED_SOURCE_PIN }),
  );
  const pinBytes = Buffer.from(manifestText({ pinnedSourceCommit: 'a'.repeat(40) }), 'utf8');
  expectCode('manifest_pin_mismatch', () =>
    validateBuildManifest({ manifestBytes: pinBytes, expectedSha256: sha256Bytes(pinBytes), expectedSourcePin: PINNED_SOURCE_PIN }),
  );
  const mutatedBytes = Buffer.from(manifestText({ sourceUntouched: false }), 'utf8');
  expectCode('manifest_source_mutated', () =>
    validateBuildManifest({ manifestBytes: mutatedBytes, expectedSha256: sha256Bytes(mutatedBytes), expectedSourcePin: PINNED_SOURCE_PIN }),
  );
  expectCode('manifest_invalid_json', () =>
    validateBuildManifest({ manifestBytes: Buffer.from('not json', 'utf8'), expectedSha256: sha256('not json'), expectedSourcePin: PINNED_SOURCE_PIN }),
  );
});

test('evidence boundary: a NEW prefix is required and no target may already exist', () => {
  const paths = evidencePaths(scratch('evidence-new'));
  assert.equal(paths.artifacts, scratch('evidence-new') + '-artifacts');
  assert.equal(paths.result, scratch('evidence-new') + '-result.json');
  assert.equal(assertEvidencePrefixFree(paths, () => false), paths);
  const taken = { paths, existsSync: (target) => target === paths.runLog };
  expectCode('evidence_prefix_exists', () => assertEvidencePrefixFree(taken.paths, taken.existsSync));
});

test('workspace boundary: outside paths are refused with a named error', () => {
  const root = scratch('ws-root');
  fs.mkdirSync(root, { recursive: true });
  const inside = path.join(root, 'lab', 'builds');
  assert.equal(assertInsideWorkspace(root, 'builds', inside), path.resolve(inside));
  expectCode('outside_workspace', () => assertInsideWorkspace(root, 'builds', path.resolve(root, '..', 'elsewhere')));
});

test('runner args: all explicit inputs are required and stay inside the workspace', () => {
  const root = scratch('ws-args');
  fs.mkdirSync(path.join(root, '.uniwork-dev'), { recursive: true });
  const argv = [
    '--workspace-root', root,
    '--candidate', path.join(root, 'candidate'),
    '--fixtures', path.join(root, 'fixtures'),
    '--builds', path.join(root, 'builds'),
    '--engine-source', path.join(root, 'engine'),
    '--prebundle', path.join(root, 'engine', 'pptx-ops.mjs'),
    '--evidence-prefix', path.join(root, 'evidence', 'pptx-r1'),
    '--expected-manifest-sha256', 'a'.repeat(64),
  ];
  const parsed = parseRunnerArgs(argv, {}, { cwd: root });
  assert.equal(parsed.candidate, path.resolve(root, 'candidate'));
  assert.equal(parsed.expectedSourcePin, PINNED_SOURCE_PIN);
  assert.equal(parsed.paths.runLog, path.resolve(root, 'evidence', 'pptx-r1') + '-run.txt');
  const noEngineSource = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--engine-source') {
      i += 1;
      continue;
    }
    noEngineSource.push(argv[i]);
  }
  expectCode('missing_engine-source', () => parseRunnerArgs(noEngineSource, {}, { cwd: root }));
  const escaped = [...argv];
  escaped[5] = path.join(root, '..', 'escape');
  expectCode('outside_workspace', () => parseRunnerArgs(escaped, {}, { cwd: root }));
  expectCode('bad_manifest_hash', () => parseRunnerArgs([...argv.slice(0, -1), 'short'], {}, { cwd: root }));
});

test('runner args: the spec set defaults to the full matrix and an unknown name is refused', () => {
  const root = scratch('ws-spec-set');
  fs.mkdirSync(path.join(root, '.uniwork-dev'), { recursive: true });
  const base = [
    '--workspace-root', root,
    '--candidate', path.join(root, 'candidate'),
    '--fixtures', path.join(root, 'fixtures'),
    '--builds', path.join(root, 'builds'),
    '--engine-source', path.join(root, 'engine'),
    '--prebundle', path.join(root, 'engine', 'pptx-ops.mjs'),
    '--evidence-prefix', path.join(root, 'evidence', 'pptx-r1'),
    '--expected-manifest-sha256', 'a'.repeat(64),
  ];
  const defaults = parseRunnerArgs(base, {}, { cwd: root });
  assert.equal(defaults.specSet, 'full');
  assert.deepEqual(defaults.specs, [...PPTX_SPECS]);
  const image = parseRunnerArgs([...base, '--spec-set', 'image'], {}, { cwd: root });
  assert.equal(image.specSet, 'image');
  assert.deepEqual(image.specs, [...PPTX_IMAGE_SPECS]);
  const fromEnv = parseRunnerArgs(base, { OFFICE_G0_PPTX_SPEC_SET: 'image' }, { cwd: root });
  assert.deepEqual(fromEnv.specs, [...PPTX_IMAGE_SPECS], 'the env spelling is the same explicit choice');
  expectCode('unknown_spec_set', () => parseRunnerArgs([...base, '--spec-set', 'imag'], {}, { cwd: root }));
});

test('hash helpers reject malformed digests', () => {
  assert.equal(requireHex64('h', 'A'.repeat(64)), 'a'.repeat(64));
  assert.equal(requireHex40('p', 'B'.repeat(40)), 'b'.repeat(40));
  expectCode('bad_manifest_hash', () => requireHex64('h', 'a'.repeat(63)));
  expectCode('bad_source_pin', () => requireHex40('p', PINNED_SOURCE_PIN + 'a'));
});

test('required inputs: every missing path is named at once', () => {
  const present = scratch('present.txt');
  fs.writeFileSync(present, 'x');
  assert.equal(requireFiles([['present', present]]), true);
  expectCode('required_input_missing', () =>
    requireFiles([['present', present], ['gone', scratch('gone')], ['also-gone', scratch('also-gone')]]),
  );
});

test('fixture pin: the pinned identity is enforced from bytes, not from caller trust', () => {
  const bytes = Buffer.alloc(EXPECTED_FIXTURE.bytes, 7);
  assert.equal(sha256Bytes(bytes), sha256Bytes(bytes));
  assert.ok(sha256Bytes(bytes) !== EXPECTED_FIXTURE.sha256);
  const pinnedPath = scratch('g0-slides.pptx');
  fs.writeFileSync(pinnedPath, 'not the pinned fixture');
  expectCode('fixture_hash_mismatch', () => assertFixturePin(pinnedPath));
  expectCode('fixture_missing', () => assertFixturePin(scratch('absent.pptx')));
});

test('the frozen text spec is pinned BY NAME, so the image lane cannot outlive a drifted accepted spec', () => {
  // execute() pins the accepted Text1 spec before the selected-set scan, so a drift fails as
  // frozen_text_spec_mismatch even on --spec-set image. This asserts that exact code, not just that
  // assertFixturePin exists: an unused import would leave the named failure unproven.
  const drifted = scratch('pptx-cycle.spec.ts');
  fs.writeFileSync(drifted, 'drifted accepted spec bytes');
  expectCode('frozen_text_spec_mismatch', () =>
    assertFixturePin(drifted, FROZEN_TEXT_SPEC, 'frozen_text_spec_mismatch', 'frozen text spec'),
  );
  expectCode('fixture_missing', () =>
    assertFixturePin(scratch('absent-spec.ts'), FROZEN_TEXT_SPEC, 'frozen_text_spec_mismatch', 'frozen text spec'),
  );
  // The same helper still credits the REAL accepted spec, so the pin is a comparison and not a
  // free failure.
  const repoRoot = discoverWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
  const accepted = fs.readFileSync(path.join(repoRoot, 'e2e', 'office-g0', FROZEN_TEXT_SPEC.name));
  const acceptedPath = scratch('accepted-copy.ts');
  fs.writeFileSync(acceptedPath, accepted);
  const pinned = assertFixturePin(acceptedPath, FROZEN_TEXT_SPEC, 'frozen_text_spec_mismatch', 'frozen text spec');
  assert.equal(pinned.bytes, FROZEN_TEXT_SPEC.bytes);
  assert.equal(pinned.sha256, FROZEN_TEXT_SPEC.sha256);
});

test('spec: a skipped or fixme required test is refused, and a clean spec passes', () => {
  assert.equal(assertNoSkippedTests("test('edits slide1 Text1', async () => {});", 'pptx-cycle.spec.ts'), true);
  expectCode('spec_has_skipped_test', () => assertNoSkippedTests("test.skip('later', () => {});", 'pptx-cycle.spec.ts'));
  expectCode('spec_has_skipped_test', () => assertNoSkippedTests("test.describe.fixme('suite', () => {});", 'pptx-cycle.spec.ts'));
});

test('discovery: zero tests or a missing installed browser project is a failure', () => {
  const clean = assertDiscovery({ total: 2, projects: ['chrome', 'edge'], tests: ['a', 'b'] });
  assert.equal(clean.total, 2);
  expectCode('discovery_zero_tests', () => assertDiscovery({ total: 0, projects: ['chrome', 'edge'], tests: [] }));
  expectCode('discovery_zero_tests', () => assertDiscovery(parseListOutput('  0 tests found\n')));
  expectCode('discovery_missing_project', () => assertDiscovery({ total: 1, projects: ['chrome'], tests: ['a'] }));
});

test('discovery parsing: the list reporter output yields a real total and projects', () => {
  const listing = [
    'Listing tests:',
    '  [chrome] \u203a pptx-cycle.spec.ts:42:5 \u203a slides: edit slide1 Text1',
    '  [edge] \u203a pptx-cycle.spec.ts:42:5 \u203a slides: edit slide1 Text1',
    'Total: 2 tests in 1 file',
  ].join('\n');
  const parsed = parseListOutput(listing);
  assert.equal(parsed.total, 2);
  assert.deepEqual(parsed.projects, ['chrome', 'edge']);
  assert.equal(parseListOutput('output without a total line').total, null);
});

test('engine plan: the prepared tsx launch resolves the real prepared engine entry, not a build', () => {
  const workspaceScratch = scratch('ws-engine');
  const plan = buildEngineHostPlan({
    nodeExe: 'node',
    engineSource: workspaceScratch,
    candidate: workspaceScratch,
    engineLabDir: path.join(workspaceScratch, 'lab'),
    enginePort: LOGICAL_PORTS.engine,
    prebundle: path.join(workspaceScratch, 'pptx-ops.mjs'),
  });
  assert.equal(plan.command, 'node');
  assert.equal(plan.args[0], path.join(workspaceScratch, 'node_modules', 'tsx', 'dist', 'cli.mjs'));
  assert.ok(plan.args.includes('--source'));
  assert.ok(plan.args.includes('--prebundle'));
  assert.ok(plan.requiredPaths.includes(path.join(workspaceScratch, 'packages', 'pptx-engine', 'src', 'index.ts')));
  assert.equal(plan.route, 'http://127.0.0.1:' + LOGICAL_PORTS.engine + '/engine/ping');
  assert.deepEqual(LOGICAL_PORTS, { app: 5470, preview: 5471, engine: 5472 });
});

test('shared runtime root: the engine --lab argument and the lab server root are one directory', () => {
  // The engine host publishes a view's result to <lab>/out/<viewId> and the lab server grants
  // <labDir>/out/<viewId> as that view's native output. Two roots made the published file land
  // outside its own grant, so every save was refused as not_native_output.
  const paths = evidencePaths(scratch('ws-roots'));
  const roots = runtimeRoots(paths);
  assert.equal(roots.engineLabDir, roots.labDir);
  assert.equal(path.resolve(roots.labDir), path.join(path.resolve(paths.runtime), 'lab'));
  assert.equal(assertSharedRuntimeRoot(roots), roots);

  // The launched plan really carries that one root, so the engine cannot be told a second one.
  const plan = buildEngineHostPlan({
    nodeExe: 'node',
    engineSource: scratch('ws-roots'),
    candidate: scratch('ws-roots'),
    engineLabDir: roots.engineLabDir,
    enginePort: LOGICAL_PORTS.engine,
    prebundle: path.join(scratch('ws-roots'), 'pptx-ops.mjs'),
  });
  const labFlag = plan.args.indexOf('--lab');
  assert.notEqual(labFlag, -1, 'the engine is launched with an explicit --lab root');
  assert.equal(plan.args[labFlag + 1], roots.labDir, 'the engine --lab root is the server lab root');

  // A split pair is refused by name before any child starts; it is never silently repaired.
  const split = { engineLabDir: path.join(scratch('ws-roots'), 'engine-lab'), labDir: roots.labDir };
  expectCode('runtime_root_split', () => assertSharedRuntimeRoot(split));
});

test('playwright plan: discovery and the real run differ only by --list', () => {
  const candidate = scratch('ws-pw');
  const config = path.join(candidate, 'e2e', 'playwright.office-g0.pptx.config.ts');
  const base = { nodeExe: 'node', cli: 'cli.js', candidate, configPath: config };
  const run = buildPlaywrightPlan(base);
  const list = buildPlaywrightPlan({ ...base, listing: true });
  assert.deepEqual(run.args, ['cli.js', 'test', ...PPTX_SPECS, '--config', config]);
  assert.deepEqual(list.args, [...run.args, '--list']);
  assert.equal(run.cwd, path.join(candidate, 'e2e'));
  // An explicit subset is honoured, and the image cycle is never silently dropped:
  // presentPptxSpecs is the ONE place the real run decides which specs to name.
  assert.deepEqual(
    buildPlaywrightPlan({ ...base, specs: [PPTX_IMAGE_SPEC] }).args,
    ['cli.js', 'test', PPTX_IMAGE_SPEC, '--config', config],
  );
});

test('an explicit image spec set names only the image spec; the default keeps the full matrix', () => {
  const candidate = scratch('ws-specs');
  const dir = path.join(candidate, 'e2e', 'office-g0');
  fs.mkdirSync(dir, { recursive: true });
  assert.deepEqual(presentPptxSpecs(candidate), [], 'no spec on disk means nothing is named');
  fs.writeFileSync(path.join(dir, PPTX_IMAGE_SPEC), '');
  assert.deepEqual(presentPptxSpecs(candidate), [PPTX_IMAGE_SPEC]);
  fs.writeFileSync(path.join(dir, PPTX_SPEC), '');
  assert.deepEqual(presentPptxSpecs(candidate), [PPTX_SPEC, PPTX_IMAGE_SPEC], 'canonical order, not directory order');
  assert.deepEqual(
    presentPptxSpecs(candidate, { specs: PPTX_IMAGE_SPECS }),
    [PPTX_IMAGE_SPEC],
    'the image lane selects its own spec explicitly, not by inheritance',
  );
  assert.deepEqual(PPTX_IMAGE_SPECS, [PPTX_IMAGE_SPEC]);
  assert.deepEqual(SPEC_SETS.image, PPTX_IMAGE_SPECS);
  assert.deepEqual(SPEC_SETS.full, PPTX_SPECS, 'the default set stays the complete matrix');
  assert.equal(DEFAULT_SPEC_SET, 'full', 'an unqualified run must never silently narrow');
});

test('discovery coverage names every spec of the selected set, so a dropped spec cannot pass', () => {
  const both = [
    '  [chrome] \u203a pptx-cycle.spec.ts:42:5 \u203a slides: edit slide1 Text1',
    '  [chrome] \u203a pptx-image-cycle.spec.ts:60:5 \u203a pptx image: replace and reopen',
    '  [edge] \u203a pptx-image-cycle.spec.ts:60:5 \u203a pptx image: replace and reopen',
  ].join('\n');
  assert.deepEqual(assertPptxSpecCoverage(both), [...PPTX_SPECS]);
  expectCode('discovery_missing_spec', () => assertPptxSpecCoverage(both.replace(/pptx-image-cycle\.spec\.ts/g, 'other.spec.ts')));
  expectCode('discovery_missing_spec', () => assertPptxSpecCoverage(''));
});

test('the image fixture and replacement pins are distinct from the text fixture', () => {
  // The image cycle is its own deck: reusing the text fixture would silently reuse a
  // deck with no picture at all, so the two identities must never collide.
  assert.notEqual(EXPECTED_IMAGE_FIXTURE.sha256, EXPECTED_FIXTURE.sha256);
  assert.notEqual(EXPECTED_IMAGE_FIXTURE.name, EXPECTED_FIXTURE.name);
  assert.match(EXPECTED_IMAGE_FIXTURE.sha256, /^[0-9a-f]{64}$/);
  assert.match(EXPECTED_IMAGE_REPLACEMENT.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(EXPECTED_IMAGE_REPLACEMENT.sha256, EXPECTED_IMAGE_FIXTURE.sha256);
  assert.equal(EXPECTED_IMAGE_REPLACEMENT.name.endsWith('.png'), true);
});

test('workspace discovery walks up to the owner of .uniwork-dev', () => {
  const root = scratch('ws-discover');
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(path.join(root, '.uniwork-dev'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(discoverWorkspaceRoot(nested), path.resolve(root));
});

/** T1 - the lab proxy binds only real, allowlisted candidate routes. */
test('engine bindings: only allowlisted, routed operations bind, and a missing capability fails explicitly', () => {
  const operations = ['pptx-open', 'pptx-txn', 'pptx-save', 'pptx-edit-text', 'pptx-is-dirty', 'pptx-layouts', 'pptx-replace-picture'];
  const hostRoutes = [
    '/engine/ping',
    '/engine/pptx-open',
    '/engine/pptx-save',
    '/engine/pptx-edit-text',
    '/engine/pptx-is-dirty',
    '/engine/pptx-layouts',
    '/engine/pptx-replace-picture',
  ];
  const selection = selectEngineBindings({ hostRoutes, operations });
  assert.deepEqual(selection.handlers, {
    'pptx-open': 'pptx-open',
    'pptx-save': 'pptx-save',
    'pptx-edit-text': 'pptx-edit-text',
    'pptx-is-dirty': 'pptx-is-dirty',
    'pptx-layouts': 'pptx-layouts',
    'pptx-replace-picture': 'pptx-replace-picture',
  });
  assert.deepEqual(selection.unbound, []);
  for (const unrouted of UNROUTED_ENGINE_OPERATIONS) {
    assert.ok(!(unrouted in selection.handlers), 'an unrouted operation must never be bound: ' + unrouted);
  }
  assert.deepEqual([...REQUIRED_ENGINE_OPERATIONS].sort(), ['pptx-edit-text', 'pptx-is-dirty', 'pptx-layouts', 'pptx-open', 'pptx-replace-picture', 'pptx-save']);
  assert.equal(assertRequiredEngineCapability(selection), selection);
  const missingRoute = selectEngineBindings({
    hostRoutes: hostRoutes.filter((route) => route !== '/engine/pptx-is-dirty'),
    operations,
  });
  expectCode('engine_capability_missing', () => assertRequiredEngineCapability(missingRoute));
  const missingAllowlist = selectEngineBindings({
    hostRoutes,
    operations: operations.filter((name) => name !== 'pptx-edit-text'),
  });
  expectCode('engine_capability_missing', () => assertRequiredEngineCapability(missingAllowlist));
  // A route cannot be faked into existence: the routed path must equal /engine/<op>.
  const wrongRoute = selectEngineBindings({ hostRoutes: ['/engine/pptx-open-extra'], operations });
  expectCode('engine_capability_missing', () => assertRequiredEngineCapability(wrongRoute));
});

const jsonTest = (project, title, { status = 'expected', expectedStatus = 'passed', resultStatuses = ['passed'], ok = true } = {}) => ({
  title,
  ok,
  tests: [
    { projectName: project, status, expectedStatus, results: resultStatuses.map((value) => ({ status: value })) },
  ],
});

const jsonReport = ({ stats = {}, specs = [] } = {}) =>
  JSON.stringify({
    config: {},
    errors: [],
    stats: {
      startTime: '2026-09-18T00:00:00.000Z',
      duration: 1000,
      expected: specs.filter((spec) => spec.tests[0].status === 'expected').length,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
      ...stats,
    },
    suites: [{ title: 'pptx-cycle.spec.ts', specs }],
  });

/** T2 - exit 0 is not a pass; only clean per-browser JSON evidence is. */
test('run outcome: clean two-browser JSON passes, and every skip/unexpected/interrupt/todo/retry fails', () => {
  const clean = parsePlaywrightJson(
    jsonReport({ specs: [jsonTest('chrome', 'slides cycle'), jsonTest('edge', 'slides cycle')] }),
  );
  assert.equal(assertRunOutcome(clean, { expectedTotal: 2 }).executed, 2);
  assert.deepEqual(clean.projects, ['chrome', 'edge']);
  assert.equal(parsePlaywrightJson('not json'), null);
  assert.equal(parsePlaywrightJson('{}'), null);
  expectCode('run_report_missing', () => assertRunOutcome(null));
  const withSkip = parsePlaywrightJson(
    jsonReport({
      stats: { skipped: 1 },
      specs: [jsonTest('chrome', 'slides cycle'), jsonTest('edge', 'slides cycle', { status: 'skipped', resultStatuses: ['skipped'] })],
    }),
  );
  expectCode('run_outcome_not_clean', () => assertRunOutcome(withSkip, { expectedTotal: 2 }));
  const withUnexpected = parsePlaywrightJson(
    jsonReport({
      stats: { unexpected: 1 },
      specs: [jsonTest('chrome', 'slides cycle', { status: 'unexpected', ok: false, resultStatuses: ['failed'] }), jsonTest('edge', 'slides cycle')],
    }),
  );
  expectCode('run_outcome_not_clean', () => assertRunOutcome(withUnexpected, { expectedTotal: 2 }));
  const interrupted = parsePlaywrightJson(
    jsonReport({ specs: [jsonTest('chrome', 'slides cycle', { resultStatuses: ['interrupted'] }), jsonTest('edge', 'slides cycle')] }),
  );
  expectCode('run_outcome_not_clean', () => assertRunOutcome(interrupted, { expectedTotal: 2 }));
  const todo = parsePlaywrightJson(
    jsonReport({
      specs: [jsonTest('chrome', 'slides cycle', { status: 'skipped', expectedStatus: 'skipped', resultStatuses: ['skipped'] }), jsonTest('edge', 'slides cycle')],
    }),
  );
  expectCode('run_outcome_not_clean', () => assertRunOutcome(todo, { expectedTotal: 2 }));
  const retried = parsePlaywrightJson(
    jsonReport({ specs: [jsonTest('chrome', 'slides cycle', { resultStatuses: ['passed', 'passed'] }), jsonTest('edge', 'slides cycle')] }),
  );
  expectCode('run_outcome_not_clean', () => assertRunOutcome(retried, { expectedTotal: 2 }));
});

/** T3 - executed count must match discovery, in both directions. */
test('run outcome: the executed count must match the discovery total exactly', () => {
  const report = parsePlaywrightJson(jsonReport({ specs: [jsonTest('chrome', 'x'), jsonTest('edge', 'x')] }));
  assert.equal(report.executed, 2);
  expectCode('run_outcome_not_clean', () => assertRunOutcome(report, { expectedTotal: 1 }));
  expectCode('run_outcome_not_clean', () => assertRunOutcome(report, { expectedTotal: 4 }));
  const oneProject = parsePlaywrightJson(jsonReport({ specs: [jsonTest('chrome', 'x')] }));
  expectCode('run_outcome_not_clean', () => assertRunOutcome(oneProject, { expectedTotal: 1 }));
});

/** T4 - the new run-JSON and temp targets are prefix-derived and refused when taken. */
test('evidence boundary: the run JSON and pinned temp targets are prefix-derived and refused when taken', () => {
  const paths = evidencePaths(scratch('evidence-r2'));
  assert.equal(paths.runJson, scratch('evidence-r2') + '-run.json');
  assert.equal(paths.temp, scratch('evidence-r2') + '-temp');
  assert.equal(assertEvidencePrefixFree(paths, () => false), paths);
  expectCode('evidence_prefix_exists', () => assertEvidencePrefixFree(paths, (target) => target === paths.runJson));
  expectCode('evidence_prefix_exists', () => assertEvidencePrefixFree(paths, (target) => target === paths.temp));
});

/** T5 - TEMP/TMP/TMPDIR, the run JSON target and the owned preview URL are pinned. */
test('child env: temp, run JSON and the owned preview URL are pinned under the evidence prefix', () => {
  const paths = evidencePaths(scratch('evidence-env'));
  const options = { fixtures: 'F:/ws/lab/fixtures', prebundle: 'F:/ws/lab/pptx-ops.mjs' };
  const env = buildChildEnv({
    env: { KEEP: '1', TEMP: 'C:/outside' },
    options,
    paths,
    manifest: { sha256: 'a'.repeat(64), pinnedSourceCommit: PINNED_SOURCE_PIN },
  });
  assert.equal(env.KEEP, '1');
  assert.equal(env.TEMP, paths.temp);
  assert.equal(env.TMP, paths.temp);
  assert.equal(env.TMPDIR, paths.temp);
  assert.equal(env.PLAYWRIGHT_JSON_OUTPUT_FILE, paths.runJson);
  assert.equal(env.PREVIEW_URL_ENV, undefined);
  assert.equal(env[PREVIEW_URL_ENV], 'http://127.0.0.1:' + LOGICAL_PORTS.preview);
  assert.equal(env[PREVIEW_URL_ENV], previewUrlFor());
  assert.equal(env.OFFICE_G0_LAB_URL, 'http://127.0.0.1:' + LOGICAL_PORTS.app);
  assert.equal(env.OFFICE_G0_ENGINE_BASE_URL, 'http://127.0.0.1:' + LOGICAL_PORTS.engine);
});

const readPid = async (file) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const value = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isInteger(value) && value > 0) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('child pid file was never written: ' + file);
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** T6 - the owned tree is stopped; an unrelated live PID is never the target. */
test('child cleanup: an owned child tree is stopped and an unrelated live PID is never the target', async () => {
  const marker = scratch('tree');
  const grandchildSource =
    "const fs=require('fs');fs.writeFileSync(process.argv[1]+'.gc.pid',String(process.pid));setInterval(()=>{},1000);";
  const parentSource =
    "const {spawn}=require('child_process');const fs=require('fs');const marker=process.argv[1];" +
    "spawn(process.execPath,['-e',process.argv[2],marker],{stdio:'ignore',windowsHide:true});" +
    "fs.writeFileSync(marker+'.parent.pid',String(process.pid));setInterval(()=>{},1000);";
  const child = spawn(process.execPath, ['-e', parentSource, marker, grandchildSource], { stdio: 'ignore', windowsHide: true });
  const parentPid = child.pid;
  const grandchildPid = await readPid(marker + '.gc.pid');
  assert.notEqual(parentPid, process.pid);
  assert.notEqual(grandchildPid, parentPid);
  assert.equal(alive(parentPid), true);
  assert.equal(alive(grandchildPid), true);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);'], { stdio: 'ignore', windowsHide: true });
  const unrelatedPid = unrelated.pid;
  assert.equal(alive(unrelatedPid), true);
  try {
    const evidence = await stopChildTree(child);
    assert.equal(evidence.owned, true);
    assert.equal(evidence.pid, parentPid);
    assert.equal(evidence.exited, true, 'an observed exit must be reported as exited');
    assert.equal(evidence.tree, 'unknown', 'descendants are not proven, so tree must never claim success');
    if (process.platform === 'win32') {
      assert.equal(evidence.command, 'taskkill /PID ' + parentPid + ' /T /F');
      assert.ok(!/\.exe/i.test(evidence.command), 'cleanup must never target by image name');
      assert.equal(evidence.killStatus, 0);
    }
    assert.equal(alive(unrelatedPid), true, 'a process this runner never spawned must never be stopped');
  } finally {
    // The unrelated child is cleaned here so a failed assertion above cannot leak it;
    // the runner under test never owns or stops it.
    if (alive(unrelatedPid)) unrelated.kill();
  }
  const goneBy = Date.now() + 8000;
  while (Date.now() < goneBy && (alive(parentPid) || alive(grandchildPid))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(alive(parentPid), false, 'owned child still alive after stop');
  assert.equal(alive(grandchildPid), false, 'owned grandchild still alive after stop');
  assert.equal(alive(process.pid), true, 'the test process must never be a kill target');
});

/** T7 - a bounded wait rejects on time instead of hanging the runner. */
test('timeout: withTimeout rejects a stalled wait with its named code and resolves a real one', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 25, 'run_timeout', 'Playwright run'),
    (error) => error instanceof RunnerInputError && error.code === 'run_timeout' && /exceeded 25ms/.test(error.message),
  );
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'unused', 'unused'), 'ok');
});

/** T8 - cleanup reports ownership and failure honestly; no exit is claimed without proof. */
test('cleanup evidence: an already-exited child is not owned, and an unproven stop carries a bounded error', async () => {
  const dead = spawn(process.execPath, ['-e', 'process.exit(0);'], { stdio: 'ignore', windowsHide: true });
  await new Promise((resolve) => dead.once('exit', resolve));
  const after = await stopChildTree(dead);
  assert.equal(after.owned, false, 'a child that already exited is not claimed as owned');
  assert.equal(after.exited, true);
  assert.equal(after.tree, 'unknown');
  // The injected killer never exits, so the stop is BOUNDED and UNPROVEN. No real
  // taskkill runs and no fabricated PID is handed to a real OS kill.
  const stuckKill = () => {
    const fake = new EventEmitter();
    fake.kill = () => true;
    return fake;
  };
  const stuck = { pid: 987654, exitCode: null, signalCode: null, once() {}, kill() { return true; } };
  const bogus = await stopChildTree(stuck, { graceMs: 25, killWaitMs: 25, killSpawn: stuckKill });
  assert.equal(bogus.owned, true);
  assert.equal(bogus.exited, false, 'no observed exit must not be reported as exited');
  assert.equal(bogus.tree, 'unknown', 'descendants were never proven, so tree must not claim success');
  assert.ok(bogus.error, 'an unproven stop must carry an error, not a false success');
  if (process.platform === 'win32') {
    assert.match(bogus.error, /did not exit within 25ms/);
    assert.equal(bogus.killStatus, null);
  }
});

/** T9 - main's finalization folds EVERY cleanup failure into a failed record. */
test('finalization: a clean cleanup keeps success, and any cleanup failure becomes a failed record', () => {
  const ok = finalizeRecord({
    result: { runner: RUNNER_ID, playwright: { status: 0 } },
    started: {},
    cleanup: [{ owned: true, pid: 1, exited: true, tree: 'unknown', error: null }],
    serverClose: { error: null },
    refs: { paths: { result: 'x' } },
  });
  assert.equal(ok.failure, null);
  assert.equal(ok.record.cleanup.length, 1);
  assert.equal(ok.record.playwright.status, 0);
  const treeFail = finalizeRecord({ result: { runner: RUNNER_ID }, started: {}, cleanup: [{ owned: true, pid: 2, exited: false, tree: 'unknown', error: null }] });
  assert.ok(treeFail.failure, 'an unproven owned exit must fail the final result');
  assert.equal(treeFail.record.failure.code, 'cleanup_failed');
  assert.equal(treeFail.record.started.cleanupFailure.code, 'cleanup_failed');
  const closeFail = finalizeRecord({ result: { runner: RUNNER_ID }, started: {}, cleanup: [], serverClose: { error: 'server.close did not settle within 5000ms' } });
  assert.equal(closeFail.failure.code, 'cleanup_failed');
  const preserved = finalizeRecord({
    failure: new RunnerInputError('run_timeout', 'Playwright run exceeded 900000ms'),
    started: { failure: { code: 'run_timeout', message: 'Playwright run exceeded 900000ms' } },
    cleanup: [{ owned: true, pid: 3, exited: false, error: null }],
    serverClose: { error: 'close failed' },
  });
  assert.equal(preserved.record.failure.code, 'run_timeout', 'the primary failure code is preserved');
  assert.equal(preserved.record.started.cleanupFailure.code, 'cleanup_failed');
  const nothing = finalizeRecord({ result: { runner: RUNNER_ID }, started: {}, cleanup: [{ owned: false, pid: null, exited: true }], serverClose: { error: null } });
  assert.equal(nothing.failure, null, 'nothing owned means nothing to prove');
});

/** T10 - a signal DURING normal finalize is folded into one failed record; guards dispose LAST. */
test('finalization seam: a signal during normal finalize is recorded, guards dispose last, one write', async () => {
  const writes = [];
  const disposed = [];
  const order = [];
  const latch = { signal: null, failure: null };
  const started = { signals: [], failure: null };
  const outcome = await finalizeCycle({
    started,
    result: { runner: RUNNER_ID, playwright: { status: 0 } },
    failure: null,
    latch,
    server: { close: async () => undefined },
    stopOwnedChildren: async () => {
      // The signal lands WHILE cleanup is running; the guards are still installed, so the latch is
      // set and must be folded into the record before the single write.
      latch.signal = 'SIGTERM';
      latch.failure = new RunnerInputError('runner_signal', 'received SIGTERM during finalize');
      return [{ owned: true, pid: 11, tree: 'unknown', exited: true, error: null }];
    },
    buildRefs: () => ({}),
    records: () => [],
    resultPath: 'x-result.json',
    writeRecord: (target, text) => { writes.push({ target, text }); order.push('write'); },
    signalHandlers: [{ signal: 'SIGTERM', handler: () => {} }],
    removeSignalListener: (signal) => { disposed.push(signal); order.push('dispose'); },
    setExitCode: () => {},
  });
  assert.equal(outcome.failure.code, 'runner_signal', 'a signal during finalize must be recorded, not default-exited');
  assert.equal(outcome.record.failure.code, 'runner_signal');
  assert.equal(writes.length, 1, 'exactly one result write, never a double write');
  assert.deepEqual(disposed, ['SIGTERM'], 'the named guard is disposed LAST, after persistence');
  assert.deepEqual(order, ['write', 'dispose']);
  assert.equal(outcome.persistenceError, null);
});

/** T11 - a throwing persistence forces a nonzero outcome and stays SEPARATE from the primary failure. */
test('finalization seam: throwing persistence forces nonzero and preserves the primary failure separately', async () => {
  const writes = [];
  let exitCode = null;
  const primary = new RunnerInputError('run_timeout', 'Playwright run exceeded 900000ms');
  const outcome = await finalizeCycle({
    started: { signals: [], failure: null },
    result: null,
    failure: primary,
    latch: { signal: null, failure: null },
    server: null,
    stopOwnedChildren: async () => [],
    buildRefs: () => ({}),
    records: () => [],
    resultPath: 'x-result.json',
    writeRecord: (target) => { writes.push(target); throw new Error('disk full'); },
    signalHandlers: [],
    removeSignalListener: () => {},
    setExitCode: (code) => { exitCode = code; },
    writeStderr: () => {},
  });
  assert.equal(writes.length, 1, 'the write is attempted exactly once');
  assert.equal(outcome.failure.code, 'run_timeout', 'the primary failure is preserved');
  assert.equal(outcome.persistenceError.code, 'result_persist_failed', 'the persistence failure is preserved separately');
  assert.equal(exitCode, 1, 'a persistence failure must force a nonzero outcome');
  // No primary failure: the persistence error IS the outcome, so a swallowed write can never look green.
  let onlyExit = null;
  const only = await finalizeCycle({
    started: { signals: [], failure: null },
    result: { runner: RUNNER_ID },
    failure: null,
    latch: { signal: null, failure: null },
    stopOwnedChildren: async () => [{ owned: true, pid: 5, tree: 'unknown', exited: true, error: null }],
    buildRefs: () => ({}),
    records: () => [],
    resultPath: 'y-result.json',
    writeRecord: () => { throw new Error('EACCES'); },
    setExitCode: (code) => { onlyExit = code; },
    writeStderr: () => {},
  });
  assert.equal(only.failure.code, 'result_persist_failed', 'with no primary failure the persistence error IS the outcome');
  assert.equal(onlyExit, 1, 'the second case also forces a nonzero outcome');
  assert.equal(only.persistenceError.code, 'result_persist_failed');
});

/** T12 - a rejected cleanup/refs/records plus a primary error still yields ONE honest failed record. */
test('finalization seam: rejected cleanup with a primary error yields one failed record carrying both', async () => {
  const outcome = await finalizeCycle({
    started: { signals: [], failure: null },
    result: { runner: RUNNER_ID },
    failure: new RunnerInputError('engine_not_ready', 'prepared engine host never answered'),
    latch: { signal: null, failure: null },
    server: null,
    stopOwnedChildren: async () => { throw new Error('stop exploded'); },
    buildRefs: () => { throw new Error('refs exploded'); },
    records: () => { throw new Error('records exploded'); },
    resultPath: 'z-result.json',
    writeRecord: () => {},
    setExitCode: () => {},
    writeStderr: () => {},
  });
  assert.ok(outcome.failure, 'a rejected cleanup plus a primary error must fail');
  assert.equal(outcome.record.failure.code, 'engine_not_ready', 'the PRIMARY failure code survives beside cleanupFailure');
  assert.equal(outcome.record.started.cleanupFailure.code, 'cleanup_failed');
  assert.ok(outcome.record.started.evidenceError, 'a refs rejection is reported honestly');
  assert.ok(outcome.record.started.recordsError, 'a records rejection is reported honestly');
  // The same seam without a caller-prepopulated started.failure (defect 4): the primary code survives.
  const bare = finalizeRecord({
    failure: new RunnerInputError('discovery_failed', 'Playwright discovery exited with 1'),
    started: {},
    cleanup: [{ owned: true, pid: 7, tree: 'unknown', exited: false, error: null }],
    serverClose: { error: 'close failed' },
  });
  assert.equal(bare.record.failure.code, 'discovery_failed', 'a primary failure without a prepopulated started.failure must survive');
  assert.equal(bare.record.started.cleanupFailure.code, 'cleanup_failed');
});

/** T13 - a fabricated PID only ever reaches the INJECTED killer; no real OS kill is attempted. */
test('cleanup seam: a fabricated pid is handed only to the injected killer, never a real spawn', async () => {
  if (process.platform !== 'win32') return;
  const calls = [];
  const killer = new EventEmitter();
  killer.kill = () => true;
  const fakePid = 24680;
  const bogus = await stopChildTree(
    { pid: fakePid, exitCode: null, signalCode: null, once() {}, kill() { return true; } },
    {
      graceMs: 25,
      killWaitMs: 25,
      killSpawn: (command, args, options) => { calls.push({ command, args, options }); return killer; },
    },
  );
  assert.equal(calls.length, 1, 'the injected killer is the ONLY spawn path used');
  assert.equal(calls[0].command, 'taskkill');
  assert.deepEqual(calls[0].args, ['/PID', String(fakePid), '/T', '/F']);
  assert.equal(bogus.exited, false, 'no observed exit must not be claimed');
  assert.ok(bogus.error, 'a bounded unproven stop carries an error, never a false success');
});

/** T14 - a primary failure + a signal DURING cleanup + a failed write retain primary AND signal. */
test('finalization seam: a primary failure and a late signal both survive cleanup and a failed write', async () => {
  const writes = [];
  let exitCode = null;
  const latch = { signal: null, failure: null };
  const started = { signals: [], failure: null };
  // main already caught a primary failure and recorded it BEFORE any signal.
  started.failure = { code: 'run_failed', message: 'Playwright run exited with status 1' };
  const outcome = await finalizeCycle({
    started,
    result: null,
    failure: new RunnerInputError('run_failed', 'Playwright run exited with status 1'),
    latch,
    server: null,
    stopOwnedChildren: async () => {
      // A signal lands while cleanup is running; it must NOT erase the primary failure.
      started.signals.push('SIGINT');
      latch.signal = 'SIGINT';
      latch.failure = new RunnerInputError('runner_signal', 'received SIGINT before the cycle finished');
      started.signalFailure = { code: latch.failure.code, message: String(latch.failure.message) };
      return [{ owned: true, pid: 9, tree: 'unknown', exited: false, error: null }];
    },
    buildRefs: () => ({}),
    records: () => [],
    resultPath: 'q-result.json',
    writeRecord: (target) => { writes.push(target); throw new Error('disk full'); },
    signalHandlers: [{ signal: 'SIGINT', handler: () => {} }],
    removeSignalListener: () => {},
    setExitCode: (code) => { exitCode = code; },
    writeStderr: () => {},
  });
  assert.equal(outcome.failure.code, 'run_failed', 'the PRIMARY failure is retained, never erased by the late signal');
  assert.equal(outcome.record.failure.code, 'run_failed', 'the persisted record keeps the primary code');
  assert.deepEqual(outcome.record.started.signals, ['SIGINT'], 'the late signal is still recorded');
  assert.equal(outcome.record.started.signalFailure.code, 'runner_signal', 'the signal failure is preserved beside the primary');
  assert.equal(outcome.record.started.cleanupFailure.code, 'cleanup_failed', 'the cleanup violation is recorded too');
  assert.equal(outcome.persistenceError.code, 'result_persist_failed', 'the failed write is preserved separately');
  assert.equal(writes.length, 1, 'still exactly one write attempt');
  assert.equal(exitCode, 1, 'the combined outcome is nonzero');
});

test.after(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});
