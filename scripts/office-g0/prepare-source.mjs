#!/usr/bin/env node
// DOC-002 (UNI-666) task 2.4 - prepares the reusable trial source.
//
// The user checkout is read-only input. This script extracts only the pinned
// commit and tree that the manifests name, refuses anything that would smuggle
// in unlicensed, linked or non-reproducible material, and writes a record with
// a checksum per extracted path so the copy can be rebuilt byte for byte.
//
//   node scripts/office-g0/prepare-source.mjs
//   node scripts/office-g0/prepare-source.mjs --source ../genoffice --work-dir ../.uniwork-dev/office-g0
//   node scripts/office-g0/prepare-source.mjs --dry-run
//   node scripts/office-g0/prepare-source.mjs --replace
//
// It installs nothing and needs no global dependency: only Node built-ins, the
// repository's own files and the pinned commit's git objects are read. Bytes
// come from the object store at the pinned commit, never from the working tree,
// so ignored, generated or dirty files cannot enter the copy. The copy is
// written to a uniquely named staging directory, validated, and only then
// promoted; a failed run keeps the previous copy and removes only its own
// staging directory.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, resolveWorkspaceRoot, resolveLabRoot, resolveUpstreamSource } from './paths.mjs';

export const SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, 'docs/office/g0/source-manifest.json');
export const CAPABILITY_MANIFEST_PATH = path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json');
export const RECORD_KIND = 'uniwork-office-trial-source-record';
export const MANAGED_MARKER = 'prepare-record.json';
export const STAGING_PREFIX = '.prepare-staging-';
export const COMMIT_RE = /^[0-9a-f]{40}$/;
export const SHA256_RE = /^[0-9A-F]{64}$/;
export const BLOB_MODES = ['100644', '100755'];
export const DEFAULT_PRODUCED_DIR = 'trial-source';

export function parseArgs(argv) {
  const out = { source: null, workDir: null, dryRun: false, replace: false, verbose: false, printPlan: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--work-dir') out.workDir = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--replace') out.replace = true;
    else if (a === '--print-plan') out.printPlan = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

/** Case folding for comparisons only; every filesystem read keeps real case. */
export function foldCase(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Resolves a directory to its real path with every existing ancestor link
 * followed, then re-appends the not-yet-existing tail. realpathSync fails on a
 * missing tail, so the deepest existing ancestor is resolved instead. This is
 * what makes an ancestor junction or symlink visible to the containment checks.
 */
export function realDirectory(p) {
  let current = path.resolve(p);
  const tail = [];
  for (;;) {
    const real = realpathOrNull(current);
    if (real !== null) return path.join(real, ...tail.reverse());
    const parent = path.dirname(current);
    if (parent === current) return path.join(current, ...tail.reverse());
    tail.push(path.basename(current));
    current = parent;
  }
}

/**
 * A path is inside a root only when it is the root itself or keeps the root as
 * an ancestor after real-path resolution and case folding. Strings that merely
 * share a prefix (trial-source-old beside trial-source) are not inside it.
 */
export function isInside(root, candidate) {
  const rel = path.relative(foldCase(root), foldCase(candidate));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** True when one root is equal to or nested inside the other. */
export function overlaps(a, b) {
  return isInside(a, b) || isInside(b, a);
}

const GLOB_RE_CACHE = new Map();

/** Translates one glob (*, **, ?) into a case-insensitive whole-segment regex. */
function globToRegExp(glob) {
  const cached = GLOB_RE_CACHE.get(glob);
  if (cached) return cached;
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:[^/]+/)*';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      source += '\\' + c;
    } else {
      source += c;
    }
  }
  const re = new RegExp('^' + source + '$', 'i');
  GLOB_RE_CACHE.set(glob, re);
  return re;
}

/** True when one glob matches the path or any of its ancestor directories. */
export function matchesGlob(rel, glob) {
  if (typeof glob !== 'string' || glob === '') return false;
  const re = globToRegExp(glob);
  const segments = rel.split('/');
  for (let i = 1; i <= segments.length; i += 1) {
    if (re.test(segments.slice(0, i).join('/'))) return true;
  }
  return false;
}

/** Normalises a manifest path to forward-slash relative form, or returns null. */
export function normalizeRel(input) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  if (path.isAbsolute(input) || /^[A-Za-z]:/.test(input)) return null;
  if (input.includes('\\')) return null;
  // A manifest may name a directory with a trailing slash (ee/, .github/); the
  // entry it compares against is the same path without it.
  const segments = input.split('/').filter((s, i) => !(s === '' && i === input.split('/').length - 1));
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segments.join('/');
}

