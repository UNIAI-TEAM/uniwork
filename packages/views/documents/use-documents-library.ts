"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { useDocumentFavorites, useWorkspaceFavoriteDocuments } from "@uniwork/core/documents/hooks-favorites";
import {
  useDocumentList,
  useDocumentTree,
  useRecentDocuments,
  useSharedByMe,
  useSharedWithMe,
  useShelvedDocuments,
  useTrashedDocuments,
} from "@uniwork/core/documents/hooks-collections";
import { isEndpointMissing, useDocumentSources } from "@uniwork/core/documents/hooks-library";
import type { DocumentList, DocumentTreeNode } from "@uniwork/core/types/document";
import { myFolderFirst } from "./document-tree-model";
import type { LibraryView } from "./documents-sidebar";
import {
  editorFilterId,
  matchesMeta,
  updatedFilterSince,
  type ActivityFilter,
  type EditorFilter,
  type UpdatedFilter,
} from "./doclist/filters";
import { docListSpec } from "./doclist/columns";
import { docListScreenOfView } from "./doclist/live-screen";
import { documentRow, sourceRow, type DocumentTypeFilter, type LibraryRow } from "./library-rows";
import {
  mergeSorted,
  nextSort,
  readLibrarySorts,
  serverSortParams,
  sourcesSortParams,
  sortOf,
  sortRows,
  writeLibrarySorts,
  type EditorNames,
  type LibrarySort,
  type LibrarySortColumn,
  type LibrarySortMap,
} from "./library-sort";
import { SHELVED_BY_SYSTEM } from "./documents-shelved-toolbar";

const FOLDER_SORT_ROW_CAP = 1000;
const NO_EDITOR_NAMES: EditorNames = new Map();

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

/**
 * Pages a list in full, up to FOLDER_SORT_ROW_CAP rows, while `active`: a list
 * the client sorts must be whole before it is shown. Answers whether it is
 * still paging; the view shows nothing (loading) until it is not.
 */
