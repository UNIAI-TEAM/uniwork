import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { PACKAGE_DIR, UPSTREAM_DIR, checkVendored, loadManifest } from './vendor-upstream.mjs';
import { PATCHES_DIR, sha256File } from './build-upstream.mjs';
import { DOCX_RENDERER_STYLE_BANNER, buildDocxRendererStyleSheet } from './docx-renderer-styles.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

/** Scratch clone the patch series is applied to before bundling. */
export const DOCX_BROWSER_SCRATCH = path.join(REPO_ROOT, '.go-tmp', 'docx-browser-build');

/**
 * Provenance-checked upstream bytes -> scratch clone (never upstream/) ->
 * patch series (git apply -p1 in SERIES.md order) -> the package layout the
 * bundle reads from. Mirrors build-upstream.mjs's patch step: the DOCX browser
 * artifact carries the same UniWork diffs as the rest of the vendored graph.
 */
/** Symbols each DOCX patch must have introduced before the bundle may build. */
const PATCHED_SYMBOLS = [
  { patch: "0006", file: "apps/docs/src/renderer/editor/note-dom.ts", symbol: "row.dataset.noteId" },
  { patch: '0005', file: 'apps/docs/src/renderer/components/PageNoteAreas.tsx', symbol: 'page-note-readonly' },
  { patch: '0003', file: 'apps/docs/src/renderer/editor/extensions.ts', symbol: 'formulaLatexEdit' },
  { patch: '0004', file: 'apps/docs/src/renderer/editor/hf-dom.ts', symbol: '.docx-surface' },
];

export function materializePatchedDocxPackage() {
  fs.rmSync(DOCX_BROWSER_SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(DOCX_BROWSER_SCRATCH, { recursive: true });
  fs.cpSync(UPSTREAM_DIR, path.join(DOCX_BROWSER_SCRATCH, 'upstream'), { recursive: true, dereference: false });
  fs.cpSync(path.join(PACKAGE_DIR, 'shims'), path.join(DOCX_BROWSER_SCRATCH, 'shims'), { recursive: true, dereference: false });
  fs.copyFileSync(path.join(PACKAGE_DIR, 'package.json'), path.join(DOCX_BROWSER_SCRATCH, 'package.json'));
  const patchesApplied = [];
  const patchFiles = fs.existsSync(PATCHES_DIR) ? fs.readdirSync(PATCHES_DIR).filter((f) => f.endsWith('.patch')).sort() : [];
  for (const patchFile of patchFiles) {
    const patchPath = path.join(PATCHES_DIR, patchFile);
    // GIT_CEILING_DIRECTORIES: the scratch lives inside the lane worktree, and
    // git apply SILENTLY SKIPS patch paths that resolve outside the current
    // directory when it walks up to a repository root (exit 0, no change). The
    // ceiling stops that walk at the scratch, so the apply is cwd-relative.
    const runApply = (extra) =>
      spawnSync('git', ['apply', ...extra, '-p1', '--whitespace=nowarn', patchPath], {
        cwd: path.join(DOCX_BROWSER_SCRATCH, 'upstream'),
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: DOCX_BROWSER_SCRATCH },
      });
    // Fail loudly on every degradation: --check rejects a patch that cannot
    // land, and the reverse --check after applying rejects a no-op apply (the
    // exact way a skip used to be recorded as applied).
    const pre = runApply(['--check']);
    if (pre.status !== 0) throw new Error(`patch ${patchFile}: ${(pre.stderr || pre.stdout || 'git apply --check failed').trim()}`);
    const applied = runApply([]);
    if (applied.status !== 0) throw new Error(`patch ${patchFile}: ${(applied.stderr || applied.stdout || 'git apply failed').trim()}`);
    const landed = runApply(['-R', '--check']);
    if (landed.status !== 0) throw new Error(`patch ${patchFile}: did not change the tree (reverse check): ${(landed.stderr || 'git apply -R --check failed').trim()}`);
    patchesApplied.push({ patch: patchFile, sha256: sha256File(patchPath) });
  }
  // … and the patched symbols must be present in the scratch the bundle reads.
  for (const { patch, file, symbol } of PATCHED_SYMBOLS) {
    const body = fs.readFileSync(path.join(DOCX_BROWSER_SCRATCH, 'upstream', file), 'utf8');
    if (!body.includes(symbol)) throw new Error(`patch ${patch}: ${file} does not carry "${symbol}" after apply`);
  }
  return { scratchRoot: DOCX_BROWSER_SCRATCH, patchesApplied, patchedSymbols: PATCHED_SYMBOLS.map(({ patch, file, symbol }) => ({ patch, file, symbol })) };
}

