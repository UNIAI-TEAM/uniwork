// UNI-667 node:test suite for the DOCX table-cycle runner's pure predicates.
//
// These tests never spawn a browser and never touch a real port. They cover the
// input contract (paths, workspace containment, hashes), the manifest gate, the
// fixture pin, the skipped-test refusal, discovery/outcome parsing and the
// cleanup/finalization seam, including the negative cases that must fail by name.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_REL,
  DOCX_APP,
  EXPECTED_FIXTURE,
  EXPECTED_ORACLE_ID,
  EXPECTED_TEST_TITLE,
  LOGICAL_PORTS,
  PINNED_SOURCE_PIN,
  REPORT_NAME,
  RUNNER_ID,
  RunnerInputError,
  SPEC_REL,
  assertDiscovery,
  assertEvidencePrefixFree,
  assertFixturePin,
  assertInsideWorkspace,
  assertNoSkippedTests,
  assertPortsFree,
  assertRunOutcome,
  buildChildEnv,
  cleanupViolations,
  evidencePaths,
  evidenceRefs,
  finalizeCycle,
  finalizeRecord,
  parseListOutput,
  parsePlaywrightJson,
  parseRunnerArgs,
  previewUrlFor,
  requireHex40,
  requireHex64,
  resolvePlaywrightCli,
  runtimeRoots,
  sha256File,
  stopChildTree,
  taskkillTree,
  validateBuildManifest,
  withTimeout,
} from './run-docx-table-cycle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const WORKSPACE = (() => {
  let dir = REPO_ROOT;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.uniwork-dev'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return REPO_ROOT;
    dir = parent;
  }
})();
const FIXTURES = path.resolve(here, '..', '..', 'lab', 'fixtures');
const MANIFEST_PATH = path.join(REPO_ROOT, '.uniwork-dev', 'office-g0-table', 'lab', 'host-builds', 'host-build-manifest.json');
const MANIFEST_SHA = fs.existsSync(MANIFEST_PATH) ? sha256File(MANIFEST_PATH) : null;

const codeOf = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof RunnerInputError) return error.code;
    throw error;
  }
};
const asyncCodeOf = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof RunnerInputError) return error.code;
    throw error;
  }
};

const manifestBytes = () =>
  MANIFEST_SHA === null
    ? Buffer.from(JSON.stringify({ apps: { docs: {} }, pinnedSourceCommit: PINNED_SOURCE_PIN, sourceUntouched: true, appSourcesUntouched: true }))
    : fs.readFileSync(MANIFEST_PATH);

test('the runner declares the docs app, its own spec/config/report and its own ports', () => {
  assert.equal(RUNNER_ID, 'office-g0-docx-table-runner-r1');
  assert.equal(DOCX_APP, 'docs');
  assert.equal(SPEC_REL, 'e2e/office-g0/docx-table-cycle.spec.ts');
  assert.equal(CONFIG_REL, 'e2e/playwright.office-g0.docx-table.config.ts');
  assert.equal(REPORT_NAME, 'office-g0-docx-table-report.json');
  assert.equal(EXPECTED_ORACLE_ID, 'office-g0-docx-table-oracle-r1');
  // 5490/5491 are this runner's own pair, distinct from every other group pair.
  assert.deepEqual(LOGICAL_PORTS, { app: 5490, preview: 5491 });
  assert.equal(previewUrlFor(), 'http://127.0.0.1:5491');
  assert.equal(EXPECTED_FIXTURE.name, 'g0-kitchen-sink.docx');
  assert.equal(EXPECTED_FIXTURE.bytes, 3415);
  assert.equal(EXPECTED_FIXTURE.sha256, '8b6de008b979174065aa43c58e17db5a3eb654b42eb61232c42945ecfa64dff9');
});

