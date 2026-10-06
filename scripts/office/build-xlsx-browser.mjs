// G3-05c (UNI-824) - build the vendored genoffice sheets renderer into the
// browser artifact the shared XlsxEditor mounts.
//
// Pipeline (mirrors build-docx-browser.mjs):
//   provenance-checked upstream bytes -> scratch clone (never upstream/) ->
//   patch series applied fail-loud -> esbuild bundle into
//   packages/office-upstream/dist/xlsx-renderer.mjs, with the Univer
//   stylesheets repackaged (scoped to .xlsx-surface) into the artifact and
//   the @genoffice/* imports resolved inside the scratch clone.
//
// The bundle carries the UniWork-authored controller (shims/xlsx-renderer).
// Univer itself is bundled (the artifact is the lazy renderer chunk); react,
// react-dom and i18next stay external so the host app owns its singletons.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { PACKAGE_DIR, UPSTREAM_DIR, checkVendored, loadManifest } from './vendor-upstream.mjs';
import { PATCHES_DIR, sha256File } from './build-upstream.mjs';
import { XLSX_RENDERER_STYLE_BANNER, buildXlsxRendererStyleSheet } from './xlsx-renderer-styles.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

/** Scratch clone the patch series is applied to before bundling. */
export const XLSX_BROWSER_SCRATCH = path.join(REPO_ROOT, '.go-tmp', 'xlsx-browser-build');

/** The Univer preset stylesheets the pin's main.tsx imports. */
export const UNIVER_STYLE_FILES = [
  '@univerjs/preset-sheets-core/lib/index.css',
  '@univerjs/preset-sheets-conditional-formatting/lib/index.css',
  '@univerjs/preset-sheets-data-validation/lib/index.css',
  '@univerjs/preset-sheets-drawing/lib/index.css',
  '@univerjs/preset-sheets-find-replace/lib/index.css',
  '@univerjs/preset-sheets-filter/lib/index.css',
  '@univerjs/preset-sheets-note/lib/index.css',
  '@univerjs/preset-sheets-sort/lib/index.css',
  '@univerjs/preset-sheets-table/lib/index.css',
];

/** Symbols each applied patch must have introduced in the scratch tree. */
const PATCHED_SYMBOLS = [
  { patch: '0001', file: 'packages/xlsx-gateway/src/gateway/xlsx-styles.ts', symbol: 'xfIdentity' },
  { patch: '0002', file: 'packages/xlsx-gateway/src/gateway/xlsx-gateway.ts', symbol: 'lazilyLoadedXmls' },
  { patch: '0008', file: 'packages/xlsx-gateway/src/gateway/xlsx-gateway.ts', symbol: 'tableAdditions: readonly SheetTableAddition[] = [],' },
  { patch: '0010', file: 'packages/xlsx-gateway/src/gateway/xlsx-gateway.ts', symbol: 'visualAdditions: readonly SheetVisualAddition[] = [],' },
];

const FORBIDDEN_EXTERNAL = /^(?!react(?:\/|$)|react-dom(?:\/|$)|i18next$).+$/;

export function materializePatchedXlsxPackage() {
  fs.rmSync(XLSX_BROWSER_SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(XLSX_BROWSER_SCRATCH, { recursive: true });
  fs.cpSync(UPSTREAM_DIR, path.join(XLSX_BROWSER_SCRATCH, 'upstream'), { recursive: true, dereference: false });
  fs.cpSync(path.join(PACKAGE_DIR, 'shims'), path.join(XLSX_BROWSER_SCRATCH, 'shims'), { recursive: true, dereference: false });
  fs.copyFileSync(path.join(PACKAGE_DIR, 'package.json'), path.join(XLSX_BROWSER_SCRATCH, 'package.json'));
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
        cwd: path.join(XLSX_BROWSER_SCRATCH, 'upstream'),
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: XLSX_BROWSER_SCRATCH },
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
    const body = fs.readFileSync(path.join(XLSX_BROWSER_SCRATCH, 'upstream', file), 'utf8');
    if (!body.includes(symbol)) throw new Error(`patch ${patch}: ${file} does not carry "${symbol}" after apply`);
  }
  return { scratchRoot: XLSX_BROWSER_SCRATCH, patchesApplied, patchedSymbols: PATCHED_SYMBOLS };
}

/** One installed Univer stylesheet: [path, css]. */
function readUniverStylesheets(nodeModulesDir) {
  const out = [];
  for (const rel of UNIVER_STYLE_FILES) {
    const abs = path.join(nodeModulesDir, ...rel.split('/'));
    if (!fs.existsSync(abs)) throw new Error(`missing Univer stylesheet ${rel} under ${nodeModulesDir}`);
    out.push([rel, fs.readFileSync(abs, 'utf8')]);
  }
  return out;
}