/**
 * The hard refusals a manifest path must never satisfy, independent of the copy
 * plan: absolute paths, drive letters, traversal, the unlicensed ee/ tree,
 * installed packages, Rust build output and environment files.
 */
export function refuseReason(rel, neverCopyPatterns = [], excludePatterns = []) {
  if (typeof rel !== 'string' || rel.trim() === '') return 'is empty';
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return 'is absolute';
  if (rel.includes('\\')) return 'uses a backslash separator';
  const segments = rel.split('/');
  if (segments.some((s) => s === '..')) return 'escapes its root';
  if (segments.some((s) => s === '.')) return 'names the current directory';
  if (segments.includes('ee')) return 'names the unlicensed ee/ tree';
  if (segments.includes('node_modules')) return 'names node_modules';
  if (segments.includes('target')) return 'names a Rust target directory';
  if (segments.some((s) => s.startsWith('.env'))) return 'names an environment file';
  for (const pat of neverCopyPatterns) if (matchesGlob(rel, pat)) return 'matches neverCopy ' + pat;
  for (const pat of excludePatterns) if (matchesGlob(rel, pat)) return 'matches exclude/excludedSet ' + pat;
  return null;
}

/** True when rel is the named entry or sits underneath it. */
export function isWithinEntry(rel, entry) {
  return rel === entry || rel.startsWith(entry + '/');
}

/**
 * Splits the allowlist excludedSets into literal entries and glob patterns.
 * A set path that carries glob characters is treated as a glob, so the
 * manifest's generated-fixtures set is enforced even when exclude carries no
 * duplicate of it; the optional glob field is honoured as well.
 */
export function normalizeExcludedSets(allowlist) {
  const cfg = allowlist || {};
  const literals = [];
  const globs = [];
  for (const set of cfg.excludedSets || []) {
    const raw = typeof set === 'string' ? set : (set && set.path);
    const normalized = normalizeRel(raw);
    if (normalized) {
      if (/[*?]/.test(normalized)) globs.push(normalized);
      else literals.push(normalized);
    }
    if (set && typeof set === 'object' && typeof set.glob === 'string' && set.glob.trim() !== '') globs.push(set.glob);
  }
  return { literals, globs };
}

/** The reason a path is inside a literal excludedSet or matches an excludedSet glob, or null. */
export function excludedSetReason(rel, sets) {
  if (sets.literals.some((entry) => isWithinEntry(rel, entry))) return 'is inside an excludedSet';
  for (const glob of sets.globs) if (matchesGlob(rel, glob)) return 'matches excludedSet ' + glob;
  return null;
}

/**
 * Plans the copy from the manifest allowlist without touching the source
 * checkout. Every tracked blob is checked against include, exclude,
 * excludedSets and neverCopy, so no allowlisted directory entry can drag a
 * refused file beneath it. Returns the kept files, the refusals, and any
 * allowlisted entry that matched nothing in the pinned tree.
 */
export function planCopy(treeFiles, allowlist) {
  const cfg = allowlist || {};
  const include = (cfg.include || []).map(normalizeRel).filter(Boolean);
  const exclude = (cfg.exclude || []).map(String);
  const neverCopy = (cfg.neverCopy || []).map((n) => (typeof n === 'string' ? n : n.path)).filter(Boolean);
  const excludedSets = normalizeExcludedSets(cfg);
  const excludedGlobs = exclude.slice();
  const refused = [];
  const kept = [];

  for (const rel of treeFiles) {
    const segments = String(rel).split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) {
      refused.push({ path: rel, reason: 'is not a normal relative path in the pinned tree' });
      continue;
    }
    if (!include.some((entry) => isWithinEntry(rel, entry))) continue;
    const setReason = excludedSetReason(rel, excludedSets);
    if (setReason) {
      refused.push({ path: rel, reason: setReason });
      continue;
    }
    const reason = refuseReason(rel, neverCopy, excludedGlobs);
    if (reason) {
      refused.push({ path: rel, reason });
      continue;
    }
    kept.push(rel);
  }

  const unmatched = [];
  for (const entry of include) {
    if (!treeFiles.some((rel) => isWithinEntry(rel, entry))) unmatched.push({ path: entry, reason: 'is allowlisted but matches nothing in the pinned tree' });
  }

  kept.sort();
  refused.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  unmatched.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: kept, refused, unmatched };
}

/**
 * Refuses anything in the produced copy that a plan may never contain, and any
 * link at all: the trial must not depend on linked source. The walk covers the
 * whole copy, not only planned paths.
 */
