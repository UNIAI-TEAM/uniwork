"use client";

import { useState, type CompositionEvent, type KeyboardEvent } from "react";
import type { DocumentSummary } from "@uniwork/core/types/document";
import { useDocumentList } from "@uniwork/core/documents/hooks-collections";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";

export const DOCUMENT_SEARCH_FILTERS = ["all", "folder", "document"] as const;
export type DocumentSearchFilter = (typeof DOCUMENT_SEARCH_FILTERS)[number];

/** Match the 250ms debounce used by the command palette (search-command.tsx). */
const SEARCH_DEBOUNCE_MS = 250;

export interface UseDocumentsSearchResult {
  query: string;
  committedQuery: string;
  filter: DocumentSearchFilter;
  active: boolean;
  composing: boolean;
  items: DocumentSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: unknown;
  isError: boolean;
  setFilter: (next: DocumentSearchFilter) => void;
  onQueryChange: (value: string, isComposing?: boolean) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  clear: () => void;
  loadMore: () => void;
  retry: () => void;
}

export function useDocumentsSearch(wsId: string, enabled: boolean): UseDocumentsSearchResult {
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState<DocumentSearchFilter>("all");

  // Reset search state if the workspace changes.
  const [queriedWsId, setQueriedWsId] = useState(wsId);
  if (wsId !== queriedWsId) {
    setQueriedWsId(wsId);
    setQuery("");
    setCommittedQuery("");
    setComposing(false);
    setFilter("all");
  }

  const trimmedCommitted = committedQuery.trim();
  const debouncedQuery = useDebouncedValue(trimmedCommitted, SEARCH_DEBOUNCE_MS);
  const active = trimmedCommitted.length >= 1;
  const queryEnabled = enabled && active && debouncedQuery.length >= 1;

  const listQuery = useDocumentList(
    wsId,
    {
      q: debouncedQuery || undefined,
      match: "title",
      kind: filter === "all" ? undefined : filter,
    },
    { enabled: queryEnabled },
  );

  const fetchedItems: DocumentSummary[] | null =
    queryEnabled && listQuery.data
      ? (listQuery.data.pages.flatMap((page) => page.documents) as DocumentSummary[])
      : null;

  const [previousItems, setPreviousItems] = useState<DocumentSummary[]>([]);
  const [lastData, setLastData] = useState<typeof listQuery.data>(undefined);
  if (!active || wsId !== queriedWsId) {
    if (previousItems.length > 0) setPreviousItems([]);
    if (lastData !== undefined) setLastData(undefined);
  } else if (listQuery.data !== undefined && listQuery.data !== lastData) {
    setLastData(listQuery.data);
    setPreviousItems(fetchedItems ?? []);
  }

  const items: DocumentSummary[] = !active
    ? []
    : (fetchedItems ?? (listQuery.isError ? [] : previousItems));

  const clear = () => {
    setQuery("");
    setCommittedQuery("");
    setComposing(false);
    setPreviousItems([]);
    setLastData(undefined);
  };

  const onQueryChange = (value: string, nativeComposing?: boolean) => {
    setQuery(value);
    if (!composing && !nativeComposing) {
      setCommittedQuery(value);
    }
  };

  const onCompositionStart = () => {
    setComposing(true);
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    setComposing(false);
    const nextValue = event.currentTarget.value;
    setQuery(nextValue);
    setCommittedQuery(nextValue);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (composing || event.nativeEvent.isComposing) return;
      if (query.length > 0 || committedQuery.length > 0) {
        event.preventDefault();
        clear();
      }
    }
  };

  return {
    query,
    committedQuery: trimmedCommitted,
    filter,
    active,
    composing,
    items,
    loading:
      active &&
      items.length === 0 &&
      (debouncedQuery !== trimmedCommitted || listQuery.isPending),
    loadingMore: listQuery.isFetchingNextPage,
    hasMore: Boolean(listQuery.hasNextPage),
    error: listQuery.error,
    isError: queryEnabled && listQuery.isError,
    setFilter,
    onQueryChange,
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
    clear,
    loadMore: () => {
      if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
        void listQuery.fetchNextPage();
      }
    },
    retry: () => {
      void listQuery.refetch();
    },
  };
}
