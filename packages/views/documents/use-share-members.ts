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
 * Every active organization member for the share dialog (UNI-1641 TV-3). The
 * members route has no search parameter, so while the dialog is open the
 * remaining pages load one after another; the picker, the already-shared
 * marking and every name lookup read the whole set. `loading` stays true
 * until the last page is in, so a name that is not there yet is still coming.
 */
export function useShareMembers(orgSlug: string, open: boolean) {
  const members = useOrgMembers(orgSlug);
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = members;
  const pageCount = data?.pages.length ?? 0;
  const more = open && hasNextPage && !isFetchNextPageError && pageCount < MAX_MEMBER_PAGES;

  useEffect(() => {
    if (more && !isFetchingNextPage) void fetchNextPage();
  }, [more, isFetchingNextPage, fetchNextPage]);

  const rows = useMemo<OrgMember[]>(() => data?.pages.flatMap((page) => page.members) ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((m) => [m.user_id, m])), [rows]);

  return {
    rows,
    loading: members.isPending || more,
    /** The member's name (else email), or undefined while unknown. */
    nameOf: (userId: string) => {
      const member = byId.get(userId);
      return member?.display_name || member?.email || undefined;
    },
  };
}
