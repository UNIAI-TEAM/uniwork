"use client";

import { useState, type CompositionEvent, type KeyboardEvent } from "react";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import type { DocumentSummary, DocumentTreeNode } from "@uniwork/core/types/document";
import { useDocumentList } from "@uniwork/core/documents/hooks-collections";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import { SHELVED_BY_SYSTEM } from "./documents-shelved-toolbar";
import { documentRow, type DocumentSummaryRow, type DocumentTypeFilter, type LibraryRow } from "./library-rows";

const MAX_VISIBLE_PATH_SEGMENTS = 2;
const MAX_VISIBLE_PATH_CHARS = 36;
const MAX_SEGMENT_CHARS = 24;

function truncateSegmentFromLeft(segment: string): string {
  if (segment.length <= MAX_SEGMENT_CHARS) return segment;
  return `…${segment.slice(-(MAX_SEGMENT_CHARS - 1)).trimStart()}`;
}

/**
 * Formats a document's ancestor path (root -> direct parent) for search result
 * rows and cards: truncates from the left ("… › Parent") when there are more
 * than two ancestors, a segment is long, or the joined text exceeds the cap,
 * while returning the full path for the `title` tooltip and screen-reader
 * announcement.
 */
export function formatSearchPath(
  path: { id: string; title: string }[] | undefined,
  rootLabel?: string,
): { display: string; full: string } {
  const segments = (path ?? []).map((item) => item.title.trim()).filter(Boolean);
  if (segments.length === 0) {
    if (!rootLabel) return { display: "", full: "" };
    return { display: rootLabel, full: rootLabel };
  }
  const full = segments.join(" › ");
  if (segments.length <= MAX_VISIBLE_PATH_SEGMENTS && full.length <= MAX_VISIBLE_PATH_CHARS) {
    return { display: full, full };
  }
  const capped = segments.map(truncateSegmentFromLeft);
  const tailSegments = capped.slice(-MAX_VISIBLE_PATH_SEGMENTS);
  const tail = tailSegments.join(" › ");
  if (segments.length === 1) {
    return { display: tail, full };
  }
  if (tail.length > MAX_VISIBLE_PATH_CHARS) {
    return { display: `… › ${tailSegments.at(-1)!}`, full };
  }
  return { display: `… › ${tail}`, full };
}

/** Match the 250ms debounce used by the command palette (search-command.tsx). */
const SEARCH_DEBOUNCE_MS = 250;

export interface UseDocumentsSearchOptions {
  types?: DocumentTypeFilter[];
  updatedBy?: string;
  updatedFrom?: string;
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
  const filterKey = `${(typeParam ?? []).join(",")}|${options?.updatedBy ?? ""}|${options?.updatedFrom ?? ""}`;

  const listQuery = useDocumentList(
    wsId,
    {
      q: debouncedQuery || undefined,
      match: "title",
      ...(typeParam ? { types: typeParam } : {}),
      ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
      ...(options?.updatedFrom ? { updatedFrom: options.updatedFrom } : {}),
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

export interface SearchViewState {
  rows: LibraryRow[];
  folders: DocumentTreeNode[];
  docById: Map<string, DocumentSummaryRow>;
  loading: boolean;
  failure: "error" | "permission" | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
  query: string;
  onClearSearch: () => void;
  searchPath: (doc: DocumentSummaryRow) => { display: string; full: string; srText: string } | null;
}

export function buildSearchViewState({
  search,
  searching,
  viewKind,
  libraryRows,
  starredIds,
  shelvedBy,
  tree,
  myFolderId,
  myFolderLabel,
  formatPathSr,
}: {
  search: UseDocumentsSearchResult;
  searching: boolean;
  viewKind: string;
  libraryRows: LibraryRow[];
  starredIds: ReadonlySet<string>;
  shelvedBy: string | null;
  tree: DocumentTreeNode[];
  myFolderId: string | null;
  myFolderLabel: string;
  formatPathSr: (full: string) => string;
}): SearchViewState | null {
  if (!searching) return null;
  const viewDocIds =
    viewKind === "home" || viewKind === "shelved"
      ? null
      : new Set(libraryRows.flatMap((row) => (row.type === "document" ? [row.doc.id] : [])));
  const items = search.items.filter((doc) => {
    if (viewKind === "shelved") {
      if (shelvedBy !== null && (doc.shelved_by ?? SHELVED_BY_SYSTEM) !== shelvedBy) return false;
      return true;
    }
    if (viewKind === "starred") {
      return starredIds.has(doc.id) || (viewDocIds?.has(doc.id) ?? false);
    }
    if (viewDocIds) {
      return viewDocIds.has(doc.id);
    }
    return true;
  });
  const rows = items.map(documentRow);
  const treeMap = new Map<string, DocumentTreeNode>();
  const walk = (nodes: DocumentTreeNode[]) => {
    for (const node of nodes) {
      treeMap.set(node.id, node);
      walk(node.children);
    }
  };
  walk(tree);
  const matchesMyFolderLabel =
    viewKind === "home" &&
    Boolean(myFolderId) &&
    Boolean(search.committedQuery) &&
    myFolderLabel.toLocaleLowerCase().includes(search.committedQuery.toLocaleLowerCase());
  const folders: DocumentTreeNode[] = items
    .filter((doc) => doc.kind === "folder")
    .map((doc) => {
      const node = treeMap.get(doc.id);
      return (
        node ?? {
          id: doc.id,
          title: doc.title,
          kind: "folder",
          position: doc.position,
          system_kind: doc.system_kind,
          is_empty: doc.is_empty,
          children: [],
        }
      );
    });
  if (
    matchesMyFolderLabel &&
    myFolderId &&
    !folders.some((node) => node.id === myFolderId)
  ) {
    const myNode = treeMap.get(myFolderId);
    if (myNode) {
      folders.unshift(myNode);
    }
  }
  const docById = new Map<string, DocumentSummaryRow>(
    items.map((doc): [string, DocumentSummaryRow] => [doc.id, doc]),
  );
  const failure = search.isError
    ? classifyDocumentError(search.error).cls === "permission"
      ? "permission"
      : "error"
    : null;
  const searchPath = (doc: DocumentSummaryRow) => {
    const rawPath = doc.path ?? [];
    if (rawPath.length === 0) return null;
    const mapped = rawPath.map((seg) =>
      myFolderId && seg.id === myFolderId ? { ...seg, title: myFolderLabel } : seg,
    );
    const formatted = formatSearchPath(mapped);
    if (!formatted.display) return null;
    return { ...formatted, srText: formatPathSr(formatted.full) };
  };
  return {
    rows,
    folders,
    docById,
    loading: search.loading,
    failure,
    hasMore: search.hasMore,
    loadingMore: search.loadingMore,
    loadMore: search.loadMore,
    refetch: search.retry,
    query: search.committedQuery,
    onClearSearch: search.clear,
    searchPath,
  };
}
