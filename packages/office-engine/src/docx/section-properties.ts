// DOCX section properties (B4): enumerate the w:sectPr sections of a parse and
// rewrite the page-setup fields of one sectPr slice.
//
// The vendored engine owns the save: the final section's slice goes through
// SaveOptions.trailingSectPr, a non-final section's slice is rewritten inside
// its section-break paragraph (SaveBlock kind "xml"). This module mirrors
// upstream section.ts semantics for exactly the fields B4 exposes and keeps
// every other byte/attribute of the slice untouched, so an untouched section
// still saves byte-identically.
import { DocxEngineError, type DocxBlock, type DocxParsed } from "./engine";

export type DocxSectionOrientation = "portrait" | "landscape";
export type DocxSectionStartType = "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";

/** The page-setup fields one edit may change. Every field is optional: an
 * absent field keeps the section's current value, so successive edits merge.
 * Sizes, margins and column spacing are twips (1/20 pt), like the file. */
export interface DocxSectionProperties {
  pageWidth?: number;
  pageHeight?: number;
  orientation?: DocxSectionOrientation;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  columns?: number;
  columnSpace?: number;
  startType?: DocxSectionStartType;
}

/** Word's own ceiling for w:cols/@w:num in the page-setup UI. */
export const DOCX_SECTION_MAX_COLUMNS = 45;

const DEFAULT_PAGE_WIDTH = 12240;
const DEFAULT_PAGE_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;
const DEFAULT_COLUMN_SPACE = 720;

const SECT_PR_RE = /<w:sectPr[^>]*\/>|<w:sectPr[\s\S]*?<\/w:sectPr>/;
const PG_SZ_RE = /<w:pgSz[^>]*\/?>/;
const PG_MAR_RE = /<w:pgMar[^>]*\/?>/;
const COLS_RE = /<w:cols[^>]*\/>|<w:cols[^>]*>[\s\S]*?<\/w:cols>/;
const TYPE_RE = /<w:type[^>]*\/>/;
/** CT_SectPr children that follow w:type (the anchor list for a w:type insert). */
const AFTER_TYPE_RE = /<w:(?:pgSz|pgMar|paperSrc|pgBorders|lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)[\s/>]/;
/** CT_SectPr children that follow w:pgSz (the anchor list when it is missing). */
const AFTER_PG_SZ_RE = /<w:(?:pgMar|paperSrc|pgBorders|lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)[\s/>]/;
/** CT_SectPr children that follow w:cols (the anchor list when it is missing). */
const AFTER_COLS_RE = /<w:(?:formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)[\s/>]/;
/** CT_SectPr children that follow w:pgMar (the anchor list when it is missing). */
const AFTER_PG_MAR_RE = /<w:(?:paperSrc|pgBorders|lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)[\s/>]/;

const START_TYPES: readonly DocxSectionStartType[] = ["nextPage", "continuous", "evenPage", "oddPage", "nextColumn"];
const PROPERTY_KEYS = [
  "pageWidth",
  "pageHeight",
  "orientation",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "columns",
  "columnSpace",
  "startType",
] as const;

/** The page-setup numbers a sectPr slice carries right now. */
export interface DocxSectionSnapshot {
  pageWidth: number;
  pageHeight: number;
  orientation: DocxSectionOrientation;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  columns: number;
  columnSpace: number;
  startType: DocxSectionStartType;
  /** negative w:top / w:bottom in the file: the displayed value is the absolute
   * margin, the sign is restored on write (upstream section.ts). */
  marginTopFixed: boolean;
  marginBottomFixed: boolean;
}

/** One section, targeted by its 0-based document-order index — the same order
 * readSections gives the paginator. The section is closed by the block that
 * carries its w:sectPr: a visible section-break paragraph, or the hidden
 * trailing sectPr for the final section (targeted through trailingSectPr). */
export interface DocxSectionSlice {
  index: number;
  firstBlockIndex: number;
  lastBlockIndex: number;
  /** closing block's docxIndex; null when the final section is closed by the
   * hidden trailing w:sectPr (there is no visible block to rewrite). */
  breakDocxIndex: number | null;
  /** the section's own w:sectPr element; "" when the parse carries none. */
  sectPrXml: string;
  /** the block bytes that carry the slice (break paragraph or hidden block). */
  blockXml: string;
}

function blockXmlOf(block: DocxBlock): string {
  return typeof block.originalXml === "string" ? block.originalXml : "";
}

/** The parse block bytes behind one docxIndex, or null when the parse has none. */
export function originalXmlOf(parsed: DocxParsed, docxIndex: number): string | null {
  const block = parsed.blocks.find((b) => b.docxIndex === docxIndex);
  return typeof block?.originalXml === "string" ? block.originalXml : null;
}

function intAttr(tag: string, name: string, fallback: number): number {
  const match = new RegExp(`${name}="(-?\\d+)"`).exec(tag);
  const value = match ? Number.parseInt(match[1]!, 10) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

/** Enumerate every section in document order, mirroring readSections: each
 * block carrying a w:sectPr closes a section, the hidden trailing block closes
 * the last one. A parse with no sectPr at all yields one uneditable section. */
export function docxSections(parsed: DocxParsed): DocxSectionSlice[] {
  const trailingIndex =
    parsed.blocks.find((block) => block.hidden === true && block.docxIndex !== null && blockXmlOf(block).includes("<w:sectPr"))?.docxIndex ?? null;
  const sections: DocxSectionSlice[] = [];
  let first = 0;
  for (const block of parsed.blocks) {
    if (block.docxIndex === null) continue;
    const xml = blockXmlOf(block);
    if (!xml.includes("<w:sectPr")) continue;
    const sectPrXml = SECT_PR_RE.exec(xml)?.[0] ?? "";
    if (!sectPrXml) continue;
    sections.push({
      index: sections.length,
      firstBlockIndex: first,
      lastBlockIndex: block.docxIndex,
      breakDocxIndex: block.docxIndex === trailingIndex ? null : block.docxIndex,
      sectPrXml,
      blockXml: xml,
    });
    first = block.docxIndex + 1;
  }
  if (sections.length === 0) {
    const last = parsed.blocks[parsed.blocks.length - 1]?.docxIndex ?? 0;
    sections.push({ index: 0, firstBlockIndex: 0, lastBlockIndex: last, breakDocxIndex: null, sectPrXml: "", blockXml: "" });
  }
  return sections;
}

/** The section's own children: a trailing w:sectPrChange embeds a copy of an
 * earlier sectPr that must never be read from or rewritten. */
function ownContent(sectPrXml: string): string {
  const change = sectPrXml.indexOf("<w:sectPrChange");
  return change === -1 ? sectPrXml : sectPrXml.slice(0, change);
}

/** Read the page-setup numbers out of one sectPr slice, with the same
 * defaults upstream section.ts applies to a missing tag. */
export function readSectionSnapshot(sectPrXml: string): DocxSectionSnapshot {
  const own = ownContent(sectPrXml);
  const pgSz = PG_SZ_RE.exec(own)?.[0] ?? "";
  const pgMar = PG_MAR_RE.exec(own)?.[0] ?? "";
  const cols = COLS_RE.exec(own)?.[0] ?? "";
  const colsOpen = /^<w:cols[^>]*\/?>/.exec(cols)?.[0] ?? cols;
  const type = /<w:type[^>]*w:val="(nextPage|continuous|evenPage|oddPage|nextColumn)"/.exec(own)?.[1];
  const rawTop = intAttr(pgMar, "w:top", DEFAULT_MARGIN);
  const rawBottom = intAttr(pgMar, "w:bottom", DEFAULT_MARGIN);
  return {
    pageWidth: intAttr(pgSz, "w:w", DEFAULT_PAGE_WIDTH),
    pageHeight: intAttr(pgSz, "w:h", DEFAULT_PAGE_HEIGHT),
    orientation: pgSz.includes('w:orient="landscape"') ? "landscape" : "portrait",
    marginTop: Math.abs(rawTop),
    marginRight: intAttr(pgMar, "w:right", DEFAULT_MARGIN),
    marginBottom: Math.abs(rawBottom),
    marginLeft: intAttr(pgMar, "w:left", DEFAULT_MARGIN),
    columns: intAttr(colsOpen, "w:num", 1),
    columnSpace: intAttr(colsOpen, "w:space", DEFAULT_COLUMN_SPACE),
    startType: (type as DocxSectionStartType | undefined) ?? "nextPage",
    marginTopFixed: rawTop < 0,
    marginBottomFixed: rawBottom < 0,
  };
}

/** Validate one edit before it reaches a plan. Callers branch on `code`. */
export function requireSectionProperties(properties: DocxSectionProperties): void {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new DocxEngineError("bad_section_properties", "set_section_properties needs a properties object");
  }
  const keys = Object.keys(properties);
  if (keys.length === 0) {
    throw new DocxEngineError("empty_section_properties", "set_section_properties needs at least one property");
  }
  for (const key of keys) {
    if (!(PROPERTY_KEYS as readonly string[]).includes(key)) {
      throw new DocxEngineError("bad_section_properties", "unknown section property " + key);
    }
  }
  for (const side of ["marginTop", "marginRight", "marginBottom", "marginLeft"] as const) {
    const value = properties[side];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new DocxEngineError("bad_margin", side + " must be an integer number of twips");
    }
    if (value < 0) throw new DocxEngineError("bad_margin", side + " must not be negative");
  }
  for (const dimension of ["pageWidth", "pageHeight"] as const) {
    const value = properties[dimension];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new DocxEngineError("bad_page_size", dimension + " must be a positive integer number of twips");
    }
  }
  if (properties.orientation !== undefined && properties.orientation !== "portrait" && properties.orientation !== "landscape") {
    throw new DocxEngineError("bad_section_orientation", "orientation must be portrait or landscape");
  }
  if (properties.startType !== undefined && !START_TYPES.includes(properties.startType)) {
    throw new DocxEngineError("bad_section_start_type", "startType " + String(properties.startType) + " is not a section start type");
  }
  if (properties.columns !== undefined) {
    const columns = properties.columns;
    if (typeof columns !== "number" || !Number.isInteger(columns) || columns < 1 || columns > DOCX_SECTION_MAX_COLUMNS) {
      throw new DocxEngineError("bad_columns", "columns must be an integer 1-" + DOCX_SECTION_MAX_COLUMNS);
    }
  }
  if (properties.columnSpace !== undefined) {
    const space = properties.columnSpace;
    if (typeof space !== "number" || !Number.isInteger(space) || space < 0) {
      throw new DocxEngineError("bad_column_space", "columnSpace must be a non-negative integer number of twips");
    }
  }
}

/** Replace one attribute in a tag, or add it before the closing bracket when
 * absent; value null removes the attribute. */
function setTagAttr(tag: string, name: string, value: string | null): string {
  const attrRe = new RegExp(`\\s${name}="[^"]*"`);
  if (value === null) return attrRe.test(tag) ? tag.replace(attrRe, "") : tag;
  if (attrRe.test(tag)) return tag.replace(attrRe, ` ${name}="${value}"`);
  return tag.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
}

function setIntAttr(tag: string, name: string, value: number): string {
  return setTagAttr(tag, name, String(value));
}

/** Insert a child of w:sectPr at its schema slot: before the first named
 * follower, else before the closing tag. A self-closing sectPr has no closing
 * tag to anchor on, so it is expanded first. */
function insertBefore(xml: string, tag: string, followers: RegExp): string {
  const match = followers.exec(xml);
  if (match) return xml.slice(0, match.index) + tag + xml.slice(match.index);
  const selfClosing = /^<w:sectPr(\s[^>]*)?\/>$/.exec(xml);
  if (selfClosing) return `<w:sectPr${selfClosing[1] ?? ""}>${tag}</w:sectPr>`;
  const close = xml.lastIndexOf("</w:sectPr>");
  return close === -1 ? xml : xml.slice(0, close) + tag + xml.slice(close);
}

function applyStartType(sectPrXml: string, properties: DocxSectionProperties): string {
  if (properties.startType === undefined) return sectPrXml;
  const ownType = TYPE_RE.exec(ownContent(sectPrXml))?.[0];
  const xml = ownType ? sectPrXml.replace(TYPE_RE, "") : sectPrXml;
  if (properties.startType === "nextPage") return xml;
  return insertBefore(xml, `<w:type w:val="${properties.startType}"/>`, AFTER_TYPE_RE);
}

function applyPageSize(sectPrXml: string, snapshot: DocxSectionSnapshot, properties: DocxSectionProperties): string {
  if (properties.pageWidth === undefined && properties.pageHeight === undefined && properties.orientation === undefined) {
    return sectPrXml;
  }
  const explicitSize = properties.pageWidth !== undefined || properties.pageHeight !== undefined;
  let width = properties.pageWidth ?? snapshot.pageWidth;
  let height = properties.pageHeight ?? snapshot.pageHeight;
  // an orientation-only edit swaps the current dimensions; explicit dimensions win
  if (properties.orientation !== undefined && properties.orientation !== snapshot.orientation && !explicitSize) {
    [width, height] = [height, width];
  }
  const landscape = properties.orientation !== undefined ? properties.orientation === "landscape" : snapshot.orientation === "landscape";
  const pgSz = PG_SZ_RE.exec(ownContent(sectPrXml))?.[0];
  if (!pgSz) {
    const tag = `<w:pgSz w:w="${width}" w:h="${height}"${landscape ? ' w:orient="landscape"' : ""}/>`;
    return insertBefore(sectPrXml, tag, AFTER_PG_SZ_RE);
  }
  let tag = setIntAttr(pgSz, "w:w", width);
  tag = setIntAttr(tag, "w:h", height);
  tag = setTagAttr(tag, "w:orient", landscape ? "landscape" : null);
  return tag === pgSz ? sectPrXml : sectPrXml.replace(pgSz, tag);
}

