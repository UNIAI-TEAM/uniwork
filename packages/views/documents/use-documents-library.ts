"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { documentKeys } from "@uniwork/core/documents/keys";
import { useDocumentFavorites } from "@uniwork/core/documents/hooks-favorites";
import {
  useDocumentList,
  useDocumentTree,
  useRecentDocuments,
  useSharedWithMe,
} from "@uniwork/core/documents/hooks-collections";
import { isEndpointMissing, useDocumentSources } from "@uniwork/core/documents/hooks-library";
import type { DocumentSourceType } from "@uniwork/core/documents/sources-schema";
import type { DocumentList, DocumentTreeNode } from "@uniwork/core/types/document";
import type { LibraryView } from "./documents-sidebar";
import {
  documentRow,
  indexTree,
  matchesChip,
  mergeNewestFirst,
  readFolderSort,
  sortFolderRows,
  sourceRow,
  writeFolderSort,
  type FolderInfo,
  type FolderSort,
  type LibraryRow,
  type TypeChip,
} from "./library-rows";
import { favoriteRow, knownDocuments } from "./starred-rows";

interface InfiniteLike<T> {
  data?: { pages: T[] };
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
}

export interface LibraryState {
  rows: LibraryRow[];
  loading: boolean;
  /** Set only when the failure leaves nothing on screen. */
  failure: "error" | "permission" | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

function failureOf(error: unknown): "error" | "permission" {
  return error && classifyDocumentError(error).cls === "permission" ? "permission" : "error";
}

function documentState(q: InfiniteLike<DocumentList>): LibraryState {
  const rows = (q.data?.pages.flatMap((page) => page.documents) ?? []).map(documentRow);
  return {
    rows,
    loading: q.isPending,
    failure: q.isError && rows.length === 0 ? failureOf(q.error) : null,
    hasMore: Boolean(q.hasNextPage),
    loadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
    refetch: () => void q.refetch(),
  };
}

const SOURCE_TYPES = new Set<string>(["docx", "xlsx", "pptx", "pdf", "md", "html"]);

export interface UseDocumentsLibraryInput {
  wsId: string;
  orgId: string;
  enabled: boolean;
  view: LibraryView;
  folderId: string | null;
  chip: TypeChip;
}

/**
 * Every server read behind the Documents home, and the rows the table shows
 * for the open view. Only the active view's queries run; the tree, the
 * favorites and the sources probe always do (the sidebar needs them).
 *
 * The home root merges the workspace documents with the files of the other
 * modules, newest first; "load more" asks both lists for their next page.
 * When the sources API answers 404/501 (not deployed) the merge is skipped and
 * the "Elsewhere" section is hidden — the page never fails because of it.
 */
export function useDocumentsLibrary({ wsId, orgId, enabled, view, folderId, chip }: UseDocumentsLibraryInput) {
  const home = view.kind === "home";
  const sourceType = SOURCE_TYPES.has(chip) ? (chip as DocumentSourceType) : undefined;
  const sourcesWanted = chip !== "page" && ((home && !folderId) || view.kind === "sources");
  const [sort, setSortState] = useState<FolderSort>(() => readFolderSort());
  const setSort = useCallback((next: FolderSort) => {
    setSortState(next);
    writeFolderSort(next);
  }, []);

  const queryClient = useQueryClient();
  const tree = useDocumentTree(wsId, undefined, { enabled });
  const favorites = useDocumentFavorites(orgId, { enabled: enabled && !!orgId });
  const listFilter = useMemo(
    () => ({
      ...(folderId ? { parentId: folderId } : {}),
      ...(chip === "page" ? { kind: "page" as const } : {}),
    }),
    [folderId, chip],
  );
  // The starred view reads the workspace root list too (the home root's own
  // cache entry when it was open), so starred rows get dates and editors.
  const homeQuery = useDocumentList(wsId, listFilter, { enabled: enabled && home });
  const rootQuery = useDocumentList(wsId, {}, { enabled: enabled && view.kind === "starred" });
  const archivedQuery = useDocumentList(wsId, { archived: true }, { enabled: enabled && view.kind === "archived" });
  const recentQuery = useRecentDocuments(wsId, { enabled: enabled && view.kind === "recent" });
  const sharedQuery = useSharedWithMe(wsId, { enabled: enabled && view.kind === "shared" });
  const sourceFilter = useMemo(
    () => ({
      ...(view.kind === "sources" && view.source ? { source: view.source } : {}),
      ...(sourceType ? { type: sourceType } : {}),
    }),
    [view, sourceType],
  );
  // Probe once even when the view does not list sources: the sidebar section
  // shows only after the API has answered.
  const sourcesQuery = useDocumentSources(wsId, sourceFilter, { enabled });
  const sourcesMissing = sourcesQuery.isError && isEndpointMissing(sourcesQuery.error);
  // Availability is "the API has answered for this workspace", not "the query
  // for the current chip has data": a chip change swaps the query key, and the
  // sidebar section must not unmount while the new one loads.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  if (Boolean(sourcesQuery.data) && !sourcesMissing && answeredFor !== wsId) setAnsweredFor(wsId);
  if (sourcesMissing && answeredFor === wsId) setAnsweredFor(null);
  const sourcesAvailable = !sourcesMissing && (Boolean(sourcesQuery.data) || answeredFor === wsId);

  const nodes: DocumentTreeNode[] = useMemo(() => tree.data?.documents ?? [], [tree.data]);
  const folderIndex: Map<string, FolderInfo> = useMemo(() => indexTree(nodes), [nodes]);
  const starred = useMemo(
    () => (favorites.data ?? []).filter((fav) => !fav.workspace_id || fav.workspace_id === wsId),
    [favorites.data, wsId],
  );

  // A cache read, not a subscription: recomputed when one of the lists above
  // answers (their data is the dependency) and not on every render.
  const known = useMemo(
    () =>
      view.kind === "starred"
        ? knownDocuments([[null, rootQuery.data], ...queryClient.getQueriesData({ queryKey: documentKeys.workspace(wsId) })])
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cache entries are read through getQueriesData; these answers are what change them
    [view.kind, queryClient, wsId, rootQuery.data, homeQuery.data, recentQuery.data, sharedQuery.data, archivedQuery.data, favorites.data],
  );

  const sourceRows = (sourcesQuery.data?.pages.flatMap((page) => page.items) ?? []).map(sourceRow);
  let state: LibraryState;
  switch (view.kind) {
    case "recent":
      state = documentState(recentQuery);
      break;
    case "shared":
      state = documentState(sharedQuery);
      break;
    case "archived":
      state = documentState(archivedQuery);
      break;
    case "starred": {
      // The root list is read through its hook so an answer re-renders the
      // view; other cached lists and details count too (read, never fetched).
      state = {
        rows: starred.map((fav) => documentRow(favoriteRow(fav, known?.get(fav.document_id)))),
        loading: favorites.isPending && !!orgId,
        failure: favorites.isError && !favorites.data ? failureOf(favorites.error) : null,
        hasMore: false,
        loadingMore: false,
        loadMore: () => undefined,
        refetch: () => void favorites.refetch(),
      };
      break;
    }
    case "sources":
      state = {
        rows: sourceRows,
        loading: sourcesQuery.isPending,
        failure: sourcesQuery.isError && sourceRows.length === 0 && !sourcesMissing ? "error" : null,
        hasMore: Boolean(sourcesQuery.hasNextPage),
        loadingMore: sourcesQuery.isFetchingNextPage,
        loadMore: () => void sourcesQuery.fetchNextPage(),
        refetch: () => void sourcesQuery.refetch(),
      };
      break;
    default: {
      const docs = documentState(homeQuery);
      if (folderId) {
        const directRows = docs.rows.filter(
          (row) => row.type === "document" && (row.doc.parent_id === undefined || row.doc.parent_id === folderId),
        );
        state = {
          ...docs,
          rows: sortFolderRows(directRows, sort),
        };
        break;
      }
      const merge = sourcesWanted && sourcesAvailable;
      state = merge
        ? {
            ...docs,
            rows: mergeNewestFirst(docs.rows, sourceRows, { docs: docs.hasMore, sources: Boolean(sourcesQuery.hasNextPage) }),
            hasMore: docs.hasMore || Boolean(sourcesQuery.hasNextPage),
            loadingMore: docs.loadingMore || sourcesQuery.isFetchingNextPage,
            loadMore: () => {
              if (homeQuery.hasNextPage) void homeQuery.fetchNextPage();
              if (sourcesQuery.hasNextPage) void sourcesQuery.fetchNextPage();
            },
          }
        : docs;
    }
  }

  const rows = state.rows.filter((row) => matchesChip(row, chip));
  return {
    state: { ...state, rows },
    /** Rows before the chip filter: an empty table under a chip is "no matches". */
    unfilteredCount: state.rows.length,
    tree: nodes,
    folderIndex,
    starredIds: new Set(starred.map((fav) => fav.document_id)),
    starredCount: favorites.data ? starred.length : null,
    sourcesAvailable,
    sort,
    setSort,
  };
}