test('the spec and config the runner targets really exist and declare the table cycle', () => {
  const specPath = path.join(REPO_ROOT, SPEC_REL);
  const configPath = path.join(REPO_ROOT, CONFIG_REL);
  assert.ok(fs.existsSync(specPath), specPath);
  assert.ok(fs.existsSync(configPath), configPath);
  const spec = fs.readFileSync(specPath, 'utf8');
  assert.ok(spec.includes(EXPECTED_TEST_TITLE), 'the spec must declare the runner expected title');
  assert.ok(spec.includes('docx-table-oracle.mjs'), 'the spec must use the table oracle');
  // The accepted paragraph cycle is deliberately out of this slice.
  const config = fs.readFileSync(configPath, 'utf8');
  assert.ok(config.includes('docx-table-cycle.spec.ts'));
  // The testMatch ARRAY decides the slice, not the prose: assert on the declared
  // entries so a comment naming the paragraph spec cannot be mistaken for a run.
  const match = /testMatch:\s*\[([^\]]*)\]/.exec(config);
  assert.ok(match, 'the slice config must declare a testMatch array');
  const entries = match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^[']|[']$/g, ''))
    .filter(Boolean);
  assert.deepEqual(entries, ['docx-table-cycle.spec.ts'], 'the slice must run ONLY the table-cycle spec');
  assertNoSkippedTests(spec, SPEC_REL);
});

test('the fixture pin accepts the authored fixture and rejects a changed one', () => {
  const result = assertFixturePin(path.join(FIXTURES, EXPECTED_FIXTURE.name));
  assert.equal(result.bytes, EXPECTED_FIXTURE.bytes);
  assert.equal(result.sha256, EXPECTED_FIXTURE.sha256);
  assert.equal(codeOf(() => assertFixturePin(path.join(FIXTURES, EXPECTED_FIXTURE.name), { ...EXPECTED_FIXTURE, sha256: '0'.repeat(64) })), 'fixture_hash_mismatch');
  assert.equal(codeOf(() => assertFixturePin(path.join(FIXTURES, 'missing.docx'))), 'fixture_missing');
});

test('a skipped/fixme/todo test is refused before any browser starts', () => {
  assert.equal(assertNoSkippedTests('test(x, async () => {});'), true);
  assert.equal(codeOf(() => assertNoSkippedTests('test.skip(x, () => {});')), 'spec_has_skipped_test');
  assert.equal(codeOf(() => assertNoSkippedTests('test.fixme(x, () => {});')), 'spec_has_skipped_test');
  assert.equal(codeOf(() => assertNoSkippedTests('test.todo(x);')), 'spec_has_skipped_test');
});

test('the manifest gate requires the expected hash, pin, single app and untouched source', () => {
  const bytes = manifestBytes();
  const sha = createHash('sha256').update(bytes).digest('hex');
  const manifest = validateBuildManifest({ manifestBytes: bytes, expectedSha256: sha, expectedSourcePin: PINNED_SOURCE_PIN });
  assert.equal(manifest.app, 'docs');
  assert.equal(manifest.sha256, sha);
  assert.equal(codeOf(() => validateBuildManifest({ manifestBytes: bytes, expectedSha256: 'b'.repeat(64), expectedSourcePin: PINNED_SOURCE_PIN })), 'manifest_sha256_mismatch');
  assert.equal(codeOf(() => validateBuildManifest({ manifestBytes: bytes, expectedSha256: sha, expectedSourcePin: PINNED_SOURCE_PIN, expectedApp: 'slides' })), 'manifest_wrong_app');
  const wrongPin = Buffer.from(JSON.stringify({ apps: { docs: {} }, pinnedSourceCommit: 'f'.repeat(40), sourceUntouched: true, appSourcesUntouched: true }));
  assert.equal(
    codeOf(() => validateBuildManifest({ manifestBytes: wrongPin, expectedSha256: createHash('sha256').update(wrongPin).digest('hex'), expectedSourcePin: PINNED_SOURCE_PIN })),
    'manifest_pin_mismatch',
  );
  const mutated = Buffer.from(JSON.stringify({ apps: { docs: {} }, pinnedSourceCommit: PINNED_SOURCE_PIN, sourceUntouched: false, appSourcesUntouched: true }));
  assert.equal(
    codeOf(() => validateBuildManifest({ manifestBytes: mutated, expectedSha256: createHash('sha256').update(mutated).digest('hex'), expectedSourcePin: PINNED_SOURCE_PIN })),
    'manifest_source_mutated',
  );
  if (MANIFEST_SHA !== null) {
    const real = validateBuildManifest({ manifestBytes: manifestBytes(), expectedSha256: MANIFEST_SHA, expectedSourcePin: PINNED_SOURCE_PIN });
    assert.equal(real.app, 'docs');
  }
});

