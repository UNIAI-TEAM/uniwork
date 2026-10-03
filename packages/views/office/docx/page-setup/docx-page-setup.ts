// B4 (UNI-924): the page-setup model the Layout dialog and command area share.
// The engine seam owns the sectPr rewrite; this module owns the dialog's
// units (cm ↔ twips), the presets, the section list / active-section
// resolution, and the display merge the runtime keeps for the dialog.
import type { Editor } from "@tiptap/core";
import type { DocxSectionProperties, DocxSectionStartType } from "@uniwork/office-engine/docx";
import { readSections, type RendererParsed, type RendererSection } from "@uniwork/office-upstream/docs-renderer-editor";

export type DocxPageSetupOrientation = "portrait" | "landscape";

/** One section as the dialog reads it. Lengths are twips, like the file. */
export interface DocxPageSetupSection {
  index: number;
  firstBlockIndex: number;
  lastBlockIndex: number;
  pageWidth: number;
  pageHeight: number;
  orientation: DocxPageSetupOrientation;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  columns: number;
  columnSpace: number;
  startType: DocxSectionStartType;
}

/** One pending edit, in apply order, as the snapshot must carry it. */
export interface DocxPageSetupEdit {
  sectionIndex: number;
  properties: DocxSectionProperties;
}

export interface DocxPageSetupState {
  sections: DocxPageSetupSection[];
  /** The 0-based index of the section at the cursor. */
  activeIndex: number;
}

/** The page-setup numbers one section edit resolves to. */
export type DocxPageSetupDraft = Omit<DocxPageSetupSection, "index" | "firstBlockIndex" | "lastBlockIndex">;

