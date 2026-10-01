// G3-04c T-01 (UNI-823) - turn the vendored GenOffice renderer stylesheet into
// a sheet the UniWork DOCX surface can load without leaking into the app shell.
//
// The upstream sheet (apps/docs/src/renderer/styles.css + packages/ui/src/
// tokens.css) is written for a whole GenOffice window: it styles body, html,
// :root tokens, the ribbon and the document paper in one global scope. The
// UniWork DOCX editor is a slot inside the shell, so the sheet is repackaged:
//
//   - every selector that can only mean "the host document" (`:root`, `html`,
//     `body`, `#root`) is re-aimed at the surface root `.docx-surface` and
//     emitted OUTSIDE the scope block, because the scope root itself is not
//     matched by rules inside `@scope`;
//   - the upstream `[data-theme='dark']` token block is re-aimed at
//     `.dark .docx-surface`, because UniWork switches themes with the `dark`
//     class (next-themes class strategy) instead of a `data-theme` attribute;
//   - the `@media (prefers-color-scheme: dark)` fallback block is dropped: its
//     declarations duplicate the `[data-theme='dark']` block, and UniWork's
//     system mode still lands as the `dark` class, so the media query would
//     only produce a stale duplicate;
//   - everything else keeps its upstream selector verbatim inside
//     `@scope (.docx-surface) { ... }`, so `.doc-table`, `.doc-li`, `.page-dark`
//     and the `--doc-b-*` / `--dk-*` consumers bind to the editor DOM and
//     nowhere else.
//
// No upstream byte is rewritten at the source: the transform runs on the
// provenance-checked copy at browser-bundle time (build-docx-browser.mjs).
export const DOCX_SURFACE_SCOPE = '.docx-surface';
export const DOCX_DARK_CLASS = '.dark';

const HOST_EXACT = new Map([
  [':root', () => DOCX_SURFACE_SCOPE],
  ['html', () => DOCX_SURFACE_SCOPE],
  ['body', () => DOCX_SURFACE_SCOPE],
  ['#root', () => DOCX_SURFACE_SCOPE],
  ["[data-theme='dark']", () => `${DOCX_DARK_CLASS} ${DOCX_SURFACE_SCOPE}`],
  ['[data-theme="dark"]', () => `${DOCX_DARK_CLASS} ${DOCX_SURFACE_SCOPE}`],
]);

/** `:root:lang(x)` / `:root:not(...)`: re-aim the :root prefix, keep the rest. */
const HOST_PREFIX_RE = /^:root(?=[:\[])/;

const GROUP_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'scope']);
const GLOBAL_AT_RULES = new Set(['keyframes', 'font-face', 'property', 'page', 'counter-style', 'font-feature-values', 'charset', 'import']);

const DARK_SCHEME_RE = /prefers-color-scheme\s*:\s*dark/i;

/** Skip `/* ... *\/` starting at i; returns the index after the comment. */
function skipComment(css, i) {
  const end = css.indexOf('*/', i + 2);
  return end === -1 ? css.length : end + 2;
}

/** Skip a quoted string starting at i; returns the index after the closing quote. */
function skipString(css, i) {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length) {
    if (css[j] === '\\') {
      j += 2;
      continue;
    }
    if (css[j] === quote) return j + 1;
    j += 1;
  }
  return css.length;
}

/** Index of the `}` matching the `{` at openIndex. */
function matchBrace(css, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error('unbalanced CSS block');
}

/**
 * Split a stylesheet into top-level nodes: `{ prelude, block }` for rules and
 * at-rule blocks, `{ prelude, block: null }` for statements (`@charset ...;`).
 */
export function topLevelNodes(css) {
  const nodes = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === '{') {
      const end = matchBrace(css, i);
      nodes.push({ prelude: css.slice(start, i), block: css.slice(i + 1, end) });
      i = end + 1;
      start = i;
      continue;
    }
    if (ch === ';') {
      const text = css.slice(start, i + 1);
      if (text.trim()) nodes.push({ prelude: text, block: null });
      i += 1;
      start = i;
      continue;
    }
    i += 1;
  }
  const tail = css.slice(start);
  if (tail.trim()) nodes.push({ prelude: tail, block: null });
  return nodes;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Split a selector list on top-level commas (parentheses, brackets and strings are opaque). */
