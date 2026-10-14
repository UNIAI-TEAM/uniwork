// Tests for the G5/G6/G7 evidence runner (UNI-1376 / G7-01 item B).
// Every case runs against a temp out dir and temp manifests: no database, no
// cloud runner and no network are touched here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_PATH,
  MATRIX_PATH,
  REQUIRED_FIELDS,
  SKIP_EXIT_CODE,
  assertEvidenceOutDir,
  assertLaneTestDatabase,
  classifyResult,
  databaseNameFromUrl,
  exitCodeOf,
  laneTestDbPrefix,
  readManifest,
  readMatrix,
  readPin,
  reset,
  resolveDSha,
  resolveFSha,
  runEvidence,
  sha256File,
  signalExitCode,
  verify,
} from './evidence.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// TMPDIR can be relative (and point inside the checkout) in some shells, so
// pick the first temp base that is absolute, creatable and outside the
// worktree: the tests must never leave scratch files in the repo.
function tempBase() {
  for (const candidate of [os.tmpdir(), '/tmp']) {
    const dir = path.resolve(candidate);
    if (dir === repoRoot || dir.startsWith(`${repoRoot}${path.sep}`)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('no usable temp directory outside the worktree');
}
const tmpRoot = fs.mkdtempSync(path.join(tempBase(), 'office-evidence-test-'));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let seq = 0;

const tempDir = () => {
  seq += 1;
  const dir = path.join(tmpRoot, `case-${seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** A manifest whose first fixture is rewritten (missing file or drifted hash). */
function tempManifest(patch) {
  const manifest = readManifest(MANIFEST_PATH);
  const target = manifest.fixtures.find((fixture) => fixture.id === 'fx-xlsx-revenue-xyz');
  Object.assign(target, patch);
  const file = path.join(tempDir(), 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return file;
}

const run = (args, env = {}) =>
  spawnSync(process.execPath, [path.join(repoRoot, 'scripts/office/g5g6g7/evidence.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

const readLines = (outDir) =>
  fs
    .readFileSync(path.join(outDir, 'evidence.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const baseArgs = (outDir) => ['run', '--req', 'G5-A01', '--fixture', 'fx-xlsx-revenue-xyz', '--checker', 'tester-cloud', '--out', outDir, '--'];

test('exit 0 records PASS with every contract field, the D SHA, the fork SHA and the web pin', () => {
  const outDir = tempDir();
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
    platform: 'linux-x64',
    build: 'dev',
    env: { ...process.env, OFFICE_FORK_SHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
  });
  assert.equal(record.result, 'PASS');
  assert.equal(record.exitCode, 0);
  assert.equal(record.blocker, null);
  assert.equal(record.requirementId, 'G5-A01');
  assert.equal(record.fixtureId, 'fx-xlsx-revenue-xyz');
  assert.equal(record.fixtureSha256, readManifest(MANIFEST_PATH).fixtures[0].sha256);
  assert.equal(record.dSha, resolveDSha());
  assert.equal(record.fSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(record.pin, readPin());
  assert.equal(record.pin, JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/platform/office-frame/docs.pin.json'), 'utf8')).version);
  assert.equal(record.platform, 'linux-x64');
  assert.equal(record.build, 'dev');
  assert.equal(record.checker, 'tester-cloud');
  assert.ok(fs.existsSync(path.join(repoRoot, record.artifact)), 'a PASS carries an artifact on disk');
  assert.equal(record.startedAt <= record.finishedAt, true);
  for (const field of REQUIRED_FIELDS) assert.ok(field in record, `evidence line is missing ${field}`);
  const lines = readLines(outDir);
  assert.equal(lines.length, 1, 'one run appends exactly one line');
  assert.deepEqual(Object.keys(lines[0]).sort(), [...REQUIRED_FIELDS].sort(), 'the ledger line carries exactly the contract fields');
});

test('a non-zero exit records FAIL, and exit 77 or a skip line records BLOCKED', () => {
  const failed = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(3)'],
    outDir: tempDir(),
  });
  assert.equal(failed.result, 'FAIL');
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.blocker, null);

  const skipped = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', `process.exit(${SKIP_EXIT_CODE})`],
    outDir: tempDir(),
  });
  assert.equal(skipped.result, 'BLOCKED');
  assert.match(skipped.blocker, /skip/);

  const skipLine = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'console.log("SKIP: no xvfb on this VM")'],
    outDir: tempDir(),
  });
  assert.equal(skipLine.result, 'BLOCKED');
  assert.match(skipLine.blocker, /no xvfb/);

  assert.deepEqual(classifyResult({ exitCode: 0, output: '' }), { result: 'PASS', blocker: null });
  assert.deepEqual(classifyResult({ exitCode: 1, output: '' }), { result: 'FAIL', blocker: null });
  assert.equal(classifyResult({ exitCode: 0, output: 'SKIP: not here' }).result, 'BLOCKED');
});

test('a command killed by a signal is a FAIL with 128 + the signal number, never a PASS', () => {
  // spawnSync reports a killed process as status null plus a signal name; the
  // old `status ?? 0` read that as a clean exit and recorded PASS.
  for (const [signal, number] of [['SIGKILL', 9], ['SIGTERM', 15], ['SIGSEGV', 11]]) {
    const killed = spawnSync('sh', ['-c', `kill -${signal.slice(3)} $$`]);
    assert.equal(killed.status, null, `${signal} leaves no status`);
    assert.equal(killed.signal, signal);
    assert.equal(exitCodeOf(killed), 128 + number, `${signal} is 128 + ${number}`);
    assert.deepEqual(classifyResult({ exitCode: exitCodeOf(killed), output: '' }), { result: 'FAIL', blocker: null });
  }
  assert.equal(signalExitCode('SIGKILL'), 137);
  assert.equal(signalExitCode('SIGTERM'), 143);
  assert.equal(signalExitCode('SIGSEGV'), 139);
  assert.equal(signalExitCode('SIGWEIRD'), 128, 'an unknown signal is still not a success');
  assert.equal(exitCodeOf({ status: null, signal: null, error: null }), 128, 'a null status with no signal is not a pass');
  assert.equal(exitCodeOf({ status: null, signal: null, error: new Error('spawn ENOENT') }), 127);
  assert.equal(exitCodeOf({ status: 0 }), 0);
  assert.equal(exitCodeOf({ status: 7 }), 7);

  const outDir = tempDir();
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: ['sh', '-c', 'kill -9 $$'],
    outDir,
  });
  assert.equal(record.result, 'FAIL');
  assert.equal(record.exitCode, 137);
  assert.equal(record.blocker, null);
  assert.equal(readLines(outDir)[0].result, 'FAIL', 'the ledger line a killed command writes is not a PASS');
});

test('a skip line only turns a clean exit into BLOCKED, and never masks a failure', () => {
  assert.deepEqual(classifyResult({ exitCode: 0, output: 'SKIP: no xvfb on this VM' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: SKIP: no xvfb on this VM',
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: '  skip - not applicable  ' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: skip - not applicable',
  });
  // R1-01: the word may be skipped/skipping, in any case, and need not be first.
  for (const output of ['Skipped: no xvfb on this VM', 'skipped: no xvfb', 'Skipping Electron: no display', 'no xvfb; skipping G7-10', 'SKIPPING: no display']) {
    assert.equal(classifyResult({ exitCode: 0, output }).result, 'BLOCKED', `${output} must be BLOCKED`);
  }
  // A mention in the middle of a sentence is not a skip statement.
  assert.equal(classifyResult({ exitCode: 0, output: 'the cache was warm; no skip needed' }).result, 'PASS');
  // A failing command that prints a skip-shaped line stays a FAIL.
  assert.deepEqual(classifyResult({ exitCode: 1, output: 'SKIP: no xvfb\nboom' }), { result: 'FAIL', blocker: null });
  assert.deepEqual(classifyResult({ exitCode: 137, output: 'skip' }), { result: 'FAIL', blocker: null });
  assert.deepEqual(classifyResult({ exitCode: SKIP_EXIT_CODE, output: '' }), {
    result: 'BLOCKED',
    blocker: `command reported skip (exit ${SKIP_EXIT_CODE})`,
  });

  const masked = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: ['sh', '-c', 'echo "skip: pretending this is fine"; exit 1'],
    outDir: tempDir(),
  });
  assert.equal(masked.result, 'FAIL', 'a skip line must not hide a genuine failure');
  assert.equal(masked.exitCode, 1);
});

test('Playwright "<n> skipped" lines with leading whitespace are classified as BLOCKED, while "0 skipped" stays PASS (C6)', () => {
  assert.deepEqual(classifyResult({ exitCode: 0, output: 'Running 2 tests using 1 worker\n  2 skipped' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: 2 skipped',
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: '    1 skipped\n  3 passed (4.2s)' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: 1 skipped',
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: '12 skipped' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: 12 skipped',
  });
  // "0 skipped" (with or without leading whitespace) must NOT count as a skip.
  assert.deepEqual(classifyResult({ exitCode: 0, output: '  0 skipped\n  3 passed (2.1s)' }), {
    result: 'PASS',
    blocker: null,
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: '0 skipped' }), {
    result: 'PASS',
    blocker: null,
  });
  // A non-zero exit with "<n> skipped" stays FAIL.
  assert.deepEqual(classifyResult({ exitCode: 1, output: '  2 skipped\n  1 failed' }), {
    result: 'FAIL',
    blocker: null,
  });
});

test('node:test "# skipped <n>" and "ℹ skipped <n>" summary lines are classified as BLOCKED when <n> >= 1, while "# skipped 0" stays PASS (G710-BE-6)', () => {
  assert.deepEqual(classifyResult({ exitCode: 0, output: '# pass 0\n# skipped 1' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: # skipped 1',
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: 'ℹ pass 3\nℹ skipped 2' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: ℹ skipped 2',
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: 'ok 1 - check # SKIP no display' }), {
    result: 'BLOCKED',
    blocker: 'command reported skip: ok 1 - check # SKIP no display',
  });
  // "# skipped 0" and "ℹ skipped 0" must NOT be treated as a skip.
  assert.deepEqual(classifyResult({ exitCode: 0, output: '# pass 5\n# skipped 0\n# fail 0' }), {
    result: 'PASS',
    blocker: null,
  });
  assert.deepEqual(classifyResult({ exitCode: 0, output: 'ℹ pass 5\nℹ skipped 0\nℹ fail 0' }), {
    result: 'PASS',
    blocker: null,
  });
});

test('vitest and prose skip summaries are classified as BLOCKED, and every zero-count form stays PASS (G710-BE-12)', () => {
  // The residual forms the r2 review probed: the skip word not at a line start,
  // which the older line-start rule let through as PASS.
  const blocked = [
    'Tests  2 skipped (5)',
    'Test Files  1 skipped (3)',
    'Tests: 2 skipped, 3 passed',
    'Passed: 4, Skipped: 2',
    '1 skip',
    '…skipping…',
    'note: 2 tests were skipped',
    'Test Files  2 skipped | 4 passed (6.3s)',
  ];
  for (const output of blocked) {
    const verdict = classifyResult({ exitCode: 0, output });
    assert.equal(verdict.result, 'BLOCKED', `${output} must be BLOCKED`);
    assert.match(verdict.blocker, /command reported skip: /, `${output} names the line it saw`);
  }
  // A zero count is not a skip, whatever the spelling.
  const passing = [
    'Tests  0 skipped (5)',
    'Test Files  0 skipped | 4 passed (6.3s)',
    'Tests: 0 skipped, 3 passed',
    'Passed: 4, Skipped: 0',
    '# pass 5\n# skipped 0',
    '0 skipped',
    '  0 skipped\n  3 passed (2.1s)',
    'the cache was warm; no skip needed',
    // The tracer prints its loop JSON on stdout, where a step status is the word
    // SKIPPED with no count: that is a report of its own, not a skipped check.
    '        "status": "SKIPPED",',
    '"reason": "app offline save was driven directly"',
  ];
  for (const output of passing) {
    assert.equal(classifyResult({ exitCode: 0, output }).result, 'PASS', `${output} must stay PASS`);
  }
  // A non-zero exit is still a FAIL even with a skip summary on it.
  assert.deepEqual(classifyResult({ exitCode: 1, output: 'Tests  2 skipped (5)' }), { result: 'FAIL', blocker: null });
});

test('a missing or drifted fixture is BLOCKED and never PASS, and the command does not run', () => {
  const missing = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'require("node:fs").writeFileSync(process.env.SHOULD_NOT_RUN ?? "/tmp/ran", "x")'],
    outDir: tempDir(),
    env: { ...process.env, OFFICE_FIXTURE_MANIFEST: tempManifest({ path: 'docs/office/g5g6g7/fixtures/does-not-exist.xlsx' }), SHOULD_NOT_RUN: path.join(tempDir(), 'ran') },
  });
  assert.equal(missing.result, 'BLOCKED');
  assert.match(missing.blocker, /missing/);
  assert.equal(missing.exitCode, null, 'a blocked run records no exit code because the command never ran');

  const drifted = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir: tempDir(),
    env: { ...process.env, OFFICE_FIXTURE_MANIFEST: tempManifest({ sha256: '0'.repeat(64) }) },
  });
  assert.equal(drifted.result, 'BLOCKED');
  assert.match(drifted.blocker, /does not match the manifest/);

  const unknown = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-not-a-fixture',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir: tempDir(),
  });
  assert.equal(unknown.result, 'BLOCKED');
  assert.match(unknown.blocker, /is not declared by row|is not in/);
});

test('a run on a fixture the row does not declare is BLOCKED and the command does not run', () => {
  // R1-13: the row proves nothing about a fixture it never names. fx-html-page-vi
  // is in the manifest and G5-A01 does not declare it, so this is a row/fixture
  // mismatch, not a missing fixture.
  const marker = path.join(tempDir(), 'ran');
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-html-page-vi',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
    outDir: tempDir(),
  });
  assert.equal(record.result, 'BLOCKED');
  assert.match(record.blocker, /is not declared by row G5-A01/);
  assert.equal(record.exitCode, null);
  assert.equal(fs.existsSync(marker), false, 'the command never ran');
});

test('two runs for one requirement cannot share an evidence id or overwrite an artifact', () => {
  // R1-11: the id is reserved with an exclusive lock file, so a second run that
  // read the same ledger count still gets its own id.
  const outDir = tempDir();
  const first = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
  });
  const second = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
  });
  assert.notEqual(first.evidenceId, second.evidenceId);
  assert.notEqual(first.artifact, second.artifact);
  assert.equal(new Set(readLines(outDir).map((line) => line.evidenceId)).size, 2);
});

test('the ledger records the argv array beside the readable command', () => {
  const outDir = tempDir();
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)', 'a b', 'quote"d'],
    outDir,
  });
  assert.deepEqual(record.argv, [process.execPath, '-e', 'process.exit(0)', 'a b', 'quote"d']);
  assert.equal(record.command, `${process.execPath} -e process.exit(0) a b quote"d`);
  assert.deepEqual(readLines(outDir)[0].argv, record.argv, 'argv survives the round trip through the ledger');
});

test('a check that prints more than the default buffer still records its exit code', () => {
  // R1-15: 2 MiB of output used to make spawnSync report ENOBUFS, which was read
  // as a spawn failure and recorded FAIL for a check that exited 0.
  const outDir = tempDir();
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))'],
    outDir,
  });
  assert.equal(record.result, 'PASS', record.blocker ?? '');
  assert.equal(record.exitCode, 0);
  assert.ok(fs.statSync(path.join(repoRoot, record.artifact)).size > 2 * 1024 * 1024, 'the artifact keeps the output');
});

