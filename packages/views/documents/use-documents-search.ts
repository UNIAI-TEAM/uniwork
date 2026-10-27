"use client";

import { useRef, useState, type CompositionEvent, type KeyboardEvent, type RefObject } from "react";
import type { DocumentSummary } from "@uniwork/core/types/document";
import { useDocumentList } from "@uniwork/core/documents/hooks-collections";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import type { DocumentTypeFilter } from "./library-rows";

/** Match the 250ms debounce used by the command palette (search-command.tsx). */
const SEARCH_DEBOUNCE_MS = 250;

export interface UseDocumentsSearchOptions {
  types?: DocumentTypeFilter[];
  updatedBy?: string;
  updatedFrom?: string;
  shelved?: boolean;
  sharedByMe?: boolean;
}

export interface UseDocumentsSearchResult {
  query: string;
  committedQuery: string;
  active: boolean;
  composing: boolean;
  items: DocumentSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: unknown;
  isError: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  focusInput: () => void;
  onQueryChange: (value: string, isComposing?: boolean) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  clear: () => void;
  loadMore: () => void;
  retry: () => void;
}

export function useDocumentsSearch(
  wsId: string,
  enabled: boolean,
  options?: UseDocumentsSearchOptions,
): UseDocumentsSearchResult {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [composing, setComposing] = useState(false);

  // Reset search state if the workspace changes.
  const [queriedWsId, setQueriedWsId] = useState(wsId);
  if (wsId !== queriedWsId) {
    setQueriedWsId(wsId);
    setQuery("");
    setCommittedQuery("");
    setComposing(false);
  }

  const trimmedCommitted = committedQuery.trim();
  const debouncedQuery = useDebouncedValue(trimmedCommitted, SEARCH_DEBOUNCE_MS);
  const active = trimmedCommitted.length >= 1;
  const queryEnabled = enabled && active && debouncedQuery.length >= 1;
  const typeParam = options?.types && options.types.length > 0 ? options.types : undefined;
  const filterKey = [
    (typeParam ?? []).join(","),
    options?.updatedBy ?? "",
    options?.updatedFrom ?? "",
    options?.shelved ? "shelved" : "",
    options?.sharedByMe ? "sharedByMe" : "",
  ].join("|");

  const listQuery = useDocumentList(
    wsId,
    {
      q: debouncedQuery || undefined,
      match: "title",
      ...(typeParam ? { types: typeParam } : {}),
      ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
      ...(options?.updatedFrom ? { updatedFrom: options.updatedFrom } : {}),
      ...(options?.shelved ? { shelved: true } : {}),
      ...(options?.sharedByMe ? { sharedByMe: true } : {}),
    },
    { enabled: queryEnabled },
  );

  const fetchedItems: DocumentSummary[] | null =
    queryEnabled && listQuery.data
      ? (listQuery.data.pages.flatMap((page) => page.documents) as DocumentSummary[])
      : null;

  const [previousItems, setPreviousItems] = useState<DocumentSummary[]>([]);
  const [lastData, setLastData] = useState<typeof listQuery.data>(undefined);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (!active || wsId !== queriedWsId) {
    if (previousItems.length > 0) setPreviousItems([]);
    if (lastData !== undefined) setLastData(undefined);
    if (lastFilterKey !== filterKey) setLastFilterKey(filterKey);
  } else if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPreviousItems([]);
    setLastData(listQuery.data);
  } else if (listQuery.data !== undefined && listQuery.data !== lastData) {
    setLastData(listQuery.data);
    setPreviousItems(fetchedItems ?? []);
  }

  const items: DocumentSummary[] = !active
    ? []
    : (fetchedItems ?? (listQuery.isError || filterKey !== lastFilterKey ? [] : previousItems));

  const clear = () => {
    setQuery("");
    setCommittedQuery("");
    setComposing(false);
    setPreviousItems([]);
    setLastData(undefined);
  };

  const focusInput = () => {
    inputRef.current?.focus();
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
    inputRef,
    focusInput,
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
