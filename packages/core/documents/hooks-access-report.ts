"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getDocumentAccessReport } from "../api/endpoints/documents-access-report";
import type { AccessReportFilters } from "../types/document-access-report";
import { documentKeys } from "./keys";

// Document access report hook (UNI-1643): the report pages on the server's
// keyset cursor, so it is an infinite query. The key carries the workspace,
// the folder and the normalized filters, and hangs off the workspace root, so
// a `document.*` realtime frame refreshes an open report too.

const ACCESS_REPORT_PAGE_SIZE = 50;

export function useDocumentAccessReport(
  wsId: string,
  folderId: string | undefined,
  filters: AccessReportFilters,
  opts?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: documentKeys.accessReport(wsId, folderId, filters),
    queryFn: async ({ pageParam, signal }) => {
      const page = await getDocumentAccessReport(
        wsId,
        { ...filters, folderId, cursor: pageParam || undefined, limit: ACCESS_REPORT_PAGE_SIZE },
        signal,
      );
      // A body that is not a report is an error, never an empty report: an
      // empty one would read as "nobody has access to anything".
      if (!page) throw new Error("document_access_report_invalid");
      return page;
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}