export function auditProducedCopy(root, allowlist) {
  const cfg = allowlist || {};
  const neverCopy = (cfg.neverCopy || []).map((n) => (typeof n === 'string' ? n : n.path)).filter(Boolean);
  const excludedSets = normalizeExcludedSets(cfg);
  const excludedGlobs = (cfg.exclude || []).map(String);
  const problems = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) {
        problems.push('a link is present in the copy: ' + childRel);
        continue;
      }
      const reason = excludedSetReason(childRel, excludedSets) || refuseReason(childRel, neverCopy, excludedGlobs);
      if (reason) problems.push(childRel + ' (' + reason + ')');
      if (entry.isDirectory()) walk(childRel);
    }
  };
  walk('');
  return problems;
}

/** The pinned commit, its tree, the clean/dirty state and the work-tree root. */
export function inspectSource(sourceDir) {
  const run = (args) => execFileSync('git', args, { cwd: sourceDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  return {
    commit: run(['rev-parse', 'HEAD']),
    tree: run(['rev-parse', 'HEAD^{tree}']),
    status: run(['status', '--porcelain']),
    topLevel: run(['rev-parse', '--show-toplevel']),
  };
}

/** True when the directory is inside a git work tree; a bare object store is not. */
export function isWorkingTree(sourceDir) {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: sourceDir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every entry of a pinned tree, as {mode, type, sha, bytes, path}. Modes, object
 * kinds, sizes and paths are read from the object store, never from the working
 * tree, so a checkout cannot substitute a file the commit does not contain and
 * a plan can report sizes without reading a single blob.
 */
export function readTreeEntries(sourceDir, treeIsh) {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', '-l', '--full-tree', treeIsh], { cwd: sourceDir, maxBuffer: 512 * 1024 * 1024 });
  const out = [];
  for (const record of raw.toString('utf8').split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    if (tab === -1) throw new Error('unexpected ls-tree record: ' + JSON.stringify(record.slice(0, 120)));
    const meta = record.slice(0, tab).trim().split(/\s+/);
    if (meta.length < 3 || meta.length > 4) throw new Error('unexpected ls-tree metadata: ' + JSON.stringify(record.slice(0, 120)));
    const bytes = meta.length === 4 ? Number(meta[3]) : null;
    if (meta.length === 4 && !Number.isInteger(bytes)) throw new Error('unexpected ls-tree size: ' + JSON.stringify(record.slice(0, 120)));
    out.push({ mode: meta[0], type: meta[1], sha: meta[2], bytes, path: record.slice(tab + 1) });
  }
  return out;
}

/** The raw bytes of one pinned blob. */
export function readBlob(sourceDir, blobSha) {
  return execFileSync('git', ['cat-file', 'blob', blobSha], { cwd: sourceDir, maxBuffer: 512 * 1024 * 1024 });
}

/**
 * The bytes of many pinned blobs in one git process, keyed by object id. A
 * single batch is used so a large allowlist does not spawn one process per
 * file, and each returned buffer is checked against the object id the tree
 * recorded before it is trusted.
 */
export function readBlobsBatch(sourceDir, blobShas) {
  const shas = [...new Set(blobShas)];
  if (!shas.length) return new Map();
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: sourceDir,
    input: shas.join('\n') + '\n',
    maxBuffer: 1024 * 1024 * 1024,
  });
  const buffers = new Map();
  let offset = 0;
  for (const requested of shas) {
    const newline = out.indexOf(0x0a, offset);
    if (newline === -1) throw new Error('git cat-file --batch ended before ' + requested);
    const header = out.toString('utf8', offset, newline).trim().split(' ');
    if (header.length < 3 || header[1] !== 'blob') throw new Error('unexpected cat-file header: ' + header.join(' '));
    const headerSha = header[0];
    const size = Number(header[2]);
    if (!Number.isInteger(size)) throw new Error('unexpected cat-file size: ' + header.join(' '));
    const start = newline + 1;
    const end = start + size;
    if (end > out.length) throw new Error('git cat-file --batch truncated ' + requested);
    const buf = out.subarray(start, end);
    if (gitBlobObjectId(buf) !== headerSha) throw new Error('cat-file returned bytes that are not ' + headerSha);
    buffers.set(headerSha, buf);
    offset = end + 1;
  }
  return buffers;
}

/** The git object id of a byte sequence: sha1 over "blob <size>\0" plus the bytes. */
export function gitBlobObjectId(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\u0000', 'utf8').update(buf).digest('hex');
}

/** The tree a commit points at, so any commit-ish that resolves to the pin is accepted. */
export function commitTree(sourceDir, commit) {
  return execFileSync('git', ['rev-parse', commit + '^{tree}'], { cwd: sourceDir, encoding: 'utf8' }).trim();
}

export const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
export const sha256Bytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();

/**
 * The lab the repository configures: <workspace root>/.uniwork-dev/office-g0,
 * resolved by paths.mjs so a linked worktree and the main checkout agree. The
 * source manifest's trialSource.workspaceRoot and labDir are provenance records
 * (its workspaceRoot is an absolute path from one machine), so they are not
 * used to locate the lab on this machine.
 */
export function resolveConfiguredLabRoot(sourceManifest, args = {}, repoRoot = REPO_ROOT) {
  return args.workDir ? path.resolve(args.workDir) : resolveLabRoot(repoRoot);
}

/** The configured lab the manifest names, without any --work-dir override. */
export function configuredLabRoot(sourceManifest, repoRoot = REPO_ROOT) {
  return resolveConfiguredLabRoot(sourceManifest, {}, repoRoot);
}

/** The configured destination directory: the lab plus the manifest's producedDirName. */
export function resolveTargetDir(sourceManifest, args = {}, repoRoot = REPO_ROOT) {
  const trialSource = (sourceManifest && sourceManifest.trialSource) || {};
  const name = trialSource.producedDirName || DEFAULT_PRODUCED_DIR;
  return path.join(resolveConfiguredLabRoot(sourceManifest, args, repoRoot), name);
}

/**
 * The output directory name must be one plain basename: no separators, no
 * traversal, no drive or colon. A manifest that names anything else is refused
 * rather than joined onto the lab, so a hostile name cannot widen the target.
 */
export function producedDirNameProblem(name) {
  if (typeof name !== 'string' || name.trim() === '') return 'is empty';
  if (/[\\/]/.test(name)) return 'contains a path separator';
  if (name === '.' || name === '..') return 'is a traversal segment';
  if (/^[A-Za-z]:/.test(name) || name.includes(':')) return 'contains a drive or colon';
  if (name !== path.basename(name)) return 'is not a single path segment';
  return null;
}

/**
 * The destination must be a real directory inside the configured lab, must not
 * be the lab root or an ancestor of it, and must not overlap the repository or
 * the source checkout. Junctioned ancestors are resolved first, so a link
 * cannot widen the real destination.
 */
export function checkDestination({ targetDir, labRoot, configuredLab, repoRoot, sourceDir, workspaceRoot }) {
  const problems = [];
  const realTarget = realDirectory(targetDir);
  const realLab = realDirectory(labRoot);
  const realConfigured = realDirectory(configuredLab || labRoot);
  const realRepo = realDirectory(repoRoot);
  const realSource = realDirectory(sourceDir);
  // Resolving both sides follows a junction at .uniwork-dev or office-g0, so a
  // linked lab that points outside the workspace is refused instead of being
  // accepted merely because the configured and resolved lab share one path.
  const realWorkspace = realDirectory(workspaceRoot || resolveWorkspaceRoot(repoRoot));
  if (!isInside(realWorkspace, realLab)) problems.push('lab directory ' + realLab + ' is not inside its workspace ' + realWorkspace);
  if (!isInside(realConfigured, realLab)) problems.push('lab directory ' + realLab + ' is not the configured lab ' + realConfigured + ' nor inside it');
  if (!isInside(realLab, realTarget)) problems.push('destination ' + realTarget + ' is not inside the configured lab ' + realLab);
  if (foldCase(realTarget) === foldCase(realLab)) problems.push('destination is the lab directory itself');
  if (isInside(realTarget, realLab)) problems.push('destination is an ancestor of the configured lab');
  if (realSource !== realRepo && overlaps(realTarget, realRepo)) problems.push('destination overlaps the repository at ' + realRepo);
  if (overlaps(realTarget, realSource)) problems.push('destination overlaps the read-only source at ' + realSource);
  return { realTarget, realLab, problems };
}

/** True when an existing target carries a valid marker written by this script. */
export function readManagedMarker(targetDir) {
  const marker = path.join(targetDir, MANAGED_MARKER);
  // lstat, not stat: a linked or directory marker must never authorize a
  // replacement. Only a regular file this script wrote can count as managed.
  let markerStat;
  try {
    markerStat = fs.lstatSync(marker);
  } catch {
    return { managed: false, reason: 'has no ' + MANAGED_MARKER };
  }
  if (markerStat.isSymbolicLink()) return { managed: false, reason: 'has a linked ' + MANAGED_MARKER };
  if (!markerStat.isFile()) return { managed: false, reason: 'has a ' + MANAGED_MARKER + ' that is not a regular file' };
  try {
    const data = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (!data || data.kind !== RECORD_KIND) return { managed: false, reason: 'has a ' + MANAGED_MARKER + ' of a different kind' };
    if (!data.produced || typeof data.produced.path !== 'string') return { managed: false, reason: 'has a marker without a produced.path' };
    return { managed: true, record: data };
  } catch (err) {
    return { managed: false, reason: 'has an unreadable ' + MANAGED_MARKER + ' (' + (err && err.message ? err.message : String(err)) + ')' };
  }
}

/**
 * Refuses to replace anything that is not provably one of our own copies: a
 * real copy has to be replaced explicitly, and a directory at the target path
 * without a valid marker for *this* destination is never deleted. There is no
 * override: an unmarked or foreign-owner directory is always left alone, so an
 * older unmanaged trial-source cannot be overwritten by this script.
 */
export function checkReplaceable({ targetDir, replace }) {
  if (!fs.existsSync(targetDir)) return null;
  if (!replace) return 'destination ' + targetDir + ' already exists; pass --replace to rebuild a copy this script produced';
  const marker = readManagedMarker(targetDir);
  if (!marker.managed) return 'destination ' + targetDir + ' ' + marker.reason + '; refusing to replace it';
  const recorded = marker.record.produced.path;
  if (foldCase(path.resolve(recorded)) !== foldCase(path.resolve(targetDir))) {
    return 'destination ' + targetDir + ' carries a record for ' + recorded + '; refusing to replace a copy another destination produced';
  }
  return null;
}

/** A staging path owned by this run: inside the lab, a sibling of the target. */
export function makeStagingDir(labRoot, nonce) {
  return path.join(labRoot, STAGING_PREFIX + nonce);
}

function newNonce() {
  return process.pid + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

/** The plan a record is written from: one entry per produced file, in plan order. */
export function buildRecord({ labRoot, sourceDir, sourceManifest, state, targetDir, files, replaced, notes }) {
  return {
    schemaVersion: 2,
    kind: RECORD_KIND,
    issue: 'UNI-666',
    parentIssue: 'UNI-656',
    task: 'DOC-002 2.4',
    sourceManifest: 'docs/office/g0/source-manifest.json',
    fixtureManifest: 'docs/office/g0/fixtures/manifest.json',
    source: { path: sourceDir, commit: state.commit, tree: state.tree, clean: state.status === '', extraction: 'git object store at the pinned commit' },
    produced: {
      path: targetDir,
      baseName: path.basename(targetDir),
      labRoot,
      fileCount: files.length,
      bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    },
    replacedPrevious: replaced,
    allowlistMode: sourceManifest.allowlist.mode,
    allowlistInclude: (sourceManifest.allowlist.include || []).slice(),
    excludedSets: (sourceManifest.allowlist.excludedSets || []).map((s) => s.path),
    neverCopy: (sourceManifest.allowlist.neverCopy || []).map((n) => n.path),
    files,
    notes,
  };
}

/** Compares the produced bytes against the plan and the source manifest's lockfile record. */
export function verifyProducedCopy(staging, files, lockfile) {
  const problems = [];
  const onDisk = [];
  const walk = (rel) => {
    const abs = path.join(staging, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) {
        problems.push('a link was produced at ' + childRel);
        continue;
      }
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) onDisk.push(childRel);
      else problems.push('an unsupported entry type was produced at ' + childRel);
    }
  };
  walk('');

  const expected = files.map((f) => f.path).slice().sort();
  const actual = onDisk.filter((rel) => rel !== MANAGED_MARKER).sort();
  const missing = expected.filter((p) => !actual.includes(p));
  const extra = actual.filter((p) => !expected.includes(p));
  if (missing.length) problems.push('missing planned file(s): ' + missing.slice(0, 5).join(', '));
  if (extra.length) problems.push('unplanned file(s) present: ' + extra.slice(0, 5).join(', '));
  for (const f of files) {
    const abs = path.join(staging, f.path);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).size !== f.bytes) problems.push(f.path + ' size does not match the plan');
    else if (sha256File(abs) !== f.sha256) problems.push(f.path + ' sha256 does not match the plan');
  }
  if (lockfile && lockfile.path) {
    const abs = path.join(staging, lockfile.path);
    if (!fs.existsSync(abs)) problems.push('lockfile ' + lockfile.path + ' is missing from the copy');
    else if (lockfile.sha256 && sha256File(abs) !== lockfile.sha256.toUpperCase()) problems.push('lockfile ' + lockfile.path + ' does not match the source manifest sha256');
  }
  return problems;
}

