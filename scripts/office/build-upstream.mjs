#!/usr/bin/env node
// G2-01b (UNI-684) - reproducible build of the vendored GenOffice engine source.
//
// Runs from a clean checkout: the vendored bytes in packages/office-upstream are
// provenance-checked, copied to a gitignored scratch dir, patched with the
// patch series, and built with dependencies installed from the vendored
// upstream package-lock (public npm registry only - no ../genoffice, no
// symlinks to it, no private registry). esbuild comes from the UniWork repo
// catalog/lockfile, never from a prepared upstream tree.
//
//   node scripts/office/build-upstream.mjs                # full build
//   node scripts/office/build-upstream.mjs --skip-install # reuse existing deps
//   node scripts/office/build-upstream.mjs --out <dir> --json
//
// Artifacts land in <out>/dist/*.mjs with sha256 recorded in
// <out>/build-record.json. A missing input, failed install or failed bundle
// exits non-zero; native work the script does not attempt is reported as
// not-attempted, never as built.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '../office-g0/paths.mjs';
import {
  PACKAGE_DIR,
  UPSTREAM_DIR,
  PROVENANCE_PATH,
  RECORD_KIND,
  loadManifest,
  checkVendored,
} from './vendor-upstream.mjs';

export const PATCHES_DIR = path.join(PACKAGE_DIR, 'patches');
export const DEFAULT_OUT = path.join(REPO_ROOT, '.go-tmp', 'office-upstream-build');
export const BUILD_RECORD_KIND = 'uniwork-office-upstream-build-record';

// Heavy/native/browser-host deps stay external to the engine bundles: they are
// resolved by the adapter lanes (G2-03..06) from the real install, and bundling
// binaries or wasm payloads would fabricate functionality this lane must not
// claim. Everything else is bundled so each artifact is self-contained.
export const BUNDLE_EXTERNALS = [
  'electron',
  '@embedpdf/*',
  'pdfjs-dist',
  'playwright-core',
  'canvas',
  '@napi-rs/*',
  'harfbuzzjs',
  'sharp',
  'fsevents',
];

export function parseArgs(argv) {
  const out = { out: null, skipInstall: false, withNative: false, json: false, keep: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--skip-install') out.skipInstall = true;
    else if (a === '--with-native') out.withNative = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

export const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();

function fail(record, step, detail) {
  record.steps.push({ step, status: 'fail', detail });
  record.verdict = 'fail';
  throw Object.assign(new Error(step + ': ' + detail), { record });
}

/** Exact versions the vendored package-lock pins for a dependency name. */
export function lockedVersions(lock, name) {
  const found = new Map();
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    if (!key.endsWith('node_modules/' + name)) continue;
    if (meta.link) continue;
    found.set(meta.version, key);
  }
  return found;
}

/** The workspace packages inside the copied tree, in dependency order. */
export function buildOrder(scratchUpstream) {
  const dir = path.join(scratchUpstream, 'packages');
  const pkgs = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const pj = path.join(dir, name, 'package.json');
    if (!fs.existsSync(pj)) continue;
    const meta = JSON.parse(fs.readFileSync(pj, 'utf8'));
    pkgs.push({ dir: name, name: meta.name, deps: meta.dependencies || {}, exports: meta.exports });
  }
  const internal = new Set(pkgs.map((p) => p.name));
  const edges = new Map(pkgs.map((p) => [p.name, Object.keys(p.deps).filter((d) => internal.has(d))]));
  const order = [];
  const visiting = new Set();
  const done = new Set();
  const visit = (n, chain) => {
    if (done.has(n)) return;
    if (visiting.has(n)) throw new Error('dependency cycle: ' + [...chain, n].join(' -> '));
    visiting.add(n);
    for (const d of edges.get(n) || []) visit(d, [...chain, n]);
    visiting.delete(n);
    done.add(n);
    order.push(n);
  };
  for (const p of pkgs) visit(p.name, []);
  return { order, pkgs: new Map(pkgs.map((p) => [p.name, p])) };
}

