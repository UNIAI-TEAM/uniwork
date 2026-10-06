import type { UpstreamParseMap } from "@uniwork/office-engine/html";

const START_TAG_NAME = /^<[^\s/>]+/;
/** The shape `createVisualEditNonce` produces (and the preview port validates). */
const NONCE = /^[0-9a-f]{32}$/;

/** The attribute the stamp writes and the inspector reads for one session. */
export function sidAttributeName(nonce: string): string {
  return `data-sid-${nonce}`;
}

/**
 * The preview copy of `text` with a sid attribute on every element the parse map
 * knows, so the inspector (which reads only that attribute) and the H3 ops
 * (which resolve by sid) name the same element. ADR 0027 leaves this to H5.
 *
 * The attribute NAME carries the per-session nonce (`data-sid-<32 hex>`), which
 * the document cannot know: a hostile file cannot make the inspector report an
 * element the stamp did not number, whatever the HTML tokenizer does with its
 * bytes. There is no scanning or stripping of the document's own attributes -
 * a `data-sid` it carries is just an inert attribute the inspector never reads.
 *
 * It is a COPY for the isolated frame: the result is never written back to the
 * source, the engine or a draft. An element with no source start tag (the
 * implied html/head/body) and a range that no longer fits `text` (a map older
 * than the text) are skipped rather than guessed at. A malformed nonce stamps
 * nothing (fail closed).
 */
export function stampSids(text: string, map: UpstreamParseMap, nonce: string): string {
  if (!NONCE.test(nonce)) return text;
  const attribute = sidAttributeName(nonce);
  const inserts: Array<{ at: number; sid: number }> = [];
  for (const element of map.elements) {
    const [from, to] = element.startTag;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || to <= from) continue;
    const name = START_TAG_NAME.exec(text.slice(from, to));
    if (name) inserts.push({ at: from + name[0].length, sid: element.sid });
  }
  if (inserts.length === 0) return text;
  inserts.sort((a, b) => a.at - b.at);
  let out = "";
  let cursor = 0;
  for (const insert of inserts) {
    if (insert.at < cursor) continue;
    out += `${text.slice(cursor, insert.at)} ${attribute}="${insert.sid}"`;
    cursor = insert.at;
  }
  return out + text.slice(cursor);
}
