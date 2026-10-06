import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildXlsxBrowser, PATCHED_SYMBOLS, UNIVER_STYLE_FILES } from './build-xlsx-browser.mjs';
import { PATCHES_DIR } from './build-upstream.mjs';
import { PACKAGE_DIR, UPSTREAM_DIR } from './vendor-upstream.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

test('XLSX browser entry bundles the vendored sheets renderer with only shared browser imports', async () => {
  const result = await buildXlsxBrowser();
  assert.ok(result.bytes > 0);
  const record = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'xlsx-renderer-build.json'), 'utf8'));
  // The artifact is a patched build: every series patch must apply to the
  // scratch clone before the bundle resolves (SERIES.md + build-upstream).
  const patchFiles = fs.readdirSync(PATCHES_DIR).filter((name) => name.endsWith('.patch')).sort();
  assert.deepEqual(record.patchesApplied.map((entry) => entry.patch), patchFiles);
  for (const entry of record.patchesApplied) assert.match(entry.sha256, /^[0-9A-F]{64}$/);
  // The renderer controller and its Univer integration closure are inside.
  for (const required of ['renderer/univer-sync.ts', 'renderer/edit-journal.ts', 'renderer/create-univer.ts']) {
    assert.ok(record.inputs.some((input) => input.endsWith(required)), required);
  }
  // The gateway is consumed through its vendored browser-safe domain modules.
  assert.ok(record.inputs.some((input) => input.includes('xlsx-gateway/src/domain/cell-address.ts')));
  // Univer itself is bundled (the artifact is the lazy renderer chunk);
  // react/react-dom/i18next stay host-owned singletons.
  for (const specifier of record.externalImports) assert.match(specifier, /^react(?:\/|$)|^react-dom(?:\/|$)|^i18next$/);
  // The Univer stylesheet set the pin imports is repackaged into the artifact.
  assert.deepEqual(record.styles.map((s) => s.path), UNIVER_STYLE_FILES);
  // Carlito (SIL OFL) faces are inlined for the grid's canvas metrics.
  assert.deepEqual(
    record.fonts.map((f) => f.path.split('/').pop()).sort(),
    ['Carlito-Bold.ttf', 'Carlito-Regular.ttf'],
  );
});

test('every pinned patch symbol is absent from the unpatched upstream source', () => {
  // review-visuals V6: a symbol upstream already has cannot detect a lost hunk.
  for (const { patch, file, symbol } of PATCHED_SYMBOLS) {
    const body = fs.readFileSync(path.join(UPSTREAM_DIR, file), 'utf8');
    assert.equal(body.includes(symbol), false, `patch ${patch} pins "${symbol}", which ${file} already carries before the series`);
  }
});

test('every patch that adds a symbol the host calls is pinned', () => {
  // review-design F7: gateway patch 0015 (applyHostNumfmtLocale) must be pinned too.
  assert.ok(
    PATCHED_SYMBOLS.some((s) => s.patch === '0015' && s.symbol === 'export function applyHostNumfmtLocale('),
    'patch 0015 has no pinned symbol',
  );
});

test('the built xlsx artifact carries its contract symbols', () => {
  const record = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'xlsx-renderer-build.json'), 'utf8'));
  assert.deepEqual(
    (record.patchedSymbols ?? []).map((s) => s.symbol),
    [
      'xfIdentity',
      'lazilyLoadedXmls',
      '    tableAdditions,',
      '    visualAdditions,',
      'export const UNIWORK_XLSX_VISUAL_ADDITIONS = true',
      '    visualEdits,',
      'export const UNIWORK_XLSX_VISUAL_EDITS = true',
      'export async function readEntriesBase64(',
      'export const UNIWORK_XLSX_VISUAL_READ_BUDGET = true',
      'export function applyHostNumfmtLocale(',
      'export function noteFormulaStreamChunk(runtime: UniverRuntime): void',
    ],
    'the build records the enforced patched symbols',
  );
  const artifact = fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'xlsx-renderer.mjs'), 'utf8');
  // UNI-957: the window.desktopApi bridge routes by session (no last-mount-wins).
  for (const symbol of ['createXlsxRenderer', 'installXlsxRendererStyles', 'XLSX_RENDERER_STYLE_ELEMENT_ID', 'xlsx_renderer_session_unbound']) {
    assert.ok(artifact.includes(symbol), `artifact carries ${symbol}`);
  }
});

test('every vendored t() key ships in the en/vi editor packs', () => {
  const record = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'dist', 'xlsx-renderer-build.json'), 'utf8'));
  const english = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/core/i18n/locales/en.json'), 'utf8')).office.xlsx.editor;
  const vietnamese = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/core/i18n/locales/vi.json'), 'utf8')).office.xlsx.editor;
  let checked = 0;
  for (const input of record.inputs.filter((entry) => entry.includes('/apps/sheets/src/renderer/'))) {
    if (!fs.existsSync(path.resolve(REPO_ROOT, input))) continue;
    const source = fs.readFileSync(path.resolve(REPO_ROOT, input), 'utf8');
    for (const match of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) {
      checked += 1;
      assert.equal(typeof english[match[1]], 'string', `en: ${match[1]}`);
      assert.equal(typeof vietnamese[match[1]], 'string', `vi: ${match[1]}`);
    }
  }
  assert.ok(checked >= 17, `expected the renderer keys to be checked (saw ${checked})`);
});