test('every caller-supplied path must stay inside the workspace', () => {
  assert.equal(assertInsideWorkspace(WORKSPACE, 'builds', path.join(WORKSPACE, 'x')), path.join(WORKSPACE, 'x'));
  assert.equal(codeOf(() => assertInsideWorkspace(WORKSPACE, 'builds', path.resolve(WORKSPACE, '..', 'elsewhere'))), 'outside_workspace');
  assert.equal(codeOf(() => requireHex64('expected-manifest-sha256', 'nope')), 'bad_manifest_hash');
  assert.equal(requireHex40('pin', 'A'.repeat(40)), 'a'.repeat(40));
  assert.equal(codeOf(() => requireHex40('pin', 'short')), 'bad_source_pin');
});

test('runner args default the pin and refuse a missing required flag', () => {
  const argv = [
    '--candidate', REPO_ROOT,
    '--fixtures', FIXTURES,
    '--builds', path.join(REPO_ROOT, '.uniwork-dev', 'office-g0-table', 'lab', 'host-builds'),
    '--evidence-prefix', path.join(REPO_ROOT, '.uniwork-dev', 'office-g0-table', 'evidence'),
    '--expected-manifest-sha256', 'a'.repeat(64),
  ];
  const options = parseRunnerArgs(argv, {}, { cwd: REPO_ROOT });
  assert.equal(options.expectedSourcePin, PINNED_SOURCE_PIN);
  assert.equal(options.paths.result, path.join(REPO_ROOT, '.uniwork-dev', 'office-g0-table', 'evidence-result.json'));
  assert.equal(codeOf(() => parseRunnerArgs(['--candidate', REPO_ROOT], {}, { cwd: REPO_ROOT })), 'missing_fixtures');
  assert.equal(runtimeRoots(options.paths).labDir, path.join(REPO_ROOT, '.uniwork-dev', 'office-g0-table', 'evidence-runtime', 'lab'));
});

test('an earlier evidence prefix is never reused', () => {
  const paths = evidencePaths(path.join(REPO_ROOT, '.uniwork-dev', '_never'));
  assert.equal(assertEvidencePrefixFree(paths, () => false), paths);
  assert.equal(codeOf(() => assertEvidencePrefixFree(paths, (entry) => entry === paths.runLog)), 'evidence_prefix_exists');
});

test('discovery and the run report must both prove a clean two-browser pass', () => {
  const listed = parseListOutput('  [chrome] \u203a docx-table-cycle.spec.ts:91:1 \u203a docs: edit an existing table cell\n  [edge] \u203a docx-table-cycle.spec.ts:91:1 \u203a docs: edit\n  Total: 2 test\n');
  assert.deepEqual(assertDiscovery(listed), listed);
  assert.equal(codeOf(() => assertDiscovery({ total: 0, projects: [] })), 'discovery_zero_tests');
  assert.equal(codeOf(() => assertDiscovery({ total: 2, projects: ['chrome'] })), 'discovery_missing_project');
  assert.equal(parseListOutput('no total here').total, null);

  const clean = {
    stats: { expected: 2, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [
      {
        specs: [
          {
            title: EXPECTED_TEST_TITLE,
            ok: true,
            tests: [
              { projectName: 'chrome', status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }] },
              { projectName: 'edge', status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }] },
            ],
          },
        ],
      },
    ],
  };
  const report = parsePlaywrightJson(JSON.stringify(clean));
  const outcome = assertRunOutcome(report, { expectedTotal: listed.total });
  assert.deepEqual(outcome.projects, ['chrome', 'edge']);
  assert.equal(outcome.executed, 2);

  const skippedRun = JSON.parse(JSON.stringify(clean));
  skippedRun.stats.skipped = 1;
  skippedRun.suites[0].specs[0].tests[1].results = [{ status: 'skipped' }];
  assert.equal(codeOf(() => assertRunOutcome(parsePlaywrightJson(JSON.stringify(skippedRun)), { expectedTotal: 2 })), 'run_outcome_not_clean');

  const retriedRun = JSON.parse(JSON.stringify(clean));
  retriedRun.suites[0].specs[0].tests[1].results = [{ status: 'failed' }, { status: 'passed' }];
  retriedRun.stats.flaky = 1;
  assert.equal(codeOf(() => assertRunOutcome(parsePlaywrightJson(JSON.stringify(retriedRun)), { expectedTotal: 2 })), 'run_outcome_not_clean');

  const renamed = JSON.parse(JSON.stringify(clean));
  renamed.suites[0].specs[0].title = 'something else';
  assert.equal(codeOf(() => assertRunOutcome(parsePlaywrightJson(JSON.stringify(renamed)), { expectedTotal: 2 })), 'run_outcome_not_clean');

  assert.equal(codeOf(() => assertRunOutcome(null, { expectedTotal: 2 })), 'run_report_missing');
  assert.equal(parsePlaywrightJson('not json'), null);
});

