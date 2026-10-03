import type { PdfAnnotationOperationProvider, PdfAnnotationOperationSubmitter, PdfDeleteSavedAnnotOperation, PdfSavedAnnotationIdentity } from "./types";

/** Build a browser-safe annotation provider. The view emits identity only;
 * serialization and PDF mutation remain in the host submitter. */
export function createPdfAnnotationOperationProvider(submitter: PdfAnnotationOperationSubmitter): PdfAnnotationOperationProvider {
  return {
    async deleteSavedAnnot(input: PdfSavedAnnotationIdentity) {
      const operation: PdfDeleteSavedAnnotOperation = { op: "deleteSavedAnnot", attributes: input };
      await submitter.submit([operation]);
    },
  };
}
