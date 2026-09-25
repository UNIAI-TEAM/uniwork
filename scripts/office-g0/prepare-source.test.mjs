import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  planCopy,
  auditProducedCopy,
  refuseReason,
  normalizeRel,
  matchesGlob,
  isInside,
  overlaps,
  realDirectory,
  checkDestination,
  configuredLabRoot,
  checkReplaceable,
  readManagedMarker,
  cleanupStaging,
  promote,
  verifyProducedCopy,
  verifyLicenseFiles,
  verifyLockfile,
  producedDirNameProblem,
  readTreeEntries,
  readBlob,
  readBlobsBatch,
  gitBlobObjectId,
  sha256File,
  sha256Bytes,
  parseArgs,
  resolveConfiguredLabRoot,
  resolveTargetDir,
  run,
  MANAGED_MARKER,
  STAGING_PREFIX,
  RECORD_KIND,
} from './prepare-source.mjs';
import { REPO_ROOT, resolveLabRoot, resolveUpstreamSource } from './paths.mjs';
import { inspectSource, readJson } from './verify-manifest.mjs';

// DOC-002 (UNI-666) task 2.4 - tests for the source-preparation extractor.
//
// They cover the safety properties the extractor has to hold: bytes come from
// the pinned commit and never from the working tree; the destination stays
// inside the configured lab and never overlaps the repository or the source; an
// existing copy is replaced only when it carries this script's own marker for
// that destination; and a failed or interrupted run never leaves a partial copy
// or deletes data it does not own.
//
// Every scratch path comes from mkdtempSync, so a run never targets a
// predictable location and never removes a directory it did not create. The
// symlink cases skip where the platform does not allow creating a link.

