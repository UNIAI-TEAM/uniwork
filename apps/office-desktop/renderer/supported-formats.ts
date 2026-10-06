import { DESKTOP_DOCUMENT_FORMATS, type DesktopDocumentFormat } from "../shared/document-formats";

/** The one list the library copy names: the empty state and the unsupported-file
 * toast both read it, so they cannot disagree about what opens. Order is how
 * people say it (Office trio first); the test pins it to the format table. */
export const SUPPORTED_FORMAT_ORDER: readonly DesktopDocumentFormat[] = ["docx", "xlsx", "pptx", "pdf", "md", "html"];

const FORMAT_LABELS: Partial<Record<DesktopDocumentFormat, string>> = { md: "Markdown" };

/** "DOCX, XLSX, PPTX, PDF, Markdown và HTML" — joined by the locale's own list rules. */
export function supportedFormatsLabel(language: string): string {
  const labels = SUPPORTED_FORMAT_ORDER.filter((format) => DESKTOP_DOCUMENT_FORMATS.includes(format)).map((format) => FORMAT_LABELS[format] ?? format.toUpperCase());
  return new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(labels);
}
