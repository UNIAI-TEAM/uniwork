"use client";

import { useTranslation } from "react-i18next";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { isShelved, type DocumentTreeNode } from "@uniwork/core/types/document";
import { docListGroupScreen, groupRowsByDate } from "./doclist/date-groups";
import type { ActivityFilter } from "./doclist/filters";
import { docListScreenOfView } from "./doclist/live-screen";
import { nonFolderRows, subfoldersOf } from "./documents-folders-grid";
import { continueCards } from "./documents-recent-continue";
import { SHELVED_BY_SYSTEM } from "./documents-shelved-toolbar";
import type { LibraryView } from "./documents-sidebar";
import type { LibraryState } from "./use-documents-library";
import {
  documentRow,
  type DocumentSummaryRow,
  type DocumentTypeFilter,
  type LibraryRow,
} from "./library-rows";
import { foldSearchText, formatSearchPath } from "./search-path";
import { useDocumentsSearch, type UseDocumentsSearchResult } from "./use-documents-search";
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
  searchPath: (doc: { path?: { id: string; title: string }[] }) => { display: string; full: string; srText: string } | null;
}

export interface BuildSearchViewStateInput {
  search: UseDocumentsSearchResult;
  searching: boolean;
  viewKind: string;
  libraryRows: LibraryRow[];
  libraryLoading: boolean;
  libraryFailure: "error" | "permission" | null;
  libraryHasMore: boolean;
  libraryLoadingMore: boolean;
  libraryLoadMore: () => void;
  libraryRefetch: () => void;
  starredIds: ReadonlySet<string>;
  shelvedBy: string | null;
  activity: ActivityFilter;
  userId: string | null;
  tree: DocumentTreeNode[];
  myFolderId: string | null;
  myFolderLabel: string;
  rootPathLabel: string;
  formatPathSr: (full: string) => string;
  onClearSearch: () => void;
}

function walkTree(nodes: DocumentTreeNode[], treeMap: Map<string, DocumentTreeNode>): void {
  for (const node of nodes) {
    treeMap.set(node.id, node);
    walkTree(node.children, treeMap);
  }
}

function matchesSearchViewScope(
  doc: DocumentSummaryRow,
  {
    viewKind,
    shelvedBy,
    starredIds,
    activity,
    userId,
    loadedById,
  }: {
    viewKind: string;
    shelvedBy: string | null;
    starredIds: ReadonlySet<string>;
    activity: ActivityFilter;
    userId: string | null;
    loadedById: ReadonlyMap<string, DocumentSummaryRow>;
  },
): boolean {
  const loaded = loadedById.get(doc.id);
  switch (viewKind) {
    case "shelved": {
      if (!isShelved(doc)) return false;
      if (shelvedBy !== null && (doc.shelved_by ?? SHELVED_BY_SYSTEM) !== shelvedBy) return false;
      return true;
    }
    case "starred":
      return Boolean(doc.favorited_at) || starredIds.has(doc.id) || loaded !== undefined;
    case "shared":
      return Boolean(doc.shared) || doc.via === "share" || loaded !== undefined;
    case "sharedByMe": {
      if (doc.kind === "folder" || doc.system_kind === "my_folder") return false;
      if (doc.is_owner === false) return false;
      if (doc.share_summary) return true;
      if (doc.share_scope) {
        return (
          doc.share_scope.home_workspace ||
          doc.share_scope.users > 0 ||
          doc.share_scope.workspaces > 0 ||
          doc.share_scope.organization
        );
      }
      return doc.visibility === "workspace" || loaded !== undefined;
    }
    case "recent": {
      const activityInfo = doc.last_activity ?? loaded?.last_activity;
      if (activity === "edited") {
        return activityInfo?.kind === "edited" || (Boolean(userId) && doc.updated_by === userId);
      }
      if (activity === "opened") {
        // Without a loaded access-log entry on the hit, keep workspace matches unscoped
        // rather than silently dropping unloaded pages.
        return activityInfo ? activityInfo.kind === "opened" || activityInfo.kind === "owned" : true;
      }
      return true;
    }
    default:
      return true;
  }
}

