// B6 (UNI-924): page decoration — page colour, page borders, watermark and
// theme colours/fonts. Page colour, the text watermark and the theme pair ride
// plain SaveOptions (the vendored save owns w:background + settings.xml, the
// header VML watermark and word/theme/theme1.xml). Page borders have no
// upstream save option, so this module rewrites the w:pgBorders child of one
// w:sectPr slice and the model feeds the result through the existing section
// seam (trailingSectPr for the final section, the break paragraph otherwise).
//
// Read side: the parse exposes watermarkText/watermarkPicture, themeFonts/
// themeColors and internal.documentXml (upstream parse.ts:545-576), so the
// dialog seeds from here without importing the vendored module.
import {
  DocxEngineError,
  type DocxPageBorders,
  type DocxParsed,
  type DocxSaveOptions,
  type DocxThemeColors,
  type DocxThemeFonts,
  type DocxWatermark,
} from "./engine";
import { docxSections } from "./section-properties";

export type { DocxPageBorders, DocxThemeColors, DocxThemeFonts, DocxWatermark } from "./engine";

/** One section's border box as the dialog reads it (index = docxSections order). */
export interface DocxPageDecorBorderSection {
  index: number;
  firstBlockIndex: number;
  lastBlockIndex: number;
  /** the section's visible w:pgBorders box, null when it has none */
  borders: DocxPageBorders | null;
}

/** The open document's page-decoration read state. */
export interface DocxPageDecorSnapshot {
  /** w:background colour hex without '#', null when unset */
  pageColor: string | null;
  /** text watermark in the default header, null when none */
  watermarkText: string | null;
  /** a picture watermark is present (read-only for B6) */
  hasPictureWatermark: boolean;
  themeFonts: DocxThemeFonts | null;
  themeColors: DocxThemeColors | null;
  sections: DocxPageDecorBorderSection[];
}

const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;
const PAGE_COLOR_RE = /<w:background[^>]*w:color="([0-9A-Fa-f]{6})"/;
const PG_BORDERS_RE = /<w:pgBorders[^>]*\/>|<w:pgBorders[\s\S]*?<\/w:pgBorders>/;
const PG_BORDER_SIDE_RE = /<w:(?:top|left|bottom|right)\b[^>]*\/?>/g;
/** CT_SectPr children that follow w:pgBorders (the insert anchor). */
const AFTER_PG_BORDERS_RE =
  /<w:(?:lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings)[\s/>]/;
const BORDER_SIDES = ["top", "left", "bottom", "right"] as const;

/** ST_Border line styles (upstream section.ts:53); anything else is an art
 * border, which the B6 dialog does not author. */
export const DOCX_PAGE_BORDER_STYLES: readonly string[] = [
  "single",
  "double",
  "dashed",
  "dotted",
  "dotDash",
  "dotDotDash",
  "triple",
  "wave",
  "doubleWave",
  "thick",
  "thinThickSmallGap",
  "thinThickThinSmallGap",
  "dashSmallGap",
  "threeDEmboss",
  "threeDEngrave",
  "outset",
  "inset",
];

export const DOCX_PAGE_BORDER_MIN_SIZE = 2;
export const DOCX_PAGE_BORDER_MAX_SIZE = 96;
export const DOCX_PAGE_BORDER_DEFAULT_SIZE = 4;
export const DOCX_PAGE_BORDER_MAX_SPACE = 31;
export const DOCX_PAGE_BORDER_DEFAULT_SPACE = 24;

function intOf(tag: string, name: string): number | null {
  const match = new RegExp(`${name}="(-?\\d+)"`).exec(tag);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function documentXmlOf(parsed: DocxParsed): string {
  const internal = parsed.internal;
  const xml = internal ? internal.documentXml : undefined;
  return typeof xml === "string" ? xml : "";
}

/** The page colour this parse carries: w:background hex without '#', else null
 * (mirrors upstream readPageColor, section.ts:504). */
export function readPageColor(parsed: DocxParsed): string | null {
  const match = PAGE_COLOR_RE.exec(documentXmlOf(parsed));
  return match ? match[1]!.toUpperCase() : null;
}

/** The visible w:pgBorders box of one sectPr slice, null when the section has
 * none (Word writes explicit "none" sides — those are not a drawn border). */
export function readPageBorders(sectPrXml: string): DocxPageBorders | null {
  const pgBorders = PG_BORDERS_RE.exec(sectPrXml)?.[0];
  if (!pgBorders) return null;
  let side: string | null = null;
  for (const candidate of pgBorders.match(PG_BORDER_SIDE_RE) ?? []) {
    const val = /w:val="([^"]*)"/.exec(candidate)?.[1];
    if (val && val !== "none" && val !== "nil") {
      side = candidate;
      break;
    }
  }
  if (side === null) return null;
  const style = /w:val="([^"]*)"/.exec(side)?.[1] ?? "single";
  const size = intOf(side, "w:sz");
  const space = intOf(side, "w:space");
  const color = /w:color="([0-9A-Fa-f]{6})"/.exec(side)?.[1];
  const offsetFrom = /w:offsetFrom="(page|text)"/.exec(pgBorders)?.[1];
  return {
    style,
    ...(size !== null ? { widthEighths: size } : {}),
    ...(color ? { colorHex: color.toUpperCase() } : {}),
    ...(space !== null ? { spacePt: space } : {}),
    ...(offsetFrom ? { offsetFrom: offsetFrom as "page" | "text" } : {}),
  };
}

/** Set/replace (or remove, null) the w:pgBorders child of one sectPr slice at
 * its CT_SectPr slot. Every byte the box does not own stays as it was. */
export function applyPageBorders(sectPrXml: string, borders: DocxPageBorders | null): string {
  const xml = sectPrXml.replace(PG_BORDERS_RE, "");
  if (borders === null) return xml;
  const size = borders.widthEighths ?? DOCX_PAGE_BORDER_DEFAULT_SIZE;
  const space = borders.spacePt ?? DOCX_PAGE_BORDER_DEFAULT_SPACE;
  const color = borders.colorHex ?? "auto";
  const sides = BORDER_SIDES.map(
    (side) => `<w:${side} w:val="${borders.style}" w:sz="${size}" w:space="${space}" w:color="${color}"/>`,
  ).join("");
  const tag = `<w:pgBorders${borders.offsetFrom ? ` w:offsetFrom="${borders.offsetFrom}"` : ""}>${sides}</w:pgBorders>`;
  const anchor = AFTER_PG_BORDERS_RE.exec(xml);
  if (anchor) return xml.slice(0, anchor.index) + tag + xml.slice(anchor.index);
  return xml.replace(/<\/w:sectPr>/, `${tag}</w:sectPr>`);
}

/** The open parse's read state: current colour, watermark, theme and the
 * per-section border boxes. */
