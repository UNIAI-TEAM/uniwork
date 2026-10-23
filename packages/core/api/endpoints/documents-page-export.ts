import { z } from "zod";
import { request, requestDownload } from "../http";
import { parseWithFallback } from "../schema";

export type PageExportFormat = "docx" | "pdf";

const PageExportFormatsSchema = z.object({
  formats: z.array(z.unknown()).transform((list) => list.filter((f): f is PageExportFormat => f === "docx" || f === "pdf")),
});

/** GET /api/v1/documents/{documentID}/export (follow-6): the formats the page
 *  export renders on this deployment - pdf only where the engine has the Docs
 *  renderer staged. null when the answer cannot be read. */
export async function getPageExportFormats(documentId: string): Promise<PageExportFormat[] | null> {
  const raw = await request(`/api/v1/documents/${encodeURIComponent(documentId)}/export`);
  return parseWithFallback<{ formats: PageExportFormat[] } | null>(raw, PageExportFormatsSchema, null, { endpoint: "getPageExportFormats" })?.formats ?? null;
}

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
