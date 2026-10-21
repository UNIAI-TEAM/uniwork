"use client";

import { useEffect, useMemo, useState } from "react";
import { useDocumentList, useRecentDocuments } from "@uniwork/core/documents/hooks-collections";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import type { DocumentList } from "@uniwork/core/types/document";
import { canShareDocumentForChat } from "./chat-document-share-gate";

/** One row of the library lists the picker reads. */
export type ChatPickerDocument = DocumentList["documents"][number];

/** The query only runs once the typing stops (the same beat as the command palette). */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Pages read ahead while none of them holds a row the sender may share. The
 * server's `access=manage` filter is not used: it leaves out `admin_scope`
 * rows (restricted documents an owner/admin reaches only by role), which the
 * picker lists, so the client gate stays the filter and this cap bounds it.
 */
const MAX_READ_AHEAD_PAGES = 5;

/**
 * The data of the "Đính kèm từ Tài liệu" picker: the recent documents (plus
 * the ones the sender owns) while the box is empty, a title search once
 * something is typed, both cut down to the rows the sender may share. Nothing
 * is fetched while the dialog is closed, and the term is dropped when it closes.
 */
export function useChatDocumentPicker(workspaceId: string, open: boolean) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const trimmed = query.trim();
  const settled = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const searching = trimmed.length > 0;
  // Typed but not yet settled: the old answer must not stand for the new term.
  const settling = trimmed !== settled;

  // includeOwned: a document the sender owns stays in the list after somebody
  // else edits it, which ends their own open/edit on it.
  const recent = useRecentDocuments(workspaceId, { enabled: open && !searching, includeOwned: true });
  const search = useDocumentList(
    workspaceId,
    { q: settled || undefined, match: "title", kind: "document" },
    { enabled: open && searching && !settling },
  );
  const active = searching ? search : recent;

  const { rows, pageCount, lastPageRows } = useMemo(() => {
    const perPage = (active.data?.pages ?? []).map((page) => page.documents.filter(canShareDocumentForChat));
    return { rows: perPage.flat(), pageCount: perPage.length, lastPageRows: perPage.at(-1)?.length ?? 0 };
  }, [active.data]);

  const hasNextPage = Boolean(active.hasNextPage);
  const { fetchNextPage, isFetchingNextPage } = active;
  // A page can hold nothing the sender may share while later ones do: keep
  // reading until a row shows, the list ends or the cap is reached.
  const readingOn =
    !settling && !active.isPending && !active.isError && rows.length === 0 && hasNextPage && pageCount < MAX_READ_AHEAD_PAGES;
  // pageCount is a dependency on purpose: a page that lands before the
  // fetching flag was ever seen true (a fast or cached answer) would not
  // re-run the effect on the flag alone, and the read-ahead would stall.
  useEffect(() => {
    if (readingOn && !isFetchingNextPage) void fetchNextPage();
  }, [readingOn, isFetchingNextPage, fetchNextPage, pageCount]);

  return {
    query,
    setQuery,
    rows,
    isLoading: (searching ? settling || search.isPending : recent.isPending) || readingOn,
    isError: !settling && active.isError,
    refetch: () => void active.refetch(),
    // "Xem thêm" only while the last page added a row: a click on a page that
    // adds nothing would look dead.
    hasNextPage: hasNextPage && lastPageRows > 0,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
  };
}
