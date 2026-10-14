#!/usr/bin/env node
// Evidence runner for the G5/G6/G7 acceptance matrix (UNI-1376 / G7-01 item B).
//
//   node scripts/office/g5g6g7/evidence.mjs run --req G5-A01 --fixture fx-xlsx-revenue-xyz \
//        --checker tester-cloud -- <command...>   run a check and append one evidence line
//   node scripts/office/g5g6g7/evidence.mjs reset [--dry-run]   drop+recreate the lane test DB, clear artifacts
//   node scripts/office/g5g6g7/evidence.mjs verify [--matrix <path>]  re-check the ledger against the matrix
//
// The rule the runner exists for (spec Section 9.1): a run's outcome is PASS
// only when the command exited 0 on a fixture whose bytes still match the
// manifest. A skip, an exit 77, a missing fixture or a drifted hash is BLOCKED
// and never PASS; a command killed by a signal is a FAIL, never a PASS; and
// nothing here rewrites a status by hand.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const MATRIX_PATH = 'docs/office/g5g6g7/acceptance-rows.json';
export const MANIFEST_PATH = 'docs/office/g5g6g7/fixtures/manifest.json';
const PIN_DIR = 'apps/web/platform/office-frame';
const PIN_MODULES = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'];
const DEFAULT_OUT_DIR = 'test-results/office-g5g6g7-evidence';
const LEDGER_NAME = 'evidence.jsonl';

