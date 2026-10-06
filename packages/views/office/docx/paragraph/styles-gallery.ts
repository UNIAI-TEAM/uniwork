/**
 * A3: the Home tab's styles gallery data. The gallery is the fixed Word set the
 * existing block model can express: Normal, Heading 1-6, Title and Quote.
 * Headings are the vendored docHeading node (level + styleId + outlineOnly —
 * the exact shape setHeading writes); Normal/Title/Quote are paragraph style
 * ids the save adapter already carries as w:pStyle (pmNodeToGeneratedBlock ->
 * GeneratedBlock.styleId). A style outside the gallery reads as no active
 * entry rather than being mislabelled.
 */
export type DocxGalleryStyleId =
  | "normal"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "title"
  | "quote";

export interface DocxGalleryStyle {
  id: DocxGalleryStyleId;
  /** i18next key; the heading entries carry {{level}}. */
  labelKey: string;
  level?: number;
  /** Style preview sample, on the role-named text scale. */
  previewClass: string;
}

const HEADING_PREVIEWS = [
  { id: "heading-1", level: 1, previewClass: "text-title-lg font-semibold" },
  { id: "heading-2", level: 2, previewClass: "text-title font-semibold" },
  { id: "heading-3", level: 3, previewClass: "text-title-sm font-semibold" },
  { id: "heading-4", level: 4, previewClass: "text-body font-semibold" },
  { id: "heading-5", level: 5, previewClass: "text-body font-semibold" },
  { id: "heading-6", level: 6, previewClass: "text-body font-semibold" },
] as const satisfies readonly { id: DocxGalleryStyleId; level: number; previewClass: string }[];

export const DOCX_STYLES_GALLERY: readonly DocxGalleryStyle[] = [
  { id: "normal", labelKey: "office.docx.styles.normal", previewClass: "text-body" },
  ...HEADING_PREVIEWS.map((entry) => ({
    id: entry.id,
    labelKey: "office.docx.styles.heading",
    level: entry.level,
    previewClass: entry.previewClass,
  })),
  { id: "title", labelKey: "office.docx.styles.title", previewClass: "text-display-sm font-semibold" },
  { id: "quote", labelKey: "office.docx.styles.quote", previewClass: "text-body italic" },
];

/** The w:pStyle an entry maps to; null = no direct style (Normal / headings). */
export function galleryStyleId(style: DocxGalleryStyleId): "Title" | "Quote" | null {
  if (style === "title") return "Title";
  if (style === "quote") return "Quote";
  return null;
}

export function headingLevelFor(style: DocxGalleryStyleId): number | null {
  const match = /^heading-([1-6])$/.exec(style);
  return match ? Number(match[1]) : null;
}

/**
 * The gallery entry a block matches. Headings read by level (a custom heading
 * style still counts as its level); paragraphs and list items read by their
 * direct style id — an unknown custom style has no gallery entry.
 */
export function resolveGalleryStyle(
  typeName: string,
  level: number | null,
  styleId: string | null,
): DocxGalleryStyleId | null {
  if (typeName === "docHeading") {
    if (level === null || !Number.isInteger(level) || level < 1 || level > 6) return null;
    return `heading-${level}` as DocxGalleryStyleId;
  }
  if (typeName !== "docParagraph" && typeName !== "docListItem") return null;
  if (styleId === null) return "normal";
  const normalized = styleId.trim().toLowerCase();
  if (normalized === "normal") return "normal";
  if (normalized === "title") return "title";
  if (normalized === "quote") return "quote";
  return null;
}
