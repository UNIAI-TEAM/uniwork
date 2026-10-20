"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getDocumentAccessReport,
  getDocumentAccessReportPrincipals,
  getDocumentAccessReportSummary,
} from "../api/endpoints/documents-access-report";
import type {
  AccessReportFilters,
  AccessReportPrincipalsQuery,
  AccessReportSort,
} from "../types/document-access-report";
import { documentKeys } from "./keys";

// Document access report hooks (UNI-1643, UNI-2039): the report pages on the
// server's keyset cursor, so it is an infinite query. The key carries the
// workspace, the folder, the normalized filters and the sort, and hangs off the
// workspace root, so a `document.*` realtime frame refreshes an open report
// too. The summary (tiles, matching count) and the principals (by-person tab)
// are plain queries under the same root.

const ACCESS_REPORT_PAGE_SIZE = 50;

export function useDocumentAccessReport(
  wsId: string,
  folderId: string | undefined,
  params: AccessReportFilters & AccessReportSort,
  opts?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: documentKeys.accessReport(wsId, folderId, params),
    queryFn: async ({ pageParam, signal }) => {
      const page = await getDocumentAccessReport(
        wsId,
        { ...params, folderId, cursor: pageParam || undefined, limit: ACCESS_REPORT_PAGE_SIZE },
        signal,
      );
      // A body that is not a report is an error, never an empty report: an
      // empty one would read as "nobody has access to anything".
      if (!page) throw new Error("document_access_report_invalid");
      return page;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    // A filter or sort change keeps the rows on screen until the new first page
    // lands; another folder or workspace does not, so its title never sits on
    // the old rows.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === wsId &&
      previousQuery.queryKey[documentKeys.accessReportRoot(wsId).length] === (folderId ?? "")
        ? previous
        : undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** Whole-scope totals for the tiles and `matching_documents` for the filters. */
export function useDocumentAccessReportSummary(
  wsId: string,
  folderId: string | undefined,
  filters: AccessReportFilters,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: documentKeys.accessReportSummary(wsId, folderId, filters),
    queryFn: async ({ signal }) => {
      const summary = await getDocumentAccessReportSummary(wsId, { ...filters, folderId }, signal);
      // Garbage is an error the tiles show, never a row of zeros.
      if (!summary) throw new Error("document_access_report_summary_invalid");
      return summary;
    },
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** One row per person or group holding access, for the by-person tab. */
export function useDocumentAccessReportPrincipals(
  wsId: string,
  query: AccessReportPrincipalsQuery,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: documentKeys.accessReportPrincipals(wsId, query),
    queryFn: async ({ signal }) => {
      const out = await getDocumentAccessReportPrincipals(wsId, query, signal);
      if (!out) throw new Error("document_access_report_principals_invalid");
      return out;
    },
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}