/**
 * Removes a staging directory only when the resolved path really is a staging
 * directory directly inside the configured lab. The lab root, the target, the
 * repository and the source are refused, so a bad argument cannot delete data.
 */
export function cleanupStaging(staging, labRoot, repoRoot, sourceDir) {
  if (!fs.existsSync(staging)) return false;
  const real = realDirectory(staging);
  if (!isInside(realDirectory(labRoot), real)) return false;
  if (!path.basename(real).startsWith(STAGING_PREFIX)) return false;
  if (overlaps(real, repoRoot) || overlaps(real, sourceDir)) return false;
  fs.rmSync(real, { recursive: true, force: true });
  return true;
}

/**
 * Promotes staging onto the target. An existing copy is moved aside first, so an
 * interrupted promotion leaves the previous copy recoverable rather than
 * deleted; the backup is removed only once the new copy is in place.
 */
export function promote({ staging, targetDir, nonce, log }) {
  const backup = targetDir + '.previous-' + nonce;
  const hadTarget = fs.existsSync(targetDir);
  if (hadTarget) fs.renameSync(targetDir, backup);
  try {
    fs.renameSync(staging, targetDir);
  } catch (err) {
    if (hadTarget && fs.existsSync(backup) && !fs.existsSync(targetDir)) {
      fs.renameSync(backup, targetDir);
      log('prepare-source: promotion failed; the previous copy was restored');
    }
    throw err;
  }
  if (hadTarget) fs.rmSync(backup, { recursive: true, force: true });
  return { hadTarget };
}

