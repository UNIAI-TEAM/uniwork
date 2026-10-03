// Task A13 (UNI-924): document-level header/footer state for the editing UI.
//
// The engine parse carries the six slots in two shapes (upstream types.ts):
// the default header/footer as loose document fields (headerText / headerParas
// / headerHasPageNumber, headerImages…) and the first/even variants as
// HfPartInfo records (text / hasPageNumber / paras / images). This module maps
// both onto the model's DocxHfSlot names so the panel, the preview and the
// command wiring speak one shape, and builds the exact existing DocxEdit ops
// (set_header_footer / set_title_pg / set_even_odd_headers) — no new op shape.
import type { DocxEdit, DocxHeaderFooter, DocxHfSlot } from "@uniwork/office-engine/docx";

/** Every slot the model and SaveOptions know, in UI order. */
export const DOCX_HF_SLOTS = ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"] as const;

/** One parsed header/footer part — the HfPartInfo slice this UI reads. */
export interface DocxHfPartLike {
  text?: string | null;
  hasPageNumber?: boolean;
  paras?: unknown[] | null;
  images?: unknown[] | null;
}

/**
 * The engine parse fields this UI consumes (a structural ParsedDoc slice, the
 * same convention createDocxPaginationSpec uses). `images` are display-only:
 * they are surfaced as content flags, never as editable state.
 */
export interface DocxHeaderFooterSource {
  headerText?: string | null;
  headerParas?: unknown[] | null;
  headerHasPageNumber?: boolean;
  footerText?: string | null;
  footerParas?: unknown[] | null;
  footerHasPageNumber?: boolean;
  headerFirst?: DocxHfPartLike | null;
  footerFirst?: DocxHfPartLike | null;
  headerEven?: DocxHfPartLike | null;
  footerEven?: DocxHfPartLike | null;
  /** Document-level images of the default header/footer (headerImages…). */
  headerImages?: unknown[] | null;
  footerImages?: unknown[] | null;
  /** w:titlePg — the first page has its own header/footer. */
  titlePg?: boolean;
  /** settings.xml w:evenAndOddHeaders — odd/even pages differ. */
  evenAndOddHeaders?: boolean;
}

export interface DocxHfSlotState {
  /** The editable part content; null when the slot has no text/field/paragraph content. */
  value: DocxHeaderFooter | null;
  /** The part carries display-only pictures (a logo); text edits leave them untouched. */
  hasImages: boolean;
}

export interface DocxHeaderFooterState {
  slots: Record<DocxHfSlot, DocxHfSlotState>;
  titlePg: boolean;
  evenAndOddHeaders: boolean;
}

/** true when the slot has anything the canvas would render. */
export function hasHfSlotContent(slot: DocxHfSlotState): boolean {
  return slot.value !== null || slot.hasImages;
}

/** header* slots render above the body, footer* below. */
export function headerFooterKindOf(slot: DocxHfSlot): "header" | "footer" {
  return slot.startsWith("header") ? "header" : "footer";
}

function valueFromFields(text: unknown, paras: unknown, hasPageNumber: unknown): DocxHeaderFooter | null {
  const value: DocxHeaderFooter = { text: typeof text === "string" ? text : "" };
  if (hasPageNumber === true) value.pageNumber = true;
  if (Array.isArray(paras) && paras.length > 0) value.paras = paras;
  const empty = value.text.trim() === "" && value.pageNumber !== true && (value.paras?.length ?? 0) === 0;
  return empty ? null : value;
}

function slotFromFields(text: unknown, paras: unknown, hasPageNumber: unknown, images: unknown): DocxHfSlotState {
  return {
    value: valueFromFields(text, paras, hasPageNumber),
    hasImages: Array.isArray(images) && images.length > 0,
  };
}

function slotFromPart(part: DocxHfPartLike | null | undefined): DocxHfSlotState {
  if (!part || typeof part !== "object") return { value: null, hasImages: false };
  return slotFromFields(part.text, part.paras, part.hasPageNumber, part.images);
}

/** The empty state — also what an unopened document contributes. */
export function emptyHeaderFooterState(): DocxHeaderFooterState {
  return {
    slots: {
      header: { value: null, hasImages: false },
      footer: { value: null, hasImages: false },
      headerFirst: { value: null, hasImages: false },
      footerFirst: { value: null, hasImages: false },
      headerEven: { value: null, hasImages: false },
      footerEven: { value: null, hasImages: false },
    },
    titlePg: false,
    evenAndOddHeaders: false,
  };
}

/**
 * Read the six slots and the two variant flags from an engine parse.
 * Mirrors the pagination spec (docx-frame.ts `documentHeaderFooter`/`hfFromPart`)
 * so the panel shows exactly what the canvas strips render: whitespace-only
 * empty text is no content, a page-number field or a rich paragraph is.
 */
export function readDocxHeaderFooterState(parsed?: DocxHeaderFooterSource | null): DocxHeaderFooterState {
  const doc = parsed ?? {};
  const empty = emptyHeaderFooterState();
  return {
    slots: {
      header: slotFromFields(doc.headerText, doc.headerParas, doc.headerHasPageNumber, doc.headerImages),
      footer: slotFromFields(doc.footerText, doc.footerParas, doc.footerHasPageNumber, doc.footerImages),
      headerFirst: slotFromPart(doc.headerFirst),
      footerFirst: slotFromPart(doc.footerFirst),
      headerEven: slotFromPart(doc.headerEven),
      footerEven: slotFromPart(doc.footerEven),
    },
    titlePg: doc.titlePg === true,
    evenAndOddHeaders: doc.evenAndOddHeaders === true,
  };
}

/** Replace a slot with edited content (null clears it the honest way). */
export function setHeaderFooterEdit(slot: DocxHfSlot, hf: DocxHeaderFooter | null): DocxEdit {
  return { op: "set_header_footer", slot, hf };
}

/**
 * Clear a slot: upstream has no "remove header" flag, so an empty-text hf is
 * the carrier (model.ts setHeaderFooter), the same shape the model writes for
 * a null.
 */
export function clearHeaderFooterEdit(slot: DocxHfSlot): DocxEdit {
  return { op: "set_header_footer", slot, hf: { text: "" } };
}

/** w:titlePg — different first page. */
export function setTitlePgEdit(value: boolean): DocxEdit {
  return { op: "set_title_pg", value };
}

/** settings.xml w:evenAndOddHeaders — different odd & even pages. */
export function setEvenOddHeadersEdit(value: boolean): DocxEdit {
  return { op: "set_even_odd_headers", value };
}