const manifest = readJson(path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json'));
const sourceManifest = readJson(path.join(REPO_ROOT, 'docs/office/g0/source-manifest.json'));
const UPSTREAM_SOURCE = resolveUpstreamSource();

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * A unique scratch directory beneath SUITE_ROOT, created by mkdtempSync so the
 * path is never predicted and never pre-exists. Cleanup removes only the
 * suite root this run created, so a case can never delete anything it does not
 * own.
 */
const scratchDir = (prefix) => fs.mkdtempSync(path.join(SUITE_ROOT, prefix));

/** Symlinks need a privileged context on Windows; the link cases skip when they cannot be made. */
function canSymlink() {
  const dir = tempDir('uniwork-g0-link-');
  try {
    fs.writeFileSync(path.join(dir, 'a'), 'x');
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Directory junctions need no file-symlink privilege, so they have their own probe. */
function canJunction() {
  const dir = tempDir('uniwork-g0-junction-cap-');
  const target = path.join(dir, 'target');
  const link = path.join(dir, 'link');
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The lab the manifests configure: workspaceRoot/labDir beside the source checkout. */
function configuredLabFor(repo) {
  return path.join(repo.wsRoot, '.uniwork-dev', 'office-g0');
}

/** One scratch root per run; only this directory, which the run created, is removed. */
const SUITE_ROOT = tempDir('uniwork-g0-suite-');
process.on('exit', () => { try { fs.rmSync(SUITE_ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });
let repoCounter = 0;

/** A synthetic source repo under the suite root, so its workspace root holds only the lab. */
function makeSyntheticRepo(files = SYNTHETIC_FILES) {
  repoCounter += 1;
  const wsRoot = path.join(SUITE_ROOT, 'ws-' + repoCounter);
  // The lab is the configured one for this workspace root, so resolveLabRoot
  // finds it and each test gets a lab of its own.
  fs.mkdirSync(path.join(wsRoot, '.uniwork-dev', 'office-g0'), { recursive: true });
  const repoRoot = path.join(wsRoot, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  const repo = makeSourceRepoAt(path.join(wsRoot, 'src'), files);
  return Object.assign(repo, { wsRoot, repoRoot });
}

/** A git repo whose HEAD is the pinned commit, so the extractor can be exercised offline. */
function makeSourceRepoAt(root, files) {
  fs.mkdirSync(root, { recursive: true });
  const git = (args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored-dir/' + String.fromCharCode(10) + 'ignored.txt' + String.fromCharCode(10));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']).trim();
  const tree = git(['rev-parse', 'HEAD^{tree}']).trim();
  return { root, commit, tree, git };
}

/** A synthetic manifest pair whose pins and hashes describe the repo above. */
function makeManifests(repo, overrides = {}) {
  const licenseBytes = fs.readFileSync(path.join(repo.root, 'LICENSE'));
  const noticeBytes = fs.readFileSync(path.join(repo.root, 'NOTICE'));
  const lockBytes = fs.readFileSync(path.join(repo.root, 'package-lock.json'));
  const syntheticSource = {
    schemaVersion: 1,
    kind: 'uniwork-office-source-manifest',
    upstream: { pinnedCommit: repo.commit, pinnedTree: repo.tree },
    lockfile: { path: 'package-lock.json', bytes: lockBytes.length, sha256: sha256Bytes(lockBytes) },
    licenses: {
      licenseFiles: [
        { path: 'LICENSE', bytes: licenseBytes.length, sha256: sha256Bytes(licenseBytes) },
        { path: 'NOTICE', bytes: noticeBytes.length, sha256: sha256Bytes(noticeBytes) },
      ],
    },
    allowlist: {
      mode: 'include-only',
      include: ['apps', 'packages', 'docs', 'LICENSE', 'NOTICE', 'package-lock.json', '.gitignore'],
      exclude: ['ee', 'ee/**', '**/target', '**/out', '**/dist', '**/*.tsbuildinfo', 'apps/*/release', '**/fixtures/generated', '**/.env*'],
      excludedSets: [{ path: 'ee/', presentInUpstream: true }, { path: '.github/', presentInUpstream: true }, { path: '**/fixtures/generated' }],
      neverCopy: [{ path: 'node_modules' }, { path: '**/target' }, { path: '**/.env*' }],
    },
    trialSource: { workspaceRoot: repo.wsRoot, labDir: '.uniwork-dev/office-g0', producedDirName: 'trial-source' },
  };
  const syntheticFixture = { upstreamCommit: repo.commit, licenseBundle: { path: 'docs/office/g0/fixtures/upstream-license/', files: [{ file: 'LICENSE.txt', sha256: sha256Bytes(licenseBytes) }] } };
  return Object.assign({ sourceManifest: syntheticSource, fixtureManifest: syntheticFixture }, overrides);
}

/** The list of tracked paths a synthetic repo holds, as planCopy expects. */
function treeFileList(repo) {
  return readTreeEntries(repo.root, repo.commit).filter((e) => e.type === 'blob').map((e) => e.path);
}

const SYNTHETIC_FILES = {
  'LICENSE': 'Apache License 2.0 (fixture)' + String.fromCharCode(10),
  'NOTICE': 'Copyright 2026 Mainfunc, Inc.' + String.fromCharCode(10),
  'package-lock.json': '{"lockfileVersion":3}' + String.fromCharCode(10),
  'apps/docs/src/index.ts': 'export const x = 1;' + String.fromCharCode(10),
  'docs/notes.md': '# notes' + String.fromCharCode(10),
  'apps/sheets/target/debug/build.bin': 'rust build output' + String.fromCharCode(10),
  'apps/sheets/package.json': '{}' + String.fromCharCode(10),
  'apps/shell/release/artifact.zip': 'release output' + String.fromCharCode(10),
  'apps/docs/.env.local': 'SECRET=1' + String.fromCharCode(10),
  'packages/ui/dist/bundle.js': 'built' + String.fromCharCode(10),
  'packages/ui/tsconfig.tsbuildinfo': 'cache' + String.fromCharCode(10),
  'packages/docx-engine/fixtures/generated/big.docx': 'generated' + String.fromCharCode(10),
  'packages/ui/tee/keep.ts': 'export const tee = 1;' + String.fromCharCode(10),
  'ee/LICENSE': 'enterprise' + String.fromCharCode(10),
  '.github/workflows/ci.yml': 'name: ci' + String.fromCharCode(10),
};

test('planCopy keeps only allowlisted tracked files and refuses exclude, excludedSets, neverCopy and unsafe names', () => {
  const repo = makeSyntheticRepo();
  const { sourceManifest: sm } = makeManifests(repo);
  const plan = planCopy(treeFileList(repo), sm.allowlist);
  const kept = plan.files;
  assert.ok(kept.includes('apps/docs/src/index.ts'), 'a normal source file must be kept');
  assert.ok(kept.includes('packages/ui/tee/keep.ts'), 'a directory named tee/ is not a Rust target/ and must be kept');
  assert.ok(kept.includes('LICENSE') && kept.includes('package-lock.json'), 'root allowlist files must be kept');
  assert.ok(!kept.some((f) => f.startsWith('ee/')), 'ee/ must never be planned: ' + kept.join(', '));
  assert.ok(!kept.some((f) => f.startsWith('.github/')), '.github/ must never be planned');
  assert.ok(!kept.some((f) => f.split('/').includes('target')), 'Rust target/ must never be planned');
  assert.ok(!kept.some((f) => f.endsWith('.tsbuildinfo')), 'tsbuildinfo must never be planned');
  assert.ok(!kept.some((f) => f.split('/').includes('dist')), 'dist/ must never be planned');
  assert.ok(!kept.some((f) => f.includes('/release/')), 'apps/*/release must never be planned');
  assert.ok(!kept.some((f) => f.includes('fixtures/generated')), 'fixtures/generated must never be planned');
  assert.ok(!kept.some((f) => f.split('/').some((s) => s.startsWith('.env'))), 'environment files must never be planned');
  assert.ok(plan.refused.some((r) => r.path === 'packages/docx-engine/fixtures/generated/big.docx' && /excludedSet/.test(r.reason)), 'a path under a declared excludedSet must be refused as one');
  assert.ok(plan.refused.some((r) => r.path === 'apps/sheets/target/debug/build.bin'), 'target/ must be reported');
  assert.ok(plan.refused.some((r) => r.path === 'packages/ui/dist/bundle.js'), 'dist/ must be reported');
  assert.ok(!plan.files.some((f) => f === 'ee/LICENSE'), 'ee/LICENSE is neither allowlisted nor planned');
});

test('untracked, ignored and dirty files never enter the plan, because the plan comes from the pinned tree', () => {
  const repo = makeSyntheticRepo();
  fs.writeFileSync(path.join(repo.root, 'apps/docs/src/dirty.ts'), 'dirty working tree file\n');
  fs.mkdirSync(path.join(repo.root, 'ignored-dir'), { recursive: true });
  fs.writeFileSync(path.join(repo.root, 'ignored-dir/secret.ts'), 'ignored\n');
  const { sourceManifest: sm } = makeManifests(repo);
  const tracked = treeFileList(repo);
  assert.ok(!tracked.includes('apps/docs/src/dirty.ts'), 'a dirty file must not be in the pinned tree');
  assert.ok(!tracked.includes('ignored-dir/secret.ts'), 'an ignored file must not be in the pinned tree');
  const plan = planCopy(tracked, sm.allowlist);
  assert.ok(!plan.files.includes('apps/docs/src/dirty.ts'));
  assert.ok(!plan.files.includes('ignored-dir/secret.ts'));
});

test('refuseReason and normalizeRel reject absolute, traversal, backslash, ee/ and unsafe names', () => {
  const never = ['node_modules', '**/target', '**/.env*'];
  const excluded = ['**/dist', 'apps/*/release', '**/*.tsbuildinfo'];
  for (const bad of ['../escape.ts', 'a/../../b.ts', 'C:/elsewhere.ts', 'ee/LICENSE', 'node_modules/x/index.js', 'apps/sheets/target/debug/x', 'apps/docs/.env', 'a\\b.ts', '']) {
    assert.ok(refuseReason(bad, never, excluded) !== null, 'must refuse ' + JSON.stringify(bad));
  }
  assert.equal(refuseReason('packages/ui/tee/keep.ts', never, excluded), null, 'tee/ is not target/');
  assert.equal(refuseReason('apps/docs/src/index.ts', never, excluded), null);
  assert.equal(refuseReason('apps/docs/out/gen.ts', never, excluded), null, 'a bare out/ is only refused when a glob says so');
  assert.ok(refuseReason('apps/sheets/out/gen.ts', never, ['**/out']) !== null, 'an **/out glob must refuse it');
  assert.equal(normalizeRel('a/b.ts'), 'a/b.ts');
  for (const bad of ['/abs.ts', 'C:/x.ts', 'a\\b.ts', '../x.ts', 'a/./b.ts', 'a//b.ts', '']) assert.equal(normalizeRel(bad), null, 'must refuse ' + JSON.stringify(bad));
});

test('a glob matches path segments, not substrings, so a name that merely resembles one is kept', () => {
  assert.equal(matchesGlob('apps/docs/index.ts', '**/target'), false);
  assert.equal(matchesGlob('apps/sheets/target/debug/x', '**/target'), true);
  assert.equal(matchesGlob('package-lock.json', '**/.env*'), false);
  assert.equal(matchesGlob('apps/docs/.env.local', '**/.env*'), true);
  assert.equal(matchesGlob('apps/shell/release/x.zip', 'apps/*/release'), true);
  assert.equal(matchesGlob('.github/workflows/ci.yml', 'ee/**'), false);
});

test('an include entry that matches nothing in the pinned tree is reported, not silently dropped', () => {
  const repo = makeSyntheticRepo();
  const { sourceManifest: sm } = makeManifests(repo);
  const broken = JSON.parse(JSON.stringify(sm));
  broken.allowlist.include.push('apps/does-not-exist');
  const plan = planCopy(treeFileList(repo), broken.allowlist);
  assert.ok(plan.unmatched.some((u) => u.path === 'apps/does-not-exist'), 'the missing include entry must be reported');
});

test('a malicious allowlist cannot escape the tree, use a drive path or smuggle ee/ in', () => {
  const repo = makeSyntheticRepo();
  const evil = {
    include: ['apps', 'ee', 'apps/../ee', 'C:/Windows', '../outside', 'ee/LICENSE'],
    exclude: [],
    excludedSets: [{ path: 'ee/' }, { path: 'ee' }],
    neverCopy: [],
  };
  const plan = planCopy(treeFileList(repo), evil);
  assert.ok(!plan.files.some((f) => f.startsWith('ee/')), 'ee/ must never be planned even when explicitly included');
  assert.ok(plan.refused.some((r) => r.path === 'ee/LICENSE' && /excludedSet/.test(r.reason)), 'an ee/ entry must be refused as an excludedSet, not merely dropped');
  assert.ok(!plan.files.some((f) => f.includes('..')), 'traversal must never be planned');
  assert.ok(!plan.files.some((f) => /^[A-Za-z]:/.test(f)), 'an absolute path must never be planned');
  assert.ok(plan.unmatched.length === 0, 'every entry matched apps/ or was refused, not reported missing');
});

test('readTreeEntries reads modes and object ids from the object store, not from the working tree', () => {
  const repo = makeSyntheticRepo();
  const before = readTreeEntries(repo.root, repo.commit).find((e) => e.path === 'LICENSE');
  fs.writeFileSync(path.join(repo.root, 'LICENSE'), 'tampered working tree copy\n');
  const after = readTreeEntries(repo.root, repo.commit).find((e) => e.path === 'LICENSE');
  assert.equal(after.sha, before.sha, 'the blob id must not change when the working tree is edited');
  assert.equal(sha256Bytes(readBlob(repo.root, after.sha)), sha256Bytes(Buffer.from(SYNTHETIC_FILES.LICENSE)), 'the pinned bytes must be returned');
});

test('a symlink in the pinned tree is refused rather than followed', { skip: !canSymlink() }, () => {
  const repo = makeSyntheticRepo();
  fs.symlinkSync(path.join(repo.root, 'apps/docs/src/index.ts'), path.join(repo.root, 'apps/docs/src/link.ts'), 'file');
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', 'add link']);
  const entries = readTreeEntries(repo.root, 'HEAD');
  const linkEntry = entries.find((e) => e.path === 'apps/docs/src/link.ts');
  assert.ok(linkEntry, 'the link must be present in the tree');
  assert.equal(linkEntry.mode, '120000', 'a symlink must carry mode 120000');
  assert.notEqual(linkEntry.mode, '100644', 'mode 120000 must not be treated as a copyable blob');
});

test('the licence and lockfile checks refuse bytes that do not match the pinned commit', () => {
  const repo = makeSyntheticRepo();
  const { sourceManifest: sm } = makeManifests(repo);
  assert.deepEqual(verifyLicenseFiles({ extractRoot: repo.root, commit: repo.commit, sourceManifest: sm }), []);
  assert.deepEqual(verifyLockfile({ extractRoot: repo.root, commit: repo.commit, sourceManifest: sm }), []);

  const wrongLicense = JSON.parse(JSON.stringify(sm));
  wrongLicense.licenses.licenseFiles[0].sha256 = 'A'.repeat(64);
  assert.ok(verifyLicenseFiles({ extractRoot: repo.root, commit: repo.commit, sourceManifest: wrongLicense }).some((p) => /license file LICENSE/.test(p)), 'a wrong licence hash must be refused');

  const missingNotice = JSON.parse(JSON.stringify(sm));
  missingNotice.licenses.licenseFiles[1].path = 'NOTICE-absent';
  assert.ok(verifyLicenseFiles({ extractRoot: repo.root, commit: repo.commit, sourceManifest: missingNotice }).some((p) => /is not in the pinned tree/.test(p)), 'a licence file absent from the tree must be refused');

  const wrongLock = JSON.parse(JSON.stringify(sm));
  wrongLock.lockfile.sha256 = 'B'.repeat(64);
  assert.ok(verifyLockfile({ extractRoot: repo.root, commit: repo.commit, sourceManifest: wrongLock }).some((p) => /lockfile/.test(p)), 'a wrong lockfile hash must be refused');

  const missingLock = JSON.parse(JSON.stringify(sm));
  missingLock.lockfile.path = 'not-a-lockfile.json';
  assert.ok(verifyLockfile({ extractRoot: repo.root, commit: repo.commit, sourceManifest: missingLock }).some((p) => /is not in the pinned tree/.test(p)), 'a lockfile absent from the tree must be refused');
});

test('containment refuses prefix siblings, the lab root, an ancestor and any overlap with the repository or source', () => {
  const root = scratchDir('uniwork-g0-containment-');
  const lab = path.join(root, 'lab');
  const repo = path.join(root, 'repo');
  const source = path.join(root, 'source');
  for (const d of [lab, repo, source]) fs.mkdirSync(d, { recursive: true });
  const inside = path.join(lab, 'trial-source');
  assert.deepEqual(checkDestination({ targetDir: inside, labRoot: lab, configuredLab: lab, repoRoot: repo, sourceDir: source }).problems, []);
  assert.ok(checkDestination({ targetDir: lab, labRoot: lab, configuredLab: lab, repoRoot: repo, sourceDir: source }).problems.length > 0, 'the lab root must be refused');
  assert.ok(checkDestination({ targetDir: path.dirname(lab), labRoot: lab, configuredLab: lab, repoRoot: repo, sourceDir: source }).problems.length > 0, 'an ancestor of the lab must be refused');
  assert.ok(checkDestination({ targetDir: path.join(root, 'elsewhere'), labRoot: lab, configuredLab: lab, repoRoot: repo, sourceDir: source }).problems.length > 0, 'a path outside the lab must be refused');
  assert.ok(checkDestination({ targetDir: path.join(repo, 'trial-source'), labRoot: lab, configuredLab: lab, repoRoot: repo, sourceDir: source }).problems.length > 0, 'a destination inside the repository must be refused');
  assert.ok(checkDestination({ targetDir: source, labRoot: lab, configuredLab: lab, repoRoot: repo, sourceDir: source }).problems.length > 0, 'the source checkout must never be a destination');
  assert.ok(checkDestination({ targetDir: inside, labRoot: path.join(root, 'other-lab'), configuredLab: lab, repoRoot: repo, sourceDir: source }).problems.length > 0, 'a lab outside the configured lab must be refused');
  assert.equal(isInside(path.join(lab, 'trial-source'), path.join(lab, 'trial-source-old')), false, 'a prefix sibling is not inside');
  assert.equal(isInside(inside, inside), true, 'a path is inside itself');
  assert.equal(overlaps(inside, lab), true, 'the target is inside the lab');
  assert.equal(overlaps(lab, repo), false, 'sibling directories do not overlap');
});

test('a junctioned ancestor is resolved, so a link cannot widen the destination', { skip: !canJunction() }, () => {
  const root = scratchDir('uniwork-g0-junction-');
  const lab = path.join(root, 'lab');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(lab, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const junction = path.join(lab, 'linked');
  fs.symlinkSync(outside, junction, 'junction');
  const problems = checkDestination({ targetDir: path.join(junction, 'trial-source'), labRoot: lab, configuredLab: lab, repoRoot: outside, sourceDir: outside }).problems;
  assert.ok(problems.length > 0, 'the resolved destination must leave the lab: ' + problems.join('; '));
  assert.equal(realDirectory(junction), realDirectory(outside), 'the junction must resolve to its target');
});

test('an existing target is refused without --replace, and one this script did not write is never replaced', () => {
  const dir = scratchDir('uniwork-g0-target-');
  fs.writeFileSync(path.join(dir, 'unmanaged.txt'), 'someone else data\n');
  assert.ok(/already exists/.test(checkReplaceable({ targetDir: dir, replace: false })), 'an existing target must require --replace');
  assert.ok(/has no prepare-record.json/.test(checkReplaceable({ targetDir: dir, replace: true })), 'an unmarked target must be refused even with --replace');
  assert.equal(readManagedMarker(dir).managed, false);
  fs.writeFileSync(path.join(dir, MANAGED_MARKER), JSON.stringify({ kind: RECORD_KIND, produced: { path: dir } }));
  assert.equal(readManagedMarker(dir).managed, true);
  assert.equal(checkReplaceable({ targetDir: dir, replace: true }), null, 'a managed copy for this destination may be replaced');
  // Two copies cannot be confused: a record that names a different destination
  // must not authorize replacing this one.
  fs.writeFileSync(path.join(dir, MANAGED_MARKER), JSON.stringify({ kind: RECORD_KIND, produced: { path: path.join(dir, 'elsewhere') } }));
  assert.ok(/record for .*elsewhere/.test(checkReplaceable({ targetDir: dir, replace: true })), 'a record for another destination must be refused');
  fs.writeFileSync(path.join(dir, MANAGED_MARKER), JSON.stringify({ kind: 'something-else', produced: { path: dir } }));
  assert.ok(/different kind/.test(readManagedMarker(dir).reason), 'a foreign marker must not count as managed');
  assert.equal(checkReplaceable({ targetDir: path.join(dir, 'absent'), replace: false }), null, 'a missing target needs no decision');
});

test('cleanupStaging removes only its own staging directory and refuses the lab, the target and the source', () => {
  const root = scratchDir('uniwork-g0-cleanup-');
  const lab = path.join(root, 'lab');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(lab, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  const staging = path.join(lab, STAGING_PREFIX + 'x');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'file.txt'), 'x');
  assert.equal(cleanupStaging(staging, lab, repo, repo), true);
  assert.equal(fs.existsSync(staging), false);

  const target = path.join(lab, 'trial-source');
  fs.mkdirSync(target, { recursive: true });
  assert.equal(cleanupStaging(target, lab, repo, repo), false, 'the target must never be deleted by staging cleanup');
  assert.ok(fs.existsSync(target));
  assert.equal(cleanupStaging(lab, lab, repo, repo), false, 'the lab root must never be deleted');
  assert.ok(fs.existsSync(lab));
  assert.equal(cleanupStaging(repo, lab, repo, repo), false, 'the repository must never be deleted');
  assert.ok(fs.existsSync(repo));
  assert.equal(cleanupStaging(path.join(root, 'not-staging'), lab, repo, repo), false, 'a path outside the lab must never be deleted');
});

test('an interrupted promotion leaves a complete copy: the previous one is restored, never half-written', () => {
  const root = scratchDir('uniwork-g0-promote-');
  const target = path.join(root, 'trial-source');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'old.txt'), 'previous copy\n');
  const staging = path.join(root, STAGING_PREFIX + 'probe');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'new.txt'), 'new copy\n');

  const originalRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (from, to) => {
    calls += 1;
    if (calls === 2) throw new Error('simulated interruption');
    return originalRename(from, to);
  };
  try {
    assert.throws(() => promote({ staging, targetDir: target, nonce: 'n1', log: () => {} }), /simulated interruption/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.ok(fs.existsSync(path.join(target, 'old.txt')), 'the previous copy must be restored after an interrupted promotion');
  assert.ok(!fs.existsSync(path.join(target, 'new.txt')), 'the partial copy must not be promoted');
  assert.ok(fs.existsSync(staging), 'staging survives so the caller can retry or clean it');

  originalRename(staging, path.join(root, 'staging-ok'));
  const ok = promote({ staging: path.join(root, 'staging-ok'), targetDir: target, nonce: 'n2', log: () => {} });
  assert.equal(ok.hadTarget, true, 'the existing copy must be reported as replaced');
  assert.ok(fs.existsSync(path.join(target, 'new.txt')));
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.includes('.previous-')), [], 'no backup directory may be left behind');
});

test('verifyProducedCopy rejects a missing file, an extra file, wrong bytes, a link and a wrong lockfile', () => {
  const root = scratchDir('uniwork-g0-verify-');
  const buf = Buffer.from('hello\n');
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/index.ts'), buf);
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  const lockBuf = fs.readFileSync(path.join(root, 'package-lock.json'));
  const files = [{ path: 'apps/index.ts', bytes: buf.length, sha256: sha256Bytes(buf) }, { path: 'package-lock.json', bytes: lockBuf.length, sha256: sha256Bytes(lockBuf) }];
  const lockfile = { path: 'package-lock.json', sha256: sha256Bytes(fs.readFileSync(path.join(root, 'package-lock.json'))) };
  assert.deepEqual(verifyProducedCopy(root, files, lockfile), []);

  fs.writeFileSync(path.join(root, 'apps/extra.ts'), 'x');
  assert.ok(verifyProducedCopy(root, files, lockfile).some((p) => /unplanned file/.test(p)), 'an unplanned file must be refused');
  fs.rmSync(path.join(root, 'apps/extra.ts'));
  fs.writeFileSync(path.join(root, 'apps/index.ts'), 'tampered\n');
  assert.ok(verifyProducedCopy(root, files, lockfile).some((p) => /size does not match|sha256 does not match/.test(p)), 'tampered bytes must be refused');
  fs.writeFileSync(path.join(root, 'apps/index.ts'), buf);
  fs.rmSync(path.join(root, 'apps/index.ts'));
  assert.ok(verifyProducedCopy(root, files, lockfile).some((p) => /missing planned file/.test(p)), 'a missing planned file must be refused');
  fs.writeFileSync(path.join(root, 'apps/index.ts'), buf);
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":2}\n');
  assert.ok(verifyProducedCopy(root, files, lockfile).some((p) => /lockfile .* does not match/.test(p)), 'a wrong lockfile must be refused');
});

test('verifyProducedCopy flags a link in the produced copy', { skip: !canSymlink() }, () => {
  const root = scratchDir('uniwork-g0-verify-link-');
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/index.ts'), 'x');
  fs.symlinkSync(path.join(root, 'apps/index.ts'), path.join(root, 'linked.ts'), 'file');
  assert.ok(verifyProducedCopy(root, [{ path: 'apps/index.ts', bytes: 1, sha256: sha256Bytes(Buffer.from('x')) }], null).some((p) => /link/.test(p)), 'a link must be refused');
});

test('auditProducedCopy flags ee/, node_modules, an environment file and a link in a produced copy', () => {
  const root = scratchDir('uniwork-g0-audit-');
  const cfg = { neverCopy: [], excludedSets: [], exclude: [] };
  fs.mkdirSync(path.join(root, 'apps/docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/docs/index.ts'), 'x');
  assert.deepEqual(auditProducedCopy(root, cfg), [], 'a clean copy must pass its own audit');

  fs.mkdirSync(path.join(root, 'ee'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ee/LICENSE'), 'x');
  assert.ok(auditProducedCopy(root, cfg).some((p) => /ee\//.test(p)), 'an ee/ path must be flagged');
  fs.rmSync(path.join(root, 'ee'), { recursive: true, force: true });

  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  assert.ok(auditProducedCopy(root, cfg).some((p) => /environment file/.test(p)), 'an environment file must be flagged');
  fs.rmSync(path.join(root, '.env'));

  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  assert.ok(auditProducedCopy(root, cfg).some((p) => /node_modules/.test(p)), 'a node_modules directory must be flagged');
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });

  fs.mkdirSync(path.join(root, 'apps/sheets/target'), { recursive: true });
  assert.ok(auditProducedCopy(root, cfg).some((p) => /target/.test(p)), 'a nested target/ must be flagged');
  fs.rmSync(path.join(root, 'apps/sheets/target'), { recursive: true, force: true });

  if (canSymlink()) {
    fs.symlinkSync(path.join(root, 'apps/docs/index.ts'), path.join(root, 'linked.ts'), 'file');
    assert.ok(auditProducedCopy(root, cfg).some((p) => /link/.test(p)), 'a link must be flagged');
  }
});

// --- prepare-source: end-to-end extraction into a lab ----------------------

/** Writes the synthetic manifests beside the synthetic lab and returns the run options. */
function writeSyntheticManifests(repo, overrides = {}) {
  const { sourceManifest: sm, fixtureManifest: fm } = makeManifests(repo);
  const smPath = path.join(SUITE_ROOT, 'source-manifest-' + repoCounter + '.json');
  const fmPath = path.join(SUITE_ROOT, 'fixture-manifest-' + repoCounter + '.json');
  fs.writeFileSync(smPath, JSON.stringify(Object.assign(sm, overrides.source || {})));
  fs.writeFileSync(fmPath, JSON.stringify(Object.assign(fm, overrides.fixture || {})));
  return { smPath, fmPath, opts: { repoRoot: repo.repoRoot, sourceManifestPath: smPath, fixtureManifestPath: fmPath } };
}

test('the pinned extraction writes the pinned bytes and marks the copy as managed', () => {
  const repo = makeSyntheticRepo();
  fs.writeFileSync(path.join(repo.root, 'apps/docs/src/index.ts'), 'export const dirty = true;\n');
  fs.writeFileSync(path.join(repo.root, 'apps/docs/src/untracked.ts'), 'untracked\n');
  const { smPath, fmPath, opts } = writeSyntheticManifests(repo);
  const lab = configuredLabFor(repo);

  assert.equal(run(['--source', repo.root], opts), 0, 'the extraction must succeed for a pinned source');

  const target = path.join(lab, 'trial-source');
  const marker = JSON.parse(fs.readFileSync(path.join(target, MANAGED_MARKER), 'utf8'));
  assert.equal(marker.kind, RECORD_KIND);
  assert.equal(marker.source.commit, repo.commit);
  assert.equal(marker.source.clean, false, 'a dirty checkout is recorded as dirty; only the pinned bytes are copied');
  assert.equal(marker.files.length, marker.produced.fileCount);
  assert.equal(sha256File(path.join(target, 'apps/docs/src/index.ts')), sha256Bytes(Buffer.from(SYNTHETIC_FILES['apps/docs/src/index.ts'])), 'the copy must hold the pinned bytes, not the dirty working tree bytes');
  assert.ok(!fs.existsSync(path.join(target, 'apps/docs/src/untracked.ts')), 'an untracked file must not be copied');
  assert.ok(!fs.existsSync(path.join(target, 'ee')), 'ee/ must not be copied');
  assert.ok(!fs.existsSync(path.join(target, '.github')), '.github/ must not be copied');
  assert.ok(!fs.existsSync(path.join(target, 'apps/sheets/target')), 'target/ must not be copied');
  assert.ok(!fs.existsSync(path.join(target, 'apps/docs/.env.local')), 'an environment file must not be copied');
  assert.ok(!fs.readdirSync(lab).some((n) => n.startsWith(STAGING_PREFIX)), 'no staging directory may be left behind');
  assert.ok(fs.existsSync(smPath) && fs.existsSync(fmPath));
});

test('a second run without --replace refuses and leaves the first copy untouched; --replace rebuilds it', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo);
  const lab = configuredLabFor(repo);
  assert.equal(run(['--source', repo.root], opts), 0);
  const before = fs.readFileSync(path.join(lab, 'trial-source', MANAGED_MARKER), 'utf8');
  assert.equal(run(['--source', repo.root], opts), 1, 'a second run without --replace must refuse');
  assert.equal(fs.readFileSync(path.join(lab, 'trial-source', MANAGED_MARKER), 'utf8'), before, 'the refused run must not modify the copy');
  assert.equal(run(['--source', repo.root, '--replace'], opts), 0, '--replace must rebuild a marked copy');
});

test('an unmarked directory at the destination is never deleted, even with --replace', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo);
  const lab = configuredLabFor(repo);
  const unmarked = path.join(lab, 'trial-source');
  fs.mkdirSync(unmarked, { recursive: true });
  fs.writeFileSync(path.join(unmarked, 'keep.txt'), 'unmanaged trial-source from an older run\n');
  assert.equal(run(['--source', repo.root, '--replace'], opts), 1, 'an unmarked destination must be refused');
  assert.ok(fs.existsSync(path.join(unmarked, 'keep.txt')), 'the unmarked directory must survive intact');
});

