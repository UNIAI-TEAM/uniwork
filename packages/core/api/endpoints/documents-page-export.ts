import { requestDownload } from "../http";

export type PageExportFormat = "docx" | "pdf";

/** POST /api/v1/documents/{documentID}/export (UNI-2004): a UniNote page as
 *  DOCX or PDF, rendered by the Office engine and answered as the file.
 *  `filename` is the server's (the page title), or null when the browser
 *  cannot read it. A file document answers 422 `page_export_not_page`. */
export function exportDocumentPage(
  documentId: string,
  format: PageExportFormat,
): Promise<{ blob: Blob; filename: string | null }> {
  return requestDownload(`/api/v1/documents/${encodeURIComponent(documentId)}/export`, {
    method: "POST",
    body: { format },
  });
}