export function readPageDecor(parsed: DocxParsed): DocxPageDecorSnapshot {
  const watermarkText =
    typeof parsed.watermarkText === "string" && parsed.watermarkText.length > 0 ? parsed.watermarkText : null;
  return {
    pageColor: readPageColor(parsed),
    watermarkText,
    hasPictureWatermark: parsed.watermarkPicture != null,
    themeFonts: asThemeFonts(parsed.themeFonts),
    themeColors: asThemeColors(parsed.themeColors),
    sections: docxSections(parsed).map((section) => ({
      index: section.index,
      firstBlockIndex: section.firstBlockIndex,
      lastBlockIndex: section.lastBlockIndex,
      borders: readPageBorders(section.sectPrXml),
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asThemeFonts(value: unknown): DocxThemeFonts | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const major = typeof raw.major === "string" ? raw.major : "";
  const minor = typeof raw.minor === "string" ? raw.minor : "";
  if (!major && !minor) return null;
  return { major, minor, ...(typeof raw.eastAsia === "string" && raw.eastAsia ? { eastAsia: raw.eastAsia } : {}) };
}

const THEME_COLOR_KEYS = ["dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;

function asThemeColors(value: unknown): DocxThemeColors | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const out: DocxThemeColors = {};
  if (typeof raw.name === "string" && raw.name.length > 0) out.name = raw.name;
  for (const key of THEME_COLOR_KEYS) {
    const slot = raw[key];
    if (typeof slot === "string" && HEX_RE.test(slot)) out[key] = slot.replace(/^#/, "").toUpperCase();
  }
  return Object.keys(out).length > 0 ? out : null;
}

function requireHex(value: unknown, code: string, what: string): string {
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    throw new DocxEngineError(code, what + " must be a 6-digit hex colour, got " + String(value));
  }
  return value.replace(/^#/, "").toUpperCase();
}

/** Page colour: null removes the background, else a hex without '#'. */
export function requirePageColor(color: string | null): string | null {
  if (color === null) return null;
  return requireHex(color, "bad_page_color", "page colour");
}

/** Watermark: null removes it, else a text spec the vendored writer can emit
 * (watermark.ts:264). Blank text would draw nothing, so it is refused. */
export function requireWatermark(watermark: DocxWatermark | null): DocxWatermark | null {
  if (watermark === null) return null;
  if (typeof watermark !== "object" || typeof watermark.text !== "string" || watermark.text.trim().length === 0) {
    throw new DocxEngineError("empty_watermark_text", "watermark needs non-blank text");
  }
  if (watermark.fontFamily !== undefined && (typeof watermark.fontFamily !== "string" || watermark.fontFamily.length === 0)) {
    throw new DocxEngineError("bad_watermark", "watermark fontFamily must be a non-empty string");
  }
  if (watermark.opacity !== undefined) {
    const opacity = watermark.opacity;
    if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new DocxEngineError("bad_watermark_opacity", "watermark opacity must be 0..1, got " + String(opacity));
    }
  }
  return {
    text: watermark.text,
    ...(watermark.fontFamily !== undefined ? { fontFamily: watermark.fontFamily } : {}),
    ...(watermark.colorHex !== undefined ? { colorHex: requireHex(watermark.colorHex, "bad_watermark", "watermark colour") } : {}),
    ...(watermark.opacity !== undefined ? { opacity: watermark.opacity } : {}),
    ...(watermark.diagonal !== undefined ? { diagonal: watermark.diagonal } : {}),
    ...(watermark.bold !== undefined ? { bold: watermark.bold } : {}),
    ...(watermark.italic !== undefined ? { italic: watermark.italic } : {}),
  };
}

/** Theme font pair: the save writes major/minor latin (+ optional east-asian)
 * into word/theme/theme1.xml. */
export function requireThemeFonts(fonts: DocxThemeFonts): DocxThemeFonts {
  if (typeof fonts !== "object" || fonts === null || typeof fonts.major !== "string" || fonts.major.trim().length === 0) {
    throw new DocxEngineError("bad_theme_fonts", "theme fonts need a non-empty major face");
  }
  if (typeof fonts.minor !== "string" || fonts.minor.trim().length === 0) {
    throw new DocxEngineError("bad_theme_fonts", "theme fonts need a non-empty minor face");
  }
  if (fonts.eastAsia !== undefined && (typeof fonts.eastAsia !== "string" || fonts.eastAsia.trim().length === 0)) {
    throw new DocxEngineError("bad_theme_fonts", "theme eastAsia face must be a non-empty string");
  }
  return {
    major: fonts.major,
    minor: fonts.minor,
    ...(fonts.eastAsia !== undefined ? { eastAsia: fonts.eastAsia } : {}),
  };
}

/** Theme colours: at least one writeable slot, each a hex without '#'. */
export function requireThemeColors(colors: DocxThemeColors): DocxThemeColors {
  const raw = asRecord(colors);
  if (!raw) throw new DocxEngineError("bad_theme_colors", "theme colours need an object");
  const allowed = [...THEME_COLOR_KEYS, "name"] as const;
  for (const key of Object.keys(raw)) {
    if (!(allowed as readonly string[]).includes(key)) {
      throw new DocxEngineError("bad_theme_colors", "unknown theme colour slot " + key);
    }
  }
  const out: DocxThemeColors = {};
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      throw new DocxEngineError("bad_theme_colors", "theme name must be a non-empty string");
    }
    out.name = raw.name;
  }
  for (const key of THEME_COLOR_KEYS) {
    const slot = raw[key];
    if (slot !== undefined) out[key] = requireHex(slot, "bad_theme_colors", "theme " + key);
  }
  if (Object.keys(out).length === 0) {
    throw new DocxEngineError("empty_theme_colors", "theme colours need at least one slot");
  }
  return out;
}

/** Page borders: null removes the box, else a style/width/colour/offset spec. */
export function requirePageBorders(borders: DocxPageBorders | null): DocxPageBorders | null {
  if (borders === null) return null;
  if (typeof borders !== "object" || !DOCX_PAGE_BORDER_STYLES.includes(borders.style)) {
    throw new DocxEngineError("bad_border_style", "page border style " + String(borders?.style) + " is not a line style");
  }
  if (borders.widthEighths !== undefined) {
    const size = borders.widthEighths;
    if (!Number.isInteger(size) || size < DOCX_PAGE_BORDER_MIN_SIZE || size > DOCX_PAGE_BORDER_MAX_SIZE) {
      throw new DocxEngineError(
        "bad_border_size",
        "border width must be " + DOCX_PAGE_BORDER_MIN_SIZE + "-" + DOCX_PAGE_BORDER_MAX_SIZE + " eighths of a point",
      );
    }
  }
  if (borders.spacePt !== undefined) {
    const space = borders.spacePt;
    if (!Number.isInteger(space) || space < 0 || space > DOCX_PAGE_BORDER_MAX_SPACE) {
      throw new DocxEngineError("bad_border_space", "border offset must be 0-" + DOCX_PAGE_BORDER_MAX_SPACE + " points");
    }
  }
  return {
    style: borders.style,
    ...(borders.widthEighths !== undefined ? { widthEighths: borders.widthEighths } : {}),
    ...(borders.colorHex !== undefined ? { colorHex: requireHex(borders.colorHex, "bad_page_borders", "border colour") } : {}),
    ...(borders.spacePt !== undefined ? { spacePt: borders.spacePt } : {}),
    ...(borders.offsetFrom !== undefined ? { offsetFrom: borders.offsetFrom } : {}),
  };
}

/** Typed page-decoration ops; the model folds them into DocxEdit. */
export type DocxPageDecorEdit =
  | { op: "set_page_color"; color: string | null }
  | { op: "set_watermark"; watermark: DocxWatermark | null }
  | { op: "set_theme_fonts"; fonts: DocxThemeFonts }
  | { op: "set_theme_colors"; colors: DocxThemeColors }
  | { op: "set_page_borders"; sectionIndex: number; borders: DocxPageBorders | null };

const PAGE_DECOR_OPS: ReadonlySet<string> = new Set([
  "set_page_color",
  "set_watermark",
  "set_theme_fonts",
  "set_theme_colors",
  "set_page_borders",
]);

/** Narrow one op of the model's edit union to the page-decor half. */
export function isPageDecorEdit(edit: { op: string }): edit is DocxPageDecorEdit {
  return PAGE_DECOR_OPS.has(edit.op);
}

/** Validate and normalize one page-decor op (refusals carry the codes above);
 * the command layer stores only normalized ops in a draft snapshot. */
export function normalizePageDecorEdit(edit: DocxPageDecorEdit): DocxPageDecorEdit {
  switch (edit.op) {
    case "set_page_color":
      return { op: edit.op, color: requirePageColor(edit.color) };
    case "set_watermark":
      return { op: edit.op, watermark: requireWatermark(edit.watermark) };
    case "set_theme_fonts":
      return { op: edit.op, fonts: requireThemeFonts(edit.fonts) };
    case "set_theme_colors":
      return { op: edit.op, colors: requireThemeColors(edit.colors) };
    case "set_page_borders":
      return { op: edit.op, sectionIndex: edit.sectionIndex, borders: requirePageBorders(edit.borders) };
  }
}

/** The model's pending page-decoration edits. Colour/watermark/theme become
 * SaveOptions at savePlan; section borders rewrite sectPr slices through
 * applyBorders (the caller owns which section slice and where it lands).
 * `onDirty` fires on every accepted edit so the model marks itself dirty. */
export class DocxPageDecorState {
  private pageColor: string | null | undefined;
  private watermark: DocxWatermark | null | undefined;
  private themeFonts: DocxThemeFonts | undefined;
  private themeColors: DocxThemeColors | undefined;
  private readonly borderEdits = new Map<number, DocxPageBorders | null>();

  constructor(private readonly onDirty: () => void) {}

  setPageColor(color: string | null): void {
    this.pageColor = requirePageColor(color);
    this.onDirty();
  }

  setWatermark(watermark: DocxWatermark | null): void {
    this.watermark = requireWatermark(watermark);
    this.onDirty();
  }

  setThemeFonts(fonts: DocxThemeFonts): void {
    this.themeFonts = requireThemeFonts(fonts);
    this.onDirty();
  }

  setThemeColors(colors: DocxThemeColors): void {
    this.themeColors = requireThemeColors(colors);
    this.onDirty();
  }

  /** Set or remove the box of one section (docxSections order). Refuses an
   * index the parse does not have or a section with no rewritable sectPr. */
  setPageBorders(parsed: DocxParsed, sectionIndex: number, borders: DocxPageBorders | null): void {
    if (!Number.isInteger(sectionIndex)) {
      throw new DocxEngineError("bad_section_index", "sectionIndex must be an integer, got " + String(sectionIndex));
    }
    const section = docxSections(parsed)[sectionIndex];
    if (!section) {
      throw new DocxEngineError("bad_section_index", "no section has index " + sectionIndex);
    }
    if (section.sectPrXml.length === 0) {
      throw new DocxEngineError("no_section_sectPr", "section " + sectionIndex + " carries no w:sectPr to rewrite");
    }
    this.borderEdits.set(sectionIndex, requirePageBorders(borders));
    this.onDirty();
  }

  /** The model's single entry for page-decor ops. */
  applyEdit(parsed: DocxParsed, edit: DocxPageDecorEdit): void {
    switch (edit.op) {
      case "set_page_color":
        return this.setPageColor(edit.color);
      case "set_watermark":
        return this.setWatermark(edit.watermark);
      case "set_theme_fonts":
        return this.setThemeFonts(edit.fonts);
      case "set_theme_colors":
        return this.setThemeColors(edit.colors);
      case "set_page_borders":
        return this.setPageBorders(parsed, edit.sectionIndex, edit.borders);
    }
  }

  /** Only the edits the user made — an untouched option stays absent so its
   * part keeps its exact bytes. */
  saveOptions(): DocxSaveOptions {
    const options: DocxSaveOptions = {};
    if (this.pageColor !== undefined) options.pageColor = this.pageColor;
    if (this.watermark !== undefined) options.watermark = this.watermark;
    if (this.themeFonts !== undefined) options.themeFonts = this.themeFonts;
    if (this.themeColors !== undefined) options.themeColors = this.themeColors;
    return options;
  }

  borderIndexes(): number[] {
    return [...this.borderEdits.keys()];
  }

  /** Apply this section's pending border edit to an already section-property-
   * rewritten slice; untouched sections return the slice unchanged. */
  applyBorders(sectionIndex: number, sectPrXml: string): string {
    if (!this.borderEdits.has(sectionIndex)) return sectPrXml;
    return applyPageBorders(sectPrXml, this.borderEdits.get(sectionIndex)!);
  }

  clear(): void {
    this.pageColor = undefined;
    this.watermark = undefined;
    this.themeFonts = undefined;
    this.themeColors = undefined;
    this.borderEdits.clear();
  }
}