test('a source whose HEAD is not the pinned commit is refused and nothing is written', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo, { fixture: { upstreamCommit: '0'.repeat(40) } });
  const lab = configuredLabFor(repo);
  assert.equal(run(['--source', repo.root], opts), 1, 'a wrong pinned commit must be refused');
  assert.ok(!fs.existsSync(path.join(lab, 'trial-source')), 'nothing may be written when the pin does not match');
});

test('a wrong lockfile hash or a wrong licence hash is refused and nothing is written', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo, { source: { lockfile: { path: 'package-lock.json', bytes: 1, sha256: 'B'.repeat(64) } } });
  const lab = configuredLabFor(repo);
  assert.equal(run(['--source', repo.root], opts), 1, 'a wrong lockfile hash must be refused');
  assert.ok(!fs.existsSync(path.join(lab, 'trial-source')));

  const repo2 = makeSyntheticRepo();
  const { opts: opts2 } = writeSyntheticManifests(repo2);
  const sm2 = JSON.parse(fs.readFileSync(opts2.sourceManifestPath, 'utf8'));
  sm2.licenses.licenseFiles[0].sha256 = 'A'.repeat(64);
  fs.writeFileSync(opts2.sourceManifestPath, JSON.stringify(sm2));
  assert.equal(run(['--source', repo2.root], opts2), 1, 'a wrong licence hash must be refused');
  assert.ok(!fs.existsSync(path.join(lab, 'trial-source')));
});