// Exit 77 is the harness convention for "this environment cannot run the check"
// (the C harness exits 77 when the cloud VM lacks xvfb or Electron libs), and a
// line that says the check was skipped is the same statement in text form. The
// word may be `skip`, `skipped` or `skipping` in any case, at the start of a line
// (with optional leading whitespace) or right after a clause boundary ("no xvfb;
// skipping G7-10"), or Playwright's `<n> skipped` count form (`"  2 skipped"`,
// where `<n> >= 1`; `"0 skipped"` is not a skip). The line is read only when the
// command exited 0, so a failure that mentions a skip stays a FAIL. The direction
// is deliberate: a verbose check that says "skip" is BLOCKED, never PASS.
export const SKIP_EXIT_CODE = 77;
const SKIP_LINE =
  /(?:^\s*(?:[#ℹ]\s*)?|[;.]\s+|#\s*)(?:(?:skip|skipped|skipping)\b(?!\s*0\b)|[1-9]\d*\s+skipped\b)/i;

/** Every evidence line carries these fields (spec Section 9.1). */
export const REQUIRED_FIELDS = [
  'evidenceId',
  'requirementId',
  'dSha',
  'fSha',
  'pin',
  'platform',
  'build',
  'fixtureId',
  'fixtureSha256',
  'command',
  'argv',
  'exitCode',
  'result',
  'artifact',
  'checker',
  'blocker',
  'startedAt',
  'finishedAt',
];
const RESULTS = ['PASS', 'FAIL', 'BLOCKED'];

export const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// path.join nests an absolute path under the repo (path.join('/repo', '/tmp/x') is
// '/repo/tmp/x'), so an absolute --out or --artifact is taken as given.
const abs = (rel) => (path.isAbsolute(rel) ? rel : path.join(repoRoot, rel));

export function readMatrix(matrixPath = MATRIX_PATH) {
  return JSON.parse(fs.readFileSync(path.isAbsolute(matrixPath) ? matrixPath : abs(matrixPath), 'utf8'));
}

export function readManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(path.isAbsolute(manifestPath) ? manifestPath : abs(manifestPath), 'utf8'));
}

/** git rev-parse HEAD in the D checkout; a detached or missing repo is an error, not an empty string. */
export function resolveDSha(cwd = repoRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git rev-parse HEAD failed in ${cwd}: ${result.stderr?.trim()}`);
  return result.stdout.trim();
}

/**
 * Fork SHA: OFFICE_FORK_SHA wins (the harness clones the fork itself); else
 * HEAD of the checkout named by OFFICE_FORK_DIR. Null when neither exists,
 * which verify reports as a missing field rather than a silent success.
 */
export function resolveFSha(env = process.env) {
  if (env.OFFICE_FORK_SHA?.trim()) return { sha: env.OFFICE_FORK_SHA.trim(), source: 'OFFICE_FORK_SHA' };
  for (const key of ['OFFICE_FORK_DIR', 'OFFICE_FORK_PATH', 'OFFICE_FORK_CHECKOUT']) {
    const dir = env[key]?.trim();
    if (!dir) continue;
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    if (result.status === 0) return { sha: result.stdout.trim(), source: `${key} ${dir}` };
  }
  return { sha: null, source: null };
}

/** The web frame pin(s) actually served: the distinct `version` of every module pin. */
export function readPin(env = process.env) {
  const dir = env.OFFICE_PIN_DIR?.trim() || PIN_DIR;
  const versions = new Set();
  for (const module of PIN_MODULES) {
    const file = abs(`${dir}/${module}.pin.json`);
    if (!fs.existsSync(file)) continue;
    const pin = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pin.version) versions.add(pin.version);
  }
  return [...versions].join(',');
}

/**
 * 128 + the signal number, the code a shell reports for a command killed by a
 * signal (`SIGKILL` -> 137, `SIGTERM` -> 143); 128 when the name is unknown.
 * A killed command has `status === null`, so it must never be read as a pass.
 */
export function signalExitCode(signal) {
  const number = os.constants?.signals?.[signal];
  return Number.isInteger(number) ? 128 + number : 128;
}

/**
 * The exit code a spawnSync result stands for. A status of null with a signal
 * means the process was killed (128 + signal); a spawn error (a command that
 * does not exist) is 127; a null status with neither is not a success either.
 */
export function exitCodeOf(run) {
  if (typeof run.status === 'number') return run.status;
  if (run.signal) return signalExitCode(run.signal);
  if (run.error) return 127;
  return signalExitCode(null);
}

function platformLabel() {
  return `${process.platform}-${os.arch()}`;
}

/**
 * A non-zero exit is FAIL; 77 is BLOCKED; a SKIP line turns a clean exit into
 * BLOCKED. The skip line is read only after the exit code: a command that failed
 * and printed a line starting with "skip" is a FAIL, so a skip can never mask a
 * genuine failure.
 */
export function classifyResult({ exitCode, output }) {
  if (exitCode === SKIP_EXIT_CODE) return { result: 'BLOCKED', blocker: `command reported skip (exit ${SKIP_EXIT_CODE})` };
  if (exitCode !== 0) return { result: 'FAIL', blocker: null };
  const skipLine = String(output ?? '')
    .split('\n')
    .find((line) => SKIP_LINE.test(line.trim()));
  if (skipLine) return { result: 'BLOCKED', blocker: `command reported skip: ${skipLine.trim()}` };
  return { result: 'PASS', blocker: null };
}

const readLedger = (outDir) => {
  const file = path.join(outDir, LEDGER_NAME);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${file}:${index + 1} is not valid JSON`);
      }
    });
};

function missingFields(record) {
  return REQUIRED_FIELDS.filter((field) => !(field in record));
}

/**
 * Fields that must carry a value: a field that is present but null or blank is
 * as useless as an absent one (an empty `argv` array included). Three fields are exempt because they are
 * legitimately null — `blocker` outside a BLOCKED record, `exitCode` when the
 * command never ran, and `fixtureSha256` for a fixture the manifest does not
 * have (which verify already reports on its own).
 */
const VALUE_FIELDS = REQUIRED_FIELDS.filter((field) => !['blocker', 'exitCode', 'fixtureSha256'].includes(field));

// `argv` is the one array-valued field: an empty array, or anything that is not
// an array, carries no argument vector and is as empty as a blank string (N1).
function isEmptyValue(field, value) {
  if (value === null) return true;
  if (field === 'argv') return !Array.isArray(value) || value.length === 0;
  return typeof value === 'string' && value.trim() === '';
}

