import {
  AccessReportPrincipalsSchema,
  AccessReportSummaryTotalsSchema,
  DocumentAccessReportSchema,
  type AccessReportExportFormat,
  type AccessReportFilters,
  type AccessReportPrincipals,
  type AccessReportPrincipalsQuery,
  type AccessReportQuery,
  type AccessReportSummaryTotals,
  type DocumentAccessReport,
} from "../../types/document-access-report";
import { request, requestDownload } from "../http";
import { parseWithFallback } from "../schema";

// Document access report endpoints (UNI-1643, read-only): who holds which
// level on every document the caller manages in a workspace or one folder,
// one page at a time, and the same rows as one CSV/XLSX file. The server
// builds the file; this module only fetches it. UNI-2039 adds the whole-scope
// summary (tiles) and the per-principal totals; every filter param is sent
// only when set, so an older server sees the request it always saw.

const enc = encodeURIComponent;

// The server rejects a `q` longer than this many characters (runes).
const MAX_QUERY_CHARS = 100;

function searchText(q: string | undefined): string {
  return Array.from(q?.trim() ?? "").slice(0, MAX_QUERY_CHARS).join("").trim();
}

function filterParams(p: URLSearchParams, query: AccessReportFilters & { folderId?: string }): void {
  if (query.folderId) p.set("folder_id", query.folderId);
  if (query.personId) p.set("person_id", query.personId);
  if (query.levels && query.levels.length > 0) p.set("level", query.levels.join(","));
  if (query.visibility) p.set("visibility", query.visibility);
  const q = searchText(query.q);
  if (q) p.set("q", q);
  if (query.principal) p.set("principal", query.principal);
  if (query.scope) p.set("scope", query.scope);
  if (query.sources && query.sources.length > 0) p.set("source", query.sources.join(","));
  if (query.flag) p.set("flag", query.flag);
  if (query.nonDefault) p.set("non_default", "1");
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
  if (query.sort) p.set("sort", query.sort);
  if (query.order) p.set("order", query.order);
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

/** GET …/documents/access-report/summary — whole-scope totals for the tiles and
 *  the matching count. Null when the answer is not a summary. */
export async function getDocumentAccessReportSummary(
  wsId: string,
  query: AccessReportFilters & { folderId?: string } = {},
  signal?: AbortSignal,
): Promise<AccessReportSummaryTotals | null> {
  const p = new URLSearchParams();
  filterParams(p, query);
  const raw = await request(reportPath(wsId, "/summary", p), { signal });
  return parseWithFallback<AccessReportSummaryTotals | null>(raw, AccessReportSummaryTotalsSchema, null, {
    endpoint: "GET /api/v1/workspaces/{id}/documents/access-report/summary",
  });
}

/** GET …/documents/access-report/principals — one row per person or group
 *  holding access, no paging. Null when the answer is not a principal list. */
export async function getDocumentAccessReportPrincipals(
  wsId: string,
  query: AccessReportPrincipalsQuery = {},
  signal?: AbortSignal,
): Promise<AccessReportPrincipals | null> {
  const p = new URLSearchParams();
  if (query.folderId) p.set("folder_id", query.folderId);
  const q = searchText(query.q);
  if (q) p.set("q", q);
  if (query.kind) p.set("kind", query.kind);
  if (query.levels && query.levels.length > 0) p.set("level", query.levels.join(","));
  if (query.sort) p.set("sort", query.sort);
  if (query.order) p.set("order", query.order);
  const raw = await request(reportPath(wsId, "/principals", p), { signal });
  return parseWithFallback<AccessReportPrincipals | null>(raw, AccessReportPrincipalsSchema, null, {
    endpoint: "GET /api/v1/workspaces/{id}/documents/access-report/principals",
  });
}
