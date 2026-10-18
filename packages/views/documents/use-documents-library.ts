"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@uniwork/core/auth";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { documentKeys } from "@uniwork/core/documents/keys";
import { useDocumentFavorites } from "@uniwork/core/documents/hooks-favorites";
import {
  useDocumentList,
  useDocumentTree,
  useRecentDocuments,
  useSharedByMe,
  useSharedWithMe,
  useShelvedDocuments,
} from "@uniwork/core/documents/hooks-collections";
import { isEndpointMissing, useDocumentSources } from "@uniwork/core/documents/hooks-library";
import type { DocumentSourceType } from "@uniwork/core/documents/sources-schema";
import type {
  DocumentAccessFilter,
  DocumentFileFormat,
  DocumentList,
  DocumentTreeNode,
} from "@uniwork/core/types/document";
import { myFolderFirst } from "./document-tree-model";
import type { LibraryView } from "./documents-sidebar";
import {
  documentRow,
  indexTree,
  matchesAccess,
  matchesChip,
  mergeNewestFirst,
  readFolderSort,
  sortFolderRows,
  sourceRow,
  writeFolderSort,
  type AccessFilter,
  type FolderInfo,
  type FolderSort,
  type LibraryRow,
  type TypeChip,
} from "./library-rows";
import { favoriteRow, knownDocuments } from "./starred-rows";
import { SHELVED_BY_SYSTEM } from "./documents-shelved-toolbar";

const FOLDER_SORT_ROW_CAP = 1000;

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

/** The home filter bar's "Người sửa" value: everyone, the viewer, or one member id. */
export type EditorFilter = "any" | "me" | string;

/** The home filter bar's "Cập nhật" buckets; "any" sends no lower bound. */
export const UPDATED_FILTERS = ["any", "today", "7d", "30d"] as const;
export type UpdatedFilter = (typeof UPDATED_FILTERS)[number];