export function splitSelectors(selectorList) {
  const out = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < selectorList.length; i += 1) {
    const ch = selectorList[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(selectorList, i);
      current += selectorList.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Host selector -> surface selector, or null when the selector is document-scoped already. */
export function reaimHostSelector(selector) {
  const s = selector.trim();
  const exact = HOST_EXACT.get(s);
  if (exact) return exact();
  if (HOST_PREFIX_RE.test(s)) return DOCX_SURFACE_SCOPE + s.slice(':root'.length);
  return null;
}

/**
 * Rewrite one block content (`a { ... } b { ... }` style rule list) into
 * `{ root, scope }` chunks: `root` holds the host-rewritten rules that must sit
 * outside `@scope`, `scope` the verbatim-selector rules that must sit inside.
 * `dropHost` is set inside `@media (prefers-color-scheme: dark)`; there the
 * host rules are dropped instead of hoisted (see the module header).
 */
function rewriteRuleList(css, { dropHost }) {
  const root = [];
  const scope = [];
  for (const node of topLevelNodes(css)) {
    if (node.block == null) {
      const text = node.prelude.trim();
      if (!text) continue;
      root.push(text);
      continue;
    }
    const prelude = stripComments(node.prelude).trim();
    const atName = /^@([a-z-]+)/i.exec(prelude);
    if (atName) {
      const name = atName[1].toLowerCase();
      if (GLOBAL_AT_RULES.has(name)) {
        root.push(`${prelude} {${node.block}}`);
        continue;
      }
      if (GROUP_AT_RULES.has(name)) {
        const inner = rewriteRuleList(node.block, { dropHost: dropHost || (name === 'media' && DARK_SCHEME_RE.test(prelude)) });
        const body = [inner.root.join('\n'), inner.scope.length ? `@scope (${DOCX_SURFACE_SCOPE}) {\n${inner.scope.join('\n')}\n}` : '']
          .filter(Boolean)
          .join('\n');
        if (body) root.push(`${prelude} {\n${body}\n}`);
        continue;
      }
      // Unknown at-rule: keep it inside the scope, exactly as authored.
      scope.push(`${prelude} {${node.block}}`);
      continue;
    }
    const host = [];
    const scoped = [];
    for (const selector of splitSelectors(prelude)) {
      const reaimed = reaimHostSelector(selector);
      if (reaimed) host.push(reaimed);
      else scoped.push(selector);
    }
    if (host.length && !dropHost) root.push(`${dedupe(host).join(', ')} {${node.block}}`);
    if (scoped.length) scope.push(`${dedupe(scoped).join(', ')} {${node.block}}`);
  }
  return { root, scope };
}

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * Repackage a vendored renderer stylesheet for the UniWork DOCX surface root.
 * Deterministic: the same bytes produce the same sheet.
 */
export function scopeRendererStyles(css) {
  const { root, scope } = rewriteRuleList(css, { dropHost: false });
  const parts = [];
  if (root.length) parts.push(root.join('\n'));
  if (scope.length) parts.push(`@scope (${DOCX_SURFACE_SCOPE}) {\n${scope.join('\n')}\n}`);
  return parts.join('\n');
}

export const DOCX_RENDERER_STYLE_BANNER =
  '/* UniWork G3-04c (UNI-823): vendored GenOffice renderer document styles,\n' +
  '   repackaged for the .docx-surface root by scripts/office/docx-renderer-styles.mjs.\n' +
  '   Generated from the provenance-checked copies of\n' +
  '   apps/docs/src/renderer/styles.css and packages/ui/src/tokens.css - do not edit. */\n';

/** The complete surface stylesheet: chrome tokens first, then document styles. */
export function buildDocxRendererStyleSheet({ tokensCss, stylesCss }) {
  return DOCX_RENDERER_STYLE_BANNER + scopeRendererStyles(`${tokensCss}\n${stylesCss}`) + '\n';
}
