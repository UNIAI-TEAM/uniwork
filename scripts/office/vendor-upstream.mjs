#!/usr/bin/env node
// G2-01b (UNI-684) - vendors the selected GenOffice capability source into
// packages/office-upstream so a clean checkout builds without ../genoffice.
//
// Extraction reuses the G0 source tooling (scripts/office-g0/prepare-source.mjs):
// bytes come from the git object store at the pinned commit, never from the
// working tree, so ignored, generated or dirty files cannot enter the copy.
// The selection below is a subset of the accepted manifest allowlist
// (docs/office/g0/source-manifest.json); every selected file must survive the
// same planCopy() checks the trial source passes (include, exclude,
// excludedSets, neverCopy), so /ee, caches and generated trees are refused
// rather than filtered after the fact.
//
//   node scripts/office/vendor-upstream.mjs --source /path/to/genoffice
//   node scripts/office/vendor-upstream.mjs --check          # verify vendored bytes
//
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  inspectSource,
  readTreeEntries,
  planCopy,
  readBlobsBatch,
  auditProducedCopy,
  isWithinEntry,
  sha256Bytes,
} from '../office-g0/prepare-source.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

export const PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'office-upstream');
export const UPSTREAM_DIR = path.join(PACKAGE_DIR, 'upstream');
export const PROVENANCE_PATH = path.join(PACKAGE_DIR, 'provenance.json');
export const SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'source-manifest.json');
export const RECORD_KIND = 'uniwork-office-upstream-provenance';
// Apache-2.0 attribution duplicated at the package root: check-boundaries.mjs
// requires packages/office-upstream/{LICENSE,NOTICE} beside the vendored tree.
export const ATTRIBUTION_FILES = ['LICENSE', 'NOTICE'];

// The G2-01 capability selection: the format engine packages plus the
// main-process engine glue that is the ONLY home of the PDF, XLSX-sidecar and
// format save paths upstream (apps/*/src/main with their closed src/shared
// dependency), the Rust xlsx sidecar the frozen engine patch series applies
// to, the sheets fixture builder the repo's fixture generator imports, and
// the root manifests/config the reproducible build consumes. Editor renderer
// shells, AI/agent packages and the CLI stay out: they are upstream product
// surfaces, not engine source.
export const SELECTION = [
  'packages/docx-engine',
  'packages/pptx-ops',
  'packages/pptx-engine',
  'packages/pptx-render',
  'packages/xlsx-gateway',
  'packages/file-parse',
  'packages/pdf2docx',
  'packages/html2docx',
  'packages/font-metrics',
  'packages/i18n',
  'packages/project-store',
  'apps/docs/src/main',
  'apps/docs/src/shared',
  'apps/sheets/src/main',
  'apps/sheets/src/shared',
  'apps/sheets/native',
  'apps/sheets/tests/fixture-builder.ts',
  'apps/slides/src/main',
  'apps/slides/src/shared',
  'apps/pdf/src/main',
  'apps/pdf/src/shared',
  'apps/markdown/src/main',
  'apps/markdown/src/shared',
  'apps/html/src/main',
  'apps/html/src/shared',
  'LICENSE',
  'LICENSE-UNICODE.txt',
  'NOTICE',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'vitest.config.ts',
];

/** The git blob id of file contents, recomputed the same way git stores it. */
export function gitBlobSha(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
}

/** One anchor digest over every recorded (path, sha256, blob, mode) tuple. */
export function filesDigest(files) {
  const hash = crypto.createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(f.path + '\0' + f.sha256 + '\0' + (f.blob || '') + '\0' + (f.mode || '') + '\n');
  }
  return hash.digest('hex');
}

