// DOC-003 lab (UNI-667): bounded <img src> discovery for an HTML session buffer.
//
// The HTML renderer's doSave sends an empty imageSources list, so host:text-save
// copied only the sources a caller named and a relative assets/dot.png disappeared
// when a saved output was reopened in a fresh session. Upstream merges
// extractHtmlImageSources(request.text) in apps/html/src/main/html-main.ts:1355;
// this helper is the lab-sized equivalent. It never rewrites the document: the
// authored bytes are written unchanged and only the asset copy list grows.
//
// Supported: case-insensitive <img ...> including <img/>, src in double quotes,
// single quotes or unquoted, and the six basic named character references plus
// decimal and hex numeric references in the value. <script>, <style> and
// <!-- ... --> contents are skipped, so markup there is never an image reference.
//
// Not supported, on purpose: srcset, and every attribute except src; a second src
// on one tag keeps the first; the complete HTML named-entity table; an
// unterminated tag, comment or raw-text element ends the scan; <img inside another
// tag's attribute value can still be seen. Nothing here grants a read or a write:
// preserveRelativeAssets still re-checks every discovered source against the
// session's own grant set and containment rules, exactly as for an explicit list.
//
// Node 22 built-ins only. No production imports.

const BASIC_HTML_ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
});

/** Decodes the character references this lab-sized scanner claims to support. */
export function decodeHtmlAttributeValue(value) {
  return String(value).replace(/&([^&;\s]+);/g, (entity, body) => {
    if (body.startsWith('#')) {
      const hexadecimal = body[1] === 'x' || body[1] === 'X';
      const digits = body.slice(hexadecimal ? 2 : 1);
      if (digits.length === 0) return entity;
      if (!(hexadecimal ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits))) return entity;
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (codePoint <= 0 || codePoint > 0x10ffff) return entity;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return entity;
      return String.fromCodePoint(codePoint);
    }
    const name = body.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(BASIC_HTML_ENTITIES, name)) return entity;
    return BASIC_HTML_ENTITIES[name];
  });
}

/** The opening tag name at index, or null when this < opens no element. */
function openingTagName(html, index) {
  const next = html[index + 1];
  if (next === undefined) return null;
  if (next === '/' || next === '!' || next === '?') return null;
  let cursor = index + 1;
  const start = cursor;
  while (cursor < html.length && /[A-Za-z0-9:-]/.test(html[cursor])) cursor += 1;
  if (cursor === start) return null;
  if (cursor < html.length && !/[\s/>]/.test(html[cursor])) return null;
  return html.slice(start, cursor).toLowerCase();
}

/** The > of the matching </name ...> close tag, or -1 when there is none. */
function rawTextEnd(html, contentStart, name) {
  const close = new RegExp('</' + name + '(?=[\\s/>])', 'gi');
  close.lastIndex = contentStart;
  const match = close.exec(html);
  if (!match) return -1;
  const end = html.indexOf('>', match.index);
  return end < 0 ? -1 : end;
}

/** The src of one <img ...> tag, or null; nextIndex always moves forward. */
function parseImgTag(html, tagStart) {
  let cursor = tagStart + 4;
  let src = null;
  while (cursor < html.length) {
    while (cursor < html.length && /\s/.test(html[cursor])) cursor += 1;
    if (cursor >= html.length) break;
    if (html[cursor] === '>') return { nextIndex: cursor + 1, src };
    if (html[cursor] === '/') {
      if (html[cursor + 1] === '>') return { nextIndex: cursor + 2, src };
      cursor += 1;
      continue;
    }
    const nameStart = cursor;
    while (cursor < html.length && !/[\s=/>]/.test(html[cursor])) cursor += 1;
    const attributeName = html.slice(nameStart, cursor).toLowerCase();
    while (cursor < html.length && /\s/.test(html[cursor])) cursor += 1;
    if (html[cursor] !== '=') continue;
    cursor += 1;
    while (cursor < html.length && /\s/.test(html[cursor])) cursor += 1;
    if (cursor >= html.length) break;

    const quote = html[cursor] === '"' || html[cursor] === "'" ? html[cursor] : null;
    let valueStart;
    let valueEnd;
    if (quote) {
      valueStart = cursor + 1;
      valueEnd = html.indexOf(quote, valueStart);
      if (valueEnd < 0) return { nextIndex: html.length, src };
      cursor = valueEnd + 1;
    } else {
      valueStart = cursor;
      while (cursor < html.length && !/[\s>]/.test(html[cursor]) &&
        !(html[cursor] === '/' && html[cursor + 1] === '>')) {
        cursor += 1;
      }
      valueEnd = cursor;
    }
    if (attributeName === 'src' && src === null) {
      src = decodeHtmlAttributeValue(html.slice(valueStart, valueEnd));
    }
  }
  return { nextIndex: html.length, src };
}

/** Every distinct <img src> value in document order, entity-decoded. */
export function discoverHtmlImageSources(html) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const sources = [];
  const seen = new Set();
  for (let index = 0; index < html.length; index += 1) {
    if (html[index] !== '<') continue;
    if (html.startsWith('<!--', index)) {
      const commentEnd = html.indexOf('-->', index + 4);
      if (commentEnd < 0) break;
      index = commentEnd + 2;
      continue;
    }
    const name = openingTagName(html, index);
    if (name === 'script' || name === 'style') {
      const end = rawTextEnd(html, index + 1, name);
      if (end < 0) break;
      index = end;
      continue;
    }
    if (name !== 'img') continue;
    const parsed = parseImgTag(html, index);
    index = Math.max(index, parsed.nextIndex - 1);
    if (parsed.src === null || parsed.src.length === 0) continue;
    if (seen.has(parsed.src)) continue;
    seen.add(parsed.src);
    sources.push(parsed.src);
  }
  return sources;
}

/** Explicit sources first, then discovered ones, each string exactly once. */
export function mergeImageSources(explicit, discovered) {
  const merged = [];
  const seen = new Set();
  const add = (source) => {
    if (typeof source !== 'string' || source.length === 0 || seen.has(source)) return;
    seen.add(source);
    merged.push(source);
  };
  if (Array.isArray(explicit)) for (const source of explicit) add(source);
  if (Array.isArray(discovered)) for (const source of discovered) add(source);
  return merged;
}
