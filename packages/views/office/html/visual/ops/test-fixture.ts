// TEST-ONLY. A parse map for the ops suite. The real parse map comes from the
// vendored upstream (parse5, packages/office-upstream); parse5 is not a
// dependency of packages/views, so the tests build the same ElementEntry shape
// with a small, strict scanner over a WELL-FORMED fixture. The fixture has no
// parse-error recovery, so a correct scanner and parse5 agree on every offset.
//
// This is not a second engine: nothing in production imports it, and the ops
// under test only read range/startTag/endTag/inner/textNodes/path/sid/parentSid.
//
// Divergences from parse5 that stay (the shipped fixture does not exercise
// them, and no op is asserted against their offsets):
//   - `<template>` children are ordinary descendants here, while parse5 keeps
//     them in a separate content fragment;
//   - implied end tags are modelled for the common list / paragraph / table
//     cases (`<ul><li>a<li>b</ul>`, `<div><p>tail`, `<td>` / `<tr>` / `<p>`
//     omissions); the full HTML5 tree-construction algorithm, foster parenting
//     and the adoption agency are not modelled, so malformed nesting that needs
//     them still diverges.
// An unclosed element at EOF extends both `range[1]` and `inner[1]` to EOF, the
// way parse5's `endOffset` does.

import { createHtmlEngine, type HtmlEngine, type HtmlUpstream, type UpstreamParseMap, type UpstreamPatch, type UpstreamPatchError, type UpstreamPatchSet } from "@uniwork/office-engine/html";

interface FixtureEntry {
  sid: number;
  tag: string;
  parentSid: number | null;
  depth: number;
  range: [number, number];
  startTag: [number, number];
  endTag: [number, number] | null;
  inner: [number, number];
  path: string;
  textNodes: Array<[number, number]>;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Rawtext/RCDATA elements whose content is text, never markup.
const RAWTEXT = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);
// Foreign-content roots: inside them a trailing `/` self-closes a start tag.
const FOREIGN = new Set(["svg", "math"]);
// Elements whose end tag the HTML5 parser may omit; "generate implied end tags"
// pops these before a start tag that closes an ancestor.
const IMPLIED_END = new Set(["dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"]);
// Block-level start tags that close an open <p>.
const P_CLOSERS = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main",
  "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
]);
// Elements an end tag may pop on its way to the matching open element.
const END_TAG_IMPLIED = new Set([...IMPLIED_END, "td", "th", "tr", "thead", "tbody", "tfoot", "caption", "colgroup"]);

/** The tags a start tag `tag` closes on the open-element stack, after implied
 * end tags are generated. Mirrors the parse5 rules for the common cases. */
function closeSetFor(tag: string): ReadonlySet<string> | null {
  switch (tag) {
    case "li": return new Set(["li"]);
    case "dt": case "dd": return new Set(["dt", "dd"]);
    case "option": return new Set(["option"]);
    case "optgroup": return new Set(["option", "optgroup"]);
    case "td": case "th": return new Set(["td", "th"]);
    case "tr": return new Set(["td", "th", "tr"]);
    case "thead": case "tbody": case "tfoot": return new Set(["td", "th", "tr", "thead", "tbody", "tfoot", "caption", "colgroup"]);
    case "caption": case "colgroup": return new Set(["caption", "colgroup"]);
    default: return P_CLOSERS.has(tag) ? new Set(["p"]) : null;
  }
}

interface Open {
  entry: FixtureEntry;
  children: FixtureEntry[];
  textNodes: Array<[number, number]>;
  textStart: number | null;
  foreign: boolean;
}

function tagEnd(text: string, from: number): number {
  let i = from;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i + 1;
    i += 1;
  }
  return text.length;
}

