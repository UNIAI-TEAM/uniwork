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
  assertLaneTestDatabase,
  classifyResult,
  databaseNameFromUrl,
  laneTestDbPrefix,
  readManifest,
  readMatrix,
  readPin,
  reset,
  resolveDSha,
  resolveFSha,
  runEvidence,
  sha256File,
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
  assert.match(record.pin, /^0\.1\.0-0d03b18$/);
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
  assert.match(unknown.blocker, /is not in/);
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
  assert.throws(() => assertLaneTestDatabase('uniwork_shared'), /not under the lane test prefix|only touch a \*_test/);
  assert.throws(() => assertLaneTestDatabase('postgres'), /not under the lane test prefix/);
  assert.throws(() => assertLaneTestDatabase(''), /no database name/);
  assert.throws(() => assertLaneTestDatabase('dev_uniwork_test', 'lane_'), /not under the lane test prefix lane_/);
  assert.equal(databaseNameFromUrl('postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable'), 'uniwork_x_1_test');
  assert.equal(databaseNameFromUrl('not a url'), null);
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

  const dry = run(['reset', '--dry-run'], { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_x_1_test?sslmode=disable' });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /would drop database uniwork_x_1_test/);
  const refused = run(['reset', '--dry-run'], { TEST_DATABASE_URL: 'postgres://uniwork:uniwork@localhost:5432/uniwork_dev' });
  assert.equal(refused.status, 2, 'a refused reset is an error, not a silent pass');
  assert.match(refused.stderr, /refuses database/);
});

test('verify accepts a clean ledger and rejects a pass without an artifact, a stale hash and a missing blocker', () => {
  const outDir = tempDir();
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-xlsx-revenue-xyz',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
  });
  assert.equal(verify({ outDir }).ok, true);

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

  // A line missing a contract field is a problem.
  delete ledger[0].pin;
  fs.writeFileSync(ledgerFile, `${ledger.map((line) => JSON.stringify(line)).join('\n')}\n`);
  assert.ok(verify({ outDir }).problems.some((problem) => /is missing pin/.test(problem)));
});

test('verify fails a row that claims PASS without a PASS record, and a matrix BLOCKED row without a blocker', () => {
  const matrix = readMatrix(MATRIX_PATH);
  const outDir = tempDir();
  // A ledger line whose fixture the row does not declare cannot carry its PASS.
  const record = runEvidence({
    requirementId: 'G5-A01',
    fixtureId: 'fx-html-page-vi',
    checker: 'tester-cloud',
    command: [process.execPath, '-e', 'process.exit(0)'],
    outDir,
  });
  assert.equal(record.result, 'PASS');
  const ledgerFile = path.join(outDir, 'evidence.jsonl');

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
