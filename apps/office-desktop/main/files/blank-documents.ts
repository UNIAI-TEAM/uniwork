import { desktopUntitledName, type DesktopDocumentFormat } from "../../shared/document-formats";
import { blankDocxBytes } from "./blank-docx";
import { blankPdfBytes } from "./blank-pdf";

/** Blank-document generators keyed by the shared format table. A format with
 * no generator yet cannot be created through IPC (see the create handlers). */
const BLANK_GENERATORS: Partial<Record<DesktopDocumentFormat, () => Uint8Array>> = {
  docx: blankDocxBytes,
  pdf: blankPdfBytes,
};

export function blankDocumentBytes(format: DesktopDocumentFormat): Uint8Array {
  const generate = BLANK_GENERATORS[format];
  if (!generate) throw new Error("document_format_unbound");
  return generate();
}

export function blankDocumentName(format: DesktopDocumentFormat): string {
  return desktopUntitledName(format);
}