function emptyFields(record) {
  return VALUE_FIELDS.filter((field) => field in record && isEmptyValue(field, record[field]));
}

/**
 * Claims an evidence id no other run can take. The ledger count alone is racy:
 * two concurrent runs against one out dir both read the same count and write the
 * same id, and the second overwrites the first's artifact. The id is reserved by
 * creating a lock file exclusively, so the loser moves to the next number.
 */
function reserveEvidenceId(outDir, requirementId) {
  const used = readLedger(outDir).filter((record) => record.requirementId === requirementId).length;
  const lockDir = path.join(outDir, '.locks');
  fs.mkdirSync(lockDir, { recursive: true });
  for (let n = used + 1; n <= used + 1000; n += 1) {
    const evidenceId = `ev-${requirementId.toLowerCase()}-${String(n).padStart(4, '0')}`;
    try {
      fs.closeSync(fs.openSync(path.join(lockDir, evidenceId), 'wx'));
      return evidenceId;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`could not reserve an evidence id for ${requirementId} in ${outDir}`);
}

/**
 * Runs one check and appends exactly one ledger line. The fixture is checked
 * before the command: a missing file or a hash that no longer matches the
 * manifest is BLOCKED and the command is not run at all.
 */
export function runEvidence({
  requirementId,
  fixtureId,
  checker,
  command,
  outDir = abs(DEFAULT_OUT_DIR),
  artifact,
  env = process.env,
  cwd = repoRoot,
  platform,
  build,
  blockerReason,
} = {}) {
  if (!requirementId || !fixtureId || !checker) throw new Error('run needs --req, --fixture and --checker');
  if (!Array.isArray(command) || command.length === 0) throw new Error('run needs a command after --');

  const matrix = readMatrix(env.OFFICE_MATRIX_PATH || MATRIX_PATH);
  const row = matrix.rows.find((candidate) => candidate.id === requirementId);
  if (!row) throw new Error(`requirement ${requirementId} is not a row of ${MATRIX_PATH}`);
  const manifest = readManifest(env.OFFICE_FIXTURE_MANIFEST || matrix.fixtureManifest);
  const fixture = manifest.fixtures.find((candidate) => candidate.id === fixtureId);

  const startedAt = new Date().toISOString();
  const dSha = resolveDSha(cwd);
  const { sha: fSha } = resolveFSha(env);
  const evidenceId = reserveEvidenceId(outDir, requirementId);

  let result = 'BLOCKED';
  let blocker = blockerReason ?? null;
  let exitCode = null;
  let output = '';
  // A run on a fixture the row does not name proves nothing about the row, so it
  // is BLOCKED and the command is not run (R1-13). This is checked before the
  // fixture lookup: an undeclared fixture is refused even if the manifest has it.
  const fixtureDeclared = row.fixtures.some((reference) => reference.id === fixtureId);
  if (!fixtureDeclared) {
    blocker = `fixture ${fixtureId} is not declared by row ${requirementId}`;
    output = blocker;
  } else if (!fixture) {
    blocker = `fixture ${fixtureId} is not in ${MANIFEST_PATH}`;
    output = blocker;
  } else {
    const fixturePath = abs(fixture.path);
    if (!fs.existsSync(fixturePath)) {
      blocker = `fixture ${fixtureId} is missing at ${fixture.path}`;
      output = blocker;
    } else {
      const actual = sha256File(fixturePath);
      if (actual !== fixture.sha256) {
        blocker = `fixture ${fixtureId} hash ${actual} does not match the manifest ${fixture.sha256}`;
        output = blocker;
      }
    }
  }

  if (blocker === null) {
    // A check that prints more than the 1 MiB default makes spawnSync set an
    // ENOBUFS error, which would be read as a spawn failure (R1-15).
    const run = spawnSync(command[0], command.slice(1), {
      cwd,
      encoding: 'utf8',
      env: { ...env, OFFICE_EVIDENCE_ID: evidenceId },
      maxBuffer: 64 * 1024 * 1024,
    });
    exitCode = exitCodeOf(run);
    output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error.message) : ''}`;
    const classified = classifyResult({ exitCode, output });
    result = classified.result;
    blocker = classified.blocker;
  }

  const finishedAt = new Date().toISOString();
  fs.mkdirSync(path.join(outDir, 'artifacts'), { recursive: true });
  const artifactPath = artifact ?? path.join(outDir, 'artifacts', `${evidenceId}.log`);
  fs.writeFileSync(path.isAbsolute(artifactPath) ? artifactPath : abs(artifactPath), `$ ${command.join(' ')}\n\n${output}`);
  const artifactRel = path.relative(repoRoot, path.isAbsolute(artifactPath) ? artifactPath : abs(artifactPath));

  const record = {
    evidenceId,
    requirementId,
    dSha,
    fSha,
    pin: readPin(env),
    platform: platform ?? platformLabel(),
    build: build ?? env.OFFICE_BUILD?.trim() ?? 'dev',
    fixtureId,
    fixtureSha256: fixture ? fixture.sha256 : null,
    // `command` is the readable form; `argv` is the exact argument vector, so an
    // argument with a space or a quote survives the ledger (R1-12).
    command: command.join(' '),
    argv: [...command],
    exitCode,
    result,
    artifact: artifactRel,
    checker,
    blocker,
    startedAt,
    finishedAt,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.appendFileSync(path.join(outDir, LEDGER_NAME), `${JSON.stringify(record)}\n`);
  return record;
}

/**
 * Lane test DB prefix. The default is the org prefix, so on its own it accepts
 * the shared repo test database (`uniwork_test`, the one `make test-go` uses in
 * every checkout); `assertLaneTestDatabase` refuses that name separately, and a
 * lane can narrow the prefix further with OFFICE_LANE_TEST_DB_PREFIX.
 */
export function laneTestDbPrefix(env = process.env) {
  return env.OFFICE_LANE_TEST_DB_PREFIX?.trim() || 'uniwork_';
}

/**
 * A reset may only touch a database that is both inside the lane's prefix and
 * a test database. Anything else (the shared dev DB, a staging URL) is refused.
 */
export function assertLaneTestDatabase(name, prefix = laneTestDbPrefix()) {
  if (!name) throw new Error('reset: no database name; set TEST_DATABASE_URL or DATABASE_URL');
  if (!name.startsWith(prefix)) throw new Error(`reset refuses database ${name}: not under the lane test prefix ${prefix}`);
  if (!name.endsWith('_test')) throw new Error(`reset refuses database ${name}: a reset may only touch a *_test database`);
  // `${prefix}test` is the shared test database of every checkout on this server,
  // not a lane's own: a lane name has a segment between the prefix and `_test`
  // (R1-06).
  if (name === `${prefix}test`) {
    throw new Error(`reset refuses database ${name}: the shared test database is not a lane test database; name the lane, e.g. ${prefix}<lane>_test`);
  }
  return name;
}

export function databaseNameFromUrl(url) {
  if (!url) return null;
  try {
    const name = new URL(url).pathname.replace(/^\//, '');
    try {
      // A URL may percent-encode the name; the DB is named by the decoded text.
      return decodeURIComponent(name);
    } catch {
      return name; // a stray '%' is not an encoding, so keep the raw name
    }
  } catch {
    return null;
  }
}

/** The psql steps reset performs; a dry run prints them instead of running them. */
function resetPlan(env = process.env) {
  const url = env.TEST_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  const name = databaseNameFromUrl(url);
  const database = assertLaneTestDatabase(name, laneTestDbPrefix(env));
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  return [
    { step: `drop database ${database}`, argv: ['psql', adminUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${database}"`] },
    { step: `create database ${database}`, argv: ['psql', adminUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${database}"`] },
    { step: 'clear the evidence out dir', argv: null },
  ];
}

/**
 * reset may only clear the evidence out dir: the default one, or a directory
 * that already holds a ledger (which is what an evidence dir looks like). Any
 * other directory — a home dir, a checkout, a scratch tree — is refused before
 * a single file is removed.
 */
export function assertEvidenceOutDir(outDir) {
  const dir = path.resolve(outDir);
  if (dir === abs(DEFAULT_OUT_DIR)) return dir;
  if (fs.existsSync(path.join(dir, LEDGER_NAME))) return dir;
  throw new Error(`reset refuses --out ${outDir}: not the evidence out dir ${DEFAULT_OUT_DIR} and it holds no ${LEDGER_NAME}`);
}

export function reset({ outDir = abs(DEFAULT_OUT_DIR), env = process.env, dryRun = false } = {}) {
  assertEvidenceOutDir(outDir);
  const plan = resetPlan(env);
  const done = [];
  for (const item of plan) {
    if (item.argv === null) {
      done.push(item.step);
      if (!dryRun) {
        for (const name of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) {
          fs.rmSync(path.join(outDir, name), { recursive: true, force: true });
        }
      }
      continue;
    }
    if (dryRun) {
      done.push(item.step);
      continue;
    }
    const run = spawnSync(item.argv[0], item.argv.slice(1), { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`${item.step} failed: ${run.stderr?.trim() || run.error?.message}`);
    done.push(item.step);
  }
  return { dryRun, steps: done };
}

/**
 * Re-checks the ledger against the matrix and the manifest. It never changes a
 * status: it reports what a reader would find wrong.
 */
export function verify({ outDir = abs(DEFAULT_OUT_DIR), matrixPath = MATRIX_PATH, manifestPath, env = process.env } = {}) {
  const problems = [];
  const matrix = readMatrix(matrixPath);
  const manifest = readManifest(manifestPath ?? matrix.fixtureManifest);
  const fixtures = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]));
  const ledger = readLedger(outDir);
  const byId = new Map();
  for (const [index, record] of ledger.entries()) {
    for (const field of missingFields(record)) problems.push(`line ${index + 1} (${record.evidenceId ?? '?'}) is missing ${field}`);
    for (const field of emptyFields(record)) problems.push(`line ${index + 1} (${record.evidenceId ?? '?'}) has an empty ${field}`);
    if (record.evidenceId) {
      if (byId.has(record.evidenceId)) problems.push(`line ${index + 1} repeats evidence id ${record.evidenceId}`);
      byId.set(record.evidenceId, record);
    }
    if (!RESULTS.includes(record.result)) problems.push(`line ${index + 1} has an unsupported result ${record.result}`);
    const fixture = fixtures.get(record.fixtureId);
    if (!fixture) problems.push(`line ${index + 1} names unknown fixture ${record.fixtureId}`);
    else if (record.fixtureSha256 !== fixture.sha256) problems.push(`line ${index + 1} fixture ${record.fixtureId} hash ${record.fixtureSha256} does not match the manifest`);
    if (record.result === 'PASS') {
      if (!record.artifact || !fs.existsSync(abs(record.artifact))) problems.push(`line ${index + 1} PASS has no artifact on disk`);
      if (record.exitCode !== 0) problems.push(`line ${index + 1} PASS has exit code ${record.exitCode}`);
      if (record.blocker) problems.push(`line ${index + 1} PASS carries a blocker`);
      const row = matrix.rows.find((candidate) => candidate.id === record.requirementId);
      if (!row) problems.push(`line ${index + 1} names requirement ${record.requirementId} that is not a matrix row`);
      else if (!row.fixtures.some((reference) => reference.id === record.fixtureId)) problems.push(`line ${index + 1} PASS used a fixture row ${record.requirementId} does not declare`);
    }
    if (record.result === 'BLOCKED' && !record.blocker) problems.push(`line ${index + 1} BLOCKED has no blocker reason`);
  }
  for (const row of matrix.rows) {
    for (const evidenceId of row.evidence ?? []) {
      if (!byId.has(evidenceId)) problems.push(`row ${row.id} names evidence ${evidenceId} that the ledger does not contain`);
    }
    const records = (row.evidence ?? []).map((id) => byId.get(id)).filter(Boolean);
    if (row.status === 'PASS' && !records.some((record) => record.result === 'PASS')) {
      problems.push(`row ${row.id} is PASS without a PASS evidence record`);
    }
    if (row.status !== 'PASS' && records.some((record) => record.result === 'PASS')) {
      problems.push(`row ${row.id} has a PASS evidence record but is ${row.status}`);
    }
    if (row.status === 'BLOCKED' && !row.blocker?.reason) problems.push(`row ${row.id} is BLOCKED without a blocker reason`);
  }
  return { ok: problems.length === 0, problems, records: ledger.length };
}

