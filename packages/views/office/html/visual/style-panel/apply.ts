/**
 * The H7 style panel's bridge to H3: what a `HtmlStylePatch` means as document
 * edits, and what the current element already carries. PURE - it takes the
 * op context and returns patch sets; the caller applies them one at a time
 * (each edit moves the revision, so the next builder reads a fresh context).
 *
 * The panel reports only the groups the person touched, and a null clears the
 * field. Everything inline-style shaped becomes ONE `set_style` op built from
 * validated declarations; `alt` is an attribute, so it is its own op.
 */
import type { UpstreamPatchSet } from "@uniwork/office-engine/html";
import {
  decodeAttributeValue,
  elementBySid,
  findAttribute,
  HtmlOpError,
  parseStartTagAttributes,
  setAttr,
  setStyleDeclarations,
  type HtmlOpContext,
} from "../ops";
import {
  clampOpacity,
  clampStyleSize,
  defaultHtmlStyleValues,
  HTML_STYLE_ALIGNMENTS,
  HTML_STYLE_FITS,
  HTML_STYLE_FONT_WEIGHTS,
  normalizeCustomCss,
  normalizeHexColour,
  STYLE_OPACITY_DEFAULT,
  type HtmlStyleValues,
  type HtmlStylePatch,
} from "./model";

/** The CSS properties the panel owns; "revert" drops exactly these. */
const MANAGED_PROPERTIES = ["font-family", "font-weight", "text-align", "width", "height", "background-color", "opacity", "object-fit"] as const;

/** One edit the caller applies; it returns null when there is nothing to do. */
export type StyleEditBuilder = (context: HtmlOpContext) => UpstreamPatchSet | null;

interface StyleChange {
  declarations: string[];
  drop: string[];
}

/** `set` when the value is present, else drop the property. */
function put(change: StyleChange, property: string, value: string | null): void {
  if (value === null) change.drop.push(property);
  else change.declarations.push(`${property}:${value}`);
}

function cssFontFamily(family: string): string {
  return /\s/.test(family) && !/["']/.test(family) ? `"${family}"` : family;
}

function sizeValue(value: number | null): string | null {
  const size = clampStyleSize(value);
  return size === null ? null : `${size}px`;
}

/** The inline-style change a patch asks for (everything but `alt`). */
function styleChange(patch: HtmlStylePatch): StyleChange {
  const change: StyleChange = { declarations: [], drop: [] };
  const typography = patch.typography;
  if (typography?.fontFamily !== undefined) put(change, "font-family", typography.fontFamily === null ? null : cssFontFamily(typography.fontFamily));
  if (typography?.fontWeight !== undefined) put(change, "font-weight", typography.fontWeight === null ? null : String(typography.fontWeight));
  if (typography?.textAlign !== undefined) put(change, "text-align", typography.textAlign);
  if (patch.size?.width !== undefined) put(change, "width", sizeValue(patch.size.width));
  if (patch.size?.height !== undefined) put(change, "height", sizeValue(patch.size.height));
  if (patch.background !== undefined) put(change, "background-color", patch.background === null ? null : normalizeHexColour(patch.background));
  if (patch.opacity !== undefined) {
    const percent = clampOpacity(patch.opacity);
    put(change, "opacity", percent === STYLE_OPACITY_DEFAULT ? null : String(percent / 100));
  }
  if (patch.fit !== undefined) put(change, "object-fit", patch.fit);
  if (patch.customCss !== undefined) {
    for (const part of normalizeCustomCss(patch.customCss).split(";")) {
      const declaration = part.trim();
      if (declaration !== "") change.declarations.push(declaration);
    }
  }
  return change;
}

/** A builder that swallows "nothing to change" so the caller never sees it. */
function guarded(build: StyleEditBuilder): StyleEditBuilder {
  return (context) => {
    try {
      return build(context);
    } catch (error) {
      if (error instanceof HtmlOpError && (error.code === "no_op" || error.code === "attribute_not_found")) return null;
      throw error;
    }
  };
}

/**
 * The edits a panel patch asks for, in apply order. An invalid declaration
 * (custom CSS carrying a URL, a rule block, a second property) makes the style
 * edit throw `HtmlOpError("invalid_target")`, which the caller treats as "no
 * edit" - the document is never given CSS the op validator refuses.
 */
export function stylePatchEdits(sid: number, patch: HtmlStylePatch): StyleEditBuilder[] {
  const edits: StyleEditBuilder[] = [];
  const change = styleChange(patch);
  if (change.declarations.length > 0 || change.drop.length > 0) {
    edits.push(guarded((context) => setStyleDeclarations(context, { sid }, change.declarations, change.drop)));
  }
  if (patch.alt !== undefined) {
    const alt = patch.alt;
    edits.push(guarded((context) => setAttr(context, { sid }, "alt", alt)));
  }
  return edits;
}

/** "Revert": drop every property the panel manages, leave the author's rest. */
export function styleRevertEdit(sid: number): StyleEditBuilder {
  return guarded((context) => setStyleDeclarations(context, { sid }, [], MANAGED_PROPERTIES));
}

function declarationMap(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of style.split(";")) {
    const at = part.indexOf(":");
    if (at === -1) continue;
    out.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return out;
}

function pixels(value: string | undefined): number | null {
  const match = value === undefined ? null : /^(\d+(?:\.\d+)?)px$/i.exec(value);
  return match ? clampStyleSize(Number(match[1])) : null;
}

/**
 * What the element already carries in its own `style` / `alt` attributes, as
 * the panel's values. Only inline declarations are read - the frame's computed
 * style is never asked for - so a value set by a stylesheet reads as "not set".
 */
export function readStyleValues(context: HtmlOpContext, sid: number): HtmlStyleValues {
  const values = defaultHtmlStyleValues();
  const element = elementBySid(context.map, sid);
  if (!element) return values;
  const attrs = parseStartTagAttributes(context.text, element.startTag);
  const style = findAttribute(attrs, "style");
  const declarations = declarationMap(style ? decodeAttributeValue(style.value) : "");
  const family = declarations.get("font-family");
  const weight = Number(declarations.get("font-weight"));
  const align = declarations.get("text-align");
  const fit = declarations.get("object-fit");
  const opacity = Number(declarations.get("opacity"));
  const alt = findAttribute(attrs, "alt");
  return {
    ...values,
    fontFamily: family ? family.replace(/^["']|["']$/g, "") : null,
    fontWeight: HTML_STYLE_FONT_WEIGHTS.find((candidate) => candidate === weight) ?? null,
    textAlign: HTML_STYLE_ALIGNMENTS.find((candidate) => candidate === align) ?? null,
    size: { ...values.size, width: pixels(declarations.get("width")), height: pixels(declarations.get("height")) },
    background: normalizeHexColour(declarations.get("background-color")),
    opacity: declarations.has("opacity") && Number.isFinite(opacity) ? clampOpacity(Math.round(opacity * 100)) : values.opacity,
    alt: alt ? decodeAttributeValue(alt.value) : null,
    fit: HTML_STYLE_FITS.find((candidate) => candidate === fit) ?? null,
  };
}
