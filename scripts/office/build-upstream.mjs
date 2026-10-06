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
// Dependencies install into <out>/upstream/node_modules from the vendored
// package.json + package-lock.json - the lock is the authoritative graph, the
// public npm registry is pinned and ambient npmrc/npm_config settings are
// stripped so resolution cannot float between builds. G0 tooling resolves
// <source>/node_modules directly, so no junction or symlink is needed.
//
// Artifacts land in <out>/dist/*.mjs with sha256 recorded in
// <out>/build-record.json. A missing input, failed install or failed bundle
// exits non-zero; native work the script does not attempt is reported as
// not-attempted, never as built.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
// The native step copies the release sidecar here (<out>/native/xlsx-sidecar[.exe]).
const NATIVE_OUT_DIR = 'native';

/**
 * The dir cargo writes to for a crate: CARGO_TARGET_DIR when set, else
 * <crate>/target. A relative CARGO_TARGET_DIR resolves against the repo root
 * (the desktop build's rule); the resolved value is also handed to cargo so
 * both agree, whatever cwd cargo runs in.
 */
function cargoTargetDir(crateDir, env = process.env) {
  const configured = env.CARGO_TARGET_DIR?.trim();
  return configured ? path.resolve(REPO_ROOT, configured) : path.join(crateDir, 'target');
}

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
    else if (a === '--docx-browser') out.docxBrowser = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

export const NPM_REGISTRY = 'https://registry.npmjs.org';

export const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();

function fail(record, step, detail) {
  record.steps.push({ step, status: 'fail', detail });
  record.verdict = 'fail';
  throw Object.assign(new Error(step + ': ' + detail), { record });
}

/**
 * npm spawn environment with ambient npm_config_* settings stripped and the
 * registry pinned: a developer .npmrc, corporate mirror or npm_config_registry
 * must not change which registry the vendored lockfile is resolved against.
 * The lockfile's own resolved URLs and the --registry flag agree with it.
 * userconfig/globalconfig are pointed at an empty file so ~/.npmrc (scoped
 * registries, auth) cannot leak in either.
 */
export function npmEnv(emptyConfigFile) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.toLowerCase().startsWith('npm_config_')) env[k] = v;
  }
  env.npm_config_registry = NPM_REGISTRY;
  if (emptyConfigFile) {
    env.npm_config_userconfig = emptyConfigFile + '.user';
    env.npm_config_globalconfig = emptyConfigFile + '.global';
  }
  return env;
}

/** Spawn npm portably: Windows cannot exec npm.cmd without a shell. */
export function npmSpawn(args, cwd, { timeoutMs = 20 * 60 * 1000, emptyConfigFile = null } = {}) {
  const env = npmEnv(emptyConfigFile);
  return process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd, env, encoding: 'utf8', timeout: timeoutMs })
    : spawnSync('npm', args, { cwd, env, encoding: 'utf8', timeout: timeoutMs });
}

/**
 * The lock rewrite npm performs at install is allowed to REMOVE entries (the
 * vendored lock covers workspaces outside the selection, which npm prunes),
 * but it must never change a kept version or add an entry - either means npm
 * resolved something fresh, which is exactly the float this lane forbids.
 * Returns the list of violations; an empty list means prune-only.
 */
