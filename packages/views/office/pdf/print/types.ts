/** Why a print attempt failed. The web host answers with the browser dialog;
 * a desktop host will answer with its own print pipeline later (C1). */
export type PdfPrintFailureCode = "unavailable" | "failed";

export class PdfPrintError extends Error {
  readonly code: PdfPrintFailureCode;

  constructor(code: PdfPrintFailureCode, message?: string) {
    super(message ?? `PDF print failed: ${code}`);
    this.name = "PdfPrintError";
    this.code = code;
  }
}

/** The host print seam. The browser implementation prints the document
 * surface through the native dialog; views never own the print pipeline. */
export interface PdfPrintPort {
  printSurface(surface: HTMLElement): Promise<void> | void;
}
