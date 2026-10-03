import assert from 'node:assert/strict';
import { test } from 'node:test';
import { XLSX_SURFACE_SCOPE, buildXlsxRendererStyleSheet, scopeXlsxRendererStyles } from './xlsx-renderer-styles.mjs';

test('univer rules are wrapped in the xlsx surface scope', () => {
  const css = '.univer-foo{color:red}\n*{box-sizing:border-box}\n.univer-bar,.univer-baz{display:none}';
  const scoped = scopeXlsxRendererStyles(css);
  assert.match(scoped, new RegExp('@scope \\(' + XLSX_SURFACE_SCOPE.replace('.', '\\.') + '\\)'));
  assert.match(scoped, /\.univer-foo\s*\{color:red\}/, 'rule kept inside the scope');
  assert.match(scoped, /\*\s*\{box-sizing:border-box\}/, 'element-wide reset stays inside the scope');
  assert.match(scoped, /\.univer-bar,\.univer-baz\s*\{display:none\}/, 'selector lists stay intact');
});

test('global at-rules stay outside the scope and media groups are scoped inside', () => {
  const css = '@keyframes spinner{to{transform:rotate(360deg)}}\n@media (min-width:640px){.univer-sm{display:block}}';
  const scoped = scopeXlsxRendererStyles(css);
  const keyframesAt = scoped.indexOf('@keyframes spinner');
  const scopeAt = scoped.indexOf('@scope');
  assert.ok(keyframesAt !== -1 && (scopeAt === -1 || keyframesAt < scopeAt), 'keyframes emitted outside the scope');
  assert.match(scoped, /@media \(min-width:640px\) \{\s*@scope/);
});

test('the merged stylesheet carries the UniWork banner and every input rule', () => {
  const sheet = buildXlsxRendererStyleSheet({
    cssFiles: [
      ['@univerjs/preset-sheets-core/lib/index.css', '.univer-a{color:red}'],
      ['@univerjs/sheets-ui/lib/index.css', '.univer-b{color:blue}'],
    ],
  });
  assert.match(sheet, /UniWork G3-05c \(UNI-824\)/);
  assert.match(sheet, /\.univer-a\s*\{color:red\}/);
  assert.match(sheet, /\.univer-b\s*\{color:blue\}/);
});