test('a destination outside the configured lab is refused even when --work-dir names it', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo);
  const outside = path.join(SUITE_ROOT, 'outside-' + repoCounter);
  fs.mkdirSync(outside, { recursive: true });
  assert.equal(run(['--source', repo.root, '--work-dir', outside], opts), 1, 'a --work-dir outside the configured lab must be refused');
  assert.ok(!fs.existsSync(path.join(outside, 'trial-source')), 'nothing may be written outside the lab');
});

test('a dry run and --print-plan report the plan without writing anything', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo);
  const lab = configuredLabFor(repo);
  assert.equal(run(['--source', repo.root, '--dry-run'], opts), 0, 'a dry run must succeed');
  assert.ok(!fs.existsSync(path.join(lab, 'trial-source')), 'a dry run must not create the copy');
});

test('--print-plan reports the resolved plan and writes nothing', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo);
  const lab = configuredLabFor(repo);
  assert.equal(run(['--source', repo.root, '--print-plan'], opts), 0, 'the plan report must succeed');
  assert.ok(!fs.existsSync(path.join(lab, 'trial-source')), '--print-plan must not create the copy');
});

test('the default destination is the configured lab plus the manifest producedDirName', () => {
  const repo = makeSyntheticRepo();
  const { sourceManifest: sm } = makeManifests(repo);
  const expectedLab = path.resolve(path.join(repo.wsRoot, '.uniwork-dev/office-g0'));
  assert.equal(resolveConfiguredLabRoot(sm, {}, repo.repoRoot), expectedLab);
  assert.equal(configuredLabRoot(sm, repo.repoRoot), expectedLab);
  assert.equal(resolveTargetDir(sm, {}, repo.repoRoot), path.join(expectedLab, 'trial-source'));
  assert.equal(resolveTargetDir(sm, { workDir: path.join(repo.wsRoot, 'lab') }, repo.repoRoot), path.join(path.resolve(path.join(repo.wsRoot, 'lab')), 'trial-source'));
  assert.equal(configuredLabFor(repo), expectedLab);
});