export async function buildDocxBrowser() {
  const problems = checkVendored(loadManifest());
  if (problems.length) throw new Error(`DOCX provenance check failed: ${problems.join('; ')}`);
  const { scratchRoot, patchesApplied } = materializePatchedDocxPackage();
  const scratchUpstream = path.join(scratchRoot, 'upstream');
  const output = path.join(PACKAGE_DIR, 'dist', 'docs-renderer.mjs');
  const styleInputs = [];
  const result = await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: [path.join(scratchRoot, 'shims', 'docs-renderer-entry.ts')],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    metafile: true,
    minify: true,
    external: ['@tiptap/*', 'i18next', 'react', 'react/*'],
    nodePaths: [path.join(PACKAGE_DIR, 'node_modules')],
    plugins: [{
      name: 'docx-renderer-styles',
      setup(builder) {
        // The shim imports the vendored sheet with a `?docx-sheet` marker; the
        // plugin repackages the provenance-checked bytes for the surface root
        // (docx-renderer-styles.mjs) and inlines the minified result as the
        // module's default export, so one artifact carries markup + styling.
        builder.onResolve({ filter: /[?]docx-sheet$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/[?]docx-sheet$/, '')),
          namespace: 'docx-renderer-sheet',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'docx-renderer-sheet' }, async () => {
          const tokensPath = path.join(scratchUpstream, 'packages', 'ui', 'src', 'tokens.css');
          const stylesPath = path.join(scratchUpstream, 'apps', 'docs', 'src', 'renderer', 'styles.css');
          const sheet = buildDocxRendererStyleSheet({
            tokensCss: fs.readFileSync(tokensPath, 'utf8'),
            stylesCss: fs.readFileSync(stylesPath, 'utf8'),
          });
          const minified = await transform(sheet, { loader: 'css', minify: true });
          for (const file of [stylesPath, tokensPath]) {
            styleInputs.push({
              path: 'packages/office-upstream/upstream/' + path.relative(scratchUpstream, file).split(path.sep).join('/'),
              sha256: sha256File(file),
            });
          }
          return {
            contents: `export default ${JSON.stringify(DOCX_RENDERER_STYLE_BANNER + minified.code)};`,
            loader: 'js',
          };
        });
      },
    }, {
      name: 'docx-browser-compatibility',
      setup(builder) {
        // The locale seam and the UI shim stay UniWork files; every
        // @genoffice/* package resolves inside the patched scratch clone.
        builder.onResolve({ filter: /^\.\.\/i18n\/locale$/ }, () => ({
          path: path.join(scratchRoot, 'shims', 'docs-renderer', 'locale.ts'),
        }));
        builder.onResolve({ filter: /^@genoffice\// }, ({ path: specifier }) => {
          if (specifier === '@genoffice/ui') return { path: path.join(scratchRoot, 'shims', 'genoffice-ui.ts') };
          const [, packageName, ...subpath] = specifier.split('/');
          const packageRoot = path.join(scratchUpstream, 'packages', packageName);
          const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
          const exported = metadata.exports[subpath.length ? './' + subpath.join('/') : '.'];
          if (typeof exported !== 'string') throw new Error(`No pinned browser export for ${specifier}`);
          return { path: path.resolve(packageRoot, exported) };
        });
      },
    }],
    logLevel: 'warning',
  });
  const imports = Object.values(result.metafile.outputs).flatMap((entry) => entry.imports);
  const forbidden = imports.filter((entry) => !/^(@tiptap\/|i18next$|react(?:\/|$))/.test(entry.path));
  if (forbidden.length) throw new Error(`Unexpected browser imports: ${forbidden.map((entry) => entry.path).join(', ')}`);
  const bytes = fs.readFileSync(output);
  // (c) the built artifact must really carry the patched symbols: a no-op
  // series would otherwise ship a silently unpatched renderer.
  const artifact = bytes.toString('utf8');
  if (!artifact.includes('formulaLatexEdit')) throw new Error('built artifact does not carry patch 0003 symbol "formulaLatexEdit"');
  if (!/querySelector\(["']\.docx-surface["']\)\s*\?\?\s*document\.body/.test(artifact)) {
    throw new Error('built artifact does not carry the patch 0004 scoped hf-probe mount');
  }
  if (!artifact.includes('page-gap-note')) throw new Error('built artifact does not carry page-gap notes');
  if (!artifact.includes('page-note-readonly')) throw new Error('built artifact does not carry read-only note areas');
  const record = {
    kind: 'uniwork-docx-browser-build',
    patchesApplied,
    patchedSymbols: PATCHED_SYMBOLS,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    inputs: Object.keys(result.metafile.inputs),
    styles: styleInputs,
    externalImports: imports.map((entry) => entry.path),
  };
  fs.writeFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer-build.json'), JSON.stringify(record, null, 2) + '\n');
  return { bytes: record.bytes, gzipBytes: record.gzipBytes, sha256: record.sha256, inputs: record.inputs.length, styles: record.styles };
}
