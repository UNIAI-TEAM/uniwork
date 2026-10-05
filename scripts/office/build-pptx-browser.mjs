// UNI-927 (P0-1) — build the vendored genoffice pptx engine/ops/render into
// the browser artifact the UniWork PPTX host binds in the browser.
//
// Pipeline (mirrors build-xlsx-browser.mjs):
//   provenance-checked upstream bytes -> scratch clone (never upstream/) ->
//   patch series applied fail-loud -> esbuild bundle into
//   packages/office-upstream/dist/pptx-renderer.mjs.
//
// The pptx closure is plain TS but imports Node facilities the browser build
// resolves to UniWork shims: node:crypto (zip.ts sha256 + sections.ts UUIDs),
// node:zlib (media-insert.ts poster-PNG DEFLATE), the free Buffer global
// (esbuild `inject`) and bidi-js (not in this repo's lockfile — the shim
// documents its UAX#9 subset). `?raw` markdown (pptx-ops op docs) is inlined
// by the same plugin the node build uses.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { PACKAGE_DIR, UPSTREAM_DIR, checkVendored, loadManifest } from './vendor-upstream.mjs';
import { PATCHES_DIR, sha256File } from './build-upstream.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

/** Scratch clone the patch series is applied to before bundling. */
export const PPTX_BROWSER_SCRATCH = path.join(REPO_ROOT, '.go-tmp', 'pptx-browser-build');

/** UniWork shims the bundle resolves instead of Node facilities / bidi-js. */
export const PPTX_BROWSER_SHIMS = [
  'shims/pptx-renderer/buffer.ts',
  'shims/pptx-renderer/crypto.ts',
  'shims/pptx-renderer/zlib.ts',
  'shims/pptx-renderer/bidi.ts',
  'shims/pptx-renderer/node-file-io.ts',
];

/** Exported symbols the artifact must carry (post-minify export names). */
export const PPTX_ARTIFACT_SYMBOLS = [
  'openPptx',
  'savePptx',
  'commitSaved',
  'reparseDeck',
  'listSlideLayouts',
  'getSlideNotes',
  'runTxn',
  'buildRenderSlide',
  'HeuristicMetrics',
  'makeViewport',
  'presetPath',
  'presetPolygon',
  'layoutText',
];

/** Symbols each pptx patch must have introduced before the bundle may build.
 * The apply guards below run for the whole (shared) series, so a patch that
 * stops applying fails the build here; this list also pins that a pptx patch
 * actually changed the pptx sources the bundle reads. */
const PATCHED_SYMBOLS = [
  { patch: '0007', file: 'packages/pptx-ops/src/ops/slide-ops.ts', symbol: 'remapExplicit' },
];

const FORBIDDEN_EXTERNAL = /^(?!react(?:\/|$)|react-dom(?:\/|$)|i18next$).+$/;

export function materializePatchedPptxPackage() {
  fs.rmSync(PPTX_BROWSER_SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(PPTX_BROWSER_SCRATCH, { recursive: true });
  fs.cpSync(UPSTREAM_DIR, path.join(PPTX_BROWSER_SCRATCH, 'upstream'), { recursive: true, dereference: false });
  fs.cpSync(path.join(PACKAGE_DIR, 'shims'), path.join(PPTX_BROWSER_SCRATCH, 'shims'), { recursive: true, dereference: false });
  fs.copyFileSync(path.join(PACKAGE_DIR, 'package.json'), path.join(PPTX_BROWSER_SCRATCH, 'package.json'));
  const patchesApplied = [];
  const patchFiles = fs.existsSync(PATCHES_DIR) ? fs.readdirSync(PATCHES_DIR).filter((f) => f.endsWith('.patch')).sort() : [];
  for (const patchFile of patchFiles) {
    const patchPath = path.join(PATCHES_DIR, patchFile);
    // GIT_CEILING_DIRECTORIES: the scratch lives inside the lane worktree, and
    // git apply silently skips patch paths that resolve outside the current
    // directory when it walks up to a repository root. The ceiling stops the
    // walk at the scratch so the apply is cwd-relative again.
    const runApply = (extra) =>
      spawnSync('git', ['apply', ...extra, '-p1', '--whitespace=nowarn', patchPath], {
        cwd: path.join(PPTX_BROWSER_SCRATCH, 'upstream'),
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: PPTX_BROWSER_SCRATCH },
      });
    const pre = runApply(['--check']);
    if (pre.status !== 0) throw new Error(`patch ${patchFile}: ${(pre.stderr || pre.stdout || 'git apply --check failed').trim()}`);
    const applied = runApply([]);
    if (applied.status !== 0) throw new Error(`patch ${patchFile}: ${(applied.stderr || applied.stdout || 'git apply failed').trim()}`);
    const landed = runApply(['-R', '--check']);
    if (landed.status !== 0) throw new Error(`patch ${patchFile}: did not change the tree (reverse check): ${(landed.stderr || landed.stdout || 'git apply -R --check failed').trim()}`);
    patchesApplied.push({ patch: patchFile, sha256: sha256File(patchPath) });
  }
  for (const { patch, file, symbol } of PATCHED_SYMBOLS) {
    const body = fs.readFileSync(path.join(PPTX_BROWSER_SCRATCH, 'upstream', file), 'utf8');
    if (!body.includes(symbol)) throw new Error(`patch ${patch}: ${file} does not carry "${symbol}" after apply`);
  }
  for (const shim of PPTX_BROWSER_SHIMS) {
    if (!fs.existsSync(path.join(PPTX_BROWSER_SCRATCH, ...shim.split('/')))) throw new Error(`missing pptx browser shim ${shim}`);
  }
  return { scratchRoot: PPTX_BROWSER_SCRATCH, patchesApplied, patchedSymbols: PATCHED_SYMBOLS };
}