/**
 * Entry point of a vendored package for bundling (raw .ts exports). Packages
 * with wildcard-only exports have no "." to read; their engine entry is named
 * here the same way the G0 engine hosts address it.
 */
export const ENTRY_OVERRIDES = { 'xlsx-gateway': 'src/gateway/xlsx-gateway.ts' };

function entryOf(pkg) {
  if (ENTRY_OVERRIDES[pkg.dir]) return ENTRY_OVERRIDES[pkg.dir];
  const dot = pkg.exports && pkg.exports['.'];
  if (typeof dot === 'string') return dot.replace(/^\.\//, '');
  if (dot && typeof dot === 'object' && typeof dot.default === 'string') return dot.default.replace(/^\.\//, '');
  return 'src/index.ts';
}

/** Inline `import x from './f.md?raw'` used by pptx-ops (mirrors prebundle-engine). */
const rawTextPlugin = {
  name: 'raw-text',
  setup(b) {
    b.onResolve({ filter: /[?]raw$/ }, (a) => ({
      path: path.resolve(a.resolveDir, a.path.replace(/[?]raw$/, '')),
      namespace: 'raw-text',
    }));
    b.onLoad({ filter: /.*/, namespace: 'raw-text' }, (a) => ({
      contents: 'export default ' + JSON.stringify(fs.readFileSync(a.path, 'utf8')),
      loader: 'js',
    }));
  },
};

/**
 * Synthetic manifest for the scratch workspace: every external dependency of
 * every vendored package pinned to the exact version the vendored
 * package-lock resolves, plus single-version transitive pins as overrides.
 */
export function scratchManifest(scratchUpstream, lock) {
  const direct = new Map();
  for (const dirName of fs.readdirSync(path.join(scratchUpstream, 'packages')).sort()) {
    const pj = path.join(scratchUpstream, 'packages', dirName, 'package.json');
    if (!fs.existsSync(pj)) continue;
    const meta = JSON.parse(fs.readFileSync(pj, 'utf8'));
    for (const [dep, range] of Object.entries(meta.dependencies || {})) {
      if (dep.startsWith('@genoffice/')) continue;
      const versions = lockedVersions(lock, dep);
      if (!versions.size) throw new Error(`no locked version for ${dep} (wanted ${range} by ${meta.name})`);
      const pinned = [...versions.keys()].sort().pop();
      if (direct.has(dep) && direct.get(dep) !== pinned) throw new Error(`conflicting locked versions for ${dep}`);
      direct.set(dep, pinned);
    }
  }
  for (const dep of ['tsx', 'typescript', 'vitest', '@types/node', 'pptxgenjs', 'pdf-lib']) {
    const versions = lockedVersions(lock, dep);
    if (!versions.size) throw new Error(`required dev tool ${dep} is not in the vendored lock`);
    direct.set(dep, [...versions.keys()].sort().pop());
  }
  const overrides = {};
  const names = new Set();
  for (const key of Object.keys(lock.packages || {})) {
    const at = key.lastIndexOf('node_modules/');
    if (at === -1) continue;
    names.add(key.slice(at + 'node_modules/'.length));
  }
  for (const name of names) {
    const versions = lockedVersions(lock, name);
    if (versions.size === 1 && !name.startsWith('@genoffice/')) overrides[name] = [...versions.keys()][0];
  }
  return {
    name: 'office-upstream-build',
    private: true,
    workspaces: ['upstream/packages/*'],
    dependencies: Object.fromEntries([...direct.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    overrides,
  };
}

export async function run({ out, skipInstall, withNative, keep }) {
  const startedAt = new Date().toISOString();
  const record = {
    kind: BUILD_RECORD_KIND,
    schemaVersion: 1,
    startedAt,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    command: 'node ' + path.relative(REPO_ROOT, process.argv[1] || 'scripts/office/build-upstream.mjs'),
    steps: [],
    patchesApplied: [],
    artifacts: [],
    verdict: 'fail',
  };
  const manifest = loadManifest();
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
  if (provenance.kind !== RECORD_KIND) throw new Error('provenance.json kind mismatch');
  const problems = checkVendored(manifest);
  if (problems.length) fail(record, 'provenance', JSON.stringify(problems.slice(0, 5)));
  record.steps.push({ step: 'provenance', status: 'pass', detail: `${provenance.fileCount} files match ${provenance.upstream.pinnedCommit.slice(0, 12)}` });

  const scratch = path.resolve(out || DEFAULT_OUT);
  if (keep || skipInstall) {
    fs.rmSync(path.join(scratch, 'upstream'), { recursive: true, force: true });
    fs.rmSync(path.join(scratch, 'dist'), { recursive: true, force: true });
  } else {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const scratchUpstream = path.join(scratch, 'upstream');
  fs.mkdirSync(scratch, { recursive: true });
  fs.cpSync(UPSTREAM_DIR, scratchUpstream, { recursive: true, dereference: false });
  record.steps.push({ step: 'copy', status: 'pass', detail: `${provenance.fileCount} files -> ${path.relative(REPO_ROOT, scratch)}` });

  for (const patchFile of fs.existsSync(PATCHES_DIR) ? fs.readdirSync(PATCHES_DIR).filter((f) => f.endsWith('.patch')).sort() : []) {
    const patchPath = path.join(PATCHES_DIR, patchFile);
    const applied = spawnSync('git', ['apply', '-p1', '--whitespace=nowarn', patchPath], { cwd: scratchUpstream, encoding: 'utf8' });
    if (applied.status !== 0) fail(record, 'patch:' + patchFile, (applied.stderr || applied.stdout || 'git apply failed').trim());
    record.patchesApplied.push({ patch: patchFile, sha256: sha256File(patchPath) });
  }
  record.steps.push({ step: 'patches', status: 'pass', detail: `${record.patchesApplied.length} applied` });

  const lock = JSON.parse(fs.readFileSync(path.join(scratchUpstream, 'package-lock.json'), 'utf8'));
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify(scratchManifest(scratchUpstream, lock), null, 2) + '\n');
  if (!skipInstall) {
    const npmArgs = ['install', '--no-audit', '--no-fund'];
    // Windows cannot spawn npm.cmd directly: route through cmd.exe.
    const inst = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...npmArgs], { cwd: scratch, encoding: 'utf8', timeout: 20 * 60 * 1000 })
      : spawnSync('npm', npmArgs, { cwd: scratch, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    if (inst.error) fail(record, 'install', String(inst.error.message || inst.error));
    if (inst.status !== 0) fail(record, 'install', ((inst.stderr || '') + (inst.stdout || '')).slice(-2000));
    const installed = fs.existsSync(path.join(scratch, 'node_modules')) ? fs.readdirSync(path.join(scratch, 'node_modules')).length : 0;
    const npmV = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', '--version'], { encoding: 'utf8' }).stdout.trim()
      : spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout.trim();
    record.steps.push({ step: 'install', status: 'pass', detail: `npm ${npmV}, ${installed} top-level entries` });
  } else {
    if (!fs.existsSync(path.join(scratch, 'node_modules'))) fail(record, 'install', '--skip-install but node_modules is absent');
    record.steps.push({ step: 'install', status: 'pass', detail: 'reused existing node_modules' });
  }

  // G0 tooling resolves dependencies as <source>/node_modules/<pkg>: junction
  // the installed tree into the scratch source copy so --source <scratch>/upstream
  // works for fixture generation and engine bundling without a second install.
  const upstreamModules = path.join(scratchUpstream, 'node_modules');
  fs.rmSync(upstreamModules, { recursive: true, force: true });
  try {
    fs.symlinkSync(path.join(scratch, 'node_modules'), upstreamModules, 'junction');
  } catch {
    fs.symlinkSync(path.join(scratch, 'node_modules'), upstreamModules, 'dir');
  }

  const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'));
  let esbuildBuild, esbuildVersion;
  try {
    esbuildVersion = requireFromRepo('esbuild/package.json').version;
    esbuildBuild = requireFromRepo('esbuild').build;
  } catch {
    fail(record, 'esbuild', 'esbuild is not resolvable from the repo root; it must come from the UniWork catalog/lockfile');
  }
  record.steps.push({ step: 'esbuild', status: 'pass', detail: `esbuild ${esbuildVersion} from repo lockfile` });

  const { order, pkgs } = buildOrder(scratchUpstream);
  record.order = order;
  const distDir = path.join(scratch, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  for (const name of order) {
    const pkg = pkgs.get(name);
    const entryRel = path.join('packages', pkg.dir, entryOf(pkg)).split(path.sep).join('/');
    if (!fs.existsSync(path.join(scratchUpstream, entryRel))) {
      record.artifacts.push({ package: name, status: 'fail', detail: 'missing entry ' + entryRel });
      continue;
    }
    const outFile = path.join(distDir, pkg.dir + '.mjs');
    try {
      await esbuildBuild({
        absWorkingDir: scratchUpstream,
        entryPoints: [entryRel],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        outfile: outFile,
        logLevel: 'warning',
        plugins: [rawTextPlugin],
        external: BUNDLE_EXTERNALS,
        nodePaths: [path.join(scratch, 'node_modules')],
        metafile: true,
      });
      const bytes = fs.statSync(outFile).size;
      record.artifacts.push({ package: name, entry: entryRel, out: 'dist/' + pkg.dir + '.mjs', status: 'built', bytes, sha256: sha256File(outFile) });
    } catch (e) {
      record.artifacts.push({ package: name, entry: entryRel, status: 'fail', detail: String(e.message || e).split('\n').slice(0, 3).join(' | ') });
    }
  }
  const built = record.artifacts.filter((a) => a.status === 'built').length;
  const failed = record.artifacts.filter((a) => a.status === 'fail');
  record.steps.push({ step: 'bundle', status: failed.length ? 'fail' : 'pass', detail: `${built}/${order.length} built` + (failed.length ? ' - ' + failed.map((f) => f.package).join(', ') : '') });
  if (failed.length) record.verdict = 'fail';
  else record.verdict = 'pass';

  // The Rust xlsx sidecar is vendored but needs cargo; report its real state,
  // never claim it built.
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (withNative && cargo.status === 0) {
    const rs = spawnSync('cargo', ['build', '--release'], { cwd: path.join(scratchUpstream, 'apps', 'sheets', 'native', 'xlsx-engine'), encoding: 'utf8', timeout: 20 * 60 * 1000 });
    record.steps.push({ step: 'native', status: rs.status === 0 ? 'pass' : 'fail', detail: rs.status === 0 ? cargo.stdout.trim() : (rs.stderr || 'cargo build failed').slice(-500) });
    if (rs.status !== 0) record.verdict = 'fail';
  } else {
    record.steps.push({ step: 'native', status: 'not-attempted', detail: withNative ? 'cargo not on PATH' : 'requires --with-native (rust toolchain)' });
  }
  return { record, scratch, distDir };
}

export async function buildAll(args) {
  const { record } = await run({ out: args.out, skipInstall: args.skipInstall, withNative: args.withNative, keep: args.keep });
  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: build-upstream.mjs [--out <dir>] [--skip-install] [--with-native] [--json]');
    return;
  }
  try {
    const record = await buildAll(args);
    const outDir = path.resolve(args.out || DEFAULT_OUT);
    fs.writeFileSync(path.join(outDir, 'build-record.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ ok: record.verdict !== 'fail', record: path.join(outDir, 'build-record.json') }));
    if (args.json) console.log(JSON.stringify(record, null, 2));
    if (record.verdict === 'fail') process.exit(1);
  } catch (e) {
    if (e.record) {
      const outDir = path.resolve(args.out || DEFAULT_OUT);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'build-record.json'), JSON.stringify(e.record, null, 2) + '\n');
      console.error(JSON.stringify({ ok: false, record: path.join(outDir, 'build-record.json'), error: e.message }));
    } else console.error(e.message);
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });
