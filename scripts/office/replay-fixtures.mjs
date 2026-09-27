#!/usr/bin/env node
// G2-01b (UNI-684) - fixture replay gate over the vendored office engine.
//
// For each of the six G0 formats this checks the three things a replay needs -
// fixture bytes that hash to the G0 manifest, the vendored engine source the
// adapter will bind, and the build artifacts build-upstream.mjs must have
// produced - then reports the capability as pass / fail / blocked. A missing
// fixture, missing engine source or missing artifact is a hard error, and a
// capability whose adapter has not landed is BLOCKED with the owning lane
// named: this script never converts skipped work into a pass.
//
//   node scripts/office/replay-fixtures.mjs                       # all formats
//   node scripts/office/replay-fixtures.mjs --formats docx,xlsx   # subset
//   node scripts/office/replay-fixtures.mjs --runtime node        # one runtime
//   node scripts/office/replay-fixtures.mjs --require docx        # docx must pass
//   node scripts/office/replay-fixtures.mjs --json
//
// Exit codes: 0 every selected capability resolved (pass or blocked); 1 a
// capability check failed; 2 a required input (fixture, engine, artifact) is
// absent; 3 a --require'd capability did not report pass.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../office-g0/paths.mjs';
import { UPSTREAM_DIR, PROVENANCE_PATH, RECORD_KIND } from './vendor-upstream.mjs';
import { DEFAULT_OUT } from './build-upstream.mjs';

export const FIXTURE_MANIFEST = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'fixtures', 'manifest.json');
export const FIXTURE_FILES = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'fixtures', 'files');
export const LAB_FIXTURES = path.join(REPO_ROOT, 'lab', 'fixtures');
export const REPORT_KIND = 'uniwork-office-fixture-replay';

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();

/**
 * The capability table. `enginePaths` are vendored source roots the format's
 * adapter binds; `artifacts` are build-upstream outputs under <build>/dist.
 * `lane` names the G2 task whose adapter turns this capability from blocked
 * into executable; until then the honest state is blocked, never pass.
 */
export const CAPABILITIES = {
  docx: {
    formats: ['docx'],
    enginePaths: ['packages/docx-engine'],
    artifacts: ['dist/docx-engine.mjs'],
    lane: 'G2-03',
    runtimes: ['node', 'desktop'],
    executor: 'packages/office-engine/test/replay/g2-03-replay.mjs',
  },
  xlsx: {
    formats: ['xlsx'],
    enginePaths: ['packages/xlsx-gateway', 'apps/sheets/src/main', 'apps/sheets/native/xlsx-engine'],
    artifacts: ['dist/xlsx-gateway.mjs'],
    lane: 'G2-04',
    runtimes: ['node', 'desktop'],
  },
  pptx: {
    formats: ['pptx'],
    enginePaths: ['packages/pptx-engine', 'packages/pptx-ops', 'packages/pptx-render'],
    artifacts: ['dist/pptx-engine.mjs'],
    lane: 'G2-03',
    runtimes: ['node', 'desktop'],
    executor: 'packages/office-engine/test/replay/g2-03-replay.mjs',
  },
  pdf: {
    formats: ['pdf'],
    enginePaths: ['apps/pdf/src/main'],
    artifacts: [],
    lane: 'G2-05',
    runtimes: ['desktop'],
  },
  md: {
    formats: ['md'],
    enginePaths: ['apps/markdown/src/main'],
    artifacts: [],
    lane: 'G2-06',
    runtimes: ['node', 'desktop'],
    executor: 'packages/office-engine/test/replay/g2-06-replay.mjs',
  },
  html: {
    formats: ['html'],
    enginePaths: ['apps/html/src/main', 'packages/html2docx'],
    artifacts: ['dist/html2docx.mjs'],
    lane: 'G2-06',
    runtimes: ['node', 'desktop'],
    executor: 'packages/office-engine/test/replay/g2-06-replay.mjs',
  },
};