export function buildSearchViewState({
  search,
  searching,
  viewKind,
  libraryRows,
  libraryLoading,
  libraryFailure,
  libraryHasMore,
  libraryLoadingMore,
  libraryLoadMore,
  libraryRefetch,
  starredIds,
  shelvedBy,
  activity,
  userId,
  tree,
  myFolderId,
  myFolderLabel,
  rootPathLabel,
  formatPathSr,
  onClearSearch,
}: BuildSearchViewStateInput): SearchViewState | null {
  if (!searching) return null;

  const searchPath = (doc: { path?: { id: string; title: string }[] }) => {
    const rawPath = doc.path ?? [];
    const mapped = rawPath.map((seg) =>
      myFolderId && seg.id === myFolderId ? { ...seg, title: myFolderLabel } : seg,
    );
    const formatted = formatSearchPath(mapped, rootPathLabel);
    if (!formatted.display) return null;
    return { ...formatted, srText: formatPathSr(formatted.full) };
  };

  // Ở nơi khác (viewKind === "sources"): sources are loaded in full on the client,
  // so search filters the loaded source rows by accent- and case-folded title.
  if (viewKind === "sources") {
    const foldedQuery = foldSearchText(search.committedQuery);
    const rows = foldedQuery
      ? libraryRows.filter(
          (row) => row.type === "source" && foldSearchText(row.source.name).includes(foldedQuery),
        )
      : libraryRows;
    return {
      rows,
      folders: [],
      docById: new Map(),
      loading: libraryLoading,
      failure: libraryFailure,
      hasMore: libraryHasMore,
      loadingMore: libraryLoadingMore,
      loadMore: libraryLoadMore,
      refetch: libraryRefetch,
      query: search.committedQuery,
      onClearSearch,
      searchPath,
    };
  }

  const loadedById = new Map<string, DocumentSummaryRow>();
  for (const row of libraryRows) {
    if (row.type === "document") loadedById.set(row.doc.id, row.doc);
  }

  const items = search.items
    .filter((doc) =>
      matchesSearchViewScope(doc, {
        viewKind,
        shelvedBy,
        starredIds,
        activity,
        userId,
        loadedById,
      }),
    )
    .map((doc): DocumentSummaryRow => {
      const loaded = loadedById.get(doc.id);
      if (!loaded) return doc;
      return {
        ...doc,
        last_activity: doc.last_activity ?? loaded.last_activity,
        favorited_at: doc.favorited_at ?? loaded.favorited_at,
        shared: doc.shared ?? loaded.shared,
        share_summary: doc.share_summary ?? loaded.share_summary,
      };
    });

  const rows = items.map(documentRow);
  const treeMap = new Map<string, DocumentTreeNode>();
  walkTree(tree, treeMap);

  const foldedCommitted = foldSearchText(search.committedQuery);
  const matchesMyFolderLabel =
    viewKind === "home" &&
    Boolean(myFolderId) &&
    Boolean(foldedCommitted) &&
    foldSearchText(myFolderLabel).includes(foldedCommitted);

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
  if (matchesMyFolderLabel && myFolderId && !folders.some((node) => node.id === myFolderId)) {
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
    onClearSearch,
    searchPath,
  };
}

export interface UseDocumentsSearchViewLibraryInput {
  state: LibraryState;
  tree: DocumentTreeNode[];
  treeLoading: boolean;
  docById: Map<string, DocumentSummaryRow>;
  starredIds: ReadonlySet<string>;
  shelvedBy: string | null;
  activity: ActivityFilter;
  editor: string;
  updated: string;
  editorId?: string;
  updatedSince?: string;
  clientFiltered: boolean;
  ownOrderShown: boolean;
}

export interface UseDocumentsSearchViewInput {
  wsId: string;
  enabled: boolean;
  view: LibraryView;
  folderId: string | null;
  folderPending: boolean;
  types: DocumentTypeFilter[];
  library: UseDocumentsSearchViewLibraryInput;
  myFolderId: string | null;
  myFolderLabel: string;
  userId: string | null;
  onNavigateFolder: (folderId: string) => void;
  onClearLibraryFilters: () => void;
}

export function useDocumentsSearchView({
  wsId,
  enabled,
  view,
  folderId,
  folderPending,
  types,
  library,
  myFolderId,
  myFolderLabel,
  userId,
  onNavigateFolder,
  onClearLibraryFilters,
}: UseDocumentsSearchViewInput) {
  const { t } = useTranslation();
  const viewKind = view.kind;
  const search = useDocumentsSearch(wsId, enabled, {
    types,
    updatedBy: library.editorId,
    updatedFrom: library.updatedSince,
    shelved: viewKind === "shelved",
    sharedByMe: viewKind === "sharedByMe",
  });
  const searching = search.active && viewKind !== "archived";
  const clearAndFocus = () => {
    search.clear();
    search.focusInput();
  };
  const searchState = buildSearchViewState({
    search,
    searching,
    viewKind,
    libraryRows: library.state.rows,
    libraryLoading: library.state.loading,
    libraryFailure: library.state.failure,
    libraryHasMore: library.state.hasMore,
    libraryLoadingMore: library.state.loadingMore,
    libraryLoadMore: library.state.loadMore,
    libraryRefetch: library.state.refetch,
    starredIds: library.starredIds,
    shelvedBy: library.shelvedBy,
    activity: library.activity,
    userId,
    tree: library.tree,
    myFolderId,
    myFolderLabel,
    rootPathLabel: t("documents.home.search.path_root"),
    formatPathSr: (full) => t("documents.home.search.path", { path: full }),
    onClearSearch: clearAndFocus,
  });

  const homeView = viewKind === "home";
  const metaFiltered =
    library.editor !== "any" ||
    library.updated !== "any" ||
    (viewKind === "recent" && library.activity !== "all");
  const filtered = metaFiltered || types.length > 0;
  const filteredBy = searchState
    ? ("server" as const)
    : filtered
      ? library.clientFiltered
        ? ("client" as const)
        : ("server" as const)
      : null;
  const state = searchState ?? library.state;
  const tableRows = homeView ? nonFolderRows(state.rows) : state.rows;
  const listScreen = docListScreenOfView(view);
  const groupScreen = docListGroupScreen(listScreen);
  const groups =
    !searchState && groupScreen && library.ownOrderShown
      ? groupRowsByDate(tableRows, groupScreen, new Date())
      : [{ key: "all", rows: tableRows }];
  const subfolders = searchState ? searchState.folders : subfoldersOf(library.tree, folderId);
  const rootTreePending =
    !searchState && homeView && !folderId && !filtered && library.treeLoading && tableRows.length === 0;
  const listLoading = state.loading || (!searchState && Boolean(folderId) && folderPending) || rootTreePending;
  const outsideFolders = !folderId && !filtered && !searchState && subfolders.length > 0;
  const rootEmpty = outsideFolders ? "outside_folders_" : "";
  const cards =
    viewKind === "recent" && !filtered && !searching && library.ownOrderShown
      ? continueCards(state.rows)
      : [];
  const hideDocuments =
    (searching || (Boolean(folderId) && !filtered)) &&
    subfolders.length > 0 &&
    tableRows.length === 0 &&
    !listLoading &&
    !state.failure;

  const openFolderFromList = (targetFolderId: string) => {
    if (searching) search.clear();
    onNavigateFolder(targetFolderId);
  };
  const clearFiltersOrSearch = () => {
    if (searchState) {
      searchState.onClearSearch();
      return;
    }
    onClearLibraryFilters();
  };

  return {
    search,
    searching,
    searchState,
    state,
    activeDocById: searchState ? searchState.docById : library.docById,
    activeRows: searchState ? searchState.rows : library.state.rows,
    metaFiltered,
    filteredBy,
    tableRows,
    listScreen,
    groupScreen,
    groups,
    subfolders,
    listLoading,
    rootEmpty,
    cards,
    hideDocuments,
    openFolderFromList,
    clearFiltersOrSearch,
    emptyFiltered: searchState
      ? {
          title: t("documents.home.search.no_results_title", { query: searchState.query }),
          description: undefined,
        }
      : undefined,
    clearFiltersLabel: searchState ? t("documents.home.search.clear") : undefined,
  };
}
