import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildDocxBrowser } from './build-docx-browser.mjs';
import { PATCHES_DIR } from './build-upstream.mjs';
import { PACKAGE_DIR } from './vendor-upstream.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

test('DOCX browser entry bundles the real renderer with only shared browser imports', async () => {
  const result = await buildDocxBrowser();
  assert.ok(result.bytes > 0);
  const record = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer-build.json'), 'utf8'));
  // The browser artifact is a patched build: every series patch must apply to
  // the scratch clone before the bundle resolves (SERIES.md + build-upstream).
  const patchFiles = fs.readdirSync(PATCHES_DIR).filter((name) => name.endsWith('.patch')).sort();
  assert.deepEqual(record.patchesApplied.map((entry) => entry.patch), patchFiles);
  for (const entry of record.patchesApplied) assert.match(entry.sha256, /^[0-9A-F]{64}$/);
  for (const required of ['editor/note-dom.ts', 'editor/extensions.ts', 'editor/convert.ts', 'src/wordart-presets.ts', 'src/shape-gallery.tsx']) {
    assert.ok(record.inputs.some(input => input.endsWith(required)), required);
  }
  for (const specifier of record.externalImports) assert.match(specifier, /^(@tiptap\/|i18next$|react(?:\/|$))/);
  const english = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/core/i18n/locales/en.json'), 'utf8')).office.docx.editor;
  const vietnamese = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/core/i18n/locales/vi.json'), 'utf8')).office.docx.editor;
  for (const input of record.inputs.filter(input => input.includes('/apps/docs/src/renderer/'))) {
    const source = fs.readFileSync(path.resolve(REPO_ROOT, input), 'utf8');
    for (const match of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) {
      assert.equal(typeof english[match[1]], 'string', `en: ${match[1]}`);
      assert.equal(typeof vietnamese[match[1]], 'string', `vi: ${match[1]}`);
    }
  }
});

test('the built artifact carries the patched symbols (a no-op series must fail)', () => {
  const record = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer-build.json'), 'utf8'));
  assert.ok(record.patchesApplied.some((p) => p.patch.startsWith('0003')), 'patch 0003 recorded as applied');
  assert.ok(record.patchesApplied.some((p) => p.patch.startsWith('0004')), 'patch 0004 recorded as applied');
  assert.ok(record.patchesApplied.some((p) => p.patch.startsWith('0005')), 'patch 0005 recorded as applied');
  assert.deepEqual(
    (record.patchedSymbols ?? []).map((s) => s.symbol),
    ['row.dataset.noteId', 'page-note-readonly', 'formulaLatexEdit', '.docx-surface'],
    'the build records the enforced patched symbols',
  );
  const artifact = fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer.mjs'), 'utf8');
  assert.ok(artifact.includes('formulaLatexEdit'), 'artifact carries the 0003 formula-edit option');
  assert.ok(artifact.includes('dataset.noteId'), 'artifact carries the 0006 note identity channel');
  assert.ok(artifact.includes('page-note-readonly'), 'artifact carries the 0005 display-only note option');
  assert.match(artifact, /querySelector\(["']\.docx-surface["']\)\s*\?\?\s*document\.body/, 'artifact carries the 0004 scoped hf-probe mount');
});
