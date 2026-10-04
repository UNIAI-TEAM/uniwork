// B6 (UNI-924): the page-decoration state the Layout dialog and command area
// share. The engine parse owns the read side (readPageDecor); this module
// mirrors pending ops onto a display copy and turns the dialog's draft into
// the minimal op list the save replays.
import type { Editor } from "@tiptap/core";
import {
  readPageDecor,
  type DocxPageBorders,
  type DocxPageDecorEdit,
  type DocxParsed,
  type DocxThemeColors,
  type DocxThemeFonts,
} from "@uniwork/office-engine/docx";

export type DocxThemeColorSlot = "dk2" | "lt2" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6";

export const DOCX_THEME_COLOR_SLOTS: readonly DocxThemeColorSlot[] = [
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
];

export interface DocxPageDecorSection {
  index: number;
  firstBlockIndex: number;
  lastBlockIndex: number;
  borders: DocxPageBorders | null;
}

/** The dialog/runtime display state: the parse's read state with every pending
 * op applied in order, plus the section at the cursor. */
export interface DocxPageDecorView {
  pageColor: string | null;
  watermarkText: string | null;
  hasPictureWatermark: boolean;
  themeFonts: DocxThemeFonts | null;
  themeColors: DocxThemeColors | null;
  sections: DocxPageDecorSection[];
  activeIndex: number;
}

export function decorViewFromParsed(parsed: unknown): DocxPageDecorView | null {
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { blocks?: unknown }).blocks)) return null;
  const snapshot = readPageDecor(parsed as DocxParsed);
  return {
    pageColor: snapshot.pageColor,
    watermarkText: snapshot.watermarkText,
    hasPictureWatermark: snapshot.hasPictureWatermark,
    themeFonts: snapshot.themeFonts ? { ...snapshot.themeFonts } : null,
    themeColors: snapshot.themeColors ? { ...snapshot.themeColors } : null,
    sections: snapshot.sections.map(cloneDecorSection),
    activeIndex: 0,
  };
}

function cloneDecorSection(section: DocxPageDecorSection): DocxPageDecorSection {
  return { ...section, borders: section.borders ? { ...section.borders } : null };
}

export function cloneDecorView(view: DocxPageDecorView): DocxPageDecorView {
  return {
    ...view,
    themeFonts: view.themeFonts ? { ...view.themeFonts } : null,
    themeColors: view.themeColors ? { ...view.themeColors } : null,
    sections: view.sections.map(cloneDecorSection),
  };
}

/** Mirror one pending op onto the display copy. */
export function applyDecorEditToView(view: DocxPageDecorView, edit: DocxPageDecorEdit): DocxPageDecorView {
  switch (edit.op) {
    case "set_page_color":
      return { ...view, pageColor: edit.color };
    case "set_watermark":
      return {
        ...view,
        watermarkText: edit.watermark ? edit.watermark.text : null,
        // the save drops the header's own watermark child on set and remove,
        // so a pending edit supersedes a picture watermark as well
        hasPictureWatermark: false,
      };
    case "set_theme_fonts":
      return { ...view, themeFonts: { ...edit.fonts } };
    case "set_theme_colors":
      return { ...view, themeColors: { ...view.themeColors, ...edit.colors } };
    case "set_page_borders":
      return {
        ...view,
        sections: view.sections.map((section) =>
          section.index === edit.sectionIndex ? { ...section, borders: edit.borders ? { ...edit.borders } : null } : section,
        ),
      };
  }
}

function docxIndexAtSelection(editor: Editor): number {
  const { doc, selection } = editor.state;
  if (doc.childCount === 0) return 0;
  const resolved = doc.resolve(Math.min(selection.from, doc.content.size));
  const top = Math.min(resolved.index(0), doc.childCount - 1);
  const indexOf = (at: number): number | null => {
    const docxIndex = doc.child(at).attrs?.docxIndex as unknown;
    return typeof docxIndex === "number" ? docxIndex : null;
  };
  // An inserted block (shape, chart, â€¦) has no docxIndex. Scan forward first so
  // the caret in front of real content still resolves to that content's
  // section, then fall back to the nearest block before it.
  for (let at = top; at < doc.childCount; at += 1) {
    const found = indexOf(at);
    if (found !== null) return found;
  }
  for (let at = top - 1; at >= 0; at -= 1) {
    const found = indexOf(at);
    if (found !== null) return found;
  }
  return 0;
}

/** The 0-based section index at the cursor (docxSections order). */
export function activeDecorSectionIndex(editor: Editor | null, sections: readonly DocxPageDecorSection[]): number {
  if (!editor || editor.isDestroyed || sections.length === 0) return 0;
  const docxIndex = docxIndexAtSelection(editor);
  const hit = sections.find((section) => docxIndex >= section.firstBlockIndex && docxIndex <= section.lastBlockIndex);
  if (hit) return hit.index;
  let nearest = 0;
  for (const section of sections) {
    if (section.firstBlockIndex <= docxIndex) nearest = section.index;
  }
  return nearest;
}

/** Word-like theme presets: the font pair + colour scheme applied together. */
export interface DocxThemePreset {
  key: string;
  fonts: DocxThemeFonts;
  colors: Record<DocxThemeColorSlot, string>;
}

export const DOCX_THEME_DEFAULT_FONTS: DocxThemeFonts = { major: "Calibri Light", minor: "Calibri" };

export const DOCX_THEME_DEFAULT_COLORS: Record<DocxThemeColorSlot, string> = {
  dk2: "44546A",
  lt2: "E7E6E6",
  accent1: "4472C4",
  accent2: "ED7D31",
  accent3: "A5A5A5",
  accent4: "FFC000",
  accent5: "5B9BD5",
  accent6: "70AD47",
};

export const DOCX_THEME_PRESETS: readonly DocxThemePreset[] = [
  {
    key: "office",
    fonts: { major: "Calibri Light", minor: "Calibri", eastAsia: "等线" },
    colors: DOCX_THEME_DEFAULT_COLORS,
  },
  {
    key: "facet",
    fonts: { major: "Trebuchet MS", minor: "Trebuchet MS", eastAsia: "微软雅黑" },
    colors: { dk2: "3E3D2D", lt2: "E1DFDD", accent1: "90C226", accent2: "54A021", accent3: "E6B91E", accent4: "E76618", accent5: "C42F1A", accent6: "918655" },
  },
  {
    key: "ion",
    fonts: { major: "Century Gothic", minor: "Century Gothic", eastAsia: "黑体" },
    colors: { dk2: "1B587C", lt2: "E8ECEE", accent1: "4E8542", accent2: "604878", accent3: "C19859", accent4: "CA7B4F", accent5: "415D6B", accent6: "8EA5AF" },
  },
  {
    key: "retrospect",
    fonts: { major: "Calibri Light", minor: "Calibri", eastAsia: "仿宋" },
    colors: { dk2: "637052", lt2: "CCDDEA", accent1: "E48312", accent2: "BD582C", accent3: "865640", accent4: "9B8357", accent5: "C2BC80", accent6: "94A088" },
  },
];

/** Watermark presets: the key names the i18n string used as the watermark text. */
export const DOCX_WATERMARK_PRESET_KEYS: readonly string[] = ["confidential", "draft", "sample", "doNotCopy"];

export interface DocxPageColorPreset {
  key: string;
  hex: string;
}

export const DOCX_PAGE_COLOR_PRESETS: readonly DocxPageColorPreset[] = [
  { key: "lightYellow", hex: "FFF9E6" },
  { key: "beige", hex: "F5F0E6" },
  { key: "lightGreen", hex: "EAF5EA" },
  { key: "lightBlue", hex: "E8F1FB" },
  { key: "lightPurple", hex: "F3EEFB" },
  { key: "lightGray", hex: "F2F2F2" },
  { key: "darkGray", hex: "333333" },
  { key: "black", hex: "000000" },
];