function applyMargins(sectPrXml: string, snapshot: DocxSectionSnapshot, properties: DocxSectionProperties): string {
  if (properties.marginTop === undefined && properties.marginRight === undefined && properties.marginBottom === undefined && properties.marginLeft === undefined) {
    return sectPrXml;
  }
  // a negative w:top / w:bottom is the fixed-height form: display the absolute
  // value, write the sign back (upstream section.ts)
  const topMargin = properties.marginTop ?? snapshot.marginTop;
  const bottomMargin = properties.marginBottom ?? snapshot.marginBottom;
  const top = snapshot.marginTopFixed ? -topMargin : topMargin;
  const right = properties.marginRight ?? snapshot.marginRight;
  const bottom = snapshot.marginBottomFixed ? -bottomMargin : bottomMargin;
  const left = properties.marginLeft ?? snapshot.marginLeft;
  const pgMar = PG_MAR_RE.exec(ownContent(sectPrXml))?.[0];
  if (!pgMar) {
    const tag = `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="708" w:footer="708" w:gutter="0"/>`;
    const pgSz = PG_SZ_RE.exec(ownContent(sectPrXml))?.[0];
    return pgSz ? sectPrXml.replace(pgSz, `${pgSz}${tag}`) : insertBefore(sectPrXml, tag, AFTER_PG_MAR_RE);
  }
  let tag = setIntAttr(pgMar, "w:top", top);
  tag = setIntAttr(tag, "w:right", right);
  tag = setIntAttr(tag, "w:bottom", bottom);
  tag = setIntAttr(tag, "w:left", left);
  return tag === pgMar ? sectPrXml : sectPrXml.replace(pgMar, tag);
}

function applyColumns(sectPrXml: string, snapshot: DocxSectionSnapshot, properties: DocxSectionProperties): string {
  if (properties.columns === undefined && properties.columnSpace === undefined) return sectPrXml;
  const cols = COLS_RE.exec(ownContent(sectPrXml))?.[0];
  const colsOpen = cols ? (/^<w:cols[^>]*\/?>/.exec(cols)?.[0] ?? cols) : "";
  if (!cols) {
    const count = properties.columns ?? snapshot.columns;
    const space = properties.columnSpace ?? snapshot.columnSpace;
    const tag = `<w:cols${count > 1 ? ` w:num="${count}"` : ""} w:space="${space}"/>`;
    return insertBefore(sectPrXml, tag, AFTER_COLS_RE);
  }
  const currentCount = intAttr(colsOpen, "w:num", 1);
  const count = properties.columns ?? currentCount;
  if (count !== currentCount) {
    // equal widths first: a rebuilt element drops any explicit w:col children
    const space = properties.columnSpace ?? intAttr(colsOpen, "w:space", DEFAULT_COLUMN_SPACE);
    const tag = `<w:cols${count > 1 ? ` w:num="${count}"` : ""} w:space="${space}"/>`;
    return sectPrXml.replace(cols, tag);
  }
  if (properties.columnSpace === undefined) return sectPrXml;
  const currentSpace = intAttr(colsOpen, "w:space", DEFAULT_COLUMN_SPACE);
  if (currentSpace === properties.columnSpace) return sectPrXml;
  const nextOpen = setIntAttr(colsOpen, "w:space", properties.columnSpace);
  return sectPrXml.replace(cols, nextOpen + cols.slice(colsOpen.length));
}

/** Rewrite one sectPr slice with the given fields; every byte the properties
 * do not name stays exactly as it was. */
export function applySectionProperties(sectPrXml: string, properties: DocxSectionProperties): string {
  const snapshot = readSectionSnapshot(sectPrXml);
  let xml = applyStartType(sectPrXml, properties);
  xml = applyPageSize(xml, snapshot, properties);
  xml = applyMargins(xml, snapshot, properties);
  return applyColumns(xml, snapshot, properties);
}
