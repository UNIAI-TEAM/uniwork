// G3-05c (UNI-824) - repackage the Univer sheet stylesheets for the UniWork
// XLSX surface root.
//
// Univer's preset CSS is a Tailwind build with `.univer-*` class names plus a
// handful of element-wide rules (the `*`/`:before` variable reset and the
// scrollbar reset). The UniWork XLSX editor is a slot inside the shell, so the
// sheet is wrapped in `@scope (.xlsx-surface)`: the global resets then bind to
// the surface subtree and cannot reach the rest of the app. Global at-rules
// (@keyframes, @font-face, ...) stay outside the scope block - they are not
// selector-scoped and CSS ignores them inside @scope.
//
// The transform runs at browser-bundle time over the installed packages; no
// upstream byte is rewritten.
import { topLevelNodes } from './docx-renderer-styles.mjs';

export const XLSX_SURFACE_SCOPE = '.xlsx-surface';

const GROUP_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'scope']);
const GLOBAL_AT_RULES = new Set(['keyframes', 'font-face', 'property', 'page', 'counter-style', 'font-feature-values', 'charset', 'import']);

function rewriteRuleList(css) {
  const root = [];
  const scope = [];
  for (const node of topLevelNodes(css)) {
    if (node.block == null) {
      const text = node.prelude.trim();
      if (text) root.push(text);
      continue;
    }
    const prelude = node.prelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    const atName = /^@([a-z-]+)/i.exec(prelude);
    if (atName) {
      const name = atName[1].toLowerCase();
      if (GLOBAL_AT_RULES.has(name)) {
        root.push(`${prelude} {${node.block}}`);
        continue;
      }
      if (GROUP_AT_RULES.has(name)) {
        const inner = rewriteRuleList(node.block);
        const body = [inner.root.join('\n'), inner.scope.length ? `@scope (${XLSX_SURFACE_SCOPE}) {\n${inner.scope.join('\n')}\n}` : '']
          .filter(Boolean)
          .join('\n');
        if (body) root.push(`${prelude} {\n${body}\n}`);
        continue;
      }
      scope.push(`${prelude} {${node.block}}`);
      continue;
    }
    scope.push(`${prelude} {${node.block}}`);
  }
  return { root, scope };
}

/** Wrap a Univer stylesheet under the XLSX surface root. Deterministic. */
export function scopeXlsxRendererStyles(css) {
  const { root, scope } = rewriteRuleList(css);
  const parts = [];
  if (root.length) parts.push(root.join('\n'));
  if (scope.length) parts.push(`@scope (${XLSX_SURFACE_SCOPE}) {\n${scope.join('\n')}\n}`);
  return parts.join('\n');
}

export const XLSX_RENDERER_STYLE_BANNER =
  '/* UniWork G3-05c (UNI-824): Univer sheet styles, repackaged for the\n' +
  '   .xlsx-surface root by scripts/office/xlsx-renderer-styles.mjs.\n' +
  '   Generated from the installed @univerjs preset stylesheets - do not edit. */\n';

export function buildXlsxRendererStyleSheet({ cssFiles }) {
  const merged = cssFiles.map(([path, css]) => `/* ${path} */\n${css}`).join('\n');
  return XLSX_RENDERER_STYLE_BANNER + scopeXlsxRendererStyles(merged) + '\n';
}
