import type { UpstreamPatch, UpstreamPatchSet } from "@uniwork/office-engine/html";
import { escapeHtmlText } from "./insert-presets";
import {
  attributeInsertionPoint,
  decodeAttributeValue,
  encodeAttributeValue,
  findAttribute,
  HtmlOpError,
  insertAt,
  parseStartTagAttributes,
  patchSet,
  replaceRange,
  requireElement,
  type HtmlAttribute,
  type HtmlTarget,
  type PatchOrigin,
  type SourceRange,
} from "./match";
import { assertMovable, resolveMoveDestination, type MoveDestination } from "./move-target";
import { imageStyleValue, mergeImageStyle, type ImageStyleInput } from "./image-style";
import type { UpstreamParseMap } from "@uniwork/office-engine/html";

// The 13 pure document ops, ported from genoffice's HTML document ops (pinned
// 09485f88) for behaviour only. Every op compiles down to source patches in
// the ORIGINAL coordinates and returns an UpstreamPatchSet for the caller to
// apply through `engine.applyPatchSet` - nothing here splices text, touches a
// DOM or holds host state. Byte-identity outside the edited range is the whole
// contract: an op only ever replaces the exact range it names.

/** What every op needs: the current source, its parse map and revision. */
export interface HtmlOpContext {
  text: string;
  map: UpstreamParseMap;
  version: number;
}

/** Where an insert lands: next to a sibling, inside a container, or at an
 * absolute source offset. */
export type InsertPosition =
  | { before: HtmlTarget }
  | { after: HtmlTarget }
  | { appendTo: HtmlTarget }
  | { at: number };

export interface StrReplaceOptions {
  /** Restrict the search to an element's inner content (default: whole source). */
  target?: HtmlTarget;
  /** Replace every occurrence instead of the first. */
  all?: boolean;
  /** Case-sensitive match (default false). */
  caseSensitive?: boolean;
  /** Which occurrence to replace when `all` is false (default 0). */
  nth?: number;
}

function innerRangeOf(context: HtmlOpContext, target: HtmlTarget): SourceRange {
  const element = requireElement(context.map, target);
  return element.inner;
}

function searchRange(context: HtmlOpContext, target: HtmlTarget | undefined): SourceRange {
  return target === undefined ? [0, context.text.length] : innerRangeOf(context, target);
}

interface FoldedText {
  folded: string;
  /** For each code unit of `folded`, the source offset of the code point it came from. */
  sourceStart: number[];
  /** For each code unit of `folded`, the source END offset of that code point. */
  sourceEnd: number[];
}

/** True when no code point of `text` lowercases to something different. */
function isAlreadyFolded(text: string): boolean {
  for (const ch of text) if (ch.toLowerCase() !== ch) return false;
  return true;
}

/**
 * Lowercase `text` while remembering which source offsets each folded code unit
 * came from. Folding per code POINT (not per UTF-16 code unit) keeps the
 * mapping exact in both directions: a BMP char that expands to several units
 * ("İ" U+0130 -> "i" + U+0307) and a supplementary cased letter that is two
 * code units but must fold as one ("𐐀" U+10400 -> "𐐨" U+10428). Folding per
 * code unit left each surrogate lone, so supplementary letters never folded and
 * a literal case-insensitive search silently missed them.
 */
function foldText(text: string): FoldedText {
  const parts: string[] = [];
  const sourceStart: number[] = [];
  const sourceEnd: number[] = [];
  let at = 0;
  for (const ch of text) {
    const lower = ch.toLowerCase();
    parts.push(lower);
    const end = at + ch.length;
    for (let k = 0; k < lower.length; k += 1) {
      sourceStart.push(at);
      sourceEnd.push(end);
    }
    at = end;
  }
  return { folded: parts.join(""), sourceStart, sourceEnd };
}

