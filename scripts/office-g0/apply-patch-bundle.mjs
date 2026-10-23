#!/usr/bin/env node
// DOC-002 (UNI-666) - replay a registered spike patch bundle in a clean tree.
//
// Task 2.4 asks for a trial source that can be prepared again on another
// machine, "including the registered spike patch bundle and checksums". This
// tool is the replay half. Every entry is content-addressed:
//   * the patch file checksum is verified,
//   * the preimage bytes the bundle ships are copied into a clean root,
//   * the whole bundle is checked before any write,
//   * entries apply in order and every declared postimage checksum is verified,
//   * side artifacts that travel with the patch are checksum-verified too.
// A mismatch fails closed and leaves nothing half-applied.
//
// Two portability facts are pinned by the tool because both changed the result
// on this machine: `git apply` is invoked with core.autocrlf=false (otherwise
// the replay re-emits the files with host line endings and the postimage hash
// never matches), and the clean root must be a git work tree (outside one, git
// apply silently skips rename-shaped entries and still exits 0).
//
//   node scripts/office-g0/apply-patch-bundle.mjs --bundle <dir> --root <clean-dir> \
//     [--record <receipt.json>] [--dry-run] [--init-root]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const sha256File = (file) => sha256(fs.readFileSync(file));
const relJoin = (root, rel) => path.join(root, ...rel.split('/'));
const GIT_SAFE = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf'];

export function readBundle(bundleDir) {
  const bundle = JSON.parse(fs.readFileSync(path.join(bundleDir, 'bundle.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (bundle.kind !== 'uniwork-office-spike-patch-bundle') throw new Error('unexpected bundle kind ' + bundle.kind);
  if (!Array.isArray(bundle.entries) || bundle.entries.length === 0) throw new Error('bundle has no entries');
  const orders = bundle.entries.map((e) => e.order);
  if (new Set(orders).size !== orders.length) throw new Error('bundle entry orders are not unique');
  return bundle;
}

/** Writes the shipped preimages of every entry into a clean root. */
export function initRootFromPreimages(bundle, bundleDir, root) {
  const written = [];
  for (const entry of bundle.entries) {
    for (const target of entry.targets) {
      if (!target.preimageSha256) continue;
      const from = path.join(bundleDir, entry.preimageDir, path.basename(target.preimagePath ?? target.path));
      const to = relJoin(root, target.preimagePath ?? target.path);
      if (!fs.existsSync(from)) throw new Error('entry ' + entry.order + ' ships no preimage for ' + (target.preimagePath ?? target.path));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      written.push({ path: target.preimagePath ?? target.path, sha256: sha256File(to) });
    }
  }
  return written;
}

export function ensureGitRoot(root, initRoot) {
  const isRepo = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'true';
    } catch { return false; }
  })();
  if (isRepo) return 'existing';
  if (!initRoot) throw new Error('clean root is not a git work tree; git apply silently skips entries there (pass --init-root to create one)');
  fs.mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', '.'], { cwd: root, encoding: 'utf8' });
  return 'initialized';
}

export function verifyPreimages(bundle, root) {
  const problems = [];
  for (const entry of bundle.entries) {
    for (const target of entry.targets) {
      const rel = target.preimagePath ?? target.path;
      const file = relJoin(root, rel);
      if (!target.preimageSha256) {
        if (fs.existsSync(file)) problems.push('entry ' + entry.order + ': ' + rel + ' should not exist yet (new file)');
        continue;
      }
      if (!fs.existsSync(file)) { problems.push('entry ' + entry.order + ': preimage ' + rel + ' is missing from the clean root'); continue; }
      const actual = sha256File(file);
      if (actual !== target.preimageSha256) problems.push('entry ' + entry.order + ': preimage ' + rel + ' is ' + actual + ', expected ' + target.preimageSha256);
    }
  }
  return problems;
}

export function verifyPatchChecksums(bundle, bundleDir) {
  const problems = [];
  for (const entry of bundle.entries) {
    const file = path.join(bundleDir, entry.file);
    if (!fs.existsSync(file)) { problems.push('entry ' + entry.order + ': patch file ' + entry.file + ' is missing'); continue; }
    const actual = sha256File(file);
    if (actual !== entry.sha256) problems.push('entry ' + entry.order + ': patch ' + entry.file + ' is ' + actual + ', expected ' + entry.sha256);
  }
  return problems;
}

export function verifySideArtifacts(bundle, bundleDir) {
  const problems = [];
  for (const entry of bundle.entries) {
    for (const artifact of entry.sideArtifacts || []) {
      const file = path.join(bundleDir, artifact.file);
      if (!fs.existsSync(file)) { problems.push('entry ' + entry.order + ': side artifact ' + artifact.file + ' is missing'); continue; }
      const actual = sha256File(file);
      if (actual !== artifact.sha256) problems.push('entry ' + entry.order + ': side artifact ' + artifact.file + ' is ' + actual + ', expected ' + artifact.sha256);
    }
  }
  return problems;
}

