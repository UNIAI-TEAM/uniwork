"use client";

import { useMemo } from "react";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
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
  byUpdatedDesc,
  documentRow,
  indexTree,
  matchesChip,
  sourceRow,
  type DocumentSummaryRow,
  type FolderInfo,
  type LibraryRow,
  type TypeChip,
} from "./library-rows";

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

/** A favorite carries what a row needs to open the document, not its dates. */
function favoriteRow(fav: { document_id: string; workspace_id: string; title: string; kind: string; icon?: string | null; parent_id?: string | null }): DocumentSummaryRow {
  return {
    id: fav.document_id,
    organization_id: "",
    workspace_id: fav.workspace_id,
    parent_id: fav.parent_id ?? null,
    kind: fav.kind,
    title: fav.title,
    icon: fav.icon ?? null,
    visibility: "workspace",
    revision: "",
    current_version: 0,
    position: 0,
    created_by: "",
    created_by_kind: "human",
    updated_by: "",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "",
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

  const tree = useDocumentTree(wsId, undefined, { enabled });
  const favorites = useDocumentFavorites(orgId, { enabled: enabled && !!orgId });
  const listFilter = useMemo(
    () => ({
      ...(folderId ? { parentId: folderId } : {}),
      ...(chip === "page" ? { kind: "page" as const } : {}),
    }),
    [folderId, chip],
  );
  const homeQuery = useDocumentList(wsId, listFilter, { enabled: enabled && home });
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
  const sourcesAvailable = Boolean(sourcesQuery.data) && !sourcesMissing;

  const nodes: DocumentTreeNode[] = useMemo(() => tree.data?.documents ?? [], [tree.data]);
  const folderIndex: Map<string, FolderInfo> = useMemo(() => indexTree(nodes), [nodes]);
  const starred = useMemo(
    () => (favorites.data ?? []).filter((fav) => !fav.workspace_id || fav.workspace_id === wsId),
    [favorites.data, wsId],
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
    case "starred":
      state = {
        rows: starred.map((fav) => documentRow(favoriteRow(fav))),
        loading: favorites.isPending && !!orgId,
        failure: favorites.isError && !favorites.data ? failureOf(favorites.error) : null,
        hasMore: false,
        loadingMore: false,
        loadMore: () => undefined,
        refetch: () => void favorites.refetch(),
      };
      break;
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
      const merge = sourcesWanted && sourcesAvailable;
      state = merge
        ? {
            ...docs,
            rows: [...docs.rows, ...sourceRows].sort(byUpdatedDesc),
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
  };
}