test('the child environment pins the lab origin, report target and TEMP inside the prefix', () => {
  const paths = evidencePaths(path.join(REPO_ROOT, '.uniwork-dev', '_env'));
  const options = { fixtures: FIXTURES };
  const manifest = { pinnedSourceCommit: PINNED_SOURCE_PIN, sha256: 'c'.repeat(64) };
  const env = buildChildEnv({ env: { PATH: 'x' }, options, paths, manifest });
  assert.equal(env.OFFICE_G0_LAB_URL, 'http://127.0.0.1:5490');
  assert.equal(env.OFFICE_G0_FIXTURES_DIR, FIXTURES);
  assert.equal(env.PLAYWRIGHT_OUTPUT_DIR, paths.artifacts);
  assert.equal(env.PLAYWRIGHT_JSON_OUTPUT_FILE, paths.runJson);
  assert.equal(env.OFFICE_G0_SOURCE_PIN, PINNED_SOURCE_PIN);
  assert.equal(env.OFFICE_G0_BUILD_MANIFEST_SHA256, manifest.sha256);
  assert.equal(env.TEMP, paths.temp);
  assert.equal(env.PATH, 'x');
});

test('evidence refs hash the spec, config, oracle and fixture this run used', () => {
  const paths = evidencePaths(path.join(REPO_ROOT, '.uniwork-dev', '_refs'));
  const options = { builds: path.join(REPO_ROOT, '.uniwork-dev', 'office-g0-table', 'lab', 'host-builds'), fixtures: FIXTURES };
  const refs = evidenceRefs({ candidate: REPO_ROOT, options, manifest: null, fixture: null, paths });
  assert.equal(refs.hashes.spec.sha256, sha256File(path.join(REPO_ROOT, SPEC_REL)));
  assert.equal(refs.hashes.sliceConfig.sha256, sha256File(path.join(REPO_ROOT, CONFIG_REL)));
  assert.ok(refs.hashes.oracle.sha256);
  assert.equal(refs.hashes.fixture.sha256, EXPECTED_FIXTURE.sha256);
  assert.equal(sha256File(path.join(REPO_ROOT, SPEC_REL)).length, 64);
});

test('a busy port this runner did not mint is refused', async () => {
  const net = await import('node:net');
  const squatter = net.createServer();
  await new Promise((resolve) => squatter.listen(0, '127.0.0.1', resolve));
  const busyPort = squatter.address().port;
  try {
    assert.equal(await asyncCodeOf(() => assertPortsFree({ app: busyPort })), 'port_in_use');
  } finally {
    await new Promise((resolve) => squatter.close(resolve));
  }
});

test('a child wait that outlives its bound fails by name instead of hanging', async () => {
  assert.equal(await asyncCodeOf(() => withTimeout(new Promise(() => {}), 20, 'run_timeout', 'Playwright run')), 'run_timeout');
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'run_timeout', 'x'), 'ok');
});