function useLoadInFull(q: InfiniteLike<DocumentList>, active: boolean): boolean {
  const loaded = q.data?.pages.reduce((sum, page) => sum + page.documents.length, 0) ?? 0;
  const lastPage = q.data?.pages.at(-1)?.documents.length ?? 0;
  const paging = active && Boolean(q.hasNextPage) && !q.isError && lastPage > 0 && loaded < FOLDER_SORT_ROW_CAP;
  useEffect(() => {
    if (paging && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [paging, q]);
  return paging;
}

/** A list loaded in full: no rows and still loading while it pages. */
function wholeState(q: InfiniteLike<DocumentList>, paging: boolean): LibraryState {
  const docs = documentState(q);
  return { ...docs, rows: paging ? [] : docs.rows, loading: docs.loading || paging, hasMore: !paging && docs.hasMore };
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

export interface UseDocumentsLibraryInput {
  wsId: string;
  orgId: string;
  enabled: boolean;
  view: LibraryView;
  folderId: string | null;
  /** The Loại picks; none = every type. */
  types: DocumentTypeFilter[];
  /** Member display names by user id: the Người sửa column sorts by name, and only the client can look them up. */
  editorNames?: EditorNames;
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
 *
 * The column sort (UNI-2038, UNI-2045 W12) is one `{ column, order }` per
 * viewer and per screen. Where the order comes from is decided in one place,
 * `sortedOnServer` below.
 */
export function useDocumentsLibrary({ wsId, orgId, enabled, view, folderId, types, editorNames = NO_EDITOR_NAMES }: UseDocumentsLibraryInput) {
  const home = view.kind === "home";
  // The Type picks go to every list route, the sources route included, as the repeated `type`
  // parameter (UNI-2113): the server filters, no row is narrowed on the client.
  const typeParam = types.length > 0 ? types : undefined;
  const sourcesShown = (home && !folderId) || view.kind === "sources";
  const sourcesWanted = (types.length === 0 || types.some((type) => type !== "page")) && sourcesShown;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [lastUserId, setLastUserId] = useState<string | null>(userId);
  const [editor, setEditor] = useState<EditorFilter>("any");
  const [activity, setActivity] = useState<ActivityFilter>("all");
  // The bound is fixed when the bucket is picked: recomputing it per render
  // would change the list query key on every render.
  const [updated, setUpdatedState] = useState<{ filter: UpdatedFilter; since: string | null }>({ filter: "any", since: null });
  const setUpdated = useCallback((filter: UpdatedFilter) => setUpdatedState({ filter, since: updatedFilterSince(filter) }), []);
  const [sorts, setSorts] = useState<LibrarySortMap>(() => readLibrarySorts(userId));
  if (userId !== lastUserId) {
    setLastUserId(userId);
    setSorts(readLibrarySorts(userId));
  }
  // One sort per screen (W12): the open folder and the sources view share the
  // workspace entry, and what a screen shows is its own pick or its default.
  const screen = docListScreenOfView(view);
  const sort = sortOf(sorts, screen);
  const onSort = useCallback(
    (column: LibrarySortColumn) => {
      if (screen === "trash") return;
      const merged = { ...sorts, [screen]: nextSort(sort, column) };
      setSorts(merged);
      writeLibrarySorts(userId, merged);
    },
    [userId, screen, sorts, sort],
  );
  // Where the order comes from. The lists that page on the server (home root,
  // Recent, Shared with me, Shared by me, Lưu trữ, Elsewhere) send `sort`/
  // `order` and show the server's pages as they come: the order is part of the
  // query key, and a page is never re-sorted here (the server's collation is
  // not Intl.Collator's). A screen that has its own column asks for that key
  // until the viewer picks another column, and any other column is an S3 key.
  // The lists that are loaded in full (Starred, an open folder, auto-paged to
  // FOLDER_SORT_ROW_CAP) are ordered on the client, and asking the server for
  // nothing keeps a header click from refetching them. The trash takes no sort
  // from here: its request is fixed (Q2). This is the only place that
  // differs if the server sort is dropped for "auto-load, then sort on the
  // client": `sortedOnServer` false, `sortedOnClient` true, and the auto-paging
  // below extended from the folder to those views.
  // The sort the lists on screen were fetched with: it trails `sort` while a re-sorted page is loading.
  const [settledSort, setSettledSort] = useState(sort);
  const sortedOnServer =
    (home && !folderId) ||
    view.kind === "recent" ||
    view.kind === "shared" ||
    view.kind === "sharedByMe" ||
    view.kind === "shelved" ||
    view.kind === "sources";
  const sortedOnClient = view.kind === "starred" || (home && Boolean(folderId));
  const serverSort = useMemo(() => (sortedOnServer ? serverSortParams(sort) : {}), [sortedOnServer, sort]);
  // Gần đây and Được chia sẻ với tôi group by date while in their own order
  // (UNI-2045 W11, rule §8): the screen column, newest first. Any other pick
  // shows a flat list in the S3 order, and so does the screen column ascending.
  const own = docListSpec(screen).defaultSort;
  const ownOrder = sort.column === own.key && sort.order === own.order;

  const archived = view.kind === "archived";
  const shelvedView = view.kind === "shelved";
  const [shelvedBy, setShelvedBy] = useState<string | null>(null);

  const tree = useDocumentTree(wsId, undefined, { enabled });
  const favorites = useDocumentFavorites(orgId, { enabled: enabled && !!orgId });
  // The filter bar's Người sửa / Cập nhật (UNI-2045 W10): server parameters
  // on every list that pages there (home root, Recent, both Shared lists,
  // Lưu trữ — SV-8) so they hold under paging; the lists loaded in full (an
  // open folder, Có gắn sao, the files of other modules) filter on the client.
  const homeRoot = home && !folderId;
  const folderView = home && Boolean(folderId);
  const editorId = editorFilterId(editor, userId);
  const updatedSince = updated.since ?? undefined;
  const serverMeta = { updatedBy: editorId, updatedFrom: updatedSince };
  const listFilter = useMemo(
    () => ({
      // The board's home list is ROOT documents only: parent_id="" (empty
      // string) is the server's "roots" marker; a folder's own id scopes the
      // list to that level (Main.dc, TV-3 option A). A folder is loaded in
      // full and filtered here, so its request carries no filter.
      ...(home ? { parentId: folderId ?? "" } : {}),
      ...(typeParam ? { types: typeParam } : {}),
      ...(homeRoot && editorId ? { updatedBy: editorId } : {}),
      ...(homeRoot && updatedSince ? { updatedFrom: updatedSince } : {}),
      ...(homeRoot ? serverSort : {}),
    }),
    [home, folderId, homeRoot, typeParam, editorId, updatedSince, serverSort],
  );
  const homeQuery = useDocumentList(wsId, listFilter, { enabled: enabled && home });
  const folderAutoPaging = useLoadInFull(homeQuery, enabled && home && Boolean(folderId));
  // Có gắn sao (UNI-2045 SV-2): the workspace's starred rows as full list rows
  // with `favorited_at`, loaded in full and then filtered and sorted here like
  // an open folder; it sends the Type picks but no other filter or sort (Ngày gắn sao is ordered here).
  const starredQuery = useWorkspaceFavoriteDocuments(wsId, { enabled: enabled && view.kind === "starred", types: typeParam });
  const starredAutoPaging = useLoadInFull(starredQuery, enabled && view.kind === "starred");
  // Thùng rác: always `deleted` ascending (UNI-2045 Q2), fixed by the endpoint.
  // Thùng rác has no filter bar (the page passes no types).
  const archivedQuery = useTrashedDocuments(wsId, { enabled: enabled && archived, types: typeParam });
  // ARCHIVE-01 U-2: the shelved list takes the Type picks and Người sửa / Cập nhật
  // server-side (SV-8; Cập nhật windows shelved_at there); the "Lưu trữ bởi"
  // member filter stays on the client (the endpoint has no `shelved_by`
  // parameter, and `updated_by` is the last editor, not who shelved it).
  const shelvedQuery = useShelvedDocuments(wsId, {
    enabled: enabled && shelvedView,
    types: typeParam,
    ...serverMeta,
    ...serverSort,
  });
  const recentQuery = useRecentDocuments(wsId, {
    enabled: enabled && view.kind === "recent",
    types: typeParam,
    ...serverMeta,
    activity: activity === "all" ? undefined : activity,
    ...serverSort,
  });
  const sharedQuery = useSharedWithMe(wsId, {
    enabled: enabled && view.kind === "shared",
    types: typeParam,
    ...serverMeta,
    ...serverSort,
  });
  const sharedByMeQuery = useSharedByMe(wsId, {
    enabled: enabled && view.kind === "sharedByMe",
    types: typeParam,
    ...serverMeta,
    ...serverSort,
  });
  const sourceFilter = useMemo(
    () => ({
      ...(view.kind === "sources" && view.source ? { source: view.source } : {}),
      // A page-only pick sends type=page too: sources hold no page, so the answer is empty.
      ...(sourcesShown && typeParam ? { types: typeParam } : {}),
      ...(sourcesWanted ? sourcesSortParams(sort) : {}),
    }),
    [view, sourcesShown, typeParam, sourcesWanted, sort],
  );
  // Probe once even when the view does not list sources: the sidebar section
  // shows only after the API has answered.
  const sourcesQuery = useDocumentSources(wsId, sourceFilter, { enabled });
  const sourcesMissing = sourcesQuery.isError && isEndpointMissing(sourcesQuery.error);
  // Availability is "the API has answered for this workspace", not "the query
  // for the current picks has data": a change of picks swaps the query key, and the
  // sidebar section must not unmount while the new one loads.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  if (Boolean(sourcesQuery.data) && !sourcesMissing && answeredFor !== wsId) setAnsweredFor(wsId);
  if (sourcesMissing && answeredFor === wsId) setAnsweredFor(null);
  const sourcesAvailable = !sourcesMissing && (Boolean(sourcesQuery.data) || answeredFor === wsId);

  const nodes: DocumentTreeNode[] = useMemo(() => myFolderFirst(tree.data?.documents ?? []), [tree.data]);
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
    case "sharedByMe":
      state = documentState(sharedByMeQuery);
      break;
    case "archived":
      state = documentState(archivedQuery);
      break;
    case "shelved":
      state = documentState(shelvedQuery);
      break;
    case "starred":
      state = wholeState(starredQuery, starredAutoPaging);
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
      if (folderId) {
        const whole = wholeState(homeQuery, folderAutoPaging);
        state = {
          ...whole,
          rows: whole.rows.filter((row) => row.type === "document" && (row.doc.parent_id === undefined || row.doc.parent_id === folderId)),
        };
        break;
      }
      const merge = sourcesWanted && sourcesAvailable;
      // While either list still shows the previous pages (a header click, until the re-ordered page 1
      // arrives) they are merged with the sort they were fetched with, never the one just picked.
      const placeholder = homeQuery.isPlaceholderData || sourcesQuery.isPlaceholderData;
      if (!placeholder && settledSort !== sort) setSettledSort(sort);
      state = merge
        ? {
            ...docs,
            rows: mergeSorted(docs.rows, sourceRows, { docs: docs.hasMore, sources: Boolean(sourcesQuery.hasNextPage) }, placeholder ? settledSort : sort, editorNames),
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

  // What the server could not filter (UNI-2045 W10): the lists loaded in full
  // (an open folder, Có gắn sao) and the sources view run the Người sửa and
  // Cập nhật predicates on every row, and a merged home on its source rows
  // only — a document row there is the server's answer. The Type picks are the
  // server's everywhere, source rows included. A merged home counts only while source rows
  // actually merged — an empty sources answer leaves the doc list fully server-filtered.
  const mergedHome = Boolean(homeRoot && sourcesWanted && sourcesAvailable && sourceRows.length > 0);
  const loadedInFull = view.kind === "starred" || view.kind === "sources" || folderView;
  // The "Lưu trữ bởi" member filter is always client-side: the server has no
  // shelved_by parameter, so it narrows only the loaded pages (Q-UI2).
  const memberFiltered = shelvedView && shelvedBy !== null;
  const clientFiltered = loadedInFull || mergedHome || memberFiltered;
  const filtered = state.rows.filter((row) => {
    if (memberFiltered && (row.type !== "document" || (row.doc.shelved_by ?? SHELVED_BY_SYSTEM) !== shelvedBy)) return false;
    const clientSide = loadedInFull || (mergedHome && row.type === "source");
    return !clientSide || matchesMeta(row, editorId, updated.since);
  });
  const rows = sortedOnClient ? sortRows(filtered, sort, editorNames) : filtered;
  // The member filter's options: the distinct shelved_by ids the loaded rows
  // carry (member rows first is the toolbar's business), plus the system slot
  // when a row was shelved by nobody (null). Unknown ids stand for former
  // members; the toolbar labels them.
  const shelverIds = shelvedView
    ? [...new Set(state.rows.flatMap((row) => (row.type === "document" && row.doc.shelved_by ? [row.doc.shelved_by] : [])))].sort()
    : [];
  const shelvedHasSystem = shelvedView && state.rows.some((row) => row.type === "document" && row.doc.shelved_by === null);
  // The rows sit in their screen's own order, so the page may draw the date
  // groups: Thùng rác always (`deleted` ascending, Q2), Gần đây and Được chia
  // sẻ với tôi while no column is picked and the pages on screen are not the
  // previous order's placeholder.
  const ownOrderShown =
    archived ||
    (ownOrder &&
      ((view.kind === "recent" && !recentQuery.isPlaceholderData) || (view.kind === "shared" && !sharedQuery.isPlaceholderData)));
  const clearFilters = () => {
    setEditor("any");
    setUpdated("any");
    setActivity("all");
    setShelvedBy(null);
  };
  return {
    state: { ...state, rows },
    ownOrderShown,
    /** Whether the filter bar ran on the client here — decides which
     *  empty-state copy the list shows ("no matches" server-side vs "no
     *  matches in what is loaded" client-side). */
    clientFiltered,
    tree: nodes,
    /** True while the first tree answer is on its way (a disabled tree is not loading). */
    treeLoading: tree.isLoading,
    /** The loaded document rows by id: a folder card takes its editor, date and level from its own row. */
    docById: new Map(state.rows.flatMap((row) => (row.type === "document" ? [[row.doc.id, row.doc]] : []))),
    starredIds: new Set(starred.map((fav) => fav.document_id)),
    starredCount: favorites.data ? starred.length : null,
    sourcesAvailable,
    editor,
    setEditor,
    updated: updated.filter,
    setUpdated,
    /** Gần đây's Tất cả / Đã mở / Đã sửa. */
    activity,
    setActivity,
    /** Người sửa, Cập nhật, the segment and "Lưu trữ bởi" back to their defaults (the type picks are the page's). */
    clearFilters,
    /** The header sort of the open screen for the table; absent in the trash, whose order is fixed. */
    sortControl: screen === "trash" ? undefined : { value: sort, onSort },
    /** The "Lưu trữ bởi" member filter (shelved view only): null = anyone,
     *  a member id, or SHELVED_BY_SYSTEM for rows shelved without a person. */
    shelvedBy,
    setShelvedBy,
    /** The distinct shelved_by ids on the loaded rows, sorted — the toolbar
     *  builds its options from the member list plus these. */
    shelverIds,
    /** A loaded row was shelved by the system (shelved_by null). */
    shelvedHasSystem,
  };
}