/** Literal find/replace inside a range; only the matched bytes change. */
export function strReplace(context: HtmlOpContext, search: string, replacement: string, options: StrReplaceOptions = {}): UpstreamPatchSet {
  if (search === "") throw new HtmlOpError("no_op", "str_replace needs a non-empty search");
  const [from, to] = searchRange(context, options.target);
  const haystack = context.text.slice(from, to);
  // Match on the ORIGINAL haystack: a case-insensitive search folds both sides
  // but every reported range is mapped back to source coordinates, so a
  // length-changing fold ("İ" U+0130 -> "i̇") can never shift the patch.
  const matches: Array<readonly [number, number]> = [];
  if (options.caseSensitive) {
    let cursor = 0;
    for (;;) {
      const at = haystack.indexOf(search, cursor);
      if (at === -1) break;
      matches.push([at, search.length]);
      cursor = at + search.length;
    }
  } else if (isAlreadyFolded(haystack)) {
    // Fast path: nothing in the haystack folds, so the folded text IS the
    // source and no index map is needed. This is the common case and skips the
    // O(n) mapping allocation entirely.
    const needle = search.toLowerCase();
    let cursor = 0;
    for (;;) {
      const at = haystack.indexOf(needle, cursor);
      if (at === -1) break;
      matches.push([at, needle.length]);
      cursor = at + needle.length;
    }
  } else {
    const { folded, sourceStart, sourceEnd } = foldText(haystack);
    const needle = search.toLowerCase();
    let cursor = 0;
    let lastEnd = -1;
    for (;;) {
      const at = folded.indexOf(needle, cursor);
      if (at === -1) break;
      const start = sourceStart[at]!;
      const end = sourceEnd[at + needle.length - 1]!;
      cursor = at + needle.length;
      // A needle that starts or ends inside one code point's fold can map two
      // adjacent folded matches onto the same source span; keep the first so
      // `{all:true}` never emits overlapping patches (which the engine rejects).
      if (start < lastEnd) continue;
      matches.push([start, end - start]);
      lastEnd = end;
    }
  }
  if (matches.length === 0) throw new HtmlOpError("no_op", "search text not found");
  const chosen: Array<readonly [number, number]> = options.all
    ? matches
    : matches[options.nth ?? 0] !== undefined
      ? [matches[options.nth ?? 0]!]
      : [];
  if (chosen.length === 0) throw new HtmlOpError("no_op", "no occurrence at that index");
  const patches: UpstreamPatch[] = chosen.map(([at, length]) => ({ from: from + at, to: from + at + length, text: replacement }));
  return patchSet(context.version, patches, "inspector", "str_replace");
}

/**
 * HTML5 void elements. Their `inner` is an empty point after the tag, so an op
 * that writes "inside" one would land AFTER the tag instead. `endTag` is null
 * for void elements AND for every element with an implied/missing end tag
 * (`<li>`, `<p>`, `<td>`, ...), so the void check must be by tag name - gating
 * on `!endTag` rejects the common implied-end markup that is legal HTML5.
 */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Replace an element (its whole range, tags included) with new markup. */
export function replaceElement(context: HtmlOpContext, target: HtmlTarget, html: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  return replaceRange(context.version, element.range[0], element.range[1], html, "inspector", "replace_element");
}

/** Replace an element's content, leaving its start and end tags untouched. */
export function setInnerHtml(context: HtmlOpContext, target: HtmlTarget, html: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  if (VOID_TAGS.has(element.tag)) {
    // A void element's inner range is empty, so its "inner html" would land
    // AFTER the tag - silently the wrong op. Only void elements are rejected;
    // an implied-end element (`<li>`, `<p>`, ...) has real inner content.
    throw new HtmlOpError("invalid_target", "cannot set the inner html of a void element", { tag: element.tag });
  }
  return replaceRange(context.version, element.inner[0], element.inner[1], html, "inspector", "set_inner_html");
}

/** Replace an element's content with escaped plain text. */
export function setText(context: HtmlOpContext, target: HtmlTarget, text: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  if (VOID_TAGS.has(element.tag)) {
    // Same defect as set_inner_html: a void element's inner is a point after
    // the tag, so the text would be appended AFTER it, not inside it.
    throw new HtmlOpError("invalid_target", "cannot set the text of a void element", { tag: element.tag });
  }
  return replaceRange(context.version, element.inner[0], element.inner[1], escapeHtmlText(text), "inspector", "set_text");
}

/** Insert markup before/after a sibling, last inside a container, or at an
 * absolute offset. */