function parseArgs(argv) {
  const args = { mode: argv[0], command: [], dryRun: false };
  const separator = argv.indexOf('--');
  const head = separator === -1 ? argv.slice(1) : argv.slice(1, separator);
  args.command = separator === -1 ? [] : argv.slice(separator + 1);
  for (let i = 0; i < head.length; i += 1) {
    const key = head[i];
    if (key === '--dry-run') args.dryRun = true;
    else if (key === '--req') args.requirementId = head[++i];
    else if (key === '--fixture') args.fixtureId = head[++i];
    else if (key === '--checker') args.checker = head[++i];
    else if (key === '--out') args.outDir = abs(head[++i]);
    else if (key === '--artifact') args.artifact = head[++i];
    else if (key === '--platform') args.platform = head[++i];
    else if (key === '--build') args.build = head[++i];
    else if (key === '--blocker') args.blockerReason = head[++i];
    else if (key === '--matrix') args.matrixPath = head[++i];
    else throw new Error(`unknown argument ${key}`);
  }
  return args;
}

/** The last lines of a non-PASS run's artifact, on stderr (the artifact starts with the `$ command` line and a blank one). */
function echoOutputTail(record, maxLines = 40) {
  try {
    const lines = fs.readFileSync(abs(record.artifact), 'utf8').split('\n').slice(2);
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const tail = lines.slice(-maxLines);
    if (tail.length === 0) return;
    process.stderr.write(`evidence: ${record.evidenceId} ${record.result}; last ${tail.length} line(s) of ${record.artifact}:\n${tail.map((line) => `  | ${line}`).join('\n')}\n`);
  } catch {
    // the artifact is only a convenience copy of what the command printed
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const outDir = args.outDir ?? abs(DEFAULT_OUT_DIR);
  if (args.mode === 'run') {
    const record = runEvidence({ ...args, outDir });
    process.stdout.write(`${JSON.stringify(record)}\n`);
    // The artifact holds the command's whole output, but a cloud round log only
    // has what this process prints: for a FAIL or BLOCKED, echo the tail of that
    // output to stderr so the reason (which check, which request) is in the log.
    if (record.result !== 'PASS') echoOutputTail(record);
    return record.result === 'PASS' ? 0 : record.result === 'BLOCKED' ? SKIP_EXIT_CODE : 1;
  }
  if (args.mode === 'reset') {
    const result = reset({ outDir, dryRun: args.dryRun });
    for (const step of result.steps) process.stdout.write(`${result.dryRun ? 'would ' : ''}${step}\n`);
    return 0;
  }
  if (args.mode === 'verify') {
    const result = verify({ outDir, matrixPath: args.matrixPath ?? MATRIX_PATH });
    for (const problem of result.problems) process.stderr.write(`${problem}\n`);
    process.stdout.write(`evidence verify: ${result.ok ? 'OK' : 'FAIL'} (${result.records} records)\n`);
    return result.ok ? 0 : 1;
  }
  process.stderr.write('usage: evidence.mjs run --req <id> --fixture <id> --checker <name> [--out <dir>] -- <command...>\n');
  process.stderr.write('       evidence.mjs reset [--dry-run]\n       evidence.mjs verify [--matrix <path>]\n');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`evidence: ${error.message}\n`);
    process.exitCode = 2;
  }
}