export async function buildXlsxBrowser() {
  const problems = checkVendored(loadManifest());
  if (problems.length) throw new Error(`XLSX provenance check failed: ${problems.map((p) => p.problem ?? p.path).join('; ')}`);
  const { scratchRoot, patchesApplied } = materializePatchedXlsxPackage();
  const scratchUpstream = path.join(scratchRoot, 'upstream');
  const nodeModulesDir = path.join(PACKAGE_DIR, 'node_modules');
  const styleInputs = [];
  const fontInputs = [];
  const output = path.join(PACKAGE_DIR, 'dist', 'xlsx-renderer.mjs');

  const result = await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: [path.join(scratchRoot, 'shims', 'xlsx-renderer-entry.ts')],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    metafile: true,
    minify: true,
    external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'i18next'],
    nodePaths: [nodeModulesDir],
    loader: { '.css': 'text' },
    plugins: [{
      name: 'xlsx-renderer-styles',
      setup(builder) {
        builder.onResolve({ filter: /[?]xlsx-sheet$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/[?]xlsx-sheet$/, '')),
          namespace: 'xlsx-renderer-sheet',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'xlsx-renderer-sheet' }, async () => {
          const files = readUniverStylesheets(nodeModulesDir);
          for (const [rel, css] of files) {
            styleInputs.push({ path: rel, bytes: Buffer.byteLength(css, 'utf8') });
          }
          const sheet = buildXlsxRendererStyleSheet({ cssFiles: files });
          const minified = await transform(sheet, { loader: 'css', minify: true });
          return {
            contents: `export default ${JSON.stringify(XLSX_RENDERER_STYLE_BANNER + minified.code)};`,
            loader: 'js',
          };
        });
      },
    }, {
      name: 'xlsx-browser-compatibility',
      setup(builder) {
        // The locale seam, the scope-boundary shims and the UniWork controller
        // stay UniWork files; every @genoffice/* package resolves inside the
        // patched scratch clone.
        builder.onResolve({ filter: /^\.\/i18n\/locale$/ }, () => ({
          path: path.join(scratchRoot, 'shims', 'xlsx-renderer', 'locale.ts'),
        }));
        // Visuals/charts/shapes and the advanced-filter dialog are outside the
        // approved render scope; their modules are not vendored.
        builder.onResolve({ filter: /^\.\/WorkbookVisuals$/ }, () => ({
          path: path.join(scratchRoot, 'shims', 'xlsx-renderer', 'workbook-visuals.ts'),
        }));
        builder.onResolve({ filter: /^\.\/AdvancedFilterDialog$/ }, () => ({
          path: path.join(scratchRoot, 'shims', 'xlsx-renderer', 'advanced-filter-dialog.ts'),
        }));
        // Carlito (SIL OFL) faces for the grid's canvas metrics: the pin loads
        // them through Vite's `?url`; here they inline as data URLs so the
        // artifact stays self-contained and lazy. The OFL text is vendored
        // beside them (apps/docs/src/renderer/fonts/LICENSE-OFL.txt).
        builder.onResolve({ filter: /^@genoffice\/ui\/fonts\/[A-Za-z0-9-]+\.ttf[?]url$/ }, ({ path: specifier }) => {
          const name = specifier.split('/').pop().replace(/[?]url$/, '');
          return { path: path.join(scratchUpstream, 'packages', 'ui', 'src', 'fonts', name), namespace: 'xlsx-font' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'xlsx-font' }, async (args) => {
          const bytes = fs.readFileSync(args.path);
          fontInputs.push({ path: 'packages/office-upstream/upstream/' + path.relative(scratchUpstream, args.path).split(path.sep).join('/'), bytes: bytes.length });
          return {
            contents: `export default "data:font/ttf;base64,${bytes.toString('base64')}";`,
            loader: 'js',
          };
        });
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
  for (const symbol of ['createXlsxRenderer', 'installXlsxRendererStyles', 'XLSX_RENDERER_STYLE_ELEMENT_ID']) {
    if (!artifact.includes(symbol)) throw new Error(`built artifact does not carry "${symbol}"`);
  }

  const record = {
    kind: 'uniwork-xlsx-browser-build',
    patchesApplied,
    patchedSymbols: PATCHED_SYMBOLS,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    // Vendored-source inputs only: node_modules paths (a) are noise for the
    // record's consumers and (b) trip substring scans like the port's
    // no-legacy-brand test through unrelated dependency file names.
    inputs: Object.keys(result.metafile.inputs).filter((input) => !input.includes('node_modules/')),
    styles: styleInputs,
    fonts: fontInputs,
    externalImports: imports.map((entry) => entry.path),
  };
  fs.writeFileSync(path.join(PACKAGE_DIR, 'dist', 'xlsx-renderer-build.json'), JSON.stringify(record, null, 2) + '\n');
  return {
    bytes: record.bytes,
    gzipBytes: record.gzipBytes,
    sha256: record.sha256,
    inputs: record.inputs.length,
    styles: record.styles.length,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  buildXlsxBrowser()
    .then((record) => {
      console.log(JSON.stringify({ ok: true, ...record }, null, 1));
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
