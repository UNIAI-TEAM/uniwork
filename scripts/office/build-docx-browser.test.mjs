import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildDocxBrowser } from './build-docx-browser.mjs';
import { PACKAGE_DIR } from './vendor-upstream.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

test('DOCX browser entry bundles the real renderer with only shared browser imports', async () => {
  const result = await buildDocxBrowser();
  assert.ok(result.bytes > 0);
  const record = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'docs-renderer-build.json'), 'utf8'));
  for (const required of ['editor/extensions.ts', 'editor/convert.ts', 'src/wordart-presets.ts', 'src/shape-gallery.tsx']) {
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
