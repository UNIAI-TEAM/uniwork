import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  DOCX_SURFACE_SCOPE,
  buildDocxRendererStyleSheet,
  scopeRendererStyles,
  splitSelectors,
  topLevelNodes,
} from './docx-renderer-styles.mjs';
import { UPSTREAM_DIR } from './vendor-upstream.mjs';

const SYNTHETIC = `
:root {
  --a: 1;
}
body {
  color: red;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
}
[data-theme='dark'] {
  --a: 3;
}
.doc-table {
  border-collapse: collapse;
}
.page-dark .doc-li::before {
  color: var(--dk-c);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):not([data-theme='dark']) {
    --a: 2;
  }
}
@media (min-width: 600px) {
  .doc-li {
    padding: 1px;
  }
  body {
    margin: 2px;
  }
}
@keyframes blink {
  to {
    visibility: hidden;
  }
}
`;

test('splitSelectors keeps commas inside functions and attributes', () => {
  assert.deepEqual(splitSelectors(":is(a, b), .c[d='x,y'], .e"), [':is(a, b)', ".c[d='x,y']", '.e']);
});

test('host selectors are re-aimed at the surface root and document selectors stay scoped', () => {
  const out = scopeRendererStyles(SYNTHETIC);
  assert.match(out, /\.docx-surface \{[\s\S]*--a: 1/);
  assert.match(out, /\.dark \.docx-surface \{[\s\S]*--a: 3/);
  assert.match(out, /@scope \(\.docx-surface\) \{/);
  assert.ok(out.indexOf('.doc-table') > out.indexOf('@scope'), '.doc-table must be inside the scope');
  assert.ok(out.indexOf('.page-dark .doc-li::before') > out.indexOf('@scope'), 'page-dark rules must be inside the scope');
  assert.ok(!/^body\s*\{/m.test(out), 'body must never be a top-level selector');
  assert.ok(!/^html\s*,/m.test(out), 'html must never be a top-level selector');
  assert.ok(!out.includes(':root'), 'no :root selector may survive');
  assert.ok(!out.includes('--a: 2'), 'the prefers-color-scheme duplicate must be dropped');
});

test('non-theme media queries keep both the re-aimed host rule and the scoped rule', () => {
  const out = scopeRendererStyles(SYNTHETIC);
  const media = /@media \(min-width: 600px\) \{([\s\S]*?)\n\}/.exec(out);
  assert.ok(media, 'min-width media block survives');
  assert.match(media[1], /\.docx-surface \{\n\s*margin: 2px/);
  assert.match(media[1], /@scope \(\.docx-surface\) \{[\s\S]*\.doc-li/);
});

test('keyframes are hoisted out of the scope block', () => {
  const out = scopeRendererStyles(SYNTHETIC);
  const topLevel = topLevelNodes(out).map((node) => node.prelude.trim());
  assert.ok(topLevel.some((prelude) => prelude.startsWith('@keyframes blink')), 'keyframes sit at the top level');
  const scopeNode = topLevelNodes(out).find((node) => node.prelude.trim().startsWith('@scope'));
  assert.ok(scopeNode && !scopeNode.block.includes('@keyframes'), 'the scope block carries no keyframes');
});

test('the vendored sheets repackage under one scope with no host selector left', () => {
  const tokensCss = fs.readFileSync(path.join(UPSTREAM_DIR, 'packages/ui/src/tokens.css'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(UPSTREAM_DIR, 'apps/docs/src/renderer/styles.css'), 'utf8');
  const sheet = buildDocxRendererStyleSheet({ tokensCss, stylesCss });
  assert.match(sheet, /@scope \(\.docx-surface\) \{/);
  assert.ok(sheet.includes('.doc-table'), 'document table rules present');
  assert.ok(sheet.includes('.page-dark'), 'dark page rules present');
  assert.ok(sheet.includes('.dark .docx-surface {'), 'dark token block re-aimed at the dark class');
  assert.ok(sheet.includes('--docs-paper-ink'), 'paper tokens carried over');
  assert.ok(!/:root/.test(sheet), 'no :root selector survives the transform');
  assert.equal(sheet, buildDocxRendererStyleSheet({ tokensCss, stylesCss }), 'transform is deterministic');

  const scopeIndex = sheet.indexOf('@scope');
  for (const node of topLevelNodes(sheet)) {
    const prelude = node.prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const selector of splitSelectors(prelude)) {
      assert.ok(
        selector.startsWith(DOCX_SURFACE_SCOPE) || selector.startsWith('.dark .docx-surface'),
        `top-level selector outside the scope must be a surface root: ${selector}`,
      );
    }
  }
  assert.ok(scopeIndex > 0, 'scope block follows the hoisted root rules');
});