/** Build a parse map for a well-formed fixture. */
export function buildFixtureParseMap(text: string, version: number): UpstreamParseMap {
  const entries: FixtureEntry[] = [];
  const roots: FixtureEntry[] = [];
  const stack: Open[] = [];
  let nextSid = 1;

  const parentOf = (): FixtureEntry | null => (stack.length ? stack[stack.length - 1]!.entry : null);
  const attach = (entry: FixtureEntry): void => {
    const parent = stack.length ? stack[stack.length - 1] : null;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      i = close === -1 ? text.length : close + 3;
      continue;
    }
    if (text[i] === "<") {
      if (text.startsWith("<!", i) || text.startsWith("<?", i)) {
        i = tagEnd(text, i);
        continue;
      }
      if (text.startsWith("</", i)) {
        const end = tagEnd(text, i);
        const name = /^<\/\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(text.slice(i, end))?.[1]?.toLowerCase();
        // An end tag closes the nearest matching open element, popping the
        // elements an end tag may imply on the way (e.g. `</ul>` closes an
        // open `<li>`; `</table>` closes open `<td>`/`<tr>`).
        const matchAt = name
          ? stack.map((open) => open.entry.tag).lastIndexOf(name)
          : -1;
        if (matchAt !== -1) {
          const closable =
            matchAt === stack.length - 1 ||
            stack.slice(matchAt + 1).every((open) => END_TAG_IMPLIED.has(open.entry.tag));
          if (closable) {
            while (stack.length > matchAt + 1) {
              const open = stack.pop()!;
              // An implied end leaves `endTag` null (parse5 does the same);
              // only the matched element below takes the real end tag.
              if (open.entry.inner[1] < i) open.entry.inner[1] = i;
              if (open.entry.range[1] < i) open.entry.range[1] = i;
            }
            const matched = stack.pop()!;
            matched.entry.endTag = [i, end];
            matched.entry.range[1] = end;
            matched.entry.inner[1] = i;
          }
        }
        i = end;
        continue;
      }
      const end = tagEnd(text, i);
      const nameMatch = /^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(text.slice(i, end));
      if (!nameMatch) {
        i = end;
        continue;
      }
      const tag = nameMatch[1]!.toLowerCase();
      // HTML5 ignores a self-closing slash on HTML elements; only foreign
      // content (svg/math) honours it.
      const selfClosing = /\/\s*>$/.test(text.slice(i, end)) && FOREIGN.has(tag);
      // Close the elements this start tag implies closed (generate implied end
      // tags, then pop the named set). Closed elements take an end tag at this
      // start tag's offset, exactly like parse5's `endOffset`.
      const closeSet = closeSetFor(tag);
      if (closeSet) {
        while (stack.length) {
          const top = stack[stack.length - 1]!;
          if (!closeSet.has(top.entry.tag)) break;
          stack.pop();
          // Implied end: `endTag` stays null, the ranges stop here.
          if (top.entry.range[1] < i) top.entry.range[1] = i;
          if (top.entry.inner[1] < i) top.entry.inner[1] = i;
        }
      }
      const parent = stack.length ? stack[stack.length - 1] : null;
      const entry: FixtureEntry = {
        sid: nextSid++,
        tag,
        parentSid: parent?.entry.sid ?? null,
        depth: stack.length,
        range: [i, end],
        startTag: [i, end],
        endTag: null,
        inner: [end, end],
        path: "",
        textNodes: [],
      };
      attach(entry);
      entries.push(entry);
      i = end;
      if (!selfClosing && !VOID.has(tag)) {
        if (RAWTEXT.has(tag)) {
          // Everything up to the matching close tag is text: register no child
          // elements and record the body as one text node. `<plaintext>` never
          // closes, so its body runs to EOF.
          const close = tag === "plaintext" ? null : new RegExp("</" + tag + "(?=[\\s/>])", "i").exec(text.slice(end));
          const innerEnd = close ? end + close.index : text.length;
          entry.inner = [end, innerEnd];
          if (innerEnd > end) entry.textNodes = [[end, innerEnd]];
          if (close) {
            const closeEnd = tagEnd(text, innerEnd);
            entry.endTag = [innerEnd, closeEnd];
            entry.range[1] = closeEnd;
            i = closeEnd;
          } else {
            entry.range[1] = text.length;
            i = text.length;
          }
          continue;
        }
        stack.push({ entry, children: [], textNodes: [], textStart: null, foreign: FOREIGN.has(tag) || (parent?.foreign ?? false) });
      }
      continue;
    }
    const next = text.indexOf("<", i);
    const stop = next === -1 ? text.length : next;
    const top = stack[stack.length - 1];
    if (top && stop > i) {
      top.textNodes.push([i, stop]);
      top.entry.textNodes = top.textNodes;
      if (top.entry.inner[1] < stop) top.entry.inner[1] = stop;
    }
    i = stop;
  }
  // An unclosed element ends at the end of the document: parse5 reports
  // `endOffset` as the source length for both `range[1]` and `inner[1]`.
  for (const open of stack) {
    if (open.entry.endTag === null) {
      open.entry.range[1] = text.length;
      open.entry.inner[1] = text.length;
    }
  }

  const pathOf = (entry: FixtureEntry): string => {
    const parent = entries.find((candidate) => candidate.sid === entry.parentSid);
    const segment =
      entry.tag === "html" || entry.tag === "head" || entry.tag === "body"
        ? entry.tag
        : entry.tag + ":nth-of-type(" + nthOfType(entry, entries) + ")";
    return parent ? pathOf(parent) + " > " + segment : segment;
  };
  for (const entry of entries) entry.path = pathOf(entry);

  return { version, elements: entries, bySid: new Map(entries.map((entry) => [entry.sid, entry])), errorCount: 0 };
}

