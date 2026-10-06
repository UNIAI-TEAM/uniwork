// UNI-952 (fix-E2-docx): per-section headers and footers in the DOCX print copy.
//
// The parse carries a header/footer reference set per section (w:headerReference
// / w:footerReference, inherited from earlier sections when absent), a w:titlePg
// flag per section and the document-wide w:evenAndOddHeaders. This module
// resolves them the way the editor canvas does (docx-frame `resolvePageHf`):
// the section's variant reference, else its default reference, else, for the
// final section only, the document-level part. Pending header/footer edits
// from the dialog overlay the final section, the section the document-level
// slots save into.
//
// Printing goes through @page margin boxes, the only per-page area Chromium
// lets a print copy paint into: text as CSS strings, pictures as data: URLs
// (./docx-print-hf-image). Chromium has no page groups, so `@page name:first`
// matches the document's first page only: the first-page variant prints for
// the first section, and a later section with its own titlePg prints its
// default part on its first page too.

import { effectiveHfRefs, readSections, type RendererHfPart, type RendererParsed } from "@uniwork/office-upstream/docs-renderer-editor";
import type { DocxEdit, DocxHfSlot } from "@uniwork/office-engine/docx";
import type { DocxHeaderFooterState } from "../header-footer/header-footer-state";
import { hfImageContent, printableHfImages, type DocxPrintHfImage } from "./docx-print-hf-image";

/** PAGE / NUMPAGES field placeholders in a parsed part's text (docx-engine PAGE_MARK, TOTAL_PAGES_MARK). */
const PAGE_MARK = "";
const TOTAL_PAGES_MARK = "";

type HfKind = "header" | "footer";
type HfVariant = "default" | "first" | "even";

export interface DocxPrintHfPart {
  /** Identity of the part's content source (a relationship id, `doc:` or `edit:`); equal ids print the same. */
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
}

/** The headers and footers the print copy prints, per section. */
export interface DocxPrintHeaderFooter {
  evenAndOddHeaders: boolean;
  sections: DocxPrintSectionHf[];
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
  const resolve = (at: number, kind: HfKind, variant: HfVariant): DocxPrintHfPart | null => {
    const set = refs[at]?.[kind];
    const rId = set?.[variant] ?? set?.default;
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
  return {
    evenAndOddHeaders: doc.evenAndOddHeaders === true,
    sections: sections.map((section, at) => ({
      index: at,
      titlePg: section.titlePg === true,
      header: variants(at, "header"),
      footer: variants(at, "footer"),
    })),
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

/**
 * The parse's parts with the dialog's pending edits applied: an edited slot
 * replaces the final section's part (its pictures stay, text edits never touch
 * them), a titlePg edit sets the final section's flag, and the document-wide
 * odd/even flag comes from the state.
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
      const images = final[kind][variant]?.images ?? [];
      const part = partOf(`edit:${edit.slot}`, value?.text, value?.pageNumber, null);
      final[kind][variant] = part ? { ...part, images } : images.length > 0 ? { id: `edit:${edit.slot}`, text: "", pageNumber: false, images } : null;
    }
  }
  return { evenAndOddHeaders: state?.evenAndOddHeaders ?? source.evenAndOddHeaders, sections };
}

/** The entry for a section; a document-level entry (index 0 only) covers every section. */
export function sectionHeaderFooter(hf: DocxPrintHeaderFooter | null | undefined, index: number): DocxPrintSectionHf | null {
  if (!hf || hf.sections.length === 0) return null;
  return hf.sections.find((section) => section.index === index) ?? (hf.sections.length === 1 ? (hf.sections[0] ?? null) : null);
}

/**
 * What a named page prints on every page (default and, under odd/even, the
 * even parts). Sections whose key and geometry match share a page name, so a
 * continuous section flows on; the first-page parts are left out because
 * `:first` can only ever match the document's first page.
 */
export function printedHfKey(section: DocxPrintSectionHf | null, evenAndOddHeaders: boolean): string {
  if (!section) return "";
  const id = (part: DocxPrintHfPart | null): string => part?.id ?? "-";
  const parts = [section.header.default, section.footer.default];
  if (evenAndOddHeaders) parts.push(section.header.even, section.footer.even);
  return parts.map(id).join(",");
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
  for (const piece of text.split(/([])/u)) {
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

type BoxPosition = "left" | "center" | "right";
const BOX_POSITIONS: readonly BoxPosition[] = ["left", "center", "right"];

/** One part's content per box: pictures by alignment, the text in the centre box after the centred pictures. */
function boxContents(part: DocxPrintHfPart | null): Record<BoxPosition, string[]> {
  const boxes: Record<BoxPosition, string[]> = { left: [], center: [], right: [] };
  if (!part) return boxes;
  for (const image of part.images) {
    const content = hfImageContent(image);
    if (content) boxes[image.align].push(content);
  }
  boxes.center.push(...textContent(part));
  return boxes;
}

function marginBoxes(header: DocxPrintHfPart | null, footer: DocxPrintHfPart | null, blankEmpty: boolean): string[] {
  const out: string[] = [];
  for (const [edge, part] of [["top", header], ["bottom", footer]] as const) {
    const contents = boxContents(part);
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
): string[] {
  if (!section) return [];
  const rules: string[] = [];
  const base = marginBoxes(section.header.default, section.footer.default, false);
  if (base.length > 0) rules.push(`@page ${name} {\n${base.join("\n")}\n}`);
  if (evenAndOddHeaders) rules.push(`@page ${name}:left {\n${marginBoxes(section.header.even, section.footer.even, true).join("\n")}\n}`);
  if (opensDocument && section.titlePg) {
    rules.push(`@page ${name}:first {\n${marginBoxes(section.header.first, section.footer.first, true).join("\n")}\n}`);
  }
  return rules;
}