test('stopping an already-exited child is honest and a fabricated pid never reaches a real kill', async () => {
  const exited = { pid: 4242, exitCode: 0, signalCode: null };
  const stopped = await stopChildTree(exited);
  assert.equal(stopped.owned, false);
  assert.equal(stopped.exited, true);

  const alive = { pid: 4242, exitCode: null, signalCode: null, on() {}, once() {} };
  const calls = [];
  const fakeKill = (command, args) => {
    calls.push([command, ...args]);
    return { once(event, handler) { if (event === 'exit') setImmediate(() => handler(0, null)); }, kill() {} };
  };
  const evidence = await stopChildTree(alive, { killSpawn: fakeKill });
  assert.equal(evidence.owned, true);
  assert.deepEqual(calls[0], ['taskkill', '/PID', '4242', '/T', '/F']);
  assert.equal(evidence.command, 'taskkill /PID 4242 /T /F');
  assert.equal(evidence.killStatus, 0);

  const hung = taskkillTree(7, 30, () => ({ once() {}, kill() {} }));
  assert.equal((await hung).ok, false);
});

test('cleanup violations and finalization keep a failure instead of reporting success', () => {
  assert.deepEqual(cleanupViolations([{ owned: true, pid: 1, exited: true, error: null }], { error: null }), []);
  assert.equal(cleanupViolations([], { error: 'server_close: boom' }).length, 1);
  assert.equal(cleanupViolations([{ owned: true, pid: 2, exited: false, error: null }]).length, 1);
  assert.deepEqual(cleanupViolations([{ owned: false, pid: 3, exited: false, error: 'x' }]), []);

  const started = { failure: null };
  const okRecord = finalizeRecord({ result: { runner: RUNNER_ID }, started, cleanup: [{ owned: true, pid: 9, exited: true }], serverClose: { error: null } });
  assert.equal(okRecord.failure, null);
  assert.equal(okRecord.record.runner, RUNNER_ID);

  const dirtyStarted = { failure: null };
  const dirty = finalizeRecord({ result: { runner: RUNNER_ID }, started: dirtyStarted, cleanup: [{ owned: true, pid: 9, exited: false, error: 'exit unproven' }], serverClose: { error: null } });
  assert.ok(dirty.failure);
  assert.equal(dirty.record.failure.code, 'cleanup_failed');
  assert.equal(dirty.record.started.cleanupFailure.violations.length, 1);
});

test('the finalization seam writes exactly one record and a write failure forces a failure', async () => {
  const started = { failure: null };
  const written = [];
  const clean = await finalizeCycle({
    started,
    result: { runner: RUNNER_ID },
    server: null,
    stopOwnedChildren: async () => [],
    buildRefs: () => ({ hashes: {} }),
    records: () => [{ op: 'session-open' }],
    resultPath: 'memory://result.json',
    writeRecord: (target, text) => written.push([target, text]),
    setExitCode: () => {},
  });
  assert.equal(clean.failure, null);
  assert.equal(written.length, 1);
  assert.equal(JSON.parse(written[0][1]).runner, RUNNER_ID);

  const failing = await finalizeCycle({
    started: { failure: null },
    result: { runner: RUNNER_ID },
    server: null,
    stopOwnedChildren: async () => [],
    resultPath: 'memory://result.json',
    writeRecord: () => {
      throw new Error('disk full');
    },
    setExitCode: () => {},
  });
  assert.ok(failing.failure, 'a swallowed write failure must still be a failure');
  assert.equal(failing.persistenceError.code, 'result_persist_failed');

  const code = { value: null };
  const signalled = await finalizeCycle({
    started: { failure: null },
    result: { runner: RUNNER_ID },
    latch: { signal: 'SIGINT', failure: new RunnerInputError('runner_signal', 'received SIGINT') },
    server: null,
    stopOwnedChildren: async () => [],
    resultPath: null,
    setExitCode: (value) => {
      code.value = value;
    },
  });
  assert.equal(signalled.record.started.failure.code, 'runner_signal');
  assert.equal(code.value, 1);
});

test('the Playwright CLI resolves from the candidate e2e dependency tree', () => {
  const cli = resolvePlaywrightCli(REPO_ROOT);
  assert.ok(fs.existsSync(cli), cli);
  assert.ok(cli.endsWith(path.join('cli.js')));
});