/** Line styles the border panel offers (a subset of the engine's ST_Border list). */
export const DOCX_BORDER_STYLE_CHOICES: readonly string[] = [
  "single",
  "double",
  "dashed",
  "dotted",
  "dotDash",
  "triple",
  "wave",
  "thick",
];

/** w:sz choices in eighths of a point (0.5 pt .. 4 pt). */
export const DOCX_BORDER_WIDTH_CHOICES: readonly number[] = [4, 8, 12, 16, 24, 32];

export const DOCX_BORDER_SPACE_CHOICES: readonly number[] = [0, 8, 16, 24, 31];

export type DocxPageDecorErrorKey =
  | "invalidColor"
  | "invalidOpacity"
  | "invalidBorderSize"
  | "invalidBorderSpace"
  | "emptyThemeFont"
  | "invalidThemeColor";

/** The dialog's editable copy: strings as typed, ops built on Apply. */
export interface DocxPageDecorDraft {
  watermarkText: string;
  watermarkFont: string;
  watermarkColor: string;
  watermarkOpacity: string;
  watermarkDiagonal: boolean;
  /** the Remove watermark action: emit set_watermark(null) on Apply */
  watermarkRemoved: boolean;
  /** "" = no page colour */
  pageColor: string;
  borderOn: boolean;
  borderStyle: string;
  borderWidth: string;
  borderColor: string;
  borderSpace: string;
  borderOffset: "page" | "text";
  themeMajor: string;
  themeMinor: string;
  themeEastAsia: string;
  themeColors: Record<DocxThemeColorSlot, string>;
}

/** Strip an optional '#', uppercase; null when it is not a 6-digit hex. */
export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

/** The four dialog panels share this shape; the dialog owns the draft. */
export interface DocxPageDecorPanelProps {
  draft: DocxPageDecorDraft;
  readOnly: boolean;
  patch: (patch: Partial<DocxPageDecorDraft>) => void;
}

export function decorDraftFromView(view: DocxPageDecorView): DocxPageDecorDraft {
  const active = view.sections[view.activeIndex] ?? view.sections[0] ?? null;
  const borders = active?.borders ?? null;
  const fonts = view.themeFonts ?? DOCX_THEME_DEFAULT_FONTS;
  const colors = { ...DOCX_THEME_DEFAULT_COLORS, ...(view.themeColors ?? {}) };
  return {
    watermarkText: view.watermarkText ?? "",
    watermarkFont: "",
    watermarkColor: "",
    watermarkOpacity: "50",
    watermarkDiagonal: true,
    watermarkRemoved: false,
    pageColor: view.pageColor ?? "",
    borderOn: borders !== null,
    borderStyle: borders?.style ?? "single",
    borderWidth: String(borders?.widthEighths ?? 4),
    borderColor: borders?.colorHex ?? "",
    borderSpace: String(borders?.spacePt ?? 24),
    borderOffset: borders?.offsetFrom ?? "page",
    themeMajor: fonts.major,
    themeMinor: fonts.minor,
    themeEastAsia: fonts.eastAsia ?? "",
    themeColors: colors,
  };
}

function sameBorders(a: DocxPageBorders | null, b: DocxPageBorders | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.style === b.style &&
    (a.widthEighths ?? 4) === (b.widthEighths ?? 4) &&
    (a.spacePt ?? 24) === (b.spacePt ?? 24) &&
    (a.offsetFrom ?? "text") === (b.offsetFrom ?? "text") &&
    (a.colorHex ?? "") === (b.colorHex ?? "")
  );
}