test('an explicit blocker reason blocks a run that would otherwise pass', () => {
  const blocked = runEvidence({
    requirementId: 'G5-A04',
    fixtureId: 'fx-pdf-invoice-vi',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir: tempDir(),
    blockerReason: 'gate G5-D1 not closed',
  });
  assert.equal(blocked.result, 'BLOCKED');
  assert.equal(blocked.blocker, 'gate G5-D1 not closed');
  assert.equal(blocked.exitCode, null);
});

test('an unknown requirement id is refused instead of written', () => {
  assert.throws(
    () => runEvidence({ requirementId: 'G9-A99', fixtureId: 'fx-md-notes-vi', checker: 'x', command: [process.execPath, '-e', '0'], outDir: tempDir() }),
    /is not a row/,
  );
});

test('reset only touches a lane test database and is a dry run without psql', () => {
  assert.equal(assertLaneTestDatabase('uniwork_office_g7_qa_123_test'), 'uniwork_office_g7_qa_123_test');
  // R1-06: the shared repo test DB is every checkout's, not this lane's.
  assert.throws(() => assertLaneTestDatabase('uniwork_test'), /shared test database is not a lane test database/);
  assert.throws(() => assertLaneTestDatabase('lane_test', 'lane_'), /shared test database is not a lane test database/);
  assert.equal(assertLaneTestDatabase('uniwork_lane_test'), 'uniwork_lane_test', 'a name after the prefix is the lane');
  assert.throws(() => assertLaneTestDatabase('uniwork_shared'), /not under the lane test prefix|only touch a \*_test/);
  assert.throws(() => assertLaneTestDatabase('postgres'), /not under the lane test prefix/);
  assert.throws(() => assertLaneTestDatabase(''), /no database name/);
  assert.throws(() => assertLaneTestDatabase('dev_uniwork_test', 'lane_'), /not under the lane test prefix lane_/);
  assert.equal(databaseNameFromUrl('postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable'), 'uniwork_x_1_test');
  assert.equal(databaseNameFromUrl('not a url'), null);
  // F6: the name is percent-decoded, so a quoted identifier matches the real DB.
  assert.equal(databaseNameFromUrl('postgres://uniwork:uniwork@localhost:5432/uniwork_a%22b_test'), 'uniwork_a"b_test');
  assert.equal(databaseNameFromUrl('postgres://uniwork:uniwork@localhost:5432/uniwork_a%25_test'), 'uniwork_a%_test');
  assert.equal(databaseNameFromUrl('postgres://uniwork:uniwork@localhost:5432/uniwork_bad%_test'), 'uniwork_bad%_test');
  assert.equal(assertLaneTestDatabase(databaseNameFromUrl('postgres://uniwork:uniwork@localhost:5432/uniwork_a%22b_test')), 'uniwork_a"b_test');
  assert.equal(laneTestDbPrefix({}), 'uniwork_');
  assert.equal(laneTestDbPrefix({ OFFICE_LANE_TEST_DB_PREFIX: 'lane_' }), 'lane_');

  const outDir = tempDir();
  fs.mkdirSync(path.join(outDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'evidence.jsonl'), '');
  const plan = reset({ outDir, env: { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable' }, dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.steps, ['drop database uniwork_x_1_test', 'create database uniwork_x_1_test', 'clear the evidence out dir']);
  assert.ok(fs.existsSync(path.join(outDir, 'evidence.jsonl')), 'a dry run clears nothing');
  assert.throws(() => reset({ outDir, env: { DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_shared' }, dryRun: true }), /refuses database/);
  assert.throws(() => reset({ outDir, env: {}, dryRun: true }), /no database name/);

  // The out dir is a second guard: reset clears the evidence dir, nothing else.
  assert.equal(assertEvidenceOutDir(outDir), path.resolve(outDir), 'a dir holding a ledger is the evidence dir');
  const scratch = tempDir();
  assert.throws(() => assertEvidenceOutDir(scratch), /refuses --out/);
  assert.throws(
    () => reset({ outDir: scratch, env: { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable' } }),
    /refuses --out/,
  );
  fs.writeFileSync(path.join(scratch, 'keep.txt'), 'not evidence');
  assert.throws(
    () => reset({ outDir: scratch, env: { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable' } }),
    /refuses --out/,
  );
  assert.equal(fs.readFileSync(path.join(scratch, 'keep.txt'), 'utf8'), 'not evidence', 'a refused reset deletes nothing');

  const dry = run(['reset', '--dry-run'], { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable' });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /would drop database uniwork_x_1_test/);
  const refused = run(['reset', '--dry-run'], { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_dev' });
  assert.equal(refused.status, 2, 'a refused reset is an error, not a silent pass');
  assert.match(refused.stderr, /refuses database/);
});

test('verify accepts a clean ledger and rejects a pass without an artifact, a stale hash and a missing blocker', () => {
  const outDir = tempDir();
  // verify reports a null fork SHA as an empty field, so a "clean" record has to
  // name one — the cloud runner always does (the harness sets OFFICE_FORK_SHA).
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
    env: { ...process.env, OFFICE_FORK_SHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
  });
  assert.equal(verify({ outDir }).ok, true, verify({ outDir }).problems.join('; '));

  const ledgerFile = path.join(outDir, 'evidence.jsonl');
  const ledger = readLines(outDir);
  // A PASS whose artifact vanished is a problem, not a pass.
  fs.rmSync(path.join(repoRoot, record.artifact));
  const noArtifact = verify({ outDir });
  assert.equal(noArtifact.ok, false);
  assert.ok(noArtifact.problems.some((problem) => /no artifact/.test(problem)));

  // A stale fixture hash on a PASS line is a problem.
  ledger[0].artifact = record.artifact;
  ledger[0].fixtureSha256 = '0'.repeat(64);
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  assert.ok(verify({ outDir }).problems.some((problem) => /does not match the manifest/.test(problem)));

  // A BLOCKED line without a reason is a problem.
  ledger[0].result = 'BLOCKED';
  ledger[0].blocker = null;
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  assert.ok(verify({ outDir }).problems.some((problem) => /BLOCKED has no blocker reason/.test(problem)));

  // A ledger that repeats an evidence id is a problem (R1-11).
  ledger.push({ ...ledger[0] });
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  assert.ok(verify({ outDir }).problems.some((problem) => /repeats evidence id/.test(problem)));
  ledger.pop();

  // A line missing a contract field is a problem.
  delete ledger[0].pin;
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  assert.ok(verify({ outDir }).problems.some((problem) => /is missing pin/.test(problem)));

  // A field that is present but null or blank is as useless as an absent one.
  ledger[0].pin = '';
  ledger[0].fSha = null;
  ledger[0].result = 'FAIL';
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const empty = verify({ outDir });
  assert.ok(empty.problems.some((problem) => /has an empty pin/.test(problem)), 'a blank pin is reported');
  assert.ok(empty.problems.some((problem) => /has an empty fSha/.test(problem)), 'a null fork SHA is reported');

  // blocker/exitCode are legitimately null and are not reported as empty.
  ledger[0].pin = readPin();
  ledger[0].fSha = 'deadbeef';
  ledger[0].blocker = null;
  ledger[0].exitCode = null;
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const clean = verify({ outDir });
  assert.equal(clean.problems.some((problem) => /has an empty (blocker|exitCode)/.test(problem)), false);
  assert.equal(clean.problems.some((problem) => /has an empty argv/.test(problem)), false, 'a real argument vector is not empty');

  // N1: an empty argv array, and an argv that is not an array, carry no argument
  // vector; the record is as incomplete as one with a blank command.
  const argvOk = ledger[0].argv;
  for (const argv of [[], null, 'node -e 0', {}]) {
    ledger[0].argv = argv;
    fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
    assert.ok(
      verify({ outDir }).problems.some((problem) => /has an empty argv/.test(problem)),
      `argv ${JSON.stringify(argv)} must be reported as empty`,
    );
  }
  ledger[0].argv = argvOk;
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  assert.equal(verify({ outDir }).problems.some((problem) => /empty argv/.test(problem)), false);
});

test('verify fails a row that claims PASS without a PASS record, and a matrix BLOCKED row without a blocker', () => {
  const matrix = readMatrix(MATRIX_PATH);
  const outDir = tempDir();
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
  });
  assert.equal(record.result, 'PASS');
  const ledgerFile = path.join(outDir, 'evidence.jsonl');
  // The runner refuses to record a run on a fixture the row does not declare
  // (R1-13), so this line is written by hand — which is exactly the ledger a
  // reader cannot trust, and verify must still refuse it.
  const manifest = readManifest(MANIFEST_PATH);
  const foreign = manifest.fixtures.find((fixture) => fixture.id === 'fx-html-page-vi');
  const line = { ...readLines(outDir)[0], fixtureId: foreign.id, fixtureSha256: foreign.sha256 };
  fs.writeFileSync(ledgerFile, `${JSON.stringify(line)}\n`);

  const claimed = structuredClone(matrix);
  claimed.rows.find((row) => row.id === 'G5-A01').status = 'PASS';
  claimed.rows.find((row) => row.id === 'G5-A01').evidence = [record.evidenceId];
  const matrixFile = path.join(tempDir(), 'matrix.json');
  fs.writeFileSync(matrixFile, JSON.stringify(claimed, null, 2));
  assert.ok(
    verify({ outDir, matrixPath: matrixFile }).problems.some((problem) => /used a fixture row G5-A01 does not declare/.test(problem)),
    'a PASS on a fixture the row does not declare is a problem',
  );

  const unbacked = structuredClone(matrix);
  unbacked.rows.find((row) => row.id === 'G5-A01').status = 'PASS';
  unbacked.rows.find((row) => row.id === 'G5-A01').evidence = ['ev-g5-a01-9999'];
  fs.writeFileSync(matrixFile, JSON.stringify(unbacked, null, 2));
  assert.ok(verify({ outDir, matrixPath: matrixFile }).problems.some((problem) => /that the ledger does not contain/.test(problem)));

  const noBlocker = structuredClone(matrix);
  noBlocker.rows.find((row) => row.status === 'BLOCKED').blocker = null;
  fs.writeFileSync(matrixFile, JSON.stringify(noBlocker, null, 2));
  assert.ok(verify({ outDir, matrixPath: matrixFile }).problems.some((problem) => /BLOCKED without a blocker reason/.test(problem)));

  const skipped = structuredClone(matrix);
  skipped.rows.find((row) => row.id === 'G5-A01').status = 'BLOCKED';
  skipped.rows.find((row) => row.id === 'G5-A01').evidence = [record.evidenceId];
  skipped.rows.find((row) => row.id === 'G5-A01').blocker = { gate: 'G5-D1', owner: 'x', reason: 'y' };
  fs.writeFileSync(matrixFile, JSON.stringify(skipped, null, 2));
  assert.ok(
    verify({ outDir, matrixPath: matrixFile }).problems.some((problem) => /has a PASS evidence record but is BLOCKED/.test(problem)),
    'a skip or blocked status never absorbs a PASS record',
  );
});

test('verify accepts a NOT_RUN row carrying partialEvidence and still rejects a PASS row with no fixture record', () => {
  const matrix = readMatrix(MATRIX_PATH);
  const outDir = tempDir();
  const matrixFile = path.join(tempDir(), 'matrix.json');

  // The committed matrix records G6-03a's server-side proof on G6-A07 and G6-A08
  // without moving them off NOT_RUN, and verify has nothing to say about it.
  for (const id of ['G6-A07', 'G6-A08']) {
    const row = matrix.rows.find((candidate) => candidate.id === id);
    assert.equal(row.status, 'NOT_RUN', `${id} stays NOT_RUN on partial evidence`);
    assert.deepEqual(row.evidence, [], `${id} names no evidence record`);
    assert.equal(row.partialEvidence?.[0]?.task, 'G6-03a', `${id} carries G6-03a partial evidence`);
  }
  assert.equal(verify({ outDir }).ok, true, verify({ outDir }).problems.join('; '));

  // The same rows claiming PASS on partial evidence alone have no record on any
  // fixture, so verify refuses them.
  const claimed = structuredClone(matrix);
  for (const id of ['G6-A07', 'G6-A08']) claimed.rows.find((row) => row.id === id).status = 'PASS';
  fs.writeFileSync(matrixFile, JSON.stringify(claimed, null, 2));
  const result = verify({ outDir, matrixPath: matrixFile });
  assert.equal(result.ok, false);
  for (const id of ['G6-A07', 'G6-A08']) {
    assert.ok(result.problems.includes(`row ${id} is PASS without a PASS evidence record`), `${id} cannot pass on partialEvidence`);
  }
});

test('the CLI maps PASS to 0, FAIL to 1 and BLOCKED to the skip code', () => {
  const pass = run([...baseArgs(tempDir()), process.execPath, '-e', 'process.exit(0)']);
  assert.equal(pass.status, 0, pass.stderr);
  const fail = run([...baseArgs(tempDir()), process.execPath, '-e', 'process.exit(4)']);
  assert.equal(fail.status, 1);
  const blocked = run([...baseArgs(tempDir()), process.execPath, '-e', `process.exit(${SKIP_EXIT_CODE})`]);
  assert.equal(blocked.status, SKIP_EXIT_CODE);
  const verifyRun = run(['verify', '--out', tempDir()]);
  assert.equal(verifyRun.status, 0, verifyRun.stderr);
  assert.match(verifyRun.stdout, /evidence verify: OK \(0 records\)/);
  const badArg = run(['run', '--nope']);
  assert.equal(badArg.status, 2);
  assert.match(badArg.stderr, /unknown argument/);
  const badMode = run(['frobnicate']);
  assert.equal(badMode.status, 2);
  assert.match(badMode.stderr, /usage/);
});

test('a FAIL or BLOCKED run echoes the tail of its output to stderr, a PASS stays quiet', () => {
  const script = "console.log('seeding'); console.error('FAILED: seed — POST /api/v1/orgs/x/workspaces -> 403'); process.exit(CODE)";
  const fail = run([...baseArgs(tempDir()), process.execPath, '-e', script.replace('CODE', '1')]);
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /evidence: ev-g5-a01-0001 FAIL; last 2 line\(s\) of /);
  assert.match(fail.stderr, /\| FAILED: seed — POST \/api\/v1\/orgs\/x\/workspaces -> 403/);
  assert.match(fail.stdout, /^\{"evidenceId"/, 'stdout still carries only the record');
  const blocked = run([...baseArgs(tempDir()), process.execPath, '-e', script.replace('CODE', String(SKIP_EXIT_CODE))]);
  assert.equal(blocked.status, SKIP_EXIT_CODE);
  assert.match(blocked.stderr, /BLOCKED; last 2 line/);
  const pass = run([...baseArgs(tempDir()), process.execPath, '-e', script.replace('CODE', '0')]);
  assert.equal(pass.status, 0);
  assert.equal(pass.stderr, '');
});

test('an absolute --out is honoured as given, never nested under the repo', () => {
  const outDir = tempDir();
  assert.ok(path.isAbsolute(outDir));
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
  });
  assert.equal(record.result, 'PASS');
  assert.ok(fs.existsSync(path.join(outDir, 'evidence.jsonl')), 'the ledger lands in the requested out dir');
  const nested = path.join(repoRoot, outDir.slice(1));
  assert.equal(fs.existsSync(nested), false, 'nothing is written under the repo');
  assert.equal(path.isAbsolute(record.artifact), false, 'the ledger records a repo-relative artifact path');
  assert.ok(fs.existsSync(path.join(repoRoot, record.artifact)));
});

test('the fork SHA comes from the environment and is null when the environment does not name it', () => {
  assert.equal(resolveFSha({ OFFICE_FORK_SHA: '  abc123  ' }).sha, 'abc123');
  assert.equal(resolveFSha({}).sha, null);
  assert.equal(resolveFSha({ OFFICE_FORK_DIR: path.join(tmpRoot, 'not-a-repo') }).sha, null);
  const local = resolveFSha({ OFFICE_FORK_DIR: repoRoot });
  assert.equal(local.sha, resolveDSha(), 'a checkout path resolves through git rev-parse HEAD');
  assert.equal(sha256File(path.join(repoRoot, MANIFEST_PATH)).length, 64);
});

test('the matrix the runner reads declares every fixture it needs', () => {
  const matrix = readMatrix(MATRIX_PATH);
  const manifest = readManifest(matrix.fixtureManifest);
  const ids = new Set(manifest.fixtures.map((fixture) => fixture.id));
  for (const row of matrix.rows) {
    for (const reference of row.fixtures) {
      assert.ok(ids.has(reference.id), `${row.id} declares fixture ${reference.id} that the manifest does not have`);
      assert.equal(reference.sha256, manifest.fixtures.find((fixture) => fixture.id === reference.id).sha256);
    }
  }
});
