// UNI-952 (fix-E2-docx): per-section headers and footers in the DOCX print copy.
//
// The parse carries a header/footer reference set per section (w:headerReference
// / w:footerReference, inherited from earlier sections when absent), a w:titlePg
// flag per section and the document-wide w:evenAndOddHeaders. This module
// resolves them the way the editor canvas does (docx-frame `resolvePageHf`):
// the section's variant reference, else its default reference, else, for the
// final section only, the document-level part. Pending header/footer edits
// from the dialog overlay the parts the engine's save would rewrite (see
// `resolveDocxPrintHeaderFooter`).
//
// Printing goes through @page margin boxes, the only per-page area Chromium
// lets a print copy paint into: text as CSS strings, pictures as data: URLs
// defined once on :root (./docx-print-hf-image). Chromium has no page groups, so
// `@page name:first` matches the document's first page only: the first-page
// variant prints for the first section, and a later section with its own
// titlePg prints its default part on its first page too.

import { effectiveHfRefs, readSections, type RendererHfPart, type RendererParsed } from "@uniwork/office-upstream/docs-renderer-editor";
import type { DocxEdit, DocxHfSlot } from "@uniwork/office-engine/docx";
import type { DocxHeaderFooterState } from "../header-footer/header-footer-state";
import { hfImageContent, printableHfImages, type DocxPrintHfImage, type DocxPrintHfImageDefs } from "./docx-print-hf-image";

/** PAGE / NUMPAGES field placeholders in a parsed part's text (docx-engine PAGE_MARK, TOTAL_PAGES_MARK). */
const PAGE_MARK = "\u{E001}";
const TOTAL_PAGES_MARK = "\u{E000}";
const PAGE_FIELD_SPLIT = /([\u{E000}\u{E001}])/u;

type HfKind = "header" | "footer";
type HfVariant = "default" | "first" | "even";
const HF_VARIANTS: readonly HfVariant[] = ["default", "first", "even"];

/** A relationship id per kind and variant. */
type HfRefIds = Record<HfKind, Partial<Record<HfVariant, string>>>;

interface DocxPrintHfPart {
  /** Where the part came from (a relationship id, `doc:` or `edit:`); informational, page names are keyed by content. */
  id: string;
  text: string;
  pageNumber: boolean;
  images: DocxPrintHfImage[];
}

export interface DocxPrintSectionHf {
  /** The section's index, as DocxPageSetupSection.index. */
  index: number;
  titlePg: boolean;
  header: Record<HfVariant, DocxPrintHfPart | null>;
  footer: Record<HfVariant, DocxPrintHfPart | null>;
  /** The relationship id each variant resolved to, empty parts included (parse source only). */
  refs?: HfRefIds;
}

/** The headers and footers the print copy prints, per section. */
export interface DocxPrintHeaderFooter {
  evenAndOddHeaders: boolean;
  sections: DocxPrintSectionHf[];
  /** The references of the final section's own sectPr: the parts the engine's save writes header/footer edits into. */
  finalOwnRefs?: HfRefIds;
}

/** What the open parse contributes; the same shape before the pending edits are applied. */
export type DocxPrintHfSource = DocxPrintHeaderFooter;

interface ParsedHfFields {
  hfParts?: Record<string, RendererHfPart> | null;
  evenAndOddHeaders?: unknown;
  headerText?: unknown;
  headerHasPageNumber?: unknown;
  headerImages?: unknown;
  footerText?: unknown;
  footerHasPageNumber?: unknown;
  footerImages?: unknown;
}

function partOf(id: string, text: unknown, pageNumber: unknown, images: unknown): DocxPrintHfPart | null {
  const part: DocxPrintHfPart = {
    id,
    text: typeof text === "string" ? text : "",
    pageNumber: pageNumber === true,
    images: printableHfImages(Array.isArray(images) ? images : null),
  };
  return part.text.trim() || part.pageNumber || part.images.length > 0 ? part : null;
}