export interface DocxMarginPreset {
  key: "normal" | "narrow" | "moderate" | "wide";
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Word's margin presets, in twips. */
export const DOCX_MARGIN_PRESETS: readonly DocxMarginPreset[] = [
  { key: "normal", top: 1440, right: 1440, bottom: 1440, left: 1440 },
  { key: "narrow", top: 720, right: 720, bottom: 720, left: 720 },
  { key: "moderate", top: 1440, right: 1080, bottom: 1440, left: 1080 },
  { key: "wide", top: 1440, right: 2880, bottom: 1440, left: 2880 },
];

export interface DocxPaperSize {
  key: "a4" | "letter" | "legal" | "b5";
  width: number;
  height: number;
}

/** Paper sizes (portrait dimensions), in twips. */
export const DOCX_PAPER_SIZES: readonly DocxPaperSize[] = [
  { key: "a4", width: 11906, height: 16838 },
  { key: "letter", width: 12240, height: 15840 },
  { key: "legal", width: 12240, height: 20160 },
  { key: "b5", width: 10319, height: 14572 },
];

export const DOCX_COLUMN_CHOICES: readonly number[] = [1, 2, 3];

/** Every start type a section can carry (the dialog offers all of them). */
export const DOCX_SECTION_START_TYPES: readonly DocxSectionStartType[] = ["nextPage", "continuous", "evenPage", "oddPage", "nextColumn"];

const DEFAULT_COLUMN_SPACE = 720;
const TWIPS_PER_CM = 1440 / 2.54;

/** Round to two decimals so the dialog shows 2.54, never 2.5400001. */
export function cmFromTwips(twips: number): number {
  return Math.round((twips / TWIPS_PER_CM) * 100) / 100;
}

export function twipsFromCm(cm: number): number {
  return Math.round(cm * TWIPS_PER_CM);
}

/** Trim a cm number for a text input (no trailing zeros). */
export function formatCm(twips: number): string {
  return String(cmFromTwips(twips));
}

function startTypeOf(value: unknown): DocxSectionStartType {
  return DOCX_SECTION_START_TYPES.includes(value as DocxSectionStartType) ? (value as DocxSectionStartType) : "nextPage";
}

function sectionFromRenderer(section: RendererSection, index: number): DocxPageSetupSection {
  const settings = section.settings as RendererSection["settings"] & {
    orientation?: string;
    columns?: number;
    colSpace?: number;
    gutter?: number;
    gutterAtTop?: boolean;
  };
  const columns = typeof settings.columns === "number" && settings.columns > 0 ? settings.columns : 1;
  // The engine writes the raw w:pgMar attributes; readSections folds w:gutter
  // into the margin it displays, so subtract it back to show (and edit) the
  // value the file carries.
  const gutter = typeof settings.gutter === "number" && settings.gutter > 0 ? settings.gutter : 0;
  const gutterAtTop = settings.gutterAtTop === true;
  return {
    index,
    firstBlockIndex: section.firstBlockIndex,
    lastBlockIndex: section.lastBlockIndex,
    pageWidth: settings.pageWidth,
    pageHeight: settings.pageHeight,
    orientation: settings.orientation === "landscape" ? "landscape" : "portrait",
    marginTop: settings.marginTop - (gutterAtTop ? gutter : 0),
    marginRight: settings.marginRight,
    marginBottom: settings.marginBottom,
    marginLeft: settings.marginLeft - (gutterAtTop ? 0 : gutter),
    columns,
    columnSpace: typeof settings.colSpace === "number" ? settings.colSpace : DEFAULT_COLUMN_SPACE,
    startType: startTypeOf(section.startType),
  };
}

/** The open parse's sections, in the paginator's own readSections order. */
export function sectionsFromParsed(parsed: unknown): DocxPageSetupSection[] {
  const sections = readSections(parsed as RendererParsed);
  return Array.isArray(sections) ? sections.map(sectionFromRenderer) : [];
}

export function clonePageSetupSection(section: DocxPageSetupSection): DocxPageSetupSection {
  return { ...section };
}

/** The dialog's seed values for one section. */
export function draftFromSection(section: DocxPageSetupSection): DocxPageSetupDraft {
  return {
    pageWidth: section.pageWidth,
    pageHeight: section.pageHeight,
    orientation: section.orientation,
    marginTop: section.marginTop,
    marginRight: section.marginRight,
    marginBottom: section.marginBottom,
    marginLeft: section.marginLeft,
    columns: section.columns,
    columnSpace: section.columnSpace,
    startType: section.startType,
  };
}

/** The 0-based section index a block belongs to; a block beyond the last
 * section's closing block (an inserted one) keeps the nearest preceding
 * section, and a block before the first keeps section 0. */
export function sectionIndexAtDocxIndex(sections: readonly DocxPageSetupSection[], docxIndex: number): number {
  if (sections.length === 0) return 0;
  const hit = sections.find((section) => docxIndex >= section.firstBlockIndex && docxIndex <= section.lastBlockIndex);
  if (hit) return hit.index;
  let nearest = 0;
  for (const section of sections) {
    if (section.firstBlockIndex <= docxIndex) nearest = section.index;
  }
  return nearest;
}

/** The docxIndex of the top-level block at the selection; an editor-created
 * block (docxIndex null) falls back to the nearest preceding original. */
function docxIndexAtSelection(editor: Editor): number {
  const { doc, selection } = editor.state;
  if (doc.childCount === 0) return 0;
  const resolved = doc.resolve(Math.min(selection.from, doc.content.size));
  const top = Math.min(resolved.index(0), doc.childCount - 1);
  for (let at = top; at >= 0; at -= 1) {
    const docxIndex = doc.child(at).attrs?.docxIndex as unknown;
    if (typeof docxIndex === "number") return docxIndex;
  }
  return 0;
}

/** The section at the cursor, for "Apply to: this section". */
export function activeSectionIndex(editor: Editor | null, sections: readonly DocxPageSetupSection[]): number {
  if (!editor || editor.isDestroyed || sections.length === 0) return 0;
  return sectionIndexAtDocxIndex(sections, docxIndexAtSelection(editor));
}

/** Mirror of the engine's merge rules for the runtime's display copy: an
 * orientation-only change swaps the paper, explicit dimensions win, every
 * other field is replaced when present. */
export function applyPropertiesToSection(
  section: DocxPageSetupSection,
  properties: DocxSectionProperties,
): DocxPageSetupSection {
  const next = { ...section };
  const explicitSize = properties.pageWidth !== undefined || properties.pageHeight !== undefined;
  if (properties.orientation !== undefined) {
    if (properties.orientation !== section.orientation && !explicitSize) {
      next.pageWidth = section.pageHeight;
      next.pageHeight = section.pageWidth;
    }
    next.orientation = properties.orientation;
  }
  if (properties.pageWidth !== undefined) next.pageWidth = properties.pageWidth;
  if (properties.pageHeight !== undefined) next.pageHeight = properties.pageHeight;
  if (properties.marginTop !== undefined) next.marginTop = properties.marginTop;
  if (properties.marginRight !== undefined) next.marginRight = properties.marginRight;
  if (properties.marginBottom !== undefined) next.marginBottom = properties.marginBottom;
  if (properties.marginLeft !== undefined) next.marginLeft = properties.marginLeft;
  if (properties.columns !== undefined) next.columns = properties.columns;
  if (properties.columnSpace !== undefined) next.columnSpace = properties.columnSpace;
  if (properties.startType !== undefined) next.startType = properties.startType;
  return next;
}

/** The fields that differ between the dialog's values and the section's own —
 * the engine merges them, so unchanged fields never reach the save. */
export function propertiesFromDraft(draft: DocxPageSetupDraft, current: DocxPageSetupSection): DocxSectionProperties {
  const properties: DocxSectionProperties = {};
  if (draft.orientation !== current.orientation) properties.orientation = draft.orientation;
  if (draft.pageWidth !== current.pageWidth) properties.pageWidth = draft.pageWidth;
  if (draft.pageHeight !== current.pageHeight) properties.pageHeight = draft.pageHeight;
  if (draft.marginTop !== current.marginTop) properties.marginTop = draft.marginTop;
  if (draft.marginRight !== current.marginRight) properties.marginRight = draft.marginRight;
  if (draft.marginBottom !== current.marginBottom) properties.marginBottom = draft.marginBottom;
  if (draft.marginLeft !== current.marginLeft) properties.marginLeft = draft.marginLeft;
  if (draft.columns !== current.columns) properties.columns = draft.columns;
  if (draft.columnSpace !== current.columnSpace) properties.columnSpace = draft.columnSpace;
  if (draft.startType !== current.startType) properties.startType = draft.startType;
  return properties;
}

/** The preset whose four values equal these margins, else null (custom). */
export function marginPresetKey(section: Pick<DocxPageSetupSection, "marginTop" | "marginRight" | "marginBottom" | "marginLeft">): DocxMarginPreset["key"] | null {
  const hit = DOCX_MARGIN_PRESETS.find(
    (preset) =>
      preset.top === section.marginTop &&
      preset.right === section.marginRight &&
      preset.bottom === section.marginBottom &&
      preset.left === section.marginLeft,
  );
  return hit?.key ?? null;
}

/** The paper preset matching the section's portrait dimensions, else "custom". */
export function paperSizeKey(section: Pick<DocxPageSetupSection, "pageWidth" | "pageHeight">): DocxPaperSize["key"] | "custom" {
  const portraitWidth = Math.min(section.pageWidth, section.pageHeight);
  const portraitHeight = Math.max(section.pageWidth, section.pageHeight);
  const hit = DOCX_PAPER_SIZES.find((size) => size.width === portraitWidth && size.height === portraitHeight);
  return hit?.key ?? "custom";
}

/** Word refuses margins that do not leave any content box. */
export function marginsFit(pageWidth: number, pageHeight: number, margins: Pick<DocxPageSetupSection, "marginTop" | "marginRight" | "marginBottom" | "marginLeft">): boolean {
  return margins.marginTop + margins.marginBottom < pageHeight && margins.marginLeft + margins.marginRight < pageWidth;
}