export function lockRewriteViolations(before, after) {
  const violations = [];
  const pre = before.packages || {};
  const post = after.packages || {};
  for (const [key, meta] of Object.entries(post)) {
    if (!key.includes('node_modules/')) continue;
    if (!(key in pre)) { violations.push(`added ${key}@${meta.version} - not in the vendored lock`); continue; }
    if (pre[key].version !== meta.version) violations.push(`${key} version changed ${pre[key].version} -> ${meta.version}`);
    if (pre[key].resolved && meta.resolved && pre[key].resolved !== meta.resolved) violations.push(`${key} resolved changed`);
  }
  return violations;
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
 * Installs dependencies in the copied upstream tree from its own vendored
 * package.json + package-lock.json. The lock is the authoritative dependency
 * graph: npm prefers locked versions for every name it covers, the public
 * registry is pinned, ambient npmrc/npm_config settings are stripped, and
 * lifecycle scripts (the upstream postinstall pulls Electron) never run.
 * The lockfile hash before/after install is recorded so any lock rewrite
 * (e.g. pruning entries for workspaces outside the selection) is auditable.
 */
export function installDeps(scratchUpstream, record) {
  const lockPath = path.join(scratchUpstream, 'package-lock.json');
  const lockBefore = fs.existsSync(lockPath) ? sha256File(lockPath) : null;
  const lockJsonBefore = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  // An empty rc pair stands in for ~/.npmrc/globalconfig so ambient registry,
  // scope and auth settings cannot affect this install (npm refuses to load
  // one file as both user and global config).
  const emptyConfig = path.join(scratchUpstream, '.npmrc.build');
  fs.writeFileSync(emptyConfig + '.user', '# ambient npmrc intentionally neutralized by build-upstream.mjs\n');
  fs.writeFileSync(emptyConfig + '.global', '# ambient npmrc intentionally neutralized by build-upstream.mjs\n');
  const inst = npmSpawn(
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', NPM_REGISTRY],
    scratchUpstream,
    { emptyConfigFile: emptyConfig },
  );
  if (inst.error) fail(record, 'install', String(inst.error.message || inst.error));
  if (inst.status !== 0) fail(record, 'install', ((inst.stderr || '') + (inst.stdout || '')).slice(-2000));
  const lockAfter = fs.existsSync(lockPath) ? sha256File(lockPath) : null;
  const lockJsonAfter = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  const rewriteViolations = lockJsonBefore && lockJsonAfter ? lockRewriteViolations(lockJsonBefore, lockJsonAfter) : [];
  if (rewriteViolations.length) {
    fail(record, 'install', 'npm rewrote the vendored lock beyond pruning: ' + rewriteViolations.slice(0, 5).join('; '));
  }
  const nm = path.join(scratchUpstream, 'node_modules');
  const topLevel = fs.existsSync(nm) ? fs.readdirSync(nm).filter((n) => !n.startsWith('.')).length : 0;
  const npmV = npmSpawn(['--version'], scratchUpstream, { timeoutMs: 30 * 1000, emptyConfigFile: emptyConfig }).stdout.trim();
  const detail = { npm: npmV, registry: NPM_REGISTRY, topLevel, lockSha256Before: lockBefore, lockSha256After: lockAfter, lockRewrite: lockBefore === lockAfter ? 'none' : 'prune-only' };
  record.steps.push({ step: 'install', status: 'pass', detail: `npm ${npmV}, ${topLevel} top-level entries, registry ${NPM_REGISTRY}` });
  record.install = detail;
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
  const scratchUpstream = path.join(scratch, 'upstream');
  fs.mkdirSync(scratch, { recursive: true });
  if (keep || skipInstall) {
    // Preserve the installed tree only; everything else is refreshed.
    if (fs.existsSync(scratchUpstream)) {
      for (const e of fs.readdirSync(scratchUpstream)) {
        if (e !== 'node_modules') fs.rmSync(path.join(scratchUpstream, e), { recursive: true, force: true });
      }
    }
    fs.rmSync(path.join(scratch, 'dist'), { recursive: true, force: true });
  } else {
    fs.rmSync(scratchUpstream, { recursive: true, force: true });
    fs.rmSync(path.join(scratch, 'dist'), { recursive: true, force: true });
  }
  fs.cpSync(UPSTREAM_DIR, scratchUpstream, { recursive: true, dereference: false });
  record.steps.push({ step: 'copy', status: 'pass', detail: `${provenance.fileCount} files -> ${path.relative(REPO_ROOT, scratch)}` });

  for (const patchFile of fs.existsSync(PATCHES_DIR) ? fs.readdirSync(PATCHES_DIR).filter((f) => f.endsWith('.patch')).sort() : []) {
    const patchPath = path.join(PATCHES_DIR, patchFile);
    // GIT_CEILING_DIRECTORIES: the scratch lives inside the lane worktree, and
    // git apply SILENTLY SKIPS patch paths that resolve outside the current
    // directory when it walks up to a repository root (exit 0, no change). The
    // ceiling stops that walk at the scratch, so the apply is cwd-relative.
    const runApply = (extra) =>
      spawnSync('git', ['apply', ...extra, '-p1', '--whitespace=nowarn', patchPath], {
        cwd: scratchUpstream,
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(scratchUpstream) },
      });
    // Fail loudly on every degradation: --check rejects a patch that cannot
    // land, and the reverse --check after applying rejects a no-op apply (the
    // exact way a skip used to be recorded as applied).
    const pre = runApply(['--check']);
    if (pre.status !== 0) fail(record, 'patch:' + patchFile, (pre.stderr || pre.stdout || 'git apply --check failed').trim());
    const applied = runApply([]);
    if (applied.status !== 0) fail(record, 'patch:' + patchFile, (applied.stderr || applied.stdout || 'git apply failed').trim());
    const landed = runApply(['-R', '--check']);
    if (landed.status !== 0) fail(record, 'patch:' + patchFile, 'patch did not change the tree (reverse check): ' + (landed.stderr || 'git apply -R --check failed').trim());
    record.patchesApplied.push({ patch: patchFile, sha256: sha256File(patchPath) });
  }
  record.steps.push({ step: 'patches', status: 'pass', detail: `${record.patchesApplied.length} applied` });

  if (!skipInstall) {
    installDeps(scratchUpstream, record);
  } else {
    if (!fs.existsSync(path.join(scratchUpstream, 'node_modules'))) fail(record, 'install', '--skip-install but node_modules is absent');
    record.steps.push({ step: 'install', status: 'pass', detail: 'reused existing node_modules' });
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
        nodePaths: [path.join(scratchUpstream, 'node_modules')],
        metafile: true,
      });
      const bytes = fs.statSync(outFile).size;
      record.artifacts.push({ package: name, entry: entryRel, out: 'dist/' + pkg.dir + '.mjs', status: 'built', bytes, sha256: sha256File(outFile) });
    } catch (e) {
      record.artifacts.push({ package: name, entry: entryRel, status: 'fail', detail: String(e.message || e).split('\n').slice(0, 3).join(' | ') });
    }
  }
  // Patch 0010's and 0013's capability markers must survive bundling: hosts
  // refuse an xlsx gateway bundle without them (packages/office-engine/src/xlsx/vendor.ts).
  const xlsxGateway = record.artifacts.find((a) => a.status === 'built' && a.out === 'dist/xlsx-gateway.mjs');
  if (xlsxGateway) {
    const bundle = fs.readFileSync(path.join(distDir, 'xlsx-gateway.mjs'), 'utf8');
    const lost = [
      ['0010', /\bUNIWORK_XLSX_VISUAL_ADDITIONS\b/, 'UNIWORK_XLSX_VISUAL_ADDITIONS'],
      ['0013', /\bUNIWORK_XLSX_VISUAL_EDITS\b/, 'UNIWORK_XLSX_VISUAL_EDITS'],
    ].filter(([, pattern]) => !pattern.test(bundle));
    if (lost.length > 0) {
      Object.assign(xlsxGateway, { status: 'fail', detail: lost.map(([patch, , marker]) => `patch ${patch} marker ${marker} missing from the bundle`).join('; ') });
    }
  }
  const built = record.artifacts.filter((a) => a.status === 'built').length;
  const failed = record.artifacts.filter((a) => a.status === 'fail');
  record.steps.push({ step: 'bundle', status: failed.length ? 'fail' : 'pass', detail: `${built}/${order.length} built` + (failed.length ? ' - ' + failed.map((f) => f.package).join(', ') : '') });
  if (failed.length) record.verdict = 'fail';
  else record.verdict = 'pass';

  // The Rust xlsx sidecar is vendored but needs cargo; report its real state,
  // never claim it built. On success record the crate/protocol/binary
  // checksums the lane is required to ship: Cargo.toml + Cargo.lock pin the
  // crate graph, main.rs is the NDJSON protocol endpoint, and the release
  // binary is the artifact the runtime stage ships.
  // A binary left in <out>/native by an earlier run must never sit next to a
  // record that did not build it.
  const nativeOut = path.join(scratch, NATIVE_OUT_DIR);
  fs.rmSync(nativeOut, { recursive: true, force: true });
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (withNative && cargo.status === 0) {
    const engineDir = path.join(scratchUpstream, 'apps', 'sheets', 'native', 'xlsx-engine');
    const cargoEnv = process.env.CARGO_TARGET_DIR?.trim() ? { ...process.env, CARGO_TARGET_DIR: cargoTargetDir(engineDir) } : process.env;
    const rs = spawnSync('cargo', ['build', '--release'], { cwd: engineDir, env: cargoEnv, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    record.steps.push({ step: 'native', status: rs.status === 0 ? 'pass' : 'fail', detail: rs.status === 0 ? cargo.stdout.trim() : (rs.stderr || 'cargo build failed').slice(-500) });
    if (rs.status !== 0) {
      // Recorded so a consumer can tell "this build's native step failed" from
      // "no native step ran": a failed build has no binary to attest.
      record.native = { status: 'fail' };
      record.verdict = 'fail';
    } else {
      // Cargo honours CARGO_TARGET_DIR (a short dir on Windows, where MSVC's
      // link.exe hits MAX_PATH under a deep worktree); copy the binary to a
      // fixed place in the scratch tree so staging finds it without that env.
      const sidecarName = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar';
      const builtPath = path.join(cargoTargetDir(engineDir), 'release', sidecarName);
      const binaryPath = path.join(nativeOut, sidecarName);
      fs.mkdirSync(nativeOut, { recursive: true });
      fs.copyFileSync(builtPath, binaryPath);
      const protocolSrc = path.join(engineDir, 'src', 'main.rs');
      const versionMatch = fs.existsSync(protocolSrc) ? /PROTOCOL_VERSION(?::\s*u8)?\s*=\s*(\d+)/.exec(fs.readFileSync(protocolSrc, 'utf8')) : null;
      record.native = {
        status: 'pass',
        // The sidecar is built for the host CPU; packaging for another one must refuse it.
        arch: process.arch,
        cargo: cargo.stdout.trim(),
        crate: {
          manifest: 'apps/sheets/native/xlsx-engine/Cargo.toml',
          manifestSha256: sha256File(path.join(engineDir, 'Cargo.toml')),
          lockfile: 'apps/sheets/native/xlsx-engine/Cargo.lock',
          lockfileSha256: sha256File(path.join(engineDir, 'Cargo.lock')),
        },
        protocol: { source: 'apps/sheets/native/xlsx-engine/src/main.rs', sourceSha256: sha256File(protocolSrc), version: versionMatch ? Number(versionMatch[1]) : null },
        binary: { path: path.relative(scratch, binaryPath).split(path.sep).join('/'), bytes: fs.statSync(binaryPath).size, sha256: sha256File(binaryPath) },
      };
    }
  } else {
    record.steps.push({ step: 'native', status: 'not-attempted', detail: withNative ? 'cargo not on PATH' : 'requires --with-native (rust toolchain)' });
    record.native = { status: 'not-attempted' };
  }
  return { record, scratch, distDir };
}

export async function buildAll(args) {
  const { record } = await run({ out: args.out, skipInstall: args.skipInstall, withNative: args.withNative, keep: args.keep });
  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.docxBrowser) {
    const { buildDocxBrowser } = await import('./build-docx-browser.mjs');
    console.log(JSON.stringify(await buildDocxBrowser()));
    return;
  }
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
