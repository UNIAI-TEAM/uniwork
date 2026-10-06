import type { UpstreamParseMap } from "@uniwork/office-engine/html";

const START_TAG_NAME = /^<[^\s/>]+/;
/** A start tag opener: `<` + a letter. `a < b`, `</p>`, `<!--` and `<!doctype` do not match. */
const TAG_OPEN = /<[a-zA-Z][^\s/>]*/g;
const ATTRIBUTE = /[\s/]*([^\s/>=][^\s/>=]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/y;

type Edit = { from: number; to: number; text: string };

/**
 * The `data-sid` attributes the DOCUMENT wrote, as removal ranges. The stamp is
 * the only legitimate source of `data-sid` in the preview copy, so every start
 * tag in the source is scanned - including a late `<body>` / `<html>` / implied
 * `<tbody>` start tag that has no entry in the map but whose attributes parse5
 * merges into the implied element - and each `data-sid` (any case, quoted or
 * not, valueless or spaced) is cut out. Attribute values are skipped over as a
 * unit, so `title='data-sid="5"'` is left alone.
 */
function documentSidRemovals(text: string): Edit[] {
  const removals: Edit[] = [];
  TAG_OPEN.lastIndex = 0;
  for (let open = TAG_OPEN.exec(text); open; open = TAG_OPEN.exec(text)) {
    let at = open.index + open[0].length;
    for (;;) {
      ATTRIBUTE.lastIndex = at;
      const attribute = ATTRIBUTE.exec(text);
      if (!attribute) break;
      const end = ATTRIBUTE.lastIndex;
      if (attribute[1]!.toLowerCase() === "data-sid") {
        // Keep the whitespace/slash that led into the attribute out of the cut so the
        // neighbours stay separated; the cut starts at the name.
        removals.push({ from: end - attribute[0].length + attribute[0].indexOf(attribute[1]!), to: end, text: "" });
      }
      at = end;
    }
    TAG_OPEN.lastIndex = at;
  }
  return removals;
}

/**
 * The preview copy of `text` with `data-sid="<sid>"` on every element the parse
 * map knows, so the inspector (which reads only `[data-sid]`) and the H3 ops
 * (which resolve by sid) name the same element. ADR 0027 leaves this to H5.
 *
 * It is a COPY for the isolated frame: the result is never written back to the
 * source, the engine or a draft. Any `data-sid` the document itself carries is
 * removed first, so a hostile file cannot make the inspector report an element
 * that the stamp did not number (a late `<body data-sid="1">`). An element with
 * no source start tag (the implied html/head/body) and a range that no longer
 * fits `text` (a map older than the text) are skipped rather than guessed at.
 */
export function stampSids(text: string, map: UpstreamParseMap): string {
  const edits: Edit[] = documentSidRemovals(text);
  for (const element of map.elements) {
    const [from, to] = element.startTag;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || to <= from) continue;
    const name = START_TAG_NAME.exec(text.slice(from, to));
    if (name) {
      const at = from + name[0].length;
      edits.push({ from: at, to: at, text: ` data-sid="${element.sid}"` });
    }
  }
  if (edits.length === 0) return text;
  // An insert sits right after a tag name and a removal starts at an attribute
  // name, so they never overlap; at the same offset the insert goes first.
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.from < cursor) continue;
    out += text.slice(cursor, edit.from) + edit.text;
    cursor = edit.to;
  }
  return out + text.slice(cursor);
}