/** The minimal op list for Apply: only fields that differ from the seed. */
export function editsFromDraft(
  draft: DocxPageDecorDraft,
  initial: DocxPageDecorDraft,
  view: DocxPageDecorView,
): { edits: DocxPageDecorEdit[]; error: DocxPageDecorErrorKey | null } {
  const edits: DocxPageDecorEdit[] = [];

  const text = draft.watermarkText.trim();
  const textChanged = text !== initial.watermarkText.trim();
  const styleChanged =
    draft.watermarkFont !== initial.watermarkFont ||
    draft.watermarkColor !== initial.watermarkColor ||
    draft.watermarkOpacity !== initial.watermarkOpacity ||
    draft.watermarkDiagonal !== initial.watermarkDiagonal;
  if (draft.watermarkRemoved) {
    edits.push({ op: "set_watermark", watermark: null });
  } else if (text === "" && view.watermarkText !== null) {
    edits.push({ op: "set_watermark", watermark: null });
  } else if (text !== "" && (textChanged || styleChanged)) {
    const color = draft.watermarkColor === "" ? null : normalizeHex(draft.watermarkColor);
    if (draft.watermarkColor !== "" && color === null) return { edits: [], error: "invalidColor" };
    const opacity = Number(draft.watermarkOpacity) / 100;
    if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) return { edits: [], error: "invalidOpacity" };
    edits.push({
      op: "set_watermark",
      watermark: {
        text,
        ...(draft.watermarkFont !== "" ? { fontFamily: draft.watermarkFont } : {}),
        ...(color ? { colorHex: color } : {}),
        opacity,
        diagonal: draft.watermarkDiagonal,
      },
    });
  }

  const pageColor = draft.pageColor.trim();
  const nextColor = pageColor === "" ? null : normalizeHex(pageColor);
  if (pageColor !== "" && nextColor === null) return { edits: [], error: "invalidColor" };
  if (nextColor !== view.pageColor) edits.push({ op: "set_page_color", color: nextColor });

  const width = Number(draft.borderWidth);
  if (draft.borderOn && (!Number.isInteger(width) || width < 4 || width > 96)) return { edits: [], error: "invalidBorderSize" };
  const space = Number(draft.borderSpace);
  if (draft.borderOn && (!Number.isInteger(space) || space < 0 || space > 31)) return { edits: [], error: "invalidBorderSpace" };
  const borderColor = draft.borderColor === "" ? null : normalizeHex(draft.borderColor);
  if (draft.borderOn && draft.borderColor !== "" && borderColor === null) return { edits: [], error: "invalidColor" };
  const active = view.sections[view.activeIndex] ?? view.sections[0] ?? null;
  const nextBorders: DocxPageBorders | null = draft.borderOn
    ? {
        style: draft.borderStyle,
        widthEighths: width,
        ...(borderColor ? { colorHex: borderColor } : {}),
        spacePt: space,
        offsetFrom: draft.borderOffset,
      }
    : null;
  if (active && !sameBorders(nextBorders, active.borders)) {
    edits.push({ op: "set_page_borders", sectionIndex: active.index, borders: nextBorders });
  }

  if (draft.themeMajor !== initial.themeMajor || draft.themeMinor !== initial.themeMinor || draft.themeEastAsia !== initial.themeEastAsia) {
    const major = draft.themeMajor.trim();
    const minor = draft.themeMinor.trim();
    if (major === "" || minor === "") return { edits: [], error: "emptyThemeFont" };
    const eastAsia = draft.themeEastAsia.trim();
    edits.push({ op: "set_theme_fonts", fonts: { major, minor, ...(eastAsia !== "" ? { eastAsia } : {}) } });
  }

  const colors: DocxThemeColors = {};
  for (const slot of DOCX_THEME_COLOR_SLOTS) {
    if (draft.themeColors[slot] === initial.themeColors[slot]) continue;
    const hex = normalizeHex(draft.themeColors[slot]);
    if (hex === null) return { edits: [], error: "invalidThemeColor" };
    colors[slot] = hex;
  }
  if (Object.keys(colors).length > 0) edits.push({ op: "set_theme_colors", colors });

  return { edits, error: null };
}
