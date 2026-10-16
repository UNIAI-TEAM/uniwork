import { CodeXml, FileCodeCorner, FileSpreadsheet, FileText, FileTypeCorner, Presentation, type LucideIcon } from "lucide-react";

/** The six editors, in the order the page presents them. */
export const OFFICE_EDITOR_KEYS = ["docs", "sheets", "slides", "pdf", "html", "markdown"] as const;
export type OfficeEditorKey = (typeof OFFICE_EDITOR_KEYS)[number];

export const OFFICE_EDITOR_ICONS: Record<OfficeEditorKey, LucideIcon> = {
  docs: FileText,
  sheets: FileSpreadsheet,
  slides: Presentation,
  pdf: FileTypeCorner,
  html: CodeXml,
  markdown: FileCodeCorner,
};

/** Each selected editor carries its own example instead of a second selector. */
export const OFFICE_EXAMPLES = {
  docs: "draft", sheets: "data", slides: "slides", pdf: "pdf", html: "html", markdown: "notes",
} as const satisfies Record<OfficeEditorKey, string>;

export const OFFICE_EDITOR_ANCHOR = "office-editors";
export const OFFICE_BUSINESS_ANCHOR = "office-business";

/** Product captures are localized and have an explicit dark UI variant. */
export function officeShotSrc(editor: OfficeEditorKey, language: string, theme: "light" | "dark" = "light"): string {
  return `/landing/office/${editor}.${language.toLowerCase().startsWith("vi") ? "vi" : "en"}${theme === "dark" ? ".dark" : ""}.webp`;
}
