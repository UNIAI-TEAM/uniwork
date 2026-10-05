import type { PdfAnnotationOperationProvider, PdfAnnotationOperationSubmitter, PdfDeleteSavedAnnotOperation, PdfSavedAnnotationIdentity } from "./types";

/** Build a browser-safe annotation provider. The view emits identity only;
 * serialization and PDF mutation remain in the host submitter.
 *
 * Unlike the drawing provider there is no displayed→original page mapping:
 * a saved annotation's `pageIndex` is the original 0-based file index, so the
 * host must supply it as-is. The engine echo-guards a mismatched index rather
 * than deleting the wrong annotation, but mapping a displayed page number in
 * here would still be wrong. */
export function createPdfAnnotationOperationProvider(submitter: PdfAnnotationOperationSubmitter): PdfAnnotationOperationProvider {
  return {
    async deleteSavedAnnot(input: PdfSavedAnnotationIdentity) {
      const operation: PdfDeleteSavedAnnotOperation = { op: "deleteSavedAnnot", attributes: input };
      await submitter.submit([operation]);
    },
  };
}
