import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-953 X5 / patch 0015: a `#,##0` cell shows the separators of the editor
// language. The patch is applied to a scratch copy of the pinned numfmt-fix.ts
// (upstream/ is never edited), then bundled with the Univer heavyweights stubbed.
const pkg = path.join(REPO_ROOT, 'packages/office-upstream');
const rel = 'apps/sheets/src/renderer/numfmt-fix.ts';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-numfmt-locale-'));
fs.mkdirSync(path.dirname(path.join(scratch, rel)), { recursive: true });
fs.copyFileSync(path.join(pkg, 'upstream', rel), path.join(scratch, rel));
const applied = spawnSync('git', ['apply', '-p1', '--whitespace=nowarn', path.join(pkg, 'patches/0015-xlsx-numfmt-host-locale.patch')], {
  cwd: scratch, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: scratch },
});
assert.equal(applied.status, 0, applied.stderr);
const source = fs.readFileSync(path.join(scratch, rel), 'utf8');
fs.rmSync(scratch, { recursive: true, force: true });

const STUBBED = /^(@univerjs\/(engine-formula|engine-render|preset-sheets-conditional-formatting|sheets)|\.\/(app-constants|cell-font-fallback))$/;
const bundled = await build({
  stdin: { contents: source, resolveDir: path.join(pkg, 'upstream/apps/sheets/src/renderer'), loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'heavy-stubs',
    setup(builder) {
      builder.onResolve({ filter: STUBBED }, (args) => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const ERROR_TYPE_SET = new Set(); export const getWorkbookMdw = () => 7; export const isSubstitutedCellFamily = () => false;'
          + 'export const FontCache = {}; export const getFontStyleString = () => ({ fontString: "" }); export class ConditionalFormattingService {}'
          + 'export const INTERCEPTOR_POINT = {}; export class SheetInterceptorService {}',
      }));
    },
  }],
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(mod, mod.exports, createRequire(path.join(pkg, 'noop.js')));
const { applyHostNumfmtLocale, formatForMeasure } = mod.exports;

function runtimeWith(workbook) {
  return { univerAPI: { getActiveWorkbook: () => workbook } };
}

test('numfmt output follows the locale set by the shell, English by default', () => {
  assert.equal(formatForMeasure('#,##0', 1250000000), '1,250,000,000');
  applyHostNumfmtLocale(runtimeWith(null), 'vi');
  assert.equal(formatForMeasure('#,##0', 1250000000), '1.250.000.000');
  assert.equal(formatForMeasure('#,##0.00', 1234.5), '1.234,50');
  applyHostNumfmtLocale(runtimeWith(null), 'en');
  assert.equal(formatForMeasure('#,##0', 1250000000), '1,250,000,000');
  assert.equal(formatForMeasure('#,##0.00', 1234.5), '1,234.50');
});

test('the same locale reaches Univer\'s own formatter through the workbook facade', () => {
  const seen = [];
  const workbook = { setNumfmtLocal: (locale) => seen.push(locale) };
  applyHostNumfmtLocale(runtimeWith(workbook), 'vi');
  applyHostNumfmtLocale(runtimeWith(workbook), 'en');
  assert.deepEqual(seen, ['vi', 'en']);
  // A bundle whose facade lacks the method must not throw.
  assert.doesNotThrow(() => applyHostNumfmtLocale(runtimeWith({}), 'vi'));
});