/** The RFC3339 lower bound a Cập nhật bucket stands for; null for "any". */
function updatedFilterSince(filter: UpdatedFilter, now: number = Date.now()): string | null {
  if (filter === "today") {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    return day.toISOString();
  }
  if (filter === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (filter === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

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
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [lastUserId, setLastUserId] = useState<string | null>(userId);
  const [access, setAccess] = useState<AccessFilter>("all");
  const [editor, setEditor] = useState<EditorFilter>("any");
  // The bound is fixed when the bucket is picked: recomputing it per render
  // would change the list query key on every render.
  const [updated, setUpdatedState] = useState<{ filter: UpdatedFilter; since: string | null }>({ filter: "any", since: null });
  const setUpdated = useCallback((filter: UpdatedFilter) => setUpdatedState({ filter, since: updatedFilterSince(filter) }), []);
  const [sort, setSortState] = useState<FolderSort>(() => readFolderSort(userId));
  if (userId !== lastUserId) {
    setLastUserId(userId);
    setSortState(readFolderSort(userId));
  }
  const setSort = useCallback(
    (next: FolderSort) => {
      setSortState(next);
      writeFolderSort(userId, next);
    },
    [userId],
  );

  // The server-side pair of the type chips (UNI-1868): the file chips become
  // `format`, "UniNote" keeps `kind=page`, and the access buttons become
  // `access`. The trash accepts only `format` and `access=restricted` — a
  // manage/edit carried in from another tab is clamped here, and the toolbar
  // hides those options while the trash is open.
  const serverFormat = SOURCE_TYPES.has(chip) ? (chip as DocumentFileFormat) : undefined;
  const archived = view.kind === "archived";
  const shelvedView = view.kind === "shelved";
  const [shelvedBy, setShelvedBy] = useState<string | null>(null);
  const serverAccess: DocumentAccessFilter | undefined =
    access === "all" ? undefined : archived && access !== "restricted" ? undefined : access;

  const queryClient = useQueryClient();
  const tree = useDocumentTree(wsId, undefined, { enabled });
  const favorites = useDocumentFavorites(orgId, { enabled: enabled && !!orgId });
  // The home filter bar's editor/recency filters are server parameters of
  // GET /documents so they hold under paging (lead decision, TRASH-A3); they
  // apply to the home root only — a folder list and the other views keep their
  // own filters.
  const homeRoot = home && !folderId;
  const editorParam = homeRoot ? (editor === "any" ? undefined : editor === "me" ? (userId ?? undefined) : editor) : undefined;
  const updatedParam = homeRoot ? (updated.since ?? undefined) : undefined;
  const listFilter = useMemo(
    () => ({
      // The board's home list is ROOT documents only: parent_id="" (empty
      // string) is the server's "roots" marker; a folder's own id scopes the
      // list to that level (Main.dc, TV-3 option A).
      ...(home ? { parentId: folderId ?? "" } : {}),
      ...(chip === "page" ? { kind: "page" as const } : {}),
      ...(serverFormat ? { format: serverFormat } : {}),
      ...(serverAccess ? { access: serverAccess } : {}),
      ...(editorParam ? { updatedBy: editorParam } : {}),
      ...(updatedParam ? { updatedFrom: updatedParam } : {}),
    }),
    [home, folderId, chip, editorParam, updatedParam, serverFormat, serverAccess],
  );
  // The starred view reads the workspace root list too (the home root's own
  // cache entry when it was open), so starred rows get dates and editors.
  const homeQuery = useDocumentList(wsId, listFilter, { enabled: enabled && home });
  const folderLoadedCount = homeQuery.data?.pages.reduce((sum, page) => sum + page.documents.length, 0) ?? 0;
  const lastFolderPageCount = homeQuery.data?.pages.at(-1)?.documents.length ?? 0;
  const folderAutoPaging =
    enabled &&
    home &&
    Boolean(folderId) &&
    Boolean(homeQuery.hasNextPage) &&
    !homeQuery.isError &&
    lastFolderPageCount > 0 &&
    folderLoadedCount < FOLDER_SORT_ROW_CAP;

  useEffect(() => {
    if (folderAutoPaging && !homeQuery.isFetchingNextPage) {
      void homeQuery.fetchNextPage();
    }
  }, [folderAutoPaging, homeQuery]);

  const rootQuery = useDocumentList(wsId, {}, { enabled: enabled && view.kind === "starred" });
  const archivedFilter = useMemo(
    () => ({
      archived: true,
      ...(chip === "page" ? { kind: "page" as const } : {}),
      ...(serverFormat ? { format: serverFormat } : {}),
      ...(serverAccess ? { access: serverAccess } : {}),
    }),
    [chip, serverFormat, serverAccess],
  );
  const archivedQuery = useDocumentList(wsId, archivedFilter, { enabled: enabled && archived });
  // ARCHIVE-01 U-2: the shelved list takes `format` server-side like the
  // trash; the "Trang" chip and the member filter stay on the client (the
  // endpoint has no `kind` or `shelved_by` parameter), and the access filter
  // is not offered there, so it never reaches the query either.
  const shelvedQuery = useShelvedDocuments(wsId, {
    enabled: enabled && shelvedView,
    format: serverFormat,
  });
  const recentQuery = useRecentDocuments(wsId, {
    enabled: enabled && view.kind === "recent",
    format: serverFormat,
    access: serverAccess,
  });
  const sharedQuery = useSharedWithMe(wsId, {
    enabled: enabled && view.kind === "shared",
    format: serverFormat,
    access: serverAccess,
  });
  const sharedByMeQuery = useSharedByMe(wsId, {
    enabled: enabled && view.kind === "sharedByMe",
    format: serverFormat,
    access: serverAccess,
  });
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

  const nodes: DocumentTreeNode[] = useMemo(() => myFolderFirst(tree.data?.documents ?? []), [tree.data]);
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
    [view.kind, queryClient, wsId, rootQuery.data, homeQuery.data, recentQuery.data, sharedQuery.data, sharedByMeQuery.data, archivedQuery.data, favorites.data],
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
          rows: folderAutoPaging ? [] : sortFolderRows(directRows, sort),
          loading: docs.loading || folderAutoPaging,
          hasMore: !folderAutoPaging && docs.hasMore,
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

  // What the server could not filter (UNI-1868): the starred view (favorites
  // + cache) and the sources view keep the client predicates on every row, and
  // on a merged home they run on the source rows only — a document row there
  // is the server's answer. Recent and shared-with-me take `format`/`access`
  // but no `kind`, so the "UniNote" chip there is narrowed on the client, and
  // the empty state says "in what is loaded". A merged home counts only while
  // source rows actually merged — an empty sources answer leaves the doc list
  // fully server-filtered.
  const mergedHome = Boolean(home && !folderId && sourcesWanted && sourcesAvailable && sourceRows.length > 0);
  const pageChipOnListWithoutKind =
    chip === "page" && (view.kind === "recent" || view.kind === "shared" || view.kind === "sharedByMe" || shelvedView);
  // The "Lưu trữ bởi" member filter is always client-side: the server has no
  // shelved_by parameter, so it narrows only the loaded pages (Q-UI2).
  const memberFiltered = shelvedView && shelvedBy !== null;
  const clientFiltered =
    view.kind === "starred" || view.kind === "sources" || mergedHome || pageChipOnListWithoutKind || memberFiltered;
  // The server filters the document rows by editorParam/updatedParam too; the
  // merged source rows come from another list, so the same predicates run on
  // them here (TRASH-A3).
  const updatedAfter = updatedParam ? Date.parse(updatedParam) : null;
  const sourceMetaMatches = (row: LibraryRow) =>
    row.type !== "source" ||
    ((!editorParam || row.source.owner?.id === editorParam) && (!updatedAfter || Date.parse(row.source.updated_at ?? "") >= updatedAfter));
  const rows = state.rows.filter((row) => {
    if (shelvedView) {
      if (memberFiltered) {
        if (row.type !== "document") return false;
        if ((row.doc.shelved_by ?? SHELVED_BY_SYSTEM) !== shelvedBy) return false;
      }
      return !pageChipOnListWithoutKind || matchesChip(row, chip);
    }
    // Only the type predicate runs on recent/shared: the server already applied `access` there.
    if (pageChipOnListWithoutKind) return matchesChip(row, chip);
    const clientSide = view.kind === "starred" || view.kind === "sources" || (mergedHome && row.type === "source");
    return (!clientSide || (matchesChip(row, chip) && matchesAccess(row, access))) && sourceMetaMatches(row);
  });
  // The member filter's options: the distinct shelved_by ids the loaded rows
  // carry (member rows first is the toolbar's business), plus the system slot
  // when a row was shelved by nobody (null). Unknown ids stand for former
  // members; the toolbar labels them.
  const shelverIds = shelvedView
    ? [...new Set(state.rows.flatMap((row) => (row.type === "document" && row.doc.shelved_by ? [row.doc.shelved_by] : [])))].sort()
    : [];
  const shelvedHasSystem = shelvedView && state.rows.some((row) => row.type === "document" && row.doc.shelved_by === null);
  return {
    state: { ...state, rows },
    /** Whether the chip/access filters ran on the client here — decides which
     *  empty-state copy the list shows ("no matches" server-side vs "no
     *  matches in what is loaded" client-side). */
    clientFiltered,
    tree: nodes,
    folderIndex,
    /** The loaded document rows by id: a folder card takes its editor, date and level from its own row. */
    docById: new Map(state.rows.flatMap((row) => (row.type === "document" ? [[row.doc.id, row.doc]] : []))),
    starredIds: new Set(starred.map((fav) => fav.document_id)),
    starredCount: favorites.data ? starred.length : null,
    sourcesAvailable,
    // The trash never offers or sends manage/edit: the toolbar reads this
    // clamped value, not the raw state.
    access: (serverAccess ?? "all") as AccessFilter,
    setAccess,
    editor,
    setEditor,
    updated: updated.filter,
    setUpdated,
    sort,
    setSort,
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