/** The per-section header/footer parts of an engine parse; null when it has no sections. */
export function readDocxPrintHeaderFooter(parsed: unknown): DocxPrintHfSource | null {
  // readSections walks `blocks`; a parse slice without them has no sections to resolve.
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { blocks?: unknown }).blocks)) return null;
  const sections = readSections(parsed as RendererParsed);
  if (!Array.isArray(sections) || sections.length === 0) return null;
  const doc = parsed as ParsedHfFields;
  const refs = effectiveHfRefs(sections);
  const documentPart = {
    header: partOf("doc:header", doc.headerText, doc.headerHasPageNumber, doc.headerImages),
    footer: partOf("doc:footer", doc.footerText, doc.footerHasPageNumber, doc.footerImages),
  };
  const refIdOf = (at: number, kind: HfKind, variant: HfVariant): string | undefined => {
    const set = refs[at]?.[kind];
    return set?.[variant] ?? set?.default;
  };
  const resolve = (at: number, kind: HfKind, variant: HfVariant): DocxPrintHfPart | null => {
    const rId = refIdOf(at, kind, variant);
    const part = rId ? doc.hfParts?.[rId] : undefined;
    const resolved = rId && part ? partOf(rId, part.text, part.hasPageNumber, part.images) : null;
    if (resolved) return resolved;
    return at === sections.length - 1 ? documentPart[kind] : null;
  };
  const variants = (at: number, kind: HfKind): Record<HfVariant, DocxPrintHfPart | null> => ({
    default: resolve(at, kind, "default"),
    first: resolve(at, kind, "first"),
    even: resolve(at, kind, "even"),
  });
  const refIds = (at: number): HfRefIds => {
    const out: HfRefIds = { header: {}, footer: {} };
    for (const kind of ["header", "footer"] as const) {
      for (const variant of HF_VARIANTS) {
        const rId = refIdOf(at, kind, variant);
        if (rId) out[kind][variant] = rId;
      }
    }
    return out;
  };
  const last = sections[sections.length - 1];
  return {
    evenAndOddHeaders: doc.evenAndOddHeaders === true,
    sections: sections.map((section, at) => ({
      index: at,
      titlePg: section.titlePg === true,
      header: variants(at, "header"),
      footer: variants(at, "footer"),
      refs: refIds(at),
    })),
    finalOwnRefs: { header: { ...last?.headerRefs }, footer: { ...last?.footerRefs } },
  };
}

const SLOT_TARGET: Record<DocxHfSlot, [HfKind, HfVariant]> = {
  header: ["header", "default"],
  footer: ["footer", "default"],
  headerFirst: ["header", "first"],
  footerFirst: ["footer", "first"],
  headerEven: ["header", "even"],
  footerEven: ["footer", "even"],
};

/** The document-level state alone, for a document whose parse gave no sections: one entry for every section. */
function fromStateOnly(state: DocxHeaderFooterState): DocxPrintHeaderFooter {
  const slot = (name: DocxHfSlot): DocxPrintHfPart | null => {
    const value = state.slots[name]?.value;
    return value ? partOf(`edit:${name}`, value.text, value.pageNumber, null) : null;
  };
  return {
    evenAndOddHeaders: state.evenAndOddHeaders,
    sections: [
      {
        index: 0,
        titlePg: state.titlePg,
        header: { default: slot("header"), first: slot("headerFirst"), even: slot("headerEven") },
        footer: { default: slot("footer"), first: slot("footerFirst"), even: slot("footerEven") },
      },
    ],
  };
}

/** An edited slot's value in place of a part: the text and page number are replaced, the part's pictures stay. */
function editedPart(slot: DocxHfSlot, current: DocxPrintHfPart | null, value: { text?: string; pageNumber?: boolean } | null | undefined): DocxPrintHfPart | null {
  const images = current?.images ?? [];
  const part = partOf(`edit:${slot}`, value?.text, value?.pageNumber, null);
  if (part) return { ...part, images };
  return images.length > 0 ? { id: `edit:${slot}`, text: "", pageNumber: false, images } : null;
}

/**
 * The parse's parts with the dialog's pending edits applied the way the
 * engine's save writes them: a slot edit rewrites the part the final section's
 * own reference names, IN PLACE, so every section whose variant resolves to
 * that same part shows the edit too; with no own reference the save writes a
 * new part for the final section alone. A text edit keeps the part's pictures,
 * a titlePg edit sets the final section's flag, and the document-wide odd/even
 * flag comes from the state.
 */
export function resolveDocxPrintHeaderFooter(
  source: DocxPrintHfSource | null,
  state: DocxHeaderFooterState | null,
  edits: readonly DocxEdit[],
): DocxPrintHeaderFooter | null {
  if (!source) return state ? fromStateOnly(state) : null;
  const sections = source.sections.map((section) => ({
    ...section,
    header: { ...section.header },
    footer: { ...section.footer },
  }));
  const final = sections[sections.length - 1];
  if (state && final) {
    for (const edit of edits) {
      if (edit.op === "set_title_pg") final.titlePg = state.titlePg;
      if (edit.op !== "set_header_footer") continue;
      const [kind, variant] = SLOT_TARGET[edit.slot];
      const value = state.slots[edit.slot]?.value;
      const ownId = source.finalOwnRefs?.[kind][variant];
      for (const section of sections) {
        for (const at of HF_VARIANTS) {
          const sharesPart = ownId !== undefined && section.refs?.[kind][at] === ownId;
          if (sharesPart || (section === final && at === variant)) section[kind][at] = editedPart(edit.slot, section[kind][at], value);
        }
      }
    }
  }
  return { ...source, evenAndOddHeaders: state?.evenAndOddHeaders ?? source.evenAndOddHeaders, sections };
}

/** The entry for a section; a document-level entry (index 0 only) covers every section. */
export function sectionHeaderFooter(hf: DocxPrintHeaderFooter | null | undefined, index: number): DocxPrintSectionHf | null {
  if (!hf || hf.sections.length === 0) return null;
  return hf.sections.find((section) => section.index === index) ?? (hf.sections.length === 1 ? (hf.sections[0] ?? null) : null);
}

