import { decodeHtmlAttributeValue } from './lab-html-sources.mjs';

// Discover only authored stylesheet links. Quoted attributes, comments and raw
// text are consumed as units so embedded markup cannot grant an extra asset.
export function discoverHtmlStylesheets(html) {
  const found = new Set();
  const text = String(html ?? '');
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4);
      cursor = end < 0 ? text.length : end + 3;
      continue;
    }
    const name = /^<([a-z][\w:-]*)(?=[\s/>])/i.exec(text.slice(start));
    if (!name) { cursor = start + 1; continue; }
    let end = start + name[0].length, quote = null;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === text.length) break;
    cursor = end + 1;
    const tag = name[1].toLowerCase();
    if (['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(tag)) {
      const close = new RegExp('</' + tag + '\\s*>', 'gi');
      close.lastIndex = cursor;
      const match = close.exec(text);
      cursor = match ? close.lastIndex : text.length;
      continue;
    }
    if (tag === 'plaintext') break;
    if (tag !== 'link') continue;
    const attributes = new Map();
    const body = text.slice(start + name[0].length, end);
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const match of body.matchAll(pattern)) {
      const key = match[1].toLowerCase();
      if (!attributes.has(key)) attributes.set(key, decodeHtmlAttributeValue(match[2] ?? match[3] ?? match[4] ?? ''));
    }
    if (!(attributes.get('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue;
    const href = attributes.get('href');
    if (href) found.add(href);
  }
  return [...found];
}
