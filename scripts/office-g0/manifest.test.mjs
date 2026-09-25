import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  validateManifest,
  validateLabRecord,
  selfTestCases,
  renderMatrix,
  sha256File,
  inspectSource,
  readJson,
  pinnedTrackedPaths,
  pinnedFileText,
  holdsPinnedCommit,
} from './verify-manifest.mjs';
import { REPO_ROOT, resolveFixtureRoot, resolveLabRoot, resolveUpstreamSource } from './paths.mjs';
import { planCopy, auditProducedCopy } from './prepare-source.mjs';

const FIXTURE_ROOT = resolveFixtureRoot();
const LAB_ROOT = resolveLabRoot();
/**
 * The source checkout is verified, not required: when it is absent the
 * source-identity test is skipped rather than failed, because that test checks
 * the user's checkout rather than this repository.
 */
const UPSTREAM_SOURCE = resolveUpstreamSource();

const manifest = readJson(path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json'));
const capabilities = readJson(path.join(REPO_ROOT, 'docs/office/g0/capabilities.json'));
const sourceManifest = readJson(path.join(REPO_ROOT, 'docs/office/g0/source-manifest.json'));

const baseInput = (overrides) => Object.assign({
  manifest,
  capabilities,
  sourceManifest,
  upstreamCommit: manifest.upstreamCommit,
  fixtureRoot: FIXTURE_ROOT,
  // The pinned checkout is optional on this machine. When it is present the
  // validator compares the recorded closure and brand inventory against it, so
  // the tests exercise the same path the CLI takes with --source.
  upstreamRoot: fs.existsSync(UPSTREAM_SOURCE) ? UPSTREAM_SOURCE : null,
  checkBytes: true,
}, overrides || {});

test('the real manifest passes validation with checksums checked', () => {
  const failures = validateManifest(baseInput());
  assert.deepEqual(failures, [], failures.join('; '));
});

test('every declared fixture exists on disk with the recorded bytes', () => {
  let checked = 0;
  for (const f of manifest.fixtures) {
    if (f.generation.method === 'pending' || f.sha256 === null) continue;
    const root = f.generation.method === 'lab-large' ? LAB_ROOT : FIXTURE_ROOT;
    const rel = f.generation.method === 'lab-large' ? f.production.labPath : f.path;
    const abs = path.resolve(root, rel);
    assert.ok(fs.existsSync(abs), f.id + ' is missing at ' + abs);
    assert.equal(fs.statSync(abs).size, f.bytes, f.id + ' size');
    assert.equal(sha256File(abs), f.sha256, f.id + ' sha256');
    checked += 1;
  }
  assert.ok(checked >= 50, 'expected most fixtures to be checked, only checked ' + checked);
});

test('fixture ids are unique and every capability row points at a declared fixture', () => {
  const ids = new Set();
  for (const f of manifest.fixtures) {
    assert.ok(!ids.has(f.id), 'duplicate id ' + f.id);
    ids.add(f.id);
  }
  for (const row of capabilities.rows) {
    for (const fid of row.fixtures || []) assert.ok(ids.has(fid), row.id + ' -> ' + fid);
  }
});

test('every fixture references at least one capability and every capability has at least one case', () => {
  for (const f of manifest.fixtures) assert.ok(f.capabilities.length > 0, f.id + ' has no capability');
  const declared = new Map(manifest.fixtures.map((f) => [f.id, f]));
  for (const row of capabilities.rows) {
    const linked = (row.fixtures || []).filter((fid) => declared.has(fid));
    assert.ok(linked.length > 0, row.id + ' has no verification case');
  }
});

test('every fixture is referenced by at least one capability row', () => {
  const referenced = new Set();
  for (const row of capabilities.rows) for (const fid of row.fixtures || []) referenced.add(fid);
  const orphans = manifest.fixtures.map((f) => f.id).filter((id) => !referenced.has(id));
  assert.deepEqual(orphans, [], 'fixtures that no capability row references: ' + orphans.join(', '));
});

test('each fixture lists capabilities that point back at it', () => {
  const byId = new Map(capabilities.rows.map((r) => [r.id, r]));
  const problems = [];
  for (const f of manifest.fixtures) {
    for (const cid of f.capabilities) {
      const row = byId.get(cid);
      if (!row || !(row.fixtures || []).includes(f.id)) problems.push(f.id + ' -> ' + cid);
    }
  }
  assert.deepEqual(problems, [], 'one-way capability links: ' + problems.join(', '));
});

test('no fixture is marked proven; the inventory starts at chưa thử', () => {
  for (const row of capabilities.rows) {
    assert.equal(row.webProven, 'chưa thử', row.id + ' webProven');
    assert.equal(row.desktopProven, 'chưa thử', row.id + ' desktopProven');
  }
  assert.equal(manifest.status, 'chưa thử');
});

test('source is refused when it is not the pinned commit', () => {
  const failures = validateManifest(baseInput({ manifest: Object.assign({}, manifest, { upstreamCommit: '1'.repeat(40) }) }));
  assert.ok(failures.some((f) => /upstreamCommit/.test(f)), failures.join('; '));
});

test('checksums are refused when the file on disk is not the recorded one', () => {
  const mutated = JSON.parse(JSON.stringify(manifest));
  const target = mutated.fixtures.find((f) => f.generation.method === 'generated');
  target.sha256 = 'B'.repeat(64);
  const failures = validateManifest(baseInput({ manifest: mutated }));
  assert.ok(failures.some((f) => new RegExp(target.id + '.*sha256 on disk').test(f)), failures.join('; '));
});

test('a path outside the fixture set is refused', () => {
  for (const badPath of ['../escape.docx', 'C:/elsewhere.docx', 'ee/licensed.docx', 'a/../../b.docx', 'a\\b.docx', '']) {
    const mutated = JSON.parse(JSON.stringify(manifest));
    mutated.fixtures.find((f) => f.generation.method === 'generated').path = badPath;
    const failures = validateManifest(baseInput({ manifest: mutated, checkBytes: false }));
    assert.ok(failures.length > 0, 'path ' + JSON.stringify(badPath) + ' was accepted');
  }
});

test('a fixture without an expected result is refused', () => {
  const mutated = JSON.parse(JSON.stringify(manifest));
  const target = mutated.fixtures.find((f) => f.generation.method === 'generated');
  delete target.expected;
  const failures = validateManifest(baseInput({ manifest: mutated, checkBytes: false }));
  assert.ok(failures.some((f) => /expected.result is required/.test(f)), failures.join('; '));
});

test('a capability claimed as supported without a case is refused', () => {
  const mutated = JSON.parse(JSON.stringify(capabilities));
  const row = mutated.rows.find((r) => r.fixtures && r.fixtures.length > 0);
  row.webProven = 'đạt có bằng chứng';
  row.fixtures = [];
  const failures = validateManifest(baseInput({ capabilities: mutated, checkBytes: false }));
  assert.ok(failures.some((f) => /no verification case/.test(f)), failures.join('; '));
});

test('a lab fixture may not carry a committed checksum', () => {
  const mutated = JSON.parse(JSON.stringify(manifest));
  const lab = mutated.fixtures.find((f) => f.generation.method === 'lab-large');
  lab.sha256 = 'C'.repeat(64);
  lab.bytes = 48234496;
  const failures = validateManifest(baseInput({ manifest: mutated, checkBytes: false }));
  assert.ok(failures.some((f) => /lab fixture must not carry a committed checksum/.test(f)), failures.join('; '));
});

test('a lab fixture must declare where it will live and how large it is', () => {
  for (const field of ['labPath', 'defaultBytes']) {
    const mutated = JSON.parse(JSON.stringify(manifest));
    delete mutated.fixtures.find((f) => f.generation.method === 'lab-large').production[field];
    const failures = validateManifest(baseInput({ manifest: mutated, checkBytes: false }));
    assert.ok(failures.some((f) => /lab fixture must record production\./.test(f)), field + ' -> ' + failures.join('; '));
  }
});

test('a lab record naming an undeclared fixture is refused', () => {
  const record = { kind: 'uniwork-office-lab-fixture-record', fixtures: [{ id: 'F-NOT-DECLARED', labPath: 'fixtures/large/x.docx', bytes: 1, sha256: 'A'.repeat(64) }] };
  const failures = validateLabRecord(record, manifest, LAB_ROOT);
  assert.ok(failures.some((f) => /which the manifest does not declare/.test(f)), failures.join('; '));
});

test('a lab record whose labPath disagrees with the manifest is refused', () => {
  const lab = manifest.fixtures.find((f) => f.generation.method === 'lab-large');
  const record = { kind: 'uniwork-office-lab-fixture-record', fixtures: [{ id: lab.id, labPath: 'fixtures/large/elsewhere.docx', bytes: 1, sha256: 'A'.repeat(64) }] };
  const failures = validateLabRecord(record, manifest, LAB_ROOT);
  assert.ok(failures.some((f) => /labPath disagrees with the manifest/.test(f)), failures.join('; '));
});

test('a lab record whose file is missing is refused', () => {
  const lab = manifest.fixtures.find((f) => f.generation.method === 'lab-large');
  const record = { kind: 'uniwork-office-lab-fixture-record', fixtures: [{ id: lab.id, labPath: lab.production.labPath, bytes: 123, sha256: 'A'.repeat(64) }] };
  const failures = validateLabRecord(record, manifest, path.join(LAB_ROOT, 'definitely-not-here'));
  assert.ok(failures.some((f) => /file is missing/.test(f)), failures.join('; '));
});

test('the recorded package workspace closure is checked against the pinned package.json', { skip: !fs.existsSync(UPSTREAM_SOURCE) }, () => {
  const clean = validateManifest(baseInput({ checkBytes: false }));
  assert.deepEqual(clean, [], clean.join('; '));

  const dropped = JSON.parse(JSON.stringify(sourceManifest));
  const cli = dropped.sourceClosure.packages.find((p) => p.name === '@genoffice/cli');
  cli.runtimeWorkspaceDependencies = cli.runtimeWorkspaceDependencies.filter((n) => n !== '@genoffice/xlsx-gateway');
  const droppedFailures = validateManifest(baseInput({ sourceManifest: dropped, checkBytes: false }));
  assert.ok(droppedFailures.some((f) => /omits workspace runtime dependency @genoffice\/xlsx-gateway/.test(f)), droppedFailures.join('; '));

  const invented = JSON.parse(JSON.stringify(sourceManifest));
  const inventedCli = invented.sourceClosure.packages.find((p) => p.name === '@genoffice/cli');
  inventedCli.runtimeWorkspaceDependencies.push('@genoffice/not-real');
  const inventedFailures = validateManifest(baseInput({ sourceManifest: invented, checkBytes: false }));
  assert.ok(inventedFailures.some((f) => /records workspace runtime dependency @genoffice\/not-real/.test(f)), inventedFailures.join('; '));

  const unrecorded = JSON.parse(JSON.stringify(sourceManifest));
  const unrecordedCli = unrecorded.sourceClosure.packages.find((p) => p.name === '@genoffice/cli');
  delete unrecordedCli.runtimeWorkspaceDependencies;
  const unrecordedFailures = validateManifest(baseInput({ sourceManifest: unrecorded, checkBytes: false }));
  assert.ok(unrecordedFailures.some((f) => /must record runtimeWorkspaceDependencies/.test(f)), unrecordedFailures.join('; '));
});

test('the recorded app runtime closure is checked against the pinned package.json, not read as prose', { skip: !fs.existsSync(UPSTREAM_SOURCE) }, () => {
  const failures = validateManifest(baseInput({ checkBytes: false }));
  assert.deepEqual(failures, [], failures.join('; '));
  const dropped = JSON.parse(JSON.stringify(sourceManifest));
  const docs = dropped.sourceClosure.apps.find((a) => a.path === 'apps/docs');
  docs.runtimeDependencies = docs.runtimeDependencies.filter((d) => d.name !== 'pdf-lib');
  const droppedFailures = validateManifest(baseInput({ sourceManifest: dropped, checkBytes: false }));
  assert.ok(droppedFailures.some((f) => /omits runtime dependency pdf-lib/.test(f)), droppedFailures.join('; '));

  const invented = JSON.parse(JSON.stringify(sourceManifest));
  const inventedDocs = invented.sourceClosure.apps.find((a) => a.path === 'apps/docs');
  inventedDocs.runtimeDependencies.push({ name: 'left-pad', kind: 'third-party' });
  const inventedFailures = validateManifest(baseInput({ sourceManifest: invented, checkBytes: false }));
  assert.ok(inventedFailures.some((f) => /records runtime dependency left-pad which the pinned package.json does not declare/.test(f)), inventedFailures.join('; '));

  const unrecorded = JSON.parse(JSON.stringify(sourceManifest));
  delete unrecorded.sourceClosure.apps[1].runtimeDependencies;
  const unrecordedFailures = validateManifest(baseInput({ sourceManifest: unrecorded, checkBytes: false }));
  assert.ok(unrecordedFailures.some((f) => /must record runtimeDependencies/.test(f)), unrecordedFailures.join('; '));
});

test('pin-anchored reads use the pinned commit object, not a drifted HEAD', () => {
  // Review r2 N1: pin-anchored checks used to resolve paths and package.json from
  // whatever HEAD happened to be, so a checkout that moved past the pin could make
  // an evidence path resolve that does not exist at the pin. These helpers read the
  // pinned commit through git, which is what the validator now binds to.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'uniwork-g0-drift-'));
  const git = (args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']);
    fs.writeFileSync(path.join(repo, 'at-pin.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(repo, 'app-package.json'), JSON.stringify({ name: 'p', dependencies: { keep: '1.0.0' } }));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'pin']);
    const pin = git(['rev-parse', 'HEAD']);
    // Drift past the pin and edit a pinned file in the same commit.
    fs.writeFileSync(path.join(repo, 'after-pin.ts'), 'export const y = 2;\n');
    fs.writeFileSync(path.join(repo, 'app-package.json'), JSON.stringify({ name: 'p', dependencies: { keep: '1.0.0', added: '2.0.0' } }));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'drift']);
    const head = git(['rev-parse', 'HEAD']);
    assert.notEqual(head, pin, 'the test repository must have drifted past the pin');

    const atPin = pinnedTrackedPaths(repo, pin);
    assert.ok(atPin.includes('at-pin.ts'), 'the pin path must resolve at the pin');
    assert.ok(!atPin.includes('after-pin.ts'), 'a file added after the pin must not resolve at the pin');
    assert.ok(pinnedTrackedPaths(repo, head).includes('after-pin.ts'), 'the drift commit does hold the new file');

    const pinnedPkg = JSON.parse(pinnedFileText(repo, pin, 'app-package.json'));
    assert.deepEqual(Object.keys(pinnedPkg.dependencies), ['keep'], 'the pinned package.json must be the pinned bytes, not the edited worktree copy');
    assert.ok(Object.keys(JSON.parse(pinnedFileText(repo, head, 'app-package.json')).dependencies).includes('added'));

    assert.equal(holdsPinnedCommit(repo, pin), true, 'the checkout holds the pin');
    assert.equal(holdsPinnedCommit(repo, '0'.repeat(40)), false, 'an unknown commit is not held');
    assert.deepEqual(pinnedTrackedPaths(repo, '0'.repeat(40)), [], 'an unknown commit degrades to empty, never to HEAD');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a capability that cites a path missing from the pin is refused', { skip: !fs.existsSync(UPSTREAM_SOURCE) }, () => {
  const mutated = JSON.parse(JSON.stringify(capabilities));
  const row = mutated.rows.find((r) => r.mustPort);
  row.evidence = ['apps/docs/tests/pagination-corpus/docx/visual-captable-*.docx'];
  const failures = validateManifest(baseInput({ capabilities: mutated, checkBytes: false }));
  assert.ok(failures.some((f) => /row docx-open cites evidence path .* whose glob matches no tracked file at the pinned checkout/.test(f)), failures.join('; '));

  // A prose entry, and an evidence entry that names a fixture rather than an
  // upstream path, must not trip the gate.
  const prose = JSON.parse(JSON.stringify(capabilities));
  const proseRow = prose.rows.find((r) => r.mustPort);
  proseRow.evidence = ['apps/shell/src/main/index.ts DOCX_RE routing'];
  assert.deepEqual(validateManifest(baseInput({ capabilities: prose, checkBytes: false })), []);
});

test('the real lab record agrees with the manifest when it exists on this machine', { skip: !fs.existsSync(path.join(LAB_ROOT, 'fixtures/large/lab-record.json')) }, () => {
  const record = readJson(path.join(LAB_ROOT, 'fixtures/large/lab-record.json'));
  assert.deepEqual(validateLabRecord(record, manifest, LAB_ROOT), []);
});
test('a lab record generated far below the declared Q9 band is refused', () => {
  const lab = manifest.fixtures.find((f) => f.generation.method === 'lab-large');
  const record = {
    kind: 'uniwork-office-lab-fixture-record',
    requestBytes: 150000,
    fixtures: [{ id: lab.id, labPath: lab.production.labPath, bytes: 6238, sha256: 'A'.repeat(64), requestBytes: 150000 }],
  };
  const failures = validateLabRecord(record, manifest, path.join(LAB_ROOT, 'definitely-not-here'));
  assert.ok(failures.some((f) => /below 80% of the .* default/.test(f)), failures.join('; '));
});

test('a lab record with no recorded generation size is refused', () => {
  const lab = manifest.fixtures.find((f) => f.generation.method === 'lab-large');
  const record = {
    kind: 'uniwork-office-lab-fixture-record',
    fixtures: [{ id: lab.id, labPath: lab.production.labPath, bytes: 6238, sha256: 'A'.repeat(64) }],
  };
  const failures = validateLabRecord(record, manifest, path.join(LAB_ROOT, 'definitely-not-here'));
  assert.ok(failures.some((f) => /must record the requestBytes/.test(f)), failures.join('; '));
});

test('a lab record generated at the declared Q9 band is accepted on the band check', () => {
  const lab = manifest.fixtures.find((f) => f.generation.method === 'lab-large');
  const record = {
    kind: 'uniwork-office-lab-fixture-record',
    fixtures: [{ id: lab.id, labPath: lab.production.labPath, bytes: 362178, sha256: 'A'.repeat(64), requestBytes: lab.production.defaultBytes }],
  };
  const failures = validateLabRecord(record, manifest, path.join(LAB_ROOT, 'definitely-not-here'));
  assert.ok(!failures.some((f) => /below 80%|must record the requestBytes/.test(f)), failures.join('; '));
});

test('the capability matrix is the rendering of the current data, not a stale copy', () => {
  const matrixPath = path.join(REPO_ROOT, 'docs/office/g0/capability-matrix.md');
  const expected = renderMatrix(manifest, capabilities, '2026-09-16');
  const actual = fs.readFileSync(matrixPath, 'utf8');
  assert.equal(actual, expected, 'run: node scripts/office-g0/verify-manifest.mjs --write-matrix');
});

test('the matrix keeps every status cell at chưa thử', () => {
  const matrix = fs.readFileSync(path.join(REPO_ROOT, 'docs/office/g0/capability-matrix.md'), 'utf8');
  assert.ok(!/\|\s*đạt có bằng chứng\s*\|/.test(matrix), 'the matrix must not claim a proven result');
  assert.ok(matrix.includes('chưa thử'));
});

test('the licence bundle ships with the copied fixtures and matches its record', () => {
  assert.ok(manifest.licenseBundle, 'licenseBundle is required');
  for (const entry of manifest.licenseBundle.files) {
    const abs = path.join(REPO_ROOT, manifest.licenseBundle.path, entry.file);
    assert.ok(fs.existsSync(abs), entry.file + ' is missing');
    assert.equal(sha256File(abs), entry.sha256, entry.file + ' sha256');
  }
  assert.ok(manifest.licenseBundle.files.some((e) => e.file === 'LICENSE.txt'));
  assert.ok(manifest.licenseBundle.files.some((e) => e.file === 'NOTICE.txt'));
});

test('every copied fixture names a licence or a third-party notice', () => {
  for (const f of manifest.fixtures.filter((x) => x.source.kind === 'upstream-copy')) {
    assert.ok(f.source.thirdPartyNotice || /Apache-2\.0/.test(f.license || ''), f.id + ' has neither a notice nor an Apache-2.0 licence');
  }
});

test('a licence bundle entry with a wrong checksum is refused', () => {
  const mutated = JSON.parse(JSON.stringify(manifest));
  mutated.licenseBundle.files[0].sha256 = 'A'.repeat(64);
  const failures = validateManifest(baseInput({ manifest: mutated, checkBytes: false }));
  assert.ok(failures.some((f) => /licenseBundle file .* does not match its recorded sha256/.test(f)), failures.join('; '));
});

test('the trial source plan refuses the ee/ tree, node_modules, target/ and environment files', () => {
  // The plan is built from the pinned tree's tracked paths, so this list stands
  // in for it. The allowlist below is deliberately permissive: even when a
  // directory is named, the refusal rules keep the excluded paths out.
  const tracked = ['apps/docs/index.ts', 'docs/readme.md', 'ee/LICENSE', 'node_modules/left-pad/index.js', 'apps/sheets/target/debug/x', 'apps/docs/.env', 'apps/pdf/.env.local'];
  const plan = planCopy(tracked, { include: ['apps', 'docs', 'ee', 'node_modules'], neverCopy: ['node_modules', '**/target', '**/.env*'] });
  const kept = plan.files;
  assert.ok(kept.includes('apps/docs/index.ts'), 'a normal source file must be kept');
  assert.ok(!kept.some((f) => f.startsWith('ee/')), 'ee/ must never be planned: ' + kept.join(', '));
  assert.ok(!kept.some((f) => f.includes('node_modules')), 'node_modules must never be planned');
  assert.ok(!kept.some((f) => path.basename(f).startsWith('.env')), 'environment files must never be planned');
  assert.ok(!kept.some((f) => f.includes('target')), 'Rust target directories must never be planned');
  assert.ok(plan.refused.some((r) => r.path === 'ee/LICENSE'), 'the ee entry must be refused explicitly');
});

test('a produced copy audit flags an ee/ directory, node_modules and an environment file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uniwork-g0-audit-'));
  try {
    fs.mkdirSync(path.join(root, 'apps/docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/docs/index.ts'), 'x');
    assert.deepEqual(auditProducedCopy(root), [], 'a clean copy must pass its own audit');

    fs.mkdirSync(path.join(root, 'ee'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ee/LICENSE'), 'x');
    assert.ok(auditProducedCopy(root).some((p) => /ee\//.test(p)), 'an ee/ path must be flagged');
    fs.rmSync(path.join(root, 'ee'), { recursive: true, force: true });

    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
    assert.ok(auditProducedCopy(root).some((p) => /environment file/.test(p)), 'an environment file must be flagged');
    fs.rmSync(path.join(root, '.env'));

    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    assert.ok(auditProducedCopy(root).some((p) => /node_modules/.test(p)), 'a root node_modules must be flagged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an allowlist that mentions ee/ is refused', () => {
  const mutated = JSON.parse(JSON.stringify(sourceManifest));
  mutated.allowlist.include.push('ee');
  const failures = validateManifest(baseInput({ sourceManifest: mutated, checkBytes: false }));
  assert.ok(failures.some((f) => /never contain ee/.test(f)), failures.join('; '));
});

test('inspectSource reports the pinned commit and tree when the checkout is present', { skip: !fs.existsSync(UPSTREAM_SOURCE) }, () => {
  const state = inspectSource(UPSTREAM_SOURCE);
  assert.equal(state.commit, manifest.upstreamCommit);
  assert.equal(state.tree, sourceManifest.upstream.pinnedTree);
  assert.equal(state.status, '', 'the source checkout must be clean');
});

test('the negative self-test cases are all rejected and the control passes', () => {
  const sample = manifest.fixtures.find((f) => f.generation.method === 'generated');
  const cases = selfTestCases(manifest, capabilities, sourceManifest, manifest.upstreamCommit, sample.bytes);
  let negatives = 0;
  for (const c of cases) {
    const input = c.mutate({
      manifest: JSON.parse(JSON.stringify(manifest)),
      capabilities: JSON.parse(JSON.stringify(capabilities)),
      sourceManifest: JSON.parse(JSON.stringify(sourceManifest)),
      upstreamCommit: manifest.upstreamCommit,
      fixtureRoot: FIXTURE_ROOT,
      checkBytes: c.checkBytes === true,
    });
    const failures = validateManifest(input);
    if (c.expectRejected) {
      negatives += 1;
      assert.ok(failures.length > 0, 'mutant was accepted: ' + c.name);
    } else {
      assert.deepEqual(failures, [], 'control was rejected: ' + c.name + ' -> ' + failures.join('; '));
    }
  }
  assert.ok(negatives >= 20, 'expected at least 20 negative cases, found ' + negatives);
});
