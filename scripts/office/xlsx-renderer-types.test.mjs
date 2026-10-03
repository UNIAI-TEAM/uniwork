import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { REPO_ROOT } from '../office-g0/paths.mjs';

test('authored XLSX controller and journal helpers typecheck against pinned Univer', () => {
  const directory = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
  const program = ts.createProgram([
    path.join(directory, 'controller.ts'),
    path.join(directory, '../xlsx-renderer.d.ts'),
    path.join(directory, 'font-assets.d.ts'),
  ], {
    noEmit: true, strict: true, skipLibCheck: true, esModuleInterop: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    baseUrl: REPO_ROOT,
    paths: { '@genoffice/xlsx-gateway/*': ['packages/office-upstream/upstream/packages/xlsx-gateway/src/*'] },
  });
  // Vendored modules are compiled by esbuild; their pre-existing diagnostics
  // are outside the authored shim boundary checked by this focused test.
  const owned = new Set(['controller.ts', 'edits.ts', 'command-policy.ts', 'cell-input.ts', 'fonts.ts', 'locale.ts', '../xlsx-renderer.d.ts'].map(
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
