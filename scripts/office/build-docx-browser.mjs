import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { PACKAGE_DIR, UPSTREAM_DIR, checkVendored, loadManifest } from './vendor-upstream.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

export async function buildDocxBrowser() {
  const problems = checkVendored(loadManifest());
  if (problems.length) throw new Error(`DOCX provenance check failed: ${problems.join('; ')}`);
  const output = path.join(PACKAGE_DIR, 'dist', 'docs-renderer.mjs');
  const result = await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: [path.join(PACKAGE_DIR, 'shims', 'docs-renderer-entry.ts')],
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
        builder.onResolve({ filter: /^\.\.\/i18n\/locale$/ }, () => ({
          path: path.join(PACKAGE_DIR, 'shims', 'docs-renderer', 'locale.ts'),
        }));
        builder.onResolve({ filter: /^@genoffice\// }, ({ path: specifier }) => {
          if (specifier === '@genoffice/ui') return { path: path.join(PACKAGE_DIR, 'shims', 'genoffice-ui.ts') };
          const [, packageName, ...subpath] = specifier.split('/');
          const packageRoot = path.join(UPSTREAM_DIR, 'packages', packageName);
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
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    inputs: Object.keys(result.metafile.inputs),
    externalImports: imports.map((entry) => entry.path),
  };
  fs.writeFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer-build.json'), JSON.stringify(record, null, 2) + '\n');
  return { bytes: record.bytes, gzipBytes: record.gzipBytes, sha256: record.sha256, inputs: record.inputs.length };
}
