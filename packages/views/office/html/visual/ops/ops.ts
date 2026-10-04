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

/** Literal find/replace inside a range; only the matched bytes change. */
export function strReplace(context: HtmlOpContext, search: string, replacement: string, options: StrReplaceOptions = {}): UpstreamPatchSet {
  if (search === "") throw new HtmlOpError("no_op", "str_replace needs a non-empty search");
  const [from, to] = searchRange(context, options.target);
  const haystack = context.text.slice(from, to);
  const needle = options.caseSensitive ? search : search.toLowerCase();
  const folded = options.caseSensitive ? haystack : haystack.toLowerCase();
  const matches: number[] = [];
  let cursor = 0;
  for (;;) {
    const at = folded.indexOf(needle, cursor);
    if (at === -1) break;
    matches.push(at);
    cursor = at + needle.length;
  }
  if (matches.length === 0) throw new HtmlOpError("no_op", "search text not found");
  const chosen = options.all ? matches : [matches[options.nth ?? 0]!].filter((at) => at !== undefined);
  if (chosen.length === 0) throw new HtmlOpError("no_op", "no occurrence at that index");
  const patches: UpstreamPatch[] = chosen.map((at) => ({ from: from + at, to: from + at + search.length, text: replacement }));
  return patchSet(context.version, patches, "inspector", "str_replace");
}

/** Replace an element (its whole range, tags included) with new markup. */
export function replaceElement(context: HtmlOpContext, target: HtmlTarget, html: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  return replaceRange(context.version, element.range[0], element.range[1], html, "inspector", "replace_element");
}

/** Replace an element's content, leaving its start and end tags untouched. */
export function setInnerHtml(context: HtmlOpContext, target: HtmlTarget, html: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
  return replaceRange(context.version, element.inner[0], element.inner[1], html, "inspector", "set_inner_html");
}

/** Replace an element's content with escaped plain text. */
export function setText(context: HtmlOpContext, target: HtmlTarget, text: string): UpstreamPatchSet {
  const element = requireElement(context.map, target);
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
  const element = requireElement(context.map, target);
  const attrs = parseStartTagAttributes(context.text, element.startTag);
  const existing = findAttribute(attrs, name);
  if (value === null) {
    if (!existing) throw new HtmlOpError("attribute_not_found", "attribute is not present", { name });
    const start = attributeStart(context.text, element.startTag, existing);
    return replaceRange(context.version, start, existing.valueEnd, "", "inspector", "set_attr");
  }
  if (existing) {
    const quote = existing.quote ?? '"';
    const encoded = encodeAttributeValue(value, quote);
    return replaceRange(context.version, existing.valueStart, existing.valueEnd, encoded, "inspector", "set_attr");
  }
  const at = attributeInsertionPoint(context.text, element.startTag);
  return insertAt(context.version, at, " " + name.toLowerCase() + '="' + encodeAttributeValue(value, '"') + '"', "inspector", "set_attr");
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
  const element = requireElement(context.map, target);
  const attrs = parseStartTagAttributes(context.text, element.startTag);
  const existing = findAttribute(attrs, "style");
  const declarations = imageStyleValue(style) === "" ? [] : imageStyleValue(style).split(";");
  const merged = mergeImageStyle(existing ? decodeAttributeValue(existing.value) : "", declarations, options.drop ?? []);
  if (merged === "" && !existing) throw new HtmlOpError("no_op", "set_style has nothing to apply");
  const encoded = encodeAttributeValue(merged, existing?.quote ?? '"');
  if (existing) {
    if (existing.value === encoded) throw new HtmlOpError("no_op", "style is already set");
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
  if (!element.endTag) throw new HtmlOpError("invalid_target", "cannot unwrap a void element", { tag: element.tag });
  return replaceRange(
    context.version,
    element.range[0],
    element.range[1],
    context.text.slice(element.inner[0], element.inner[1]),
    "inspector",
    "unwrap",
  );
}