export function verifyPostimages(bundle, root) {
  const problems = [];
  for (const entry of bundle.entries) {
    for (const target of entry.targets) {
      const file = relJoin(root, target.path);
      if (!fs.existsSync(file)) { problems.push('entry ' + entry.order + ': postimage ' + target.path + ' was not produced'); continue; }
      const actual = sha256File(file);
      if (actual !== target.postimageSha256) problems.push('entry ' + entry.order + ': postimage ' + target.path + ' is ' + actual + ', expected ' + target.postimageSha256);
    }
  }
  return problems;
}

function gitApply(root, patchFile, extra) {
  return execFileSync('git', [...GIT_SAFE, 'apply', ...extra, path.resolve(patchFile)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function replayBundle({ bundleDir, root, dryRun = false, initRoot = false, record = null }) {
  const bundle = readBundle(bundleDir);
  const receipt = { schemaVersion: 1, kind: 'uniwork-office-patch-bundle-replay', bundle: path.basename(bundleDir), root, dryRun, git: { version: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(), config: 'core.autocrlf=false core.eol=lf' }, entries: [] };
  const patchProblems = verifyPatchChecksums(bundle, bundleDir);
  if (patchProblems.length) throw new Error('patch checksum failures:\n' + patchProblems.join('\n'));
  const artifactProblems = verifySideArtifacts(bundle, bundleDir);
  if (artifactProblems.length) throw new Error('side artifact failures:\n' + artifactProblems.join('\n'));
  receipt.rootState = ensureGitRoot(root, initRoot);
  if (initRoot) receipt.initialized = initRootFromPreimages(bundle, bundleDir, root);
  const preimageProblems = verifyPreimages(bundle, root);
  if (preimageProblems.length) throw new Error('preimage failures:\n' + preimageProblems.join('\n'));

  // Check the whole bundle before the first write so a later failure cannot
  // leave a half-applied tree.
  for (const entry of bundle.entries) {
    try {
      gitApply(root, path.join(bundleDir, entry.file), ['--check']);
    } catch (error) {
      throw new Error('entry ' + entry.order + ' does not apply cleanly: ' + String((error && error.stderr) || (error && error.message)));
    }
  }
  if (!dryRun) {
    for (const entry of bundle.entries) {
      try {
        gitApply(root, path.join(bundleDir, entry.file), []);
      } catch (error) {
        throw new Error('entry ' + entry.order + ' failed to apply: ' + String((error && error.stderr) || (error && error.message)));
      }
      receipt.entries.push({ order: entry.order, file: entry.file, sha256: entry.sha256, applied: true });
    }
    const postimageProblems = verifyPostimages(bundle, root);
    if (postimageProblems.length) throw new Error('postimage failures:\n' + postimageProblems.join('\n'));
  }
  receipt.targets = bundle.entries.flatMap((entry) => entry.targets.map((target) => ({
    order: entry.order,
    repoPath: target.repoPath ?? null,
    preimagePath: target.preimageSha256 ? (target.preimagePath ?? target.path) : null,
    preimageSha256: target.preimageSha256,
    postimagePath: target.path,
    postimageSha256: target.postimageSha256,
    observedSha256: fs.existsSync(relJoin(root, target.path)) ? sha256File(relJoin(root, target.path)) : null,
  })));
  receipt.sideArtifacts = bundle.entries.flatMap((entry) => (entry.sideArtifacts || []).map((artifact) => ({
    order: entry.order,
    file: artifact.file,
    sha256: artifact.sha256,
    repoPath: artifact.repoPath ?? null,
    observedSha256: sha256File(path.join(bundleDir, artifact.file)),
  })));
  receipt.ok = true;
  receipt.at = new Date().toISOString();
  if (record) {
    fs.mkdirSync(path.dirname(record), { recursive: true });
    fs.writeFileSync(record, JSON.stringify(receipt, null, 2) + '\n');
  }
  return receipt;
}

async function main(argv) {
  const value = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1]; };
  const bundleDir = value('bundle', null);
  const root = value('root', null);
  const record = value('record', null);
  const dryRun = argv.includes('--dry-run');
  const initRoot = argv.includes('--init-root');
  if (!bundleDir || !root) {
    process.stdout.write('usage: node apply-patch-bundle.mjs --bundle <dir> --root <clean-dir> [--record <json>] [--dry-run] [--init-root]\n');
    process.exit(2);
  }
  const receipt = replayBundle({ bundleDir: path.resolve(bundleDir), root: path.resolve(root), dryRun, initRoot, record: record ? path.resolve(record) : null });
  process.stdout.write(JSON.stringify({
    ok: receipt.ok,
    dryRun: receipt.dryRun,
    entries: receipt.entries,
    targets: receipt.targets.map((t) => ({ path: t.postimagePath, observed: t.observedSha256, expected: t.postimageSha256 })),
    sideArtifacts: receipt.sideArtifacts.map((a) => ({ file: a.file, observed: a.observedSha256, expected: a.sha256 })),
  }, null, 2) + '\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));