export function insertHtml(context: HtmlOpContext, html: string, position: InsertPosition): UpstreamPatchSet {
  if ("at" in position) {
    if (position.at < 0 || position.at > context.text.length) {
      throw new HtmlOpError("invalid_range", "insert offset is out of bounds", { at: position.at });
    }
    return insertAt(context.version, position.at, html, "inspector", "insert_html");
  }
  const target: HtmlTarget = "before" in position ? position.before : "after" in position ? position.after : position.appendTo;
  const element = requireElement(context.map, target);
  if ("appendTo" in position && VOID_TAGS.has(element.tag)) {
    // appendTo on a void element would insert AFTER it, not inside it.
    throw new HtmlOpError("invalid_target", "cannot append inside a void element", { tag: element.tag });
  }
  const at = "before" in position ? element.range[0] : "after" in position ? element.range[1] : element.inner[1];
  return insertAt(context.version, at, html, "inspector", "insert_html");
}

/** Remove an element's whole range. */
export function remove(context: HtmlOpContext, target: HtmlTarget): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  return replaceRange(context.version, element.range[0], element.range[1], "", "inspector", "remove");
}

/**
 * Move an element next to a sibling or into a container. Two patches: delete
 * the original range and insert its exact source text at the destination.
 * `assertMovable` rejects a destination inside the element (which would make
 * the patches overlap) or at its own edge (which would be a silent no-op).
 */
export function move(context: HtmlOpContext, target: HtmlTarget, destination: MoveDestination): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  const resolved = resolveMoveDestination(context.map, destination);
  assertMovable(context.map, element, resolved);
  const source = context.text.slice(element.range[0], element.range[1]);
  const patches: UpstreamPatch[] = [
    { from: element.range[0], to: element.range[1], text: "" },
    { from: resolved.offset, to: resolved.offset, text: source },
  ];
  return patchSet(context.version, patches, "inspector", "move");
}

/** Set, replace or (with `value === null`) remove one attribute. */
export function setAttr(context: HtmlOpContext, target: HtmlTarget, name: string, value: string | null): UpstreamPatchSet {
  if (!isValidAttributeName(name)) {
    // Only the value is encoded below; an unvalidated name would splice quotes
    // and a new attribute (or event handler) into the tag.
    throw new HtmlOpError("invalid_target", "not a valid attribute name", { name });
  }
  const element = requireElement(context.map, target);
  const attrs = parseStartTagAttributes(context.text, element.startTag);
  const existing = findAttribute(attrs, name);
  if (value === null) {
    if (!existing) throw new HtmlOpError("attribute_not_found", "attribute is not present", { name });
    const start = attributeStart(context.text, element.startTag, existing);
    // `end` covers the closing quote too; `valueEnd` stops inside it.
    return replaceRange(context.version, start, existing.end, "", "inspector", "set_attr");
  }
  if (existing) {
    if (isValueless(existing)) {
      // `<input disabled>` -> `<input disabled="…">`: the value has to bring
      // its own `="…"`, because there is no `=` in the source to replace.
      return insertAt(context.version, existing.nameEnd, '="' + encodeAttributeValue(value, '"') + '"', "inspector", "set_attr");
    }
    const quote = existing.quote ?? '"';
    const encoded = encodeAttributeValue(value, quote);
    return replaceRange(context.version, existing.valueStart, existing.valueEnd, encoded, "inspector", "set_attr");
  }
  const at = attributeInsertionPoint(context.text, element.startTag);
  return insertAt(context.version, at, " " + name.toLowerCase() + '="' + encodeAttributeValue(value, '"') + '"', "inspector", "set_attr");
}

/**
 * A valid attribute name: a letter/underscore/colon, then letters, digits,
 * `_`, `.`, `:`, `-`. HTML5 attribute names are NOT ASCII-only, so the classes
 * are Unicode (`đậm` is a legal attribute name) while the structural
 * characters that could end the name or splice a new attribute - whitespace,
 * quotes, `<`, `>`, `/`, `=`, backtick - stay out of the allowlist.
 */
function isValidAttributeName(name: string): boolean {
  return /^[\p{L}_:][\p{L}\p{N}_.:-]*$/u.test(name);
}

/** True for an attribute written without a value (`disabled`, `hidden`, ...). */
function isValueless(attribute: HtmlAttribute): boolean {
  return attribute.quote === null && attribute.valueStart === attribute.nameEnd && attribute.valueEnd === attribute.nameEnd;
}

/** Start of an attribute including the whitespace that precedes it. */
function attributeStart(text: string, startTag: SourceRange, attribute: HtmlAttribute): number {
  let at = attribute.nameStart;
  while (at > startTag[0] + 1 && /\s/.test(text[at - 1]!)) at -= 1;
  return at;
}

/** Set inline style properties, merging with the author's existing style and
 * replacing only the properties this call names. */
export function setStyle(
  context: HtmlOpContext,
  target: HtmlTarget,
  style: ImageStyleInput,
  options: { drop?: readonly string[] } = {},
): UpstreamPatchSet {
  const styleValue = imageStyleValue(style);
  return mergeStyleAttribute(context, target, styleValue === "" ? [] : styleValue.split(";"), options.drop ?? []);
}

/** A `property:value` declaration: a lowercase property name, a value with no
 * second declaration, rule, tag or script/URL function in it. */
const SAFE_DECLARATION = /^[a-z-]+:[^;{}<>\\]*$/;
const UNSAFE_CSS_VALUE = /url\s*\(|expression\s*\(|@import|javascript:/i;

/**
 * Set arbitrary inline CSS declarations (`["color:blue", "opacity:0.5"]`),
 * merging into the author's style attribute exactly like `setStyle`. The style
 * panel's typography / background / opacity / custom CSS groups all land here.
 * Each declaration is validated one by one so a value can never carry a second
 * declaration, a rule block or a URL into the document.
 */
export function setStyleDeclarations(
  context: HtmlOpContext,
  target: HtmlTarget,
  declarations: readonly string[],
  drop: readonly string[] = [],
): UpstreamPatchSet {
  for (const declaration of declarations) {
    if (!SAFE_DECLARATION.test(declaration) || UNSAFE_CSS_VALUE.test(declaration)) {
      throw new HtmlOpError("invalid_target", "not a safe CSS declaration", { declaration });
    }
  }
  return mergeStyleAttribute(context, target, declarations, drop);
}

function mergeStyleAttribute(
  context: HtmlOpContext,
  target: HtmlTarget,
  declarations: readonly string[],
  drop: readonly string[],
): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  const attrs = parseStartTagAttributes(context.text, element.startTag);
  const existing = findAttribute(attrs, "style");
  const merged = mergeImageStyle(existing ? decodeAttributeValue(existing.value) : "", declarations, drop);
  if (merged === "" && !existing) throw new HtmlOpError("no_op", "set_style has nothing to apply");
  const encoded = encodeAttributeValue(merged, existing?.quote ?? '"');
  if (existing) {
    if (existing.value === encoded) throw new HtmlOpError("no_op", "style is already set");
    if (isValueless(existing)) {
      return insertAt(context.version, existing.nameEnd, '="' + encoded + '"', "inspector", "set_style");
    }
    return replaceRange(context.version, existing.valueStart, existing.valueEnd, encoded, "inspector", "set_style");
  }
  const at = attributeInsertionPoint(context.text, element.startTag);
  return insertAt(context.version, at, ' style="' + encoded + '"', "inspector", "set_style");
}

/** Rename an element's tag in both the start and end tag. */
export function setTag(context: HtmlOpContext, target: HtmlTarget, tag: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  const next = tag.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(next)) throw new HtmlOpError("invalid_target", "not a valid tag name", { tag });
  if (next === element.tag) throw new HtmlOpError("no_op", "tag is already set");
  const patches: UpstreamPatch[] = [
    { from: element.startTag[0] + 1, to: element.startTag[0] + 1 + element.tag.length, text: next },
  ];
  if (element.endTag) {
    patches.push({ from: element.endTag[0] + 2, to: element.endTag[0] + 2 + element.tag.length, text: next });
  }
  return patchSet(context.version, patches, "inspector", "set_tag");
}

/** Replace one direct child text node with escaped text. */
export function setTextNode(context: HtmlOpContext, target: HtmlTarget, index: number, text: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  const node = element.textNodes[index];
  if (!node) throw new HtmlOpError("text_node_not_found", "no text node at that index", { index, count: element.textNodes.length });
  return replaceRange(context.version, node[0], node[1], escapeHtmlText(text), "inspector", "set_text_node");
}

export interface WrapTextOptions {
  /** Attributes written on the wrapper's start tag, already escaped. */
  attributes?: string;
  origin?: PatchOrigin;
}

/**
 * Reject a range that cuts through a tag or splits an element. A range is
 * wrappable when every element it overlaps is either fully inside it or fully
 * contains it (i.e. the range sits in one element's content or spans a
 * balanced run of whole elements). Wrapping `<p>aa</p><p>bb</p>` across both
 * paragraphs otherwise emits overlapping tags.
 */