export function parseArgs(argv) {
  const out = { formats: null, runtime: 'all', require: [], buildDir: null, evidenceDir: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--formats') out.formats = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--runtime') out.runtime = argv[++i];
    else if (a === '--require') out.require = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--build-dir') out.buildDir = argv[++i];
    else if (a === '--evidence-dir') out.evidenceDir = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

function fixtureForFormat(manifest, format) {
  const hit = (manifest.fixtures || []).find((f) => f.format === format && f.expected && f.expected.result);
  return hit || null;
}

/**
 * The three input classes for one capability. Returns { problems, fixtures }:
 * a non-empty problems list is a missing-input error, not a capability fail.
 */
export function checkInputs({ capability, manifest, buildDir, provenance }) {
  const problems = [];
  const fixtures = [];
  for (const format of capability.formats) {
    const fixture = fixtureForFormat(manifest, format);
    if (!fixture) { problems.push(`no ${format} fixture with an expected result in the G0 manifest`); continue; }
    const abs = path.join(FIXTURE_FILES, fixture.path);
    if (!fs.existsSync(abs)) { problems.push(`fixture ${fixture.id} missing at ${fixture.path}`); continue; }
    const bytes = fs.statSync(abs).size;
    const sha256 = sha256File(abs);
    if (fixture.sha256 && sha256 !== fixture.sha256) problems.push(`fixture ${fixture.id} sha256 mismatch (${sha256.slice(0, 12)} != ${fixture.sha256.slice(0, 12)})`);
    if (fixture.bytes && bytes !== fixture.bytes) problems.push(`fixture ${fixture.id} is ${bytes} bytes, expected ${fixture.bytes}`);
    fixtures.push({ id: fixture.id, path: fixture.path, format, bytes, sha256, expected: fixture.expected.result });
  }
  if (!provenance || provenance.kind !== RECORD_KIND) {
    problems.push('packages/office-upstream/provenance.json is absent or malformed - run vendor-upstream.mjs');
  }
  for (const rel of capability.enginePaths) {
    if (!fs.existsSync(path.join(UPSTREAM_DIR, rel))) problems.push(`engine source ${rel} is not in the vendored tree`);
  }
  // When a build record exists the artifact must hash to what the build
  // recorded: a rebuilt, hand-edited or stale dist file is input drift, not
  // something a replay may silently pass over. No record means existence-only.
  const recordPath = path.join(buildDir, 'build-record.json');
  const record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : null;
  if (record && record.verdict === 'fail') problems.push('build-record.json verdict is fail - the recorded build did not pass');
  for (const rel of capability.artifacts) {
    const abs = path.join(buildDir, rel);
    if (!fs.existsSync(abs)) { problems.push(`build artifact ${rel} is missing - run scripts/office/build-upstream.mjs`); continue; }
    if (record) {
      const entry = (record.artifacts || []).find((a) => a.out === rel);
      if (!entry || entry.status !== 'built') problems.push(`build artifact ${rel} is not recorded as built in build-record.json`);
      else if (sha256File(abs) !== entry.sha256) problems.push(`build artifact ${rel} sha256 drifted from build-record.json - rebuild or investigate`);
    }
  }
  return { problems, fixtures };
}

export function replay({ formats, runtime, require, buildDir, evidenceDir }) {
  const build = path.resolve(buildDir || DEFAULT_OUT);
  const manifest = JSON.parse(fs.readFileSync(FIXTURE_MANIFEST, 'utf8'));
  const provenance = fs.existsSync(PROVENANCE_PATH) ? JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8')) : null;
  const names = formats || Object.keys(CAPABILITIES);
  const report = {
    kind: REPORT_KIND,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime,
    buildDir: path.relative(REPO_ROOT, build),
    capabilities: {},
    summary: { pass: 0, fail: 0, blocked: 0, inputErrors: 0 },
    requiredUnmet: [],
  };
  const outDir = path.resolve(evidenceDir || path.join(REPO_ROOT, '.go-tmp', 'office-fixture-replay'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const capability = CAPABILITIES[name];
    if (!capability) {
      report.capabilities[name] = { status: 'fail', detail: 'unknown capability' };
      report.summary.fail += 1;
      continue;
    }
    if (runtime !== 'all' && !capability.runtimes.includes(runtime)) {
      report.capabilities[name] = { status: 'blocked', lane: capability.lane, detail: `no ${runtime} runtime for this capability` };
      report.summary.blocked += 1;
      continue;
    }
    const { problems, fixtures } = checkInputs({ capability, manifest, buildDir: build, provenance });
    if (problems.length) {
      report.capabilities[name] = { status: 'input-error', problems, fixtures };
      report.summary.inputErrors += 1;
      continue;
    }
    // Inputs verified. When the owning lane shipped an executor, run it and
    // read back its per-format result file; a lane without one stays blocked,
    // never converted into a pass.
    if (capability.executor) {
      const executorPath = path.join(REPO_ROOT, capability.executor);
      if (!fs.existsSync(executorPath)) {
        report.capabilities[name] = { status: 'fail', lane: capability.lane, detail: `executor ${capability.executor} missing`, fixtures };
        report.summary.fail += 1;
        continue;
      }
      const run = spawnSync(
        process.execPath,
        [executorPath, '--build-dir', build, '--format', name, '--fixture', path.join(FIXTURE_FILES, fixtures[0].path), '--out', outDir],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 },
      );
      const resultPath = path.join(outDir, `${name}-result.json`);
      let result = null;
      if (fs.existsSync(resultPath)) {
        try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { result = null; }
      }
      const pass = run.status === 0 && result?.status === 'pass';
      report.capabilities[name] = {
        status: pass ? 'pass' : 'fail',
        lane: capability.lane,
        detail: result?.detail ?? `executor exited ${run.status}: ${(run.stderr || run.stdout || '').trim().slice(0, 300)}`,
        fixtures,
        rows: result?.rows ?? [],
      };
      report.summary[pass ? 'pass' : 'fail'] += 1;
      continue;
    }
    report.capabilities[name] = {
      status: 'blocked',
      lane: capability.lane,
      detail: `engine source and artifacts verified; adapter replay lands with ${capability.lane}`,
      fixtures,
    };
    report.summary.blocked += 1;
  }
  for (const name of require) {
    if (report.capabilities[name]?.status !== 'pass') report.requiredUnmet.push(name);
  }
  const outPath = path.join(outDir, 'replay-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  return { report, outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: replay-fixtures.mjs [--formats a,b] [--runtime all|node|browser|desktop] [--require a,b] [--build-dir dir] [--evidence-dir dir] [--json]');
    return;
  }
  const { report, outPath } = replay(args);
  for (const [name, c] of Object.entries(report.capabilities)) {
    const tag = { pass: 'PASS', fail: 'FAIL', blocked: 'BLOCKED', 'input-error': 'INPUT-ERROR' }[c.status] || c.status;
    console.log(`  ${tag}  ${name}${c.lane ? ' (lane ' + c.lane + ')' : ''}${c.detail ? ' - ' + c.detail : ''}`);
    for (const p of c.problems || []) console.log('         ! ' + p);
  }
  const s = report.summary;
  console.log(`${s.pass} pass / ${s.fail} fail / ${s.blocked} blocked / ${s.inputErrors} input-error`);
  console.log('wrote ' + outPath);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  if (report.summary.inputErrors > 0) process.exit(2);
  if (report.summary.fail > 0) process.exit(1);
  if (report.requiredUnmet.length) { console.error('required but not passing: ' + report.requiredUnmet.join(', ')); process.exit(3); }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });
