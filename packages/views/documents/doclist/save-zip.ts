import { downloadJobZip } from "@uniwork/core/api/endpoints/documents-download-jobs";

/** The name the zip is saved under when the server's name cannot be read (the server names it the same). */
const FALLBACK_ZIP_NAME = "documents.zip";

/**
 * Fetches the zip of a ready download job through the transport (the route is a bearer route, so a
 * plain link answers 401) and saves it through an object URL. Rejects with the transport's error.
 */
export async function saveJobZip(wsId: string, jobId: string): Promise<void> {
  const { blob, filename } = await downloadJobZip(wsId, jobId);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename ?? FALLBACK_ZIP_NAME;
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
