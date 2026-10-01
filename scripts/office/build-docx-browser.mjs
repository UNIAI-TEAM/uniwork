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
export const DOCX_BROWSER_SCRATCH = path.join(REPO_ROOT, '.go-tmp', 'docx-browser-build');

/**
 * Provenance-checked upstream bytes -> scratch clone (never upstream/) ->
 * patch series (git apply -p1 in SERIES.md order) -> the package layout the
 * bundle reads from. Mirrors build-upstream.mjs's patch step: the DOCX browser
 * artifact carries the same UniWork diffs as the rest of the vendored graph.
 */
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
    const applied = spawnSync('git', ['apply', '-p1', '--whitespace=nowarn', patchPath], { cwd: path.join(DOCX_BROWSER_SCRATCH, 'upstream'), encoding: 'utf8' });
    if (applied.status !== 0) throw new Error(`patch ${patchFile}: ${(applied.stderr || applied.stdout || 'git apply failed').trim()}`);
    patchesApplied.push({ patch: patchFile, sha256: sha256File(patchPath) });
  }
  return { scratchRoot: DOCX_BROWSER_SCRATCH, patchesApplied };
}

export async function buildDocxBrowser() {
  const problems = checkVendored(loadManifest());
  if (problems.length) throw new Error(`DOCX provenance check failed: ${problems.join('; ')}`);
  const { scratchRoot, patchesApplied } = materializePatchedDocxPackage();
  const scratchUpstream = path.join(scratchRoot, 'upstream');
  const output = path.join(PACKAGE_DIR, 'dist', 'docs-renderer.mjs');
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
  const record = {
    kind: 'uniwork-docx-browser-build',
    patchesApplied,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    inputs: Object.keys(result.metafile.inputs),
    externalImports: imports.map((entry) => entry.path),
  };
  fs.writeFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer-build.json'), JSON.stringify(record, null, 2) + '\n');
  return { bytes: record.bytes, gzipBytes: record.gzipBytes, sha256: record.sha256, inputs: record.inputs.length };
}
