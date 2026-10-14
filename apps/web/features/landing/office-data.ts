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

/** "From a task to a finished file": each card names the editor it starts in. */
export const OFFICE_TASKS = [
  { key: "draft", editor: "docs" },
  { key: "data", editor: "sheets" },
  { key: "slides", editor: "slides" },
  { key: "pdf", editor: "pdf" },
  { key: "html", editor: "html" },
  { key: "notes", editor: "markdown" },
] as const satisfies readonly { key: string; editor: OfficeEditorKey }[];

export const OFFICE_EDITOR_ANCHOR = "office-editors";
export const OFFICE_BUSINESS_ANCHOR = "office-business";

/** Product captures are localized and have an explicit dark UI variant. */
export function officeShotSrc(editor: OfficeEditorKey, language: string, theme: "light" | "dark" = "light"): string {
  return `/landing/office/${editor}.${language.toLowerCase().startsWith("vi") ? "vi" : "en"}${theme === "dark" ? ".dark" : ""}.webp`;
}
