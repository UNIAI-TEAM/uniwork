import { PdfOpsBridgeError } from "./ops-bridge";

/** i18n key for a failed edit. The engine's own message is never shown: it is
 * English, may name internals, and says nothing a user can act on. The checks
 * are structural so the browser engine's typed errors (`PdfOpError`,
 * `BrowserPdfUnsupportedError`) are recognised without importing the engine. */
export function pdfEditErrorKey(error: unknown): string {
  if (error instanceof PdfOpsBridgeError) {
    return error.code === "unsupported_operation" ? "office.pdf.errors.unsupportedInBrowser" : "office.pdf.errors.editFailed";
  }
  if (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === "unsupported_in_browser") return "office.pdf.errors.unsupportedInBrowser";
    if ("name" in error && error.name === "PdfOpError") return "office.pdf.errors.editRejected";
  }
  return "office.pdf.errors.editFailed";
}