export async function buildPptxBrowser() {
  const problems = checkVendored(loadManifest());
  if (problems.length) throw new Error(`PPTX provenance check failed: ${problems.map((p) => p.problem ?? p.path).join('; ')}`);
  const { scratchRoot, patchesApplied } = materializePatchedPptxPackage();
  const scratchUpstream = path.join(scratchRoot, 'upstream');
  const output = path.join(PACKAGE_DIR, 'dist', 'pptx-renderer.mjs');

  const result = await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: [path.join(scratchRoot, 'shims', 'pptx-renderer-entry.ts')],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    metafile: true,
    minify: true,
    // The pptx closure has no legitimate external import: react/i18next are
    // not in its graph, and anything else that tried to stay external is
    // rejected below rather than silently shipped as a bare specifier.
    external: [],
    nodePaths: [path.join(PACKAGE_DIR, 'node_modules')],
    // Upstream reads/writes XML through the free Buffer global; the shim
    // supplies exactly the surface that closure uses.
    inject: [path.join(scratchRoot, 'shims', 'pptx-renderer', 'buffer.ts')],
    plugins: [{
      name: 'pptx-raw-text',
      setup(builder) {
        // pptx-ops inlines prompts/ops/*.md at build time (`?raw`), same as
        // build-upstream.mjs does for the node bundle.
        builder.onResolve({ filter: /[?]raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/[?]raw$/, '')),
          namespace: 'pptx-raw-text',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'pptx-raw-text' }, (args) => ({
          contents: 'export default ' + JSON.stringify(fs.readFileSync(args.path, 'utf8')),
          loader: 'js',
        }));
      },
    }, {
      name: 'pptx-browser-compatibility',
      setup(builder) {
        // Node facilities the vendored closure imports, replaced by UAX#9 /
        // DEFLATE / SHA-256 shims under packages/office-upstream/shims.
        builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: path.join(scratchRoot, 'shims', 'pptx-renderer', 'crypto.ts') }));
        builder.onResolve({ filter: /^node:zlib$/ }, () => ({ path: path.join(scratchRoot, 'shims', 'pptx-renderer', 'zlib.ts') }));
        builder.onResolve({ filter: /^bidi-js$/ }, () => ({ path: path.join(scratchRoot, 'shims', 'pptx-renderer', 'bidi.ts') }));
        // savePptxToFile's lazy Node streaming imports: bundled, then refusing
        // at call time (the browser save path never reaches them).
        builder.onResolve({ filter: /^node:fs$/ }, () => ({ path: path.join(scratchRoot, 'shims', 'pptx-renderer', 'node-file-io.ts') }));
        builder.onResolve({ filter: /^node:stream\/promises$/ }, () => ({ path: path.join(scratchRoot, 'shims', 'pptx-renderer', 'node-file-io.ts') }));
        // Every @genoffice/* specifier resolves inside the patched scratch
        // clone through the package's own (pinned) exports map.
        builder.onResolve({ filter: /^@genoffice\// }, ({ path: specifier }) => {
          const [, packageName, ...subpath] = specifier.split('/');
          const packageRoot = path.join(scratchUpstream, 'packages', packageName);
          const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
          const key = subpath.length ? './' + subpath.join('/') : '.';
          const exported = metadata.exports?.[key] ?? metadata.exports?.['./*'];
          if (typeof exported !== 'string') throw new Error(`No pinned browser export for ${specifier}`);
          return { path: path.resolve(packageRoot, exported.replace('*', subpath.join('/'))) };
        });
      },
    }],
    logLevel: 'warning',
  });

  const imports = Object.values(result.metafile.outputs).flatMap((entry) => entry.imports);
  const forbidden = imports.filter((entry) => FORBIDDEN_EXTERNAL.test(entry.path));
  if (forbidden.length) throw new Error(`Unexpected browser imports: ${forbidden.map((entry) => entry.path).join(', ')}`);

  const bytes = fs.readFileSync(output);
  const artifact = bytes.toString('utf8');
  for (const symbol of PPTX_ARTIFACT_SYMBOLS) {
    if (!artifact.includes(symbol)) throw new Error(`built artifact does not carry "${symbol}"`);
  }
  for (const specifier of ['node:crypto', 'node:zlib', 'bidi-js']) {
    if (artifact.includes(`from"${specifier}"`) || artifact.includes(`from '${specifier}'`) || artifact.includes(`require("${specifier}")`)) {
      throw new Error(`built artifact still imports ${specifier}`);
    }
  }

  const record = {
    kind: 'uniwork-pptx-browser-build',
    patchesApplied,
    patchedSymbols: PATCHED_SYMBOLS,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    // Vendored-source inputs only: node_modules paths are noise for the
    // record's consumers (same filter as the xlsx record).
    inputs: Object.keys(result.metafile.inputs).filter((input) => !input.includes('node_modules/')),
    shims: PPTX_BROWSER_SHIMS.map((shim) => ({ path: `packages/office-upstream/${shim}`, sha256: sha256File(path.join(PACKAGE_DIR, ...shim.split('/'))) })),
    externalImports: imports.map((entry) => entry.path),
  };
  fs.writeFileSync(path.join(PACKAGE_DIR, 'dist', 'pptx-renderer-build.json'), JSON.stringify(record, null, 2) + '\n');
  return {
    bytes: record.bytes,
    gzipBytes: record.gzipBytes,
    sha256: record.sha256,
    inputs: record.inputs.length,
    shims: record.shims.length,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  buildPptxBrowser()
    .then((record) => {
      console.log(JSON.stringify({ ok: true, ...record }, null, 1));
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
