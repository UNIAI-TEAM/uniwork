"use client";

import { useEffect } from "react";
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

/** Maximum pages auto-fetched while searching on Gần đây or Được chia sẻ với tôi (10 pages = 500 rows). */
const SCREEN_SEARCH_AUTO_PAGE_CAP = 10;

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
  starredLoading?: boolean;
  starredFailure?: "error" | "permission" | null;
  starredRefetch?: () => void;
  screenAutoPaging?: boolean;
  screenFetchFailed?: boolean;
  shelvedBy: string | null;
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
    loadedById,
  }: {
    viewKind: string;
    shelvedBy: string | null;
    starredIds: ReadonlySet<string>;
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
  starredLoading = false,
  starredFailure = null,
  starredRefetch,
  screenAutoPaging = false,
  screenFetchFailed = false,
  shelvedBy,
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

  // Gần đây & Được chia sẻ với tôi (viewKind === "recent" | "shared", KLV-6, KLV-9):
  // their server endpoints take no `q`, so search filters the screen's own rows
  // client-side by folded title while auto-paging up to SCREEN_SEARCH_AUTO_PAGE_CAP pages (500 rows).
  if (viewKind === "recent" || viewKind === "shared") {
    const foldedQuery = foldSearchText(search.committedQuery);
    const rows = foldedQuery
      ? libraryRows.filter(
          (row) => row.type === "document" && foldSearchText(row.doc.title).includes(foldedQuery),
        )
      : libraryRows;
    const docById = new Map<string, DocumentSummaryRow>();
    for (const row of rows) {
      if (row.type === "document") docById.set(row.doc.id, row.doc);
    }
    const loading = libraryLoading || (rows.length === 0 && (screenAutoPaging || libraryLoadingMore));
    return {
      rows,
      folders: [],
      docById,
      loading,
      failure: libraryFailure ?? (rows.length === 0 && screenFetchFailed ? "error" : null),
      hasMore: !screenAutoPaging && libraryHasMore,
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
  const searchFailure = search.isError
    ? classifyDocumentError(search.error).cls === "permission"
      ? "permission"
      : "error"
    : null;
  const starredView = viewKind === "starred";
  const failure = searchFailure ?? (starredView ? starredFailure : null);
  const loading = search.loading || (starredView && starredLoading);

  return {
    rows: loading || failure ? [] : rows,
    folders,
    docById,
    loading,
    failure,
    hasMore: search.hasMore,
    loadingMore: search.loadingMore,
    loadMore: search.loadMore,
    refetch: starredView && starredFailure && !searchFailure ? (starredRefetch ?? libraryRefetch) : search.retry,
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
  starredLoading: boolean;
  starredFailure: "error" | "permission" | null;
  refetchFavorites: () => void;
  recentPageCount: number;
  recentFetchFailed: boolean;
  sharedPageCount: number;
  sharedFetchFailed: boolean;
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
  onNavigateFolder,
  onClearLibraryFilters,
}: UseDocumentsSearchViewInput) {
  const { t } = useTranslation();
  const viewKind = view.kind;
  const screenScoped = viewKind === "recent" || viewKind === "shared";
  const searchEnabled = enabled && viewKind !== "sources" && !screenScoped && viewKind !== "archived";
  const search = useDocumentsSearch(wsId, searchEnabled, {
    types,
    updatedBy: library.editorId,
    updatedFrom: library.updatedSince,
    shelved: viewKind === "shelved",
    sharedByMe: viewKind === "sharedByMe",
  });
  const searching = search.active && viewKind !== "archived";
  const { loadMore: libraryLoadMore, loadingMore: libraryLoadingMore } = library.state;
  const screenPageCount = viewKind === "recent" ? library.recentPageCount : viewKind === "shared" ? library.sharedPageCount : 0;
  const screenFetchFailed =
    viewKind === "recent" ? library.recentFetchFailed : viewKind === "shared" ? library.sharedFetchFailed : false;
  const screenAutoPaging =
    searching &&
    screenScoped &&
    library.state.hasMore &&
    !library.state.failure &&
    !screenFetchFailed &&
    screenPageCount > 0 &&
    screenPageCount < SCREEN_SEARCH_AUTO_PAGE_CAP;
  useEffect(() => {
    if (screenAutoPaging && !libraryLoadingMore) {
      libraryLoadMore();
    }
  }, [screenAutoPaging, libraryLoadingMore, libraryLoadMore]);

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
    starredLoading: library.starredLoading,
    starredFailure: library.starredFailure,
    starredRefetch: () => {
      library.refetchFavorites();
      library.state.refetch();
    },
    screenAutoPaging,
    screenFetchFailed,
    shelvedBy: library.shelvedBy,
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
  // "filtered" answers "is a filter on" (the filter bar of every list screen):
  // it gates the folder's subfolders-only suppression (TV-4), the root's empty
  // copy and the no-results state, so all three read the same flag.
  const filtered = metaFiltered || types.length > 0;
  const filteredBy = searchState
    ? screenScoped
      ? ("client" as const)
      : ("server" as const)
    : filtered
      ? library.clientFiltered
        ? ("client" as const)
        : ("server" as const)
      : null;
  const state = searchState ?? library.state;
  // At home and in a folder the folders are cards above the table.
  const tableRows = homeView ? nonFolderRows(state.rows) : state.rows;
  // The date groups (W11) while the rows sit in their screen's own order; a flat list otherwise.
  const listScreen = docListScreenOfView(view);
  const groupScreen = docListGroupScreen(listScreen);
  const groups =
    !searchState && groupScreen && library.ownOrderShown
      ? groupRowsByDate(tableRows, groupScreen, new Date())
      : [{ key: "all", rows: tableRows }];
  const subfolders = searchState ? searchState.folders : subfoldersOf(library.tree, folderId);
  // The root's folders come from the tree query: until it answers, an empty root
  // list cannot tell "no folders" from "folders not here yet".
  const rootTreePending =
    !searchState && homeView && !folderId && !filtered && library.treeLoading && tableRows.length === 0;
  const listLoading = state.loading || (!searchState && Boolean(folderId) && folderPending) || rootTreePending;
  // UNI-1994: folders on screen but no loose root document is not an empty workspace.
  const outsideFolders = !folderId && !filtered && !searchState && subfolders.length > 0;
  const rootEmpty = outsideFolders ? "outside_folders_" : "";
  // Gần đây's Mở tiếp cards (recent-canvas): only while no filter or search narrows the list, and while the rows
  // sit in their screen's own order.
  const cards =
    viewKind === "recent" && !filtered && !searching && library.ownOrderShown
      ? continueCards(state.rows)
      : [];
  // TV-4: a folder whose children are only subfolders is not empty, so it shows
  // no "Tài liệu 0" and no empty copy; the same applies when a search matches
  // folders only (KLR-4). Filters, loading and failure keep their own states.
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

  const screenMorePages = screenScoped && Boolean(searchState?.hasMore);
  return {
    search,
    searching,
    searchState,
    state,
    activeDocById: searchState ? searchState.docById : library.docById,
    activeRows: searchState ? searchState.rows : library.state.rows,
    metaFiltered: (metaFiltered && !searchState) || (Boolean(searchState) && screenScoped),
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
      ? screenMorePages
        ? { title: t("documents.home.search.no_results_title", { query: searchState.query }) }
        : {
            title: t("documents.home.search.no_results_title", { query: searchState.query }),
            description: undefined,
          }
      : undefined,
    clearFiltersLabel: searchState ? t("documents.home.search.clear") : undefined,
  };
}
