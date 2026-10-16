import {
  DocumentAccessReportSchema,
  type AccessReportExportFormat,
  type AccessReportFilters,
  type AccessReportQuery,
  type DocumentAccessReport,
} from "../../types/document-access-report";
import { request, requestDownload } from "../http";
import { parseWithFallback } from "../schema";

// Document access report endpoints (UNI-1643, read-only): who holds which
// level on every document the caller manages in a workspace or one folder,
// one page at a time, and the same rows as one CSV/XLSX file. The server
// builds the file; this module only fetches it.

const enc = encodeURIComponent;

function filterParams(p: URLSearchParams, query: AccessReportFilters & { folderId?: string }): void {
  if (query.folderId) p.set("folder_id", query.folderId);
  if (query.personId) p.set("person_id", query.personId);
  if (query.levels && query.levels.length > 0) p.set("level", query.levels.join(","));
  if (query.visibility) p.set("visibility", query.visibility);
}

function reportPath(wsId: string, suffix: string, p: URLSearchParams): string {
  const q = p.toString();
  return `/api/v1/workspaces/${enc(wsId)}/documents/access-report${suffix}${q ? `?${q}` : ""}`;
}

/** GET /api/v1/workspaces/{workspaceID}/documents/access-report — one page.
 *  Null when the answer is not a report; the caller shows an error, never a
 *  fabricated empty report. */
export async function getDocumentAccessReport(
  wsId: string,
  query: AccessReportQuery = {},
  signal?: AbortSignal,
): Promise<DocumentAccessReport | null> {
  const p = new URLSearchParams();
  filterParams(p, query);
  if (query.cursor) p.set("cursor", query.cursor);
  if (query.limit !== undefined) p.set("limit", String(query.limit));
  const raw = await request(reportPath(wsId, "", p), { signal });
  return parseWithFallback<DocumentAccessReport | null>(raw, DocumentAccessReportSchema, null, {
    endpoint: "GET /api/v1/workspaces/{id}/documents/access-report",
  });
}

/** GET /api/v1/workspaces/{workspaceID}/documents/access-report/export — the
 *  whole report as one file with the same filters. `filename` is the server's
 *  name for it, or null when the browser cannot read it. A report over the
 *  row cap answers 422 `access_report_too_large` before any byte. */
export function exportDocumentAccessReport(
  wsId: string,
  query: AccessReportFilters & { folderId?: string },
  format: AccessReportExportFormat,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null }> {
  const p = new URLSearchParams();
  filterParams(p, query);
  p.set("format", format);
  return requestDownload(reportPath(wsId, "/export", p), { signal });
}
