"use client";

import { useEffect, useMemo } from "react";
import { useOrgMembers } from "@uniwork/core/organizations";
import type { OrgMember } from "@uniwork/core/types/people";

/**
 * Upper bound on member pages the share dialog walks (50 per page). An
 * organization tops out around 1,000 people, so this covers every one of them
 * and still stops a server that keeps answering with a cursor.
 */
const MAX_MEMBER_PAGES = 40;

/**
 * Why the member set is not whole: `first` = no page arrived, `partial` = a
 * later page failed (the walk stopped there), `limit` = the page bound was hit
 * with a cursor left. Only the first two can be retried.
 */
export type ShareMembersError = "first" | "partial" | "limit";

/**
 * Every active organization member for the share dialog (UNI-1641 TV-3). The
 * members route has no search parameter, so while the dialog is open the
 * remaining pages load one after another; the picker, the already-shared
 * marking and every name lookup read the whole set. `loading` stays true
 * until the last page is in, so a name that is not there yet is still coming.
 * A failed page stops the walk and surfaces as `error`; `retry` resumes it
 * from the failed page and keeps the members already loaded.
 */
export function useShareMembers(orgSlug: string, open: boolean) {
  const members = useOrgMembers(orgSlug);
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, refetch } = members;
  const pageCount = data?.pages.length ?? 0;
  const atLimit = hasNextPage && pageCount >= MAX_MEMBER_PAGES;
  const more = open && hasNextPage && !isFetchNextPageError && !atLimit;

  // pageCount is a dependency because a page can land between two renders, so
  // neither `more` nor `isFetchingNextPage` would change and the walk would stall.
  useEffect(() => {
    if (more && !isFetchingNextPage) void fetchNextPage();
  }, [more, isFetchingNextPage, pageCount, fetchNextPage]);

  const rows = useMemo<OrgMember[]>(() => data?.pages.flatMap((page) => page.members) ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((m) => [m.user_id, m])), [rows]);

  // A refetch of a failed first page flips the query back to pending; the
  // earlier failure (errorUpdatedAt) keeps the line up until the page lands.
  const firstPageFailed = !data && (members.isError || (members.isFetching && members.errorUpdatedAt > 0));
  const error: ShareMembersError | null = firstPageFailed
    ? "first"
    : isFetchNextPageError
      ? "partial"
      : atLimit
        ? "limit"
        : null;

  return {
    rows,
    loading: members.isPending || more,
    /** A name that is missing may sit on a page not loaded yet: not "unknown". */
    namesPending: members.isPending || more || error === "first" || error === "partial",
    error,
    /** A retry is under way; the error line stays so the button can show it. */
    retrying: error === "first" ? members.isFetching : isFetchingNextPage && isFetchNextPageError,
    retry: () => {
      void (error === "first" ? refetch() : fetchNextPage());
    },
    /** The member's name (else email), or undefined while unknown. */
    nameOf: (userId: string) => {
      const member = byId.get(userId);
      return member?.display_name || member?.email || undefined;
    },
  };
}