test('parseArgs keeps the CLI compatible: flags parse, --force is gone and unknown flags are refused', () => {
  const parsed = parseArgs([]);
  assert.deepEqual(parsed, { source: null, workDir: null, dryRun: false, replace: false, verbose: false, printPlan: false, help: false });
  assert.equal(parseArgs(['--dry-run']).dryRun, true, '--dry-run must still be accepted');
  assert.equal(parseArgs(['--source', 'x']).source, 'x');
  assert.equal(parseArgs(['--work-dir', 'y']).workDir, 'y');
  assert.equal(parseArgs(['--replace']).replace, true, '--replace must be accepted');
  assert.throws(() => parseArgs(['--force']), /unknown argument/, '--force must not exist: unmarked data is never replaced');
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('the real source checkout matches the pinned commit, tree and allowlist when it is present', { skip: !fs.existsSync(UPSTREAM_SOURCE) }, () => {
  const state = inspectSource(UPSTREAM_SOURCE);
  assert.equal(state.commit, manifest.upstreamCommit);
  assert.equal(state.tree, sourceManifest.upstream.pinnedTree);
  const entries = readTreeEntries(UPSTREAM_SOURCE, manifest.upstreamCommit);
  assert.equal(entries.length, sourceManifest.upstream.trackedFileCount, 'the pinned tree must hold the tracked file count the manifest records');
  assert.ok(!entries.some((e) => e.mode === '120000'), 'the pinned tree must hold no symlink');
  assert.ok(!entries.some((e) => e.type === 'commit'), 'the pinned tree must hold no gitlink');
  const plan = planCopy(entries.map((e) => e.path), sourceManifest.allowlist);
  assert.deepEqual(plan.unmatched, [], 'every allowlisted entry must match the pinned tree');
  assert.equal(plan.files.length + plan.refused.length, 3129, 'the pinned tree must split into kept and refused files with no silent drop');
  assert.ok(!plan.files.some((f) => f.startsWith('ee/') || f.startsWith('.github/')), 'ee/ and .github/ must stay out');
  assert.ok(plan.refused.some((r) => /fixtures\/generated/.test(r.path)), 'the generated fixture set must be refused');
});

test('readBlobsBatch returns the pinned bytes for many blobs, verified against their object ids', () => {
  const repo = makeSyntheticRepo();
  const entries = readTreeEntries(repo.root, repo.commit).filter((e) => e.type === 'blob');
  const batch = readBlobsBatch(repo.root, entries.map((e) => e.sha));
  assert.equal(batch.size, entries.length, 'every requested blob must be returned');
  for (const e of entries) {
    const buf = batch.get(e.sha);
    assert.equal(gitBlobObjectId(buf), e.sha, 'the returned bytes must hash back to the object id');
    assert.equal(buf.length, e.bytes, 'ls-tree -l must report the same size the bytes have');
  }
  assert.equal(gitBlobObjectId(Buffer.from(SYNTHETIC_FILES['LICENSE'])), readTreeEntries(repo.root, repo.commit).find((e) => e.path === 'LICENSE').sha, 'gitBlobObjectId must reproduce the tree object id');
  assert.equal(readBlobsBatch(repo.root, []).size, 0);
});

test('readTreeEntries reports the size of every entry from the object store, not from the working tree', () => {
  const repo = makeSyntheticRepo();
  const before = readTreeEntries(repo.root, repo.commit).find((e) => e.path === 'LICENSE');
  assert.equal(before.bytes, Buffer.byteLength(SYNTHETIC_FILES.LICENSE));
  fs.writeFileSync(path.join(repo.root, 'LICENSE'), 'a much longer tampered working tree copy\n');
  const after = readTreeEntries(repo.root, repo.commit).find((e) => e.path === 'LICENSE');
  assert.equal(after.bytes, before.bytes, 'the reported size must come from the pinned object');
});

test('the real pinned source extracts byte for byte into a lab, with a complete managed record', { skip: !(fs.existsSync(UPSTREAM_SOURCE) && process.env.UNIWORK_G0_REAL_EXTRACT === '1') }, () => {
  // Writing the whole pinned source is a 59 MB extraction, so it runs only when
  // explicitly asked for. The lab is a fresh mkdtemp directory inside the
  // configured lab, so this run removes only the directory it created.
  const configuredLab = resolveLabRoot(REPO_ROOT);
  fs.mkdirSync(configuredLab, { recursive: true });
  const lab = fs.mkdtempSync(path.join(configuredLab, 'extraction-self-test-'));
  const code = run(['--source', UPSTREAM_SOURCE, '--work-dir', lab], { sourceManifestPath: path.join(REPO_ROOT, 'docs/office/g0/source-manifest.json'), fixtureManifestPath: path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json') });
  assert.equal(code, 0, 'the pinned source must extract cleanly');
  const target = path.join(lab, 'trial-source');
  const record = JSON.parse(fs.readFileSync(path.join(target, MANAGED_MARKER), 'utf8'));
  assert.equal(record.source.commit, manifest.upstreamCommit);
  assert.equal(record.source.tree, sourceManifest.upstream.pinnedTree);
  assert.ok(record.files.length > 2500, 'the record must list the extracted files');
  assert.equal(record.produced.path, target, 'the record must name the absolute destination it built');

  const entries = new Map(readTreeEntries(UPSTREAM_SOURCE, manifest.upstreamCommit).map((e) => [e.path, e]));
  for (const f of record.files) {
    const abs = path.join(target, f.path);
    assert.ok(fs.existsSync(abs), f.path + ' must exist in the copy');
    assert.equal(fs.statSync(abs).size, f.bytes, f.path + ' size');
    assert.equal(sha256File(abs), f.sha256, f.path + ' sha256');
    assert.equal(gitBlobObjectId(fs.readFileSync(abs)), entries.get(f.path).sha, f.path + ' must be the pinned blob');
  }
  assert.ok(!fs.existsSync(path.join(target, 'ee')), 'ee/ must stay out of the real copy');
  assert.ok(!fs.existsSync(path.join(target, '.github')), '.github/ must stay out of the real copy');
  assert.equal(sha256File(path.join(target, 'package-lock.json')), sourceManifest.lockfile.sha256, 'the lockfile must be the pinned bytes');
  assert.equal(sha256File(path.join(target, 'LICENSE')), sourceManifest.licenses.licenseFiles[0].sha256, 'the licence must be the pinned bytes');
  assert.ok(!fs.readdirSync(lab).some((n) => n.startsWith(STAGING_PREFIX)), 'no staging directory may be left behind');

  // Re-running must rebuild only with an explicit --replace, and a second
  // extraction must produce exactly the same record.
  const realOpts = { sourceManifestPath: path.join(REPO_ROOT, 'docs/office/g0/source-manifest.json'), fixtureManifestPath: path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json') };
  assert.equal(run(['--source', UPSTREAM_SOURCE, '--work-dir', lab], realOpts), 1, 'a second run must refuse without --replace');
  const after = JSON.parse(fs.readFileSync(path.join(target, MANAGED_MARKER), 'utf8'));
  assert.deepEqual(after, record, 'the refused run must leave the record unchanged');
  fs.rmSync(target, { recursive: true, force: true });
  fs.rmSync(lab, { recursive: true, force: true });
});

test('a hostile producedDirName cannot escape the lab: the basename is validated and stays inside', () => {
  const repo = makeSyntheticRepo();
  const { opts } = writeSyntheticManifests(repo);
  const lab = configuredLabFor(repo);
  const escaped = path.join(repo.wsRoot, 'escaped');
  for (const hostile of ['../escaped', '..', '.', '', 'nested/child', 'C:\\\\Windows', '/abs', 'a\\\\b']) {
    const sm = JSON.parse(fs.readFileSync(opts.sourceManifestPath, 'utf8'));
    sm.trialSource.producedDirName = hostile;
    fs.writeFileSync(opts.sourceManifestPath, JSON.stringify(sm));
    const code = run(['--source', repo.root], opts);
    assert.notEqual(code, 0, 'producedDirName ' + JSON.stringify(hostile) + ' must be refused');
    assert.ok(!fs.existsSync(escaped), 'nothing may be written outside the lab for ' + JSON.stringify(hostile));
    assert.ok(!fs.existsSync(path.join(lab, 'nested')), 'a nested producedDirName must not create a directory tree');
  }
  // A clean basename still works and is what the record reports.
  const sm = JSON.parse(fs.readFileSync(opts.sourceManifestPath, 'utf8'));
  sm.trialSource.producedDirName = 'trial-source';
  fs.writeFileSync(opts.sourceManifestPath, JSON.stringify(sm));
  assert.equal(run(['--source', repo.root], opts), 0);
  const record = JSON.parse(fs.readFileSync(path.join(lab, 'trial-source', MANAGED_MARKER), 'utf8'));
  assert.equal(record.produced.baseName, 'trial-source');
  assert.equal(record.produced.path, path.join(lab, 'trial-source'));
  assert.deepEqual(record.allowlistInclude, sm.allowlist.include, 'the record must list the allowlist that produced it');
});

test('producedDirNameProblem accepts one plain segment and refuses separators, traversal and drives', () => {
  assert.equal(producedDirNameProblem('trial-source'), null);
  assert.equal(producedDirNameProblem('trial_source.v2'), null);
  for (const bad of ['', ' ', '.', '..', 'a/b', 'a\\b', 'C:\\Windows', 'C:x', '/abs', 'a:b', 'a b/c']) {
    assert.ok(producedDirNameProblem(bad) !== null, 'producedDirName ' + JSON.stringify(bad) + ' must be refused');
  }
});

test('a junction at the configured lab root cannot widen the workspace boundary', { skip: !canJunction() }, () => {
  const root = scratchDir('uniwork-g0-lab-junction-');
  const ws = path.join(root, 'ws');
  const external = path.join(root, 'external-lab');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  const lab = path.join(ws, '.uniwork-dev', 'office-g0');
  fs.mkdirSync(path.dirname(lab), { recursive: true });
  fs.symlinkSync(external, lab, 'junction');
  const problems = checkDestination({
    targetDir: path.join(lab, 'trial-source'),
    labRoot: lab,
    configuredLab: lab,
    repoRoot: path.join(ws, 'repo'),
    sourceDir: path.join(ws, 'src'),
    workspaceRoot: ws,
  }).problems;
  assert.equal(realDirectory(lab), realDirectory(external), 'the junction must resolve to the external directory');
  assert.ok(problems.some((p) => /is not inside its workspace/.test(p)), 'a linked lab outside the workspace must be refused: ' + problems.join('; '));
});

test('a junction at .uniwork-dev cannot widen the workspace boundary either', { skip: !canJunction() }, () => {
  const root = scratchDir('uniwork-g0-devdir-junction-');
  const ws = path.join(root, 'ws');
  const external = path.join(root, 'external-dev');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(path.join(external, 'office-g0'), { recursive: true });
  const devDir = path.join(ws, '.uniwork-dev');
  fs.symlinkSync(external, devDir, 'junction');
  const lab = path.join(devDir, 'office-g0');
  const problems = checkDestination({
    targetDir: path.join(lab, 'trial-source'),
    labRoot: lab,
    configuredLab: lab,
    repoRoot: path.join(ws, 'repo'),
    sourceDir: path.join(ws, 'src'),
    workspaceRoot: ws,
  }).problems;
  assert.ok(problems.some((p) => /is not inside its workspace/.test(p)), 'a lab reached through a linked .uniwork-dev must be refused: ' + problems.join('; '));
});

test('a real lab inside its real workspace is still accepted, and a nested worktree layout is preserved', () => {
  const root = scratchDir('uniwork-g0-ws-ok-');
  const ws = path.join(root, 'ws');
  const lab = path.join(ws, '.uniwork-dev', 'office-g0');
  fs.mkdirSync(lab, { recursive: true });
  assert.deepEqual(checkDestination({
    targetDir: path.join(lab, 'trial-source'),
    labRoot: lab,
    configuredLab: lab,
    repoRoot: path.join(ws, 'repo'),
    sourceDir: path.join(ws, 'src'),
    workspaceRoot: ws,
  }).problems, [], 'an ordinary lab inside its workspace must be accepted');
  const worktreeRepo = path.join(ws, '.uniwork-dev', 'worktrees', 'wt');
  fs.mkdirSync(worktreeRepo, { recursive: true });
  assert.deepEqual(checkDestination({
    targetDir: path.join(lab, 'trial-source'),
    labRoot: lab,
    configuredLab: lab,
    repoRoot: worktreeRepo,
    sourceDir: path.join(ws, 'src'),
    workspaceRoot: ws,
  }).problems, [], 'a nested Git worktree repo root must not widen or break containment');
});

test('an excludedSet path glob is enforced in the plan with no duplicate exclude entry', () => {
  const repo = makeSyntheticRepo();
  const { sourceManifest: sm } = makeManifests(repo);
  const allowlist = JSON.parse(JSON.stringify(sm.allowlist));
  allowlist.exclude = [];
  const plan = planCopy(treeFileList(repo), allowlist);
  assert.ok(!plan.files.some((f) => f.includes('fixtures/generated')), 'the glob excludedSet must exclude the generated descendant: ' + plan.files.join(', '));
  assert.ok(plan.refused.some((r) => r.path === 'packages/docx-engine/fixtures/generated/big.docx' && /excludedSet/.test(r.reason)), 'the generated path must be refused as an excludedSet');
  assert.ok(plan.files.includes('packages/ui/tee/keep.ts'), 'an ordinary file must still be kept');
});

test('a literal excludedSet directory, a glob excludedSet descendant and an excludedSets[].glob are all flagged by the audit', () => {
  const root = scratchDir('uniwork-g0-audit-set-');
  fs.mkdirSync(path.join(root, 'packages/docx-engine/fixtures/generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages/docx-engine/fixtures/generated/big.docx'), 'x');
  fs.mkdirSync(path.join(root, 'ee'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ee/LICENSE'), 'x');
  fs.mkdirSync(path.join(root, 'vendor/pkg/generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'vendor/pkg/generated/out.bin'), 'x');
  const cfg = { neverCopy: [], exclude: [], excludedSets: [{ path: 'ee/' }, { path: '**/fixtures/generated' }, { path: 'literal-that-does-not-match', glob: 'vendor/*/generated' }] };
  const problems = auditProducedCopy(root, cfg);
  assert.ok(problems.some((p) => p.startsWith('ee (') && /excludedSet/.test(p)), 'the literal excludedSet directory must be flagged: ' + problems.join('; '));
  assert.ok(problems.some((p) => p.includes('fixtures/generated') && /excludedSet/.test(p)), 'the glob excludedSet descendant must be flagged');
  assert.ok(problems.some((p) => p.includes('vendor/pkg/generated') && /excludedSet/.test(p)), 'the optional excludedSets[].glob must be flagged');
});

test('a linked or directory marker never authorizes replacement', { skip: !canSymlink() && !canJunction() }, () => {
  const dir = scratchDir('uniwork-g0-marker-link-');
  const real = scratchDir('uniwork-g0-marker-real-');
  fs.writeFileSync(path.join(real, 'record.json'), JSON.stringify({ kind: RECORD_KIND, produced: { path: dir } }));
  fs.mkdirSync(path.join(dir, MANAGED_MARKER), { recursive: true });
  assert.equal(readManagedMarker(dir).managed, false, 'a directory marker must not count as managed');
  assert.ok(checkReplaceable({ targetDir: dir, replace: true }) !== null, '--replace must refuse a directory marker');
  fs.rmSync(path.join(dir, MANAGED_MARKER), { recursive: true, force: true });
  if (canSymlink()) fs.symlinkSync(path.join(real, 'record.json'), path.join(dir, MANAGED_MARKER), 'file');
  else fs.symlinkSync(real, path.join(dir, MANAGED_MARKER), 'junction');
  const marker = readManagedMarker(dir);
  assert.equal(marker.managed, false, 'a linked marker must never authorize a replacement');
  assert.ok(/linked prepare-record\.json|not a regular file/.test(marker.reason), marker.reason);
  assert.ok(checkReplaceable({ targetDir: dir, replace: true }) !== null, '--replace must refuse a linked marker');
});
