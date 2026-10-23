import { assetRelativeSegments } from './lab-storage.mjs';

/** Discover local inline/reference assets; storage still enforces realpath grants. */
export function discoverMarkdownSources(text) {
  const lines = String(text).split(/\r?\n/);
  let fence = null;
  const prose = lines.filter((line) => {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      return false;
    }
    if (match) { fence = match[1]; return false; }
    return true;
  }).join('\n').replace(/(`+)[\s\S]*?\1/g, '');
  const destinations = [];
  const inline = /!?\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s()])+))(?:\s+["'][^\n]*?["'])?\s*\)/g;
  for (const match of prose.matchAll(inline)) destinations.push(match[1] ?? match[2]);
  const references = new Map();
  for (const match of prose.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    references.set(match[1].trim().toLowerCase(), match[2] ?? match[3]);
  }
  for (const match of prose.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const value = references.get((match[2] || match[1]).trim().toLowerCase());
    if (value) destinations.push(value);
  }
  const sources = [];
  for (const destination of destinations) {
    try {
      const raw = destination.split(/[?#]/, 1)[0].replace(/\\([\\()[\] ])/g, '$1');
      const decoded = decodeURIComponent(raw);
      if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) continue;
      assetRelativeSegments(decoded);
      if (!sources.includes(decoded)) sources.push(decoded);
    } catch { /* Invalid and external destinations never receive an asset grant. */ }
  }
  return sources;
}
