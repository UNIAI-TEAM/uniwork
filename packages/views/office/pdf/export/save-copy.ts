import { downloadPdfBytes, pdfCopyFileName } from "./download";
import { PdfExportError, type PdfSaveCopyRequest } from "./types";

/** Download the host's current PDF bytes as "<name>.pdf". The host owns the
 * bytes and the view never serializes: a host wires this control only once it
 * can answer PdfOutputPort.readOutputBytes() from the engine serialize path
 * (follow-up: the web/desktop host adapter exposes the serialized output; the
 * browser save coordinator's transport discards it after upload today). */
export async function savePdfCopy(request: PdfSaveCopyRequest): Promise<string> {
  const bytes = await request.output.readOutputBytes();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new PdfExportError("empty_output", "The host returned no PDF bytes");
  }
  const filename = pdfCopyFileName(request.fileBaseName);
  await (request.download ?? downloadPdfBytes)(bytes, filename);
  return filename;
}
