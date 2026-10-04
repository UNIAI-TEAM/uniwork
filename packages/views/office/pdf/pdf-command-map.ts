/** Stable command identifiers used by the PDF toolbar and capability map. */
export const PDF_COMMANDS = {
  undo: "undo",
  redo: "redo",
  editText: "edit-text",
  replaceImage: "replace-image",
  insertPage: "insert-page",
  deletePage: "delete-page",
  rotatePage: "rotate-page",
  reorderPage: "reorder-page",
  extractPage: "extract-page",
  mergePages: "merge-pages",
  annotations: "annotations",
  highlight: "highlight",
  note: "note",
  stamp: "stamp",
  forms: "forms",
  save: "save",
} as const;

export type PdfCommandId = (typeof PDF_COMMANDS)[keyof typeof PDF_COMMANDS];

/** The UI maps each command to a capability row; this keeps annotation and
 * content editing distinct even when the provider supports only one of them. */
export const PDF_COMMAND_CAPABILITIES: Readonly<Record<keyof typeof PDF_COMMANDS, string>> = {
  undo: "CAP-pdf-edit-text-in-place",
  redo: "CAP-pdf-edit-text-in-place",
  editText: "CAP-pdf-edit-text-in-place",
  replaceImage: "CAP-pdf-edit-image",
  insertPage: "CAP-pdf-page-ops",
  deletePage: "CAP-pdf-page-ops",
  rotatePage: "CAP-pdf-page-ops",
  reorderPage: "CAP-pdf-page-ops",
  extractPage: "CAP-pdf-page-ops",
  mergePages: "CAP-pdf-page-ops",
  annotations: "CAP-pdf-annotations-stamps",
  highlight: "CAP-pdf-annotations-stamps",
  note: "CAP-pdf-annotations-stamps",
  stamp: "CAP-pdf-annotations-stamps",
  forms: "CAP-pdf-annotations-stamps",
  save: "CAP-pdf-save",
};

/** Commands the browser host cannot run: content-stream rewrites (edit text,
 * replace image) and the Buffer-based page producers (insert from another PDF,
 * extract, merge). The browser routes engine envelopes to
 * `applyPdfOpsInBrowser`, which refuses each with `BrowserPdfUnsupportedError`,
 * so a handle that renders pages in-process (`renderer`) must disable them
 * instead of opening a panel that then fails. Rotate, delete, reorder and the
 * annotate commands need no content rewrite and stay available. */
const BROWSER_UNSUPPORTED_COMMANDS: ReadonlySet<PdfCommandId> = new Set([
  PDF_COMMANDS.editText,
  PDF_COMMANDS.replaceImage,
  PDF_COMMANDS.insertPage,
  PDF_COMMANDS.extractPage,
  PDF_COMMANDS.mergePages,
]);

/** i18n key a browser-disabled command carries so the disabled control says why
 * instead of doing nothing. */
export const PDF_BROWSER_UNSUPPORTED_REASON_KEY = "office.pdf.errors.unsupportedInBrowser";

/** The i18n reason a command is disabled on the browser lane, or undefined when
 * the command runs on this handle. */
export function pdfCommandDisabledReason(id: PdfCommandId, browserLane: boolean): string | undefined {
  return browserLane && BROWSER_UNSUPPORTED_COMMANDS.has(id) ? PDF_BROWSER_UNSUPPORTED_REASON_KEY : undefined;
}
