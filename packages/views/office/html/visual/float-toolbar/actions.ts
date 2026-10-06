/**
 * The H6 float toolbar's document edits, as pure builders over the H3 ops. Each
 * takes the element's sid and returns an edit the caller applies with a fresh
 * context (`StyleEditBuilder`); it returns null when there is nothing to do
 * (the element is gone, the value is already set).
 *
 * Marks (bold / italic), font size and colour are inline `style` declarations,
 * so they go through the same validated `set_style` op the style panel uses;
 * delete and duplicate act on the element's whole source range.
 */
import {
  decodeAttributeValue,
  elementBySid,
  findAttribute,
  insertHtml,
  parseStartTagAttributes,
  remove,
  setStyleDeclarations,
  type HtmlOpContext,
} from "../ops";
import type { StyleEditBuilder } from "../style-panel/apply";

/** The size a ± press starts from when the element carries no inline size. */
const FONT_SIZE_DEFAULT = 16;
const FONT_SIZE_STEP = 2;
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 128;

/** An inline declaration's value on the element, or undefined. */
export function inlineDeclaration(context: HtmlOpContext, sid: number, property: string): string | undefined {
  const element = elementBySid(context.map, sid);
  if (!element) return undefined;
  const style = findAttribute(parseStartTagAttributes(context.text, element.startTag), "style");
  if (!style) return undefined;
  for (const part of decodeAttributeValue(style.value).split(";")) {
    const at = part.indexOf(":");
    if (at !== -1 && part.slice(0, at).trim().toLowerCase() === property) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** Bold / italic: set the declaration, or drop it when it is already on. */
export function toggleMarkEdit(sid: number, property: "font-weight" | "font-style", on: string): StyleEditBuilder {
  return (context) => {
    const current = inlineDeclaration(context, sid, property);
    return current === on
      ? setStyleDeclarations(context, { sid }, [], [property])
      : setStyleDeclarations(context, { sid }, [`${property}:${on}`]);
  };
}

/** One ± step on the inline `font-size`, in whole pixels, clamped. */
export function fontSizeEdit(sid: number, direction: 1 | -1): StyleEditBuilder {
  return (context) => {
    const current = /^(\d+(?:\.\d+)?)px$/i.exec(inlineDeclaration(context, sid, "font-size") ?? "");
    const base = current ? Number(current[1]) : FONT_SIZE_DEFAULT;
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(base) + direction * FONT_SIZE_STEP));
    return setStyleDeclarations(context, { sid }, [`font-size:${next}px`]);
  };
}

/** A document colour (`#rrggbb`), or null to inherit (drops `color`). */
export function colourEdit(sid: number, value: string | null): StyleEditBuilder {
  return (context) =>
    value === null
      ? setStyleDeclarations(context, { sid }, [], ["color"])
      : setStyleDeclarations(context, { sid }, [`color:${value}`]);
}

const DOCUMENT_STRUCTURE_TAGS: ReadonlySet<string> = new Set(["html", "head", "body"]);

/** True for html, head and body: deleting or copying one takes the whole page with it. */
export function isDocumentStructure(context: HtmlOpContext, sid: number): boolean {
  const tag = elementBySid(context.map, sid)?.tag;
  return tag !== undefined && DOCUMENT_STRUCTURE_TAGS.has(tag);
}

/** Remove the element's whole range (never html, head or body: null). */
export function deleteEdit(sid: number): StyleEditBuilder {
  return (context) => (isDocumentStructure(context, sid) ? null : remove(context, { sid }));
}

/** Insert an exact copy of the element's source right after it (never html, head or body: null). */
export function duplicateEdit(sid: number): StyleEditBuilder {
  return (context) => {
    const element = elementBySid(context.map, sid);
    if (!element || isDocumentStructure(context, sid)) return null;
    return insertHtml(context, context.text.slice(element.range[0], element.range[1]), { after: { sid } });
  };
}
