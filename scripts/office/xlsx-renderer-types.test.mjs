import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// The vendored tree this test reads is UNPATCHED; the shim calls symbols that
// gateway patches add (build-xlsx-browser.mjs PATCHED_SYMBOLS pins them). Each
// is declared here by module augmentation, so a clean checkout typechecks the
// shim as the patched scratch tree the bundle builds from would.
const PATCH_ADDED_DECLARATIONS = [
  {
    patch: '0015-xlsx-numfmt-host-locale.patch',
    module: '../../upstream/apps/sheets/src/renderer/numfmt-fix',
    declaration: 'export function applyHostNumfmtLocale(runtime: UniverRuntime, locale: string): void',
  },
];

test('authored XLSX controller and journal helpers typecheck against pinned Univer', () => {
  const directory = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
  const slash = (name) => name.replaceAll('\\', '/');
  const virtualFile = slash(path.join(directory, '__patch-added-symbols.d.ts'));
  const virtualSource = [
    'import type { UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";',
    ...PATCH_ADDED_DECLARATIONS.map((entry) => `declare module "${entry.module}" { ${entry.declaration} }`),
  ].join('\n');
  for (const entry of PATCH_ADDED_DECLARATIONS) {
    const patch = fs.readFileSync(path.join(REPO_ROOT, 'packages/office-upstream/patches', entry.patch), 'utf8');
    assert.ok(patch.includes(entry.declaration), `${entry.patch} no longer adds "${entry.declaration}"`);
  }
  const options = {
    noEmit: true, strict: true, skipLibCheck: true, esModuleInterop: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    baseUrl: REPO_ROOT,
    paths: { '@genoffice/xlsx-gateway/*': ['packages/office-upstream/upstream/packages/xlsx-gateway/src/*'] },
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (name) => slash(name) === virtualFile || fileExists.call(host, name);
  host.readFile = (name) => (slash(name) === virtualFile ? virtualSource : readFile.call(host, name));
  host.getSourceFile = (name, languageVersion, ...rest) => (slash(name) === virtualFile
    ? ts.createSourceFile(name, virtualSource, languageVersion)
    : getSourceFile.call(host, name, languageVersion, ...rest));
  const program = ts.createProgram([
    path.join(directory, 'controller.ts'),
    path.join(directory, '../xlsx-renderer.d.ts'),
    path.join(directory, 'font-assets.d.ts'),
    virtualFile,
  ], options, host);
  // Vendored modules are compiled by esbuild; their pre-existing diagnostics
  // are outside the authored shim boundary checked by this focused test.
  const owned = new Set(['controller.ts', 'edits.ts', 'command-policy.ts', 'cell-input.ts', 'fonts.ts', 'locale.ts', 'rule-set-capture.ts', 'rule-set-policy.ts', '../xlsx-renderer.d.ts'].map(
    (name) => path.join(directory, name).replaceAll('\\', '/'),
  ));
  const authored = program.getSourceFiles().filter((source) => owned.has(source.fileName.replaceAll('\\', '/')));
  const diagnostics = authored.flatMap((source) => [
    ...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source),
  ]);
  const messages = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => REPO_ROOT, getNewLine: () => '\n',
  });
  assert.equal(diagnostics.length, 0, messages);
});
