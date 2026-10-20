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
 * The data of the "Đính kèm từ Tài liệu" picker: the recent documents while
 * the box is empty, a title search once something is typed, both cut down to
 * the rows the sender may share. Nothing is fetched while the dialog is
 * closed, and the term is dropped when it closes.
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

  const recent = useRecentDocuments(workspaceId, { enabled: open && !searching });
  const search = useDocumentList(
    workspaceId,
    { q: settled || undefined, match: "title", kind: "document" },
    { enabled: open && searching && !settling },
  );
  const active = searching ? search : recent;

  const rows = useMemo<ChatPickerDocument[]>(
    () => (active.data?.pages ?? []).flatMap((page) => page.documents).filter(canShareDocumentForChat),
    [active.data],
  );

  const hasNextPage = Boolean(active.hasNextPage);
  const { fetchNextPage, isFetchingNextPage } = active;
  // A page can hold nothing the sender may share while later ones do: keep
  // reading until a row shows or the list ends, so "nothing to send" is true.
  const readingOn = !settling && !active.isPending && !active.isError && rows.length === 0 && hasNextPage;
  useEffect(() => {
    if (readingOn && !isFetchingNextPage) void fetchNextPage();
  }, [readingOn, isFetchingNextPage, fetchNextPage]);

  return {
    query,
    setQuery,
    rows,
    isLoading: (searching ? settling || search.isPending : recent.isPending) || readingOn,
    isError: !settling && active.isError,
    refetch: () => void active.refetch(),
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
  };
}