/** A part by what it prints, so equal parts under different relationship ids are one. */
function partKey(part: DocxPrintHfPart | null): string {
  if (!part) return "-";
  const images = part.images.map((image) => `${image.align}|${image.widthPx ?? ""}|${image.heightPx ?? ""}|${image.dataUrl}`);
  return [part.text, part.pageNumber ? "1" : "0", ...images].join("\u0001");
}

/**
 * What a named page prints on every page (default and, under odd/even, the
 * even parts), by content. Sections whose key and geometry match share a page
 * name; the first-page parts are left out because `:first` can only ever match
 * the document's first page.
 */
export function printedHfKey(section: DocxPrintSectionHf | null, evenAndOddHeaders: boolean): string {
  if (!section) return "";
  const parts = [section.header.default, section.footer.default];
  if (evenAndOddHeaders) parts.push(section.header.even, section.footer.even);
  return parts.map(partKey).join("\u0002");
}

/** A CSS string literal for a margin box: quotes, backslashes and `<` escaped, newlines kept. */
function cssString(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || char === '"') out += `\\${char}`;
    else if (char === "\n") out += "\\A ";
    else if (char === "<" || char === ">" || code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
    else out += char;
  }
  return `"${out}"`;
}

/** The text as CSS content: PAGE fields become counter(page), NUMPAGES counter(pages). */
function textContent(part: DocxPrintHfPart): string[] {
  const out: string[] = [];
  const text = part.text.trim();
  let hasPageField = false;
  for (const piece of text.split(PAGE_FIELD_SPLIT)) {
    if (piece === PAGE_MARK) {
      hasPageField = true;
      out.push("counter(page)");
    } else if (piece === TOTAL_PAGES_MARK) out.push("counter(pages)");
    else if (piece) out.push(cssString(piece));
  }
  if (part.pageNumber && !hasPageField) {
    if (out.length > 0) out.push('" "');
    out.push("counter(page)");
  }
  return out;
}

/** What the margin boxes of one named page need beyond the parts: the shared picture definitions and the margin heights. */
interface DocxPrintHfPageContext {
  images: DocxPrintHfImageDefs;
  /** Top and bottom page margins in CSS px: a header or footer picture is scaled to fit its margin. */
  marginTopPx: number;
  marginBottomPx: number;
}

type BoxPosition = "left" | "center" | "right";
const BOX_POSITIONS: readonly BoxPosition[] = ["left", "center", "right"];

/** One part's content per box: pictures by alignment, the text in the centre box after the centred pictures. */
function boxContents(part: DocxPrintHfPart | null, context: DocxPrintHfPageContext, boxHeightPx: number): Record<BoxPosition, string[]> {
  const boxes: Record<BoxPosition, string[]> = { left: [], center: [], right: [] };
  if (!part) return boxes;
  for (const image of part.images) {
    const content = hfImageContent(image, { defs: context.images, boxHeightPx });
    if (content) boxes[image.align].push(content);
  }
  boxes.center.push(...textContent(part));
  return boxes;
}

function marginBoxes(header: DocxPrintHfPart | null, footer: DocxPrintHfPart | null, blankEmpty: boolean, context: DocxPrintHfPageContext): string[] {
  const out: string[] = [];
  for (const [edge, part, boxHeightPx] of [["top", header, context.marginTopPx], ["bottom", footer, context.marginBottomPx]] as const) {
    const contents = boxContents(part, context, boxHeightPx);
    for (const position of BOX_POSITIONS) {
      const content = contents[position];
      const box = `@${edge}-${position}`;
      if (content.length > 0) out.push(`  ${box} { content: ${content.join(" ")}; white-space: pre-wrap; font-size: 9pt; }`);
      else if (blankEmpty) out.push(`  ${box} { content: none; }`);
    }
  }
  return out;
}

/**
 * The margin-box rules of one named page: its default parts, the even parts on
 * `:left` pages under odd/even, and the first-page parts on `:first` when this
 * page name opens the document and the section asks for them. A variant rule
 * blanks every box it leaves empty, so the default part never shows through.
 */
export function headerFooterPageRules(
  name: string,
  section: DocxPrintSectionHf | null,
  evenAndOddHeaders: boolean,
  opensDocument: boolean,
  context: DocxPrintHfPageContext,
): string[] {
  if (!section) return [];
  const rules: string[] = [];
  const base = marginBoxes(section.header.default, section.footer.default, false, context);
  if (base.length > 0) rules.push(`@page ${name} {\n${base.join("\n")}\n}`);
  if (evenAndOddHeaders) {
    rules.push(`@page ${name}:left {\n${marginBoxes(section.header.even, section.footer.even, true, context).join("\n")}\n}`);
  }
  if (opensDocument && section.titlePg) {
    rules.push(`@page ${name}:first {\n${marginBoxes(section.header.first, section.footer.first, true, context).join("\n")}\n}`);
  }
  return rules;
}
