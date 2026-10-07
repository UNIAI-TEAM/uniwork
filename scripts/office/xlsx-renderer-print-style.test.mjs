import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-952 visual r1 M2: the print read's style conversion, bundled the way
// xlsx-renderer-edits.test.mjs bundles the journal it wraps.
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const upstream = path.join(REPO_ROOT, 'packages/office-upstream/upstream');
const bundled = await build({
  stdin: { contents: `export { printStyleOf } from './print-style';`, resolveDir: renderer, loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'journal-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const CellValueType={STRING:1,NUMBER:2,BOOLEAN:3}; export const CommandType={COMMAND:0,OPERATION:1,MUTATION:2};',
      }));
      builder.onResolve({ filter: /^@genoffice\/xlsx-gateway\// }, (args) => ({
        path: path.join(upstream, 'packages/xlsx-gateway/src', args.path.split('/').slice(2).join('/')) + '.ts',
      }));
      builder.onResolve({ filter: /selection-format$/ }, () => ({ path: 'indent', namespace: 'test-indent' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-indent' }, () => ({ contents: 'export const INDENT_STEP_PX=9;' }));
    },
  }],
});
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { printStyleOf } = module.exports;

test('prints a conditional-format fill and font colour Univer holds as rgb() strings', () => {
  // print-test.xlsx F2:F120 "< 100": dxf fill FFC7CE, font 9C0006, as the CF
  // builder's ColorKit.toRgbString() leaves them on the composed style.
  const style = printStyleOf({ bl: 0, bg: { rgb: 'rgb(255,199,206)' }, cl: { rgb: 'rgba(156, 0, 6, 0.5)' } });
  assert.equal(style.fillColor, '#FFC7CE');
  assert.equal(style.fontColor, '#9C0006');
  assert.equal(style.bold, false);
});

test('keeps hex colours, clears and border colours', () => {
  assert.equal(printStyleOf({ bg: { rgb: '#ddebf7' } }).fillColor, '#DDEBF7');
  assert.equal(printStyleOf({ bg: { rgb: null } }).fillColor, null);
  const bordered = printStyleOf({ bd: { t: { s: 1, cl: { rgb: 'rgb(0,0,255)' } } } });
  assert.equal(bordered.borderTop?.color, '#0000FF');
});

test('prints a fully transparent rgba() colour as no colour, not an opaque fill', () => {
  assert.equal(printStyleOf({ bg: { rgb: 'rgba(255,199,206,0)' } }).fillColor, null);
  assert.equal(printStyleOf({ cl: { rgb: 'rgba(156,0,6,0%)' } }).fontColor, null);
  assert.equal(printStyleOf({ bd: { t: { s: 1, cl: { rgb: 'rgba(0,0,255,0.0)' } } } }).borderTop?.color ?? null, null);
  // Any visible alpha still prints at full strength.
  assert.equal(printStyleOf({ bg: { rgb: 'rgba(255,199,206,0.01)' } }).fillColor, '#FFC7CE');
});