/** The pinned hash of one path in a commit, or null when it is not in the tree. */
export function pinnedFileHash(extractRoot, commit, rel, readBlobFn = readBlob) {
  try {
    const sha = execFileSync('git', ['rev-parse', commit + ':' + rel], { cwd: extractRoot, encoding: 'utf8' }).trim();
    const buf = readBlobFn(extractRoot, sha);
    return { objectId: sha, bytes: buf.length, sha256: sha256Bytes(buf) };
  } catch {
    return null;
  }
}

/** The licence and notice files must be the pinned bytes before anything ships with them. */
export function verifyLicenseFiles({ extractRoot, commit, sourceManifest, readBlobFn = readBlob }) {
  const problems = [];
  const declared = (sourceManifest.licenses && sourceManifest.licenses.licenseFiles) || [];
  const required = ['LICENSE', 'NOTICE'];
  const paths = required.concat(declared.map((l) => l.path).filter((p) => !required.includes(p)));
  for (const rel of paths) {
    const hash = pinnedFileHash(extractRoot, commit, rel, readBlobFn);
    if (hash === null) {
      problems.push('license file ' + rel + ' is not in the pinned tree');
      continue;
    }
    const entry = declared.find((l) => l.path === rel);
    if (entry && entry.sha256 && entry.sha256.toUpperCase() !== hash.sha256) {
      problems.push('license file ' + rel + ' has pinned bytes ' + hash.sha256 + ' but the source manifest records ' + entry.sha256);
    }
    if (entry && Number.isInteger(entry.bytes) && entry.bytes !== hash.bytes) {
      problems.push('license file ' + rel + ' is ' + hash.bytes + ' bytes but the source manifest records ' + entry.bytes);
    }
  }
  return problems;
}