export function parseArgs(argv) {
  const out = { source: null, check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--check') out.check = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

export function loadManifest() {
  return JSON.parse(fs.readFileSync(SOURCE_MANIFEST_PATH, 'utf8'));
}

/** The refusal the shared plan recorded for a path, or null when it was kept. */
function refusalOf(plan, rel) {
  const hit = (plan.refused || []).find((r) => r.path === rel);
  return hit ? hit.reason : null;
}

/**
 * Copies every selected pinned blob into packages/office-upstream/upstream,
 * writes per-file provenance and plants the Apache-2.0 attribution beside the
 * tree. A selected path the shared allowlist plan refuses stops the run
 * before a single byte lands, and the produced copy is audited for links and
 * refused material afterwards.
 */
export function vendor({ sourceDir, manifest, commit }) {
  const include = (manifest.allowlist.include || []).map((p) => p.replace(/\/+$/, ''));
  for (const sel of SELECTION) {
    if (!include.some((inc) => sel === inc || sel.startsWith(inc + '/'))) {
      throw new Error(`selection ${sel} is outside the accepted manifest allowlist`);
    }
  }

  const info = inspectSource(sourceDir);
  if (info.commit !== commit) {
    throw new Error(`source checkout is at ${info.commit}, expected pinned ${commit}`);
  }
  if (info.tree !== manifest.upstream.pinnedTree) {
    throw new Error(`pinned commit tree is ${info.tree}, expected ${manifest.upstream.pinnedTree}`);
  }

  const entries = readTreeEntries(sourceDir, commit);
  const plan = planCopy(entries.map((e) => e.path), manifest.allowlist);
  const kept = new Set(plan.files);

  const selected = entries.filter((e) => SELECTION.some((sel) => isWithinEntry(e.path, sel)));
  for (const sel of SELECTION) {
    if (!selected.some((e) => isWithinEntry(e.path, sel))) {
      throw new Error(`selection ${sel} matches nothing in the pinned tree`);
    }
  }
  for (const entry of selected) {
    if (!kept.has(entry.path)) {
      const reason = refusalOf(plan, entry.path) || 'not in the allowlist plan';
      throw new Error(`refused by manifest policy: ${entry.path} (${reason}); narrow the selection`);
    }
    if (entry.type !== 'blob') throw new Error(`selection hit a non-blob entry: ${entry.path}`);
  }

  const blobs = readBlobsBatch(sourceDir, selected.map((e) => e.sha));
  const files = [];
  for (const entry of selected) {
    const buf = blobs.get(entry.sha);
    if (!buf) throw new Error(`blob ${entry.sha} for ${entry.path} was not returned`);
    const target = path.join(UPSTREAM_DIR, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    files.push({
      path: entry.path,
      bytes: buf.length,
      sha256: sha256Bytes(buf),
      blob: entry.sha,
      mode: entry.mode,
    });
    if (ATTRIBUTION_FILES.includes(entry.path)) fs.writeFileSync(path.join(PACKAGE_DIR, entry.path), buf);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  const audit = auditProducedCopy(UPSTREAM_DIR, manifest.allowlist);
  if (audit.length) throw new Error('produced copy failed the source audit: ' + audit.join('; '));

  const record = {
    kind: RECORD_KIND,
    schemaVersion: 1,
    upstream: {
      name: manifest.upstream.name,
      repository: manifest.upstream.repository,
      pinnedCommit: commit,
      pinnedTree: manifest.upstream.pinnedTree,
      licenseIdentifier: manifest.upstream.licenseIdentifier,
      licenseHolder: manifest.upstream.licenseHolder,
    },
    selection: SELECTION,
    fileCount: files.length,
    integrity: { filesDigest: filesDigest(files) },
    files,
  };
  fs.writeFileSync(PROVENANCE_PATH, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/**
 * Every drift between provenance.json and the bytes on disk: a missing,
 * modified or untracked file, a link, or refused material inside the vendored
 * tree. The package-root attribution files are checked against the provenance
 * entries for the same upstream paths.
 */
export function checkVendored(manifest) {
  const problems = [];
  if (!fs.existsSync(PROVENANCE_PATH)) return [{ problem: 'missing provenance.json' }];
  const record = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
  if (record.kind !== RECORD_KIND) problems.push({ problem: `provenance kind is ${record.kind}` });
  if (record.upstream?.pinnedCommit !== manifest.upstream.pinnedCommit) problems.push({ problem: 'pinned commit mismatch' });
  if (record.upstream?.pinnedTree !== manifest.upstream.pinnedTree) problems.push({ problem: 'pinned tree mismatch' });
  if (record.integrity?.filesDigest !== filesDigest(record.files || [])) {
    problems.push({ problem: 'integrity.filesDigest does not match the recorded file set - provenance was edited after vendoring' });
  }
  const seen = new Set();
  const byPath = new Map((record.files || []).map((f) => [f.path, f]));
  for (const f of record.files || []) {
    seen.add(f.path);
    const p = path.join(UPSTREAM_DIR, f.path);
    if (!fs.existsSync(p)) { problems.push({ path: f.path, problem: 'missing' }); continue; }
    const buf = fs.readFileSync(p);
    const h = sha256Bytes(buf);
    if (h !== f.sha256) problems.push({ path: f.path, problem: `sha256 ${h} != ${f.sha256}` });
    const blob = gitBlobSha(buf);
    if (f.blob && blob !== f.blob) problems.push({ path: f.path, problem: `git blob ${blob} != ${f.blob}` });
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(UPSTREAM_DIR, abs).split(path.sep).join('/');
      if (e.isSymbolicLink()) { problems.push({ path: rel, problem: 'link in vendored tree' }); continue; }
      if (e.isDirectory()) walk(abs);
      else if (!seen.has(rel)) problems.push({ path: rel, problem: 'untracked file in vendored tree' });
    }
  };
  if (fs.existsSync(UPSTREAM_DIR)) walk(UPSTREAM_DIR);
  for (const name of ATTRIBUTION_FILES) {
    const p = path.join(PACKAGE_DIR, name);
    const expected = byPath.get(name);
    if (!expected) { problems.push({ problem: `provenance lacks ${name}; cannot verify attribution` }); continue; }
    if (!fs.existsSync(p)) { problems.push({ problem: `${name} missing at package root` }); continue; }
    if (sha256Bytes(fs.readFileSync(p)) !== expected.sha256) problems.push({ problem: `${name} at package root differs from the vendored copy` });
  }
  for (const issue of auditProducedCopy(UPSTREAM_DIR, manifest.allowlist)) {
    problems.push({ problem: 'audit: ' + issue });
  }
  return problems;
}

/**
 * The strongest available check: every recorded path must exist in the pinned
 * upstream tree with the same blob id. This is what makes "edit file + edit
 * provenance" impossible to hide: the anchor is the pinned upstream objects,
 * not the provenance record itself. Requires --source <genoffice checkout>.
 */
export function checkAgainstPinnedTree(manifest, sourceDir) {
  const problems = [];
  const record = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
  const info = inspectSource(sourceDir);
  if (info.commit !== manifest.upstream.pinnedCommit) {
    problems.push({ problem: `source checkout is at ${info.commit}, expected pinned ${manifest.upstream.pinnedCommit}` });
    return problems;
  }
  if (info.tree !== manifest.upstream.pinnedTree) {
    problems.push({ problem: `pinned commit tree is ${info.tree}, expected ${manifest.upstream.pinnedTree}` });
    return problems;
  }
  const upstream = new Map(readTreeEntries(sourceDir, info.commit).map((e) => [e.path, e]));
  const seen = new Set();
  for (const f of record.files || []) {
    seen.add(f.path);
    const entry = upstream.get(f.path);
    if (!entry) { problems.push({ path: f.path, problem: 'not in the pinned upstream tree' }); continue; }
    if (entry.sha !== f.blob) problems.push({ path: f.path, problem: `upstream blob ${entry.sha} != recorded ${f.blob}` });
    if (entry.mode && f.mode && entry.mode !== f.mode) problems.push({ path: f.path, problem: `mode ${f.mode} != upstream ${entry.mode}` });
  }
  for (const [p, e] of upstream) {
    if (!seen.has(p) && e.type === 'blob' && SELECTION.some((sel) => isWithinEntry(p, sel))) {
      problems.push({ path: p, problem: 'selected upstream blob absent from provenance' });
    }
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: vendor-upstream.mjs --source <genoffice checkout> | --check');
    return;
  }
  const manifest = loadManifest();
  const commit = manifest.upstream.pinnedCommit;
  if (args.check) {
    const problems = checkVendored(manifest);
    let pinnedChecked = false;
    if (args.source) {
      const pinned = checkAgainstPinnedTree(manifest, path.resolve(args.source));
      problems.push(...pinned);
      pinnedChecked = true;
    }
    if (problems.length) {
      console.log(JSON.stringify({ ok: false, problems }, null, 1));
      process.exit(1);
    }
    console.log('vendor-upstream: OK - vendored bytes match provenance.json' +
      (pinnedChecked ? ' and every recorded blob matches the pinned upstream tree' : ''));
    return;
  }
  if (!args.source) throw new Error('--source <genoffice checkout> is required');
  const record = vendor({ sourceDir: path.resolve(args.source), manifest, commit });
  console.log(JSON.stringify({ ok: true, fileCount: record.fileCount, out: UPSTREAM_DIR }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });
