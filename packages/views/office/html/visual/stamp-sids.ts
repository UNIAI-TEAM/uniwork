import type { UpstreamParseMap } from "@uniwork/office-engine/html";

const START_TAG_NAME = /^<[^\s/>]+/;

/**
 * The preview copy of `text` with `data-sid="<sid>"` on every element the parse
 * map knows, so the inspector (which reads only `[data-sid]`) and the H3 ops
 * (which resolve by sid) name the same element. ADR 0027 leaves this to H5.
 *
 * It is a COPY for the isolated frame: the result is never written back to the
 * source, the engine or a draft. An element with no source start tag (the
 * implied html/head/body) and a range that no longer fits `text` (a map older
 * than the text) are skipped rather than guessed at.
 */
export function stampSids(text: string, map: UpstreamParseMap): string {
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
  for (const { at, sid } of inserts) {
    out += text.slice(cursor, at) + ` data-sid="${sid}"`;
    cursor = at;
  }
  return out + text.slice(cursor);
}