/** The lockfile must be the pinned bytes, so the trial installs the reviewed dependency set. */
export function verifyLockfile({ extractRoot, commit, sourceManifest, readBlobFn = readBlob }) {
  const lock = sourceManifest.lockfile;
  if (!lock || !lock.path) return [];
  const hash = pinnedFileHash(extractRoot, commit, lock.path, readBlobFn);
  if (hash === null) return ['lockfile ' + lock.path + ' is not in the pinned tree'];
  const problems = [];
  if (lock.sha256 && lock.sha256.toUpperCase() !== hash.sha256) {
    problems.push('lockfile ' + lock.path + ' has pinned bytes ' + hash.sha256 + ' but the source manifest records ' + lock.sha256);
  }
  if (Number.isInteger(lock.bytes) && lock.bytes !== hash.bytes) {
    problems.push('lockfile ' + lock.path + ' is ' + hash.bytes + ' bytes but the source manifest records ' + lock.bytes);
  }
  return problems;
}

export function run(argv = process.argv.slice(2), opts = {}) {
  const args = parseArgs(argv);
  const log = (m) => process.stdout.write(m + '\n');
  if (args.help) {
    process.stdout.write('usage: node scripts/office-g0/prepare-source.mjs [--source <genoffice>] [--work-dir <lab>] [--dry-run] [--replace] [--print-plan] [--verbose]\n');
    return 0;
  }

  const repoRoot = opts.repoRoot || REPO_ROOT;
  const sourceManifest = JSON.parse(fs.readFileSync(opts.sourceManifestPath || SOURCE_MANIFEST_PATH, 'utf8'));
  const fixtureManifest = JSON.parse(fs.readFileSync(opts.fixtureManifestPath || CAPABILITY_MANIFEST_PATH, 'utf8'));
  const declaredName = sourceManifest.trialSource && sourceManifest.trialSource.producedDirName;
  if (declaredName !== undefined && declaredName !== null) {
    const nameProblem = producedDirNameProblem(declaredName);
    if (nameProblem) {
      process.stderr.write('prepare-source: trialSource.producedDirName ' + JSON.stringify(declaredName) + ' ' + nameProblem + '\n');
      return 1;
    }
  }
  const sourceArg = path.resolve(args.source || opts.source || resolveUpstreamSource(repoRoot));
  const labRoot = resolveConfiguredLabRoot(sourceManifest, args, repoRoot);
  const targetDir = resolveTargetDir(sourceManifest, args, repoRoot);

  if (!fs.existsSync(sourceArg)) {
    process.stderr.write('prepare-source: source checkout not found at ' + sourceArg + '\n');
    return 2;
  }
  if (!isWorkingTree(sourceArg)) {
    process.stderr.write('prepare-source: ' + sourceArg + ' is not a git working tree; a pinned commit cannot be read from it\n');
    return 2;
  }

  // --source may name the checkout or any path inside it; the pinned objects are
  // always read from the work-tree root git reports for it.
  const sourceDir = inspectSource(sourceArg).topLevel || sourceArg;
  const state = inspectSource(sourceDir);
  const problems = [];
  const pinnedCommit = fixtureManifest.upstreamCommit;
  const pinnedTree = sourceManifest.upstream && sourceManifest.upstream.pinnedTree;
  if (state.commit !== pinnedCommit) problems.push('source HEAD is ' + state.commit + ' but the fixture manifest pins ' + pinnedCommit);
  if (state.tree !== pinnedTree) problems.push('source tree is ' + state.tree + ' but the source manifest pins ' + pinnedTree);
  if (!COMMIT_RE.test(state.commit || '')) problems.push('source HEAD is not a full 40-character commit id');
  if (problems.length) {
    for (const p of problems) process.stderr.write('prepare-source: ' + p + '\n');
    return 1;
  }

  let entries;
  try {
    entries = readTreeEntries(sourceDir, pinnedCommit);
  } catch (err) {
    process.stderr.write('prepare-source: cannot read the pinned tree ' + pinnedTree + ' (' + (err && err.message ? err.message : String(err)) + ')\n');
    return 2;
  }

  // Object-kind and mode policy: the copy must carry regular files only.
  const rejected = [];
  const blobs = [];
  for (const e of entries) {
    if (e.type === 'commit' || e.mode === '160000') {
      rejected.push({ path: e.path, reason: 'is a gitlink (a submodule the copy must not depend on)' });
      continue;
    }
    if (e.mode === '120000') {
      rejected.push({ path: e.path, reason: 'is a symlink in the pinned tree' });
      continue;
    }
    if (e.type === 'blob' && BLOB_MODES.includes(e.mode)) {
      blobs.push({ path: e.path, sha: e.sha, mode: e.mode });
      continue;
    }
    if (e.type === 'tree' && e.mode === '040000') continue;
    rejected.push({ path: e.path, reason: 'has mode ' + e.mode + '/' + e.type + ' which the copy must not carry' });
  }

  const plan = planCopy(blobs.map((b) => b.path), sourceManifest.allowlist);
  const byRel = new Map(blobs.map((b) => [b.path, b]));

  const integrity = []
    .concat(verifyLicenseFiles({ extractRoot: sourceDir, commit: pinnedCommit, sourceManifest }))
    .concat(verifyLockfile({ extractRoot: sourceDir, commit: pinnedCommit, sourceManifest }));

  const blocking = [];
  for (const r of rejected) blocking.push('refusing ' + r.path + ' (' + r.reason + ')');
  for (const r of plan.unmatched) blocking.push('allowlisted entry ' + r.path + ' ' + r.reason);
  for (const p of integrity) blocking.push(p);
  if (blocking.length) {
    for (const p of blocking) process.stderr.write('prepare-source: ' + p + '\n');
    return 1;
  }
  if (!plan.files.length) {
    process.stderr.write('prepare-source: the allowlist selected no file from the pinned tree\n');
    return 1;
  }

  // --print-plan exposes the resolved plan without touching the destination, so
  // the plan itself can be asserted on.
  if (args.printPlan || opts.printPlan) {
    process.stdout.write(JSON.stringify(Object.assign({ commit: state.commit, tree: state.tree }, plan)) + '\n');
    return 0;
  }

  // Bytes are read once in a single batch, hashed, and reused for both the size
  // report and the copy.
  const reads = new Map();
  let batch;
  try {
    batch = readBlobsBatch(sourceDir, plan.files.map((rel) => byRel.get(rel).sha));
  } catch (err) {
    process.stderr.write('prepare-source: cannot read the pinned blobs (' + (err && err.message ? err.message : String(err)) + ')\n');
    return 2;
  }
  for (const rel of plan.files) {
    const buf = batch.get(byRel.get(rel).sha);
    if (!buf) {
      process.stderr.write('prepare-source: the pinned blob for ' + rel + ' is missing from the object store\n');
      return 2;
    }
    reads.set(rel, buf);
  }
  const totalBytes = plan.files.reduce((sum, rel) => sum + reads.get(rel).length, 0);

  log('source: ' + state.commit.slice(0, 12) + ', tree ' + state.tree.slice(0, 12) + (state.status === '' ? ', clean' : ', dirty (bytes come from the pinned commit)'));
  log('planned: ' + plan.files.length + ' files, ' + totalBytes + ' bytes -> ' + targetDir);
  log('excluded: ' + plan.refused.length + ' tracked file(s) under exclude/excludedSets/neverCopy');
  if (args.verbose) for (const r of plan.refused) log('  excluded: ' + r.path + ' (' + r.reason + ')');

  const destination = checkDestination({ targetDir, labRoot, configuredLab: configuredLabRoot(sourceManifest, repoRoot), repoRoot, sourceDir, workspaceRoot: resolveWorkspaceRoot(repoRoot) });
  for (const p of destination.problems) process.stderr.write('prepare-source: ' + p + '\n');
  if (destination.problems.length) return 1;

  const replaceProblem = checkReplaceable({ targetDir, replace: args.replace });
  if (replaceProblem) {
    process.stderr.write('prepare-source: ' + replaceProblem + '\n');
    return 1;
  }

  if (args.dryRun) {
    log('prepare-source: dry run only; nothing was written');
    return 0;
  }

  fs.mkdirSync(labRoot, { recursive: true });
  const nonce = newNonce();
  const staging = makeStagingDir(labRoot, nonce);
  cleanupStaging(staging, labRoot, repoRoot, sourceDir);
  fs.mkdirSync(staging, { recursive: true });

  const copied = [];
  let writeError = null;
  try {
    for (const rel of plan.files) {
      const buf = reads.get(rel);
      const to = path.join(staging, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, buf);
      copied.push({ path: rel, mode: byRel.get(rel).mode, bytes: buf.length, sha256: sha256Bytes(buf) });
    }

    const record = buildRecord({
      labRoot,
      sourceDir,
      sourceManifest,
      state,
      targetDir,
      files: copied,
      replaced: fs.existsSync(targetDir),
      notes: [
        'This copy is a survey and build sandbox; it is not the production source tree.',
        'Bytes come from the git object store at the pinned commit, not from the working tree, so ignored and dirty files cannot enter it.',
        'Dependencies, when a later step installs them, come from the pinned lockfile inside the copy and never from the user checkout; this prepare step itself installs nothing.',
        'Re-running with --replace rebuilds the copy deterministically; the record is rewritten with it.',
      ],
    });
    fs.writeFileSync(path.join(staging, MANAGED_MARKER), JSON.stringify(record, null, 2) + '\n', 'utf8');

    const audit = auditProducedCopy(staging, sourceManifest.allowlist).concat(verifyProducedCopy(staging, copied, sourceManifest.lockfile));
    if (audit.length) {
      for (const a of audit) process.stderr.write('prepare-source: ' + a + '\n');
      writeError = 'the produced copy failed its own audit';
    }
  } catch (err) {
    writeError = err && err.message ? err.message : String(err);
  }

  if (writeError) {
    cleanupStaging(staging, labRoot, repoRoot, sourceDir);
    process.stderr.write('prepare-source: ' + writeError + '; the previous copy was kept and only this run\'s staging was removed\n');
    return 1;
  }

  try {
    promote({ staging, targetDir, nonce, log });
  } catch (err) {
    cleanupStaging(staging, labRoot, repoRoot, sourceDir);
    process.stderr.write('prepare-source: could not promote the copy into place (' + (err && err.message ? err.message : String(err)) + ')\n');
    return 1;
  }

  log('prepare-source: wrote ' + copied.length + ' files to ' + targetDir);
  log('prepare-source: record at ' + path.join(targetDir, MANAGED_MARKER));
  return 0;
}

export const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write('prepare-source: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(2);
  }
}