function assertBalancedRange(context: HtmlOpContext, from: number, to: number): void {
  for (const element of context.map.elements) {
    if (element.range[0] >= to || element.range[1] <= from) continue;
    const contained = element.range[0] >= from && element.range[1] <= to;
    const contains = element.inner[0] <= from && element.inner[1] >= to;
    if (!contained && !contains) {
      throw new HtmlOpError("invalid_range", "wrap range splits an element", { from, to, tag: element.tag });
    }
  }
  assertNoMarkupSplit(context, from, to);
}

/** Markup that is not an element: comments, CDATA, doctype and processing
 * instructions. parse5 puts none of these in the element map, so the element
 * scan above cannot see a range that splits one - wrapping `[7,10]` over
 * `<div><!-- xx -->` would put `</em>` inside the comment. */
const NON_ELEMENT_MARKUP = /<!--|<!\[CDATA\[|<\?|<!/g;

/**
 * Reject a range that splits a non-element markup span (comment / CDATA /
 * doctype / processing instruction), or that cuts a tag the element map does
 * not cover. A span the range fully contains is fine, exactly like a contained
 * element.
 */
function assertNoMarkupSplit(context: HtmlOpContext, from: number, to: number): void {
  const text = context.text;
  for (const match of text.matchAll(NON_ELEMENT_MARKUP)) {
    const spanStart = match.index!;
    const spanEnd = markupSpanEnd(text, match[0], spanStart);
    if (spanStart >= to || spanEnd <= from) continue;
    if (spanStart >= from && spanEnd <= to) continue;
    throw new HtmlOpError("invalid_range", "wrap range splits non-element markup", { from, to });
  }
  // A markup-looking `<` outside every element range means the slice cuts a
  // tag the map does not cover (e.g. markup-looking text in a rawtext body).
  // A bare `<` in text (`a < b`) is not markup and is left alone.
  const ranges = context.map.elements.map((element) => element.range);
  for (let at = from; at < to; at += 1) {
    if (text[at] !== "<") continue;
    if (!/[a-zA-Z/!?]/.test(text[at + 1] ?? "")) continue;
    if (ranges.some((range) => range[0] <= at && at < range[1])) continue;
    throw new HtmlOpError("invalid_range", "wrap range splits a tag", { from, to });
  }
}

/** The offset just past a markup opener's matching close (`-->`, `]]>`, `>`). */
function markupSpanEnd(text: string, opener: string, at: number): number {
  if (opener === "<!--") {
    const close = text.indexOf("-->", at + 4);
    return close === -1 ? text.length : close + 3;
  }
  if (opener === "<![CDATA[") {
    const close = text.indexOf("]]>", at + 9);
    return close === -1 ? text.length : close + 3;
  }
  // Doctype / processing instruction: up to the next `>`.
  const close = text.indexOf(">", at + opener.length);
  return close === -1 ? text.length : close + 1;
}

/** Wrap a source range in a new element: an opening tag at its start and a
 * closing tag at its end, leaving the wrapped bytes untouched. */
export function wrapText(context: HtmlOpContext, range: SourceRange, tag: string, options: WrapTextOptions = {}): UpstreamPatchSet {
  const name = tag.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new HtmlOpError("invalid_target", "not a valid tag name", { tag });
  const [from, to] = range;
  if (from < 0 || to < from || to > context.text.length) {
    throw new HtmlOpError("invalid_range", "wrap range is out of bounds", { from, to });
  }
  if (from === to) throw new HtmlOpError("no_op", "wrap range is empty");
  assertBalancedRange(context, from, to);
  const attributes = options.attributes ? " " + options.attributes : "";
  const patches: UpstreamPatch[] = [
    { from, to: from, text: "<" + name + attributes + ">" },
    { from: to, to, text: "</" + name + ">" },
  ];
  return patchSet(context.version, patches, options.origin ?? "inspector", "wrap_text");
}

/** Replace an element with its own inner content, dropping its tags. */
export function unwrap(context: HtmlOpContext, target: HtmlTarget): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  if (VOID_TAGS.has(element.tag)) throw new HtmlOpError("invalid_target", "cannot unwrap a void element", { tag: element.tag });
  return replaceRange(
    context.version,
    element.range[0],
    element.range[1],
    context.text.slice(element.inner[0], element.inner[1]),
    "inspector",
    "unwrap",
  );
}