function nthOfType(entry: FixtureEntry, all: readonly FixtureEntry[]): number {
  let n = 0;
  for (const candidate of all) {
    if (candidate.parentSid !== entry.parentSid || candidate.tag !== entry.tag) continue;
    n += 1;
    if (candidate.sid === entry.sid) return n;
  }
  return n;
}

function sortPatches(patches: readonly UpstreamPatch[]): UpstreamPatch[] {
  return [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The engine seam the ops tests bind: a real applyPatches over the fixture map. */
export function fixtureUpstream(): HtmlUpstream {
  return {
    buildParseMap: (text, version) => buildFixtureParseMap(text, version),
    validatePatchSet(set: UpstreamPatchSet, currentVersion: number, length: number): UpstreamPatchError | null {
      if (set.baseVersion !== currentVersion) return { kind: "stale", baseVersion: set.baseVersion, currentVersion };
      let cursor = -1;
      for (const [index, patch] of sortPatches(set.patches).entries()) {
        if (patch.from < 0 || patch.to < patch.from || patch.to > length) return { kind: "bounds", index };
        if (patch.from < cursor) return { kind: "overlap", index };
        cursor = patch.to;
      }
      return null;
    },
    applyPatches(text, patches) {
      let out = text;
      for (const patch of sortPatches(patches).reverse()) out = out.slice(0, patch.from) + patch.text + out.slice(patch.to);
      return out;
    },
    isDocEmpty: (text) => text.replace(/<[^>]*>/g, "").trim() === "",
    extractDocumentImageSources: (html) => [...html.matchAll(/<img\s[^>]*?src="([^"]*)"/gi)].map((m) => m[1]!),
  };
}


// --- test helpers -----------------------------------------------------------

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export interface OpenFixture {
  engine: HtmlEngine;
  ref: string;
  version: number;
  text: string;
  map: UpstreamParseMap;
}

/** Open `source` in the REAL html engine, bound to the fixture parse map. */
export async function openFixture(source: string): Promise<OpenFixture> {
  const engine = createHtmlEngine({ upstream: fixtureUpstream() });
  const outcome = await engine.open({ bytes: utf8(source), format: "html", document_id: "H3" });
  if (outcome.outcome !== "opened") throw new Error("fixture open failed: " + outcome.outcome);
  const snapshot = engine.snapshot(outcome.document_model_ref);
  return {
    engine,
    ref: outcome.document_model_ref,
    version: snapshot.revision,
    text: snapshot.text,
    map: engine.parseMap(outcome.document_model_ref),
  };
}

/** Apply an op's patch set through the engine and return the new source. */
export function applyOp(fixture: OpenFixture, set: UpstreamPatchSet): string {
  return fixture.engine.applyPatchSet(fixture.ref, set).text;
}

export interface Edit {
  from: number;
  to: number;
  text: string;
}

/** The first index where two strings differ, or -1. */
function firstDifference(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : max;
}

function window(text: string, at: number): string {
  return JSON.stringify(text.slice(Math.max(0, at - 30), at + 30));
}

/**
 * The byte-identity contract: `after` must equal `before` with EXACTLY the
 * listed edits applied. Every byte outside those ranges - whitespace, comment
 * text, attribute order, quoting, the tag text of untouched elements - is
 * therefore identical by construction. A mismatch fails loudly with the first
 * differing offset and the bytes around it on both sides.
 */
export function expectByteIdentical(before: string, after: string, edits: readonly Edit[], label = "op"): void {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let expected = "";
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.from < cursor) throw new Error(label + ": edits overlap at " + edit.from);
    expected += before.slice(cursor, edit.from) + edit.text;
    cursor = edit.to;
  }
  expected += before.slice(cursor);
  if (expected === after) return;
  const at = firstDifference(expected, after);
  throw new Error(
    label +
      ": byte-identity failed at offset " +
      at +
      "\n  expected " +
      window(expected, at) +
      "\n  actual   " +
      window(after, at),
  );
}

/** True when every byte outside the edits is unchanged - the same property,
 * asserted directly (defence in depth against a wrong `expected` above). */
export function outsideEditsUnchanged(before: string, after: string, edits: readonly Edit[]): boolean {
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let cursor = 0;
  let out = 0;
  for (const edit of sorted) {
    const keep = edit.from - cursor;
    if (before.slice(cursor, edit.from) !== after.slice(out, out + keep)) return false;
    out += keep + edit.text.length;
    cursor = edit.to;
  }
  return before.slice(cursor) === after.slice(out);
}
