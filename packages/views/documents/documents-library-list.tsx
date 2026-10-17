"use client";

import type { ReactNode } from "react";
import { FolderOpen, Search, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Member } from "@uniwork/core/types/workspace";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { TrashRowView, type TrashRowActions } from "./documents-trash-row";
import { libraryGroupSpans, libraryLadder, trashLadder, type LibraryColumnId } from "./library-columns";
import { rowTypeKey, type RowGroup } from "./library-rows";

const COLUMN_LABEL: Record<LibraryColumnId, string> = {
  name: "documents.home.columns.name",
  type: "documents.home.columns.type",
  source: "documents.home.columns.source",
  editor: "documents.home.columns.editor",
  updated: "documents.home.columns.updated",
  size: "documents.home.columns.size",
  access: "documents.home.columns.my_access",
  visibility: "documents.home.columns.visibility",
  actions: "documents.home.columns.actions",
  deleted_by: "documents.trash.columns.deleted_by",
  deleted_at: "documents.trash.columns.deleted_at",
  purge_in: "documents.trash.columns.purge_in",
};

// The trash table reads its own header keys (documents.trash.columns.*) for
// every column; it shares the shell, the group spanners and the states only.
const TRASH_COLUMN_LABEL: Record<LibraryColumnId, string> = {
  ...COLUMN_LABEL,
  name: "documents.trash.columns.name",
  actions: "documents.trash.columns.actions",
};

export interface DocumentsLibraryListProps {
  groups: RowGroup[];
  /** First page still loading: skeleton rows, never fake counts or rows. */
  loading: boolean;
  /** The query failed and no rows are cached; `permission` is a 403 tab. */
  failure: "error" | "permission" | null;
  /** The rows are empty because a filter is on, not because the library is.
   *  "server" (default when set): the server already filtered the list, so
   *  the empty line says simply "no matches". "client": the filter ran over
   *  only what has loaded (merged source rows, starred, the sources view), so
   *  while the server has more the copy says so and offers the next page. */
  filteredBy?: "server" | "client" | null;
  /** The access filter (not only the type chip) is on, so the empty line names access, not file type. */
  accessFiltered?: boolean;
  /** The type chip is on too: with both on, the empty line names the filters, not one of them. */
  typeFiltered?: boolean;
  /** The create cards sit above the list, so the no-match hint may point at them. */
  cardsShown?: boolean;
  /** The Thùng rác layout (RESTORE-01): the trash ladder and TrashRowView
   *  with its own columns and per-row commands instead of the library cells. */
  trash?: {
    actions: TrashRowActions;
    /** The workspace member list by user id, feeding the Xóa bởi column. */
    members: ReadonlyMap<string, Member>;
    /** True once the members query has answered; until then an unknown id is "still loading", not "former member". */
    membersReady: boolean;
    /** The trashed document a notification pointed at (`?focus=`); its row is highlighted and scrolled to. */
    focusId?: string | null;
    /** Claims the one-time scroll + focus for a focus id; false once it was applied. */
    claimFocus?: (documentId: string) => "focus" | "reveal" | null;
  };
  /** Show the Type column (`documents.home.columns.type`) when an open folder is displayed. */
  showType?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onClearFilters: () => void;
  handlers: LibraryRowHandlers;
  /** The empty state's copy and actions, which depend on the open view. */
  empty: { title: string; description: string; actions?: ReactNode };
}

/**
 * The library body: loading skeleton, empty/error states and the rows the
 * server returned, grouped. Presentational — the page view owns the queries,
 * so every row on screen comes from a server answer and nothing is
 * optimistically inserted.
 */
export function DocumentsLibraryList({
  groups,
  loading,
  failure,
  filteredBy = null,
  accessFiltered = false,
  typeFiltered = false,
  cardsShown = false,
  trash,
  showType = false,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onClearFilters,
  handlers,
  empty,
}: DocumentsLibraryListProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label={t("documents.library.loading")}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (failure) {
    const permission = failure === "permission";
    return (
      <CollectionPageState
        icon={ShieldAlert}
        title={t(permission ? "documents.library.permission_title" : "documents.library.error_title")}
        description={t(permission ? "documents.library.permission_description" : "documents.library.error_description")}
        tone={permission ? undefined : "destructive"}
        role={permission ? "status" : "alert"}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("documents.library.retry")}
          </Button>
        }
      />
    );
  }

  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (total === 0) {
    if (filteredBy) {
      // "no matches" copy (UNI-1868): the server filtered the list already, so
      // the plain line stands. Only a client-filtered view may honestly say
      // "no matches in what is loaded" while more pages wait.
      const clientFiltered = filteredBy === "client";
      return (
        <CollectionPageState
          icon={Search}
          title={t("documents.library.no_matches_title")}
          description={t(
            accessFiltered && typeFiltered
              ? clientFiltered && hasMore
                ? "documents.home.no_matches_filters_more_description"
                : "documents.home.no_matches_filters_description"
              : accessFiltered
                ? clientFiltered && hasMore
                  ? "documents.home.no_matches_access_more_description"
                  : "documents.home.no_matches_access_description"
                : clientFiltered && hasMore
                  ? "documents.home.no_matches_more_description"
                  : cardsShown
                    ? "documents.home.no_matches_description"
                    : "documents.home.no_matches_plain_description",
          )}
          role="status"
          actions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hasMore ? (
                <Button type="button" variant="outline" size="sm" aria-disabled={loadingMore || undefined} aria-busy={loadingMore || undefined} onClick={() => { if (!loadingMore) onLoadMore(); }}>
                  {loadingMore ? t("documents.library.loading_more") : t("documents.library.load_more")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
                {t("documents.library.clear_filters")}
              </Button>
            </div>
          }
        />
      );
    }
    return <CollectionPageState icon={FolderOpen} title={empty.title} description={empty.description} role="status" actions={empty.actions} />;
  }

  const showGroups = !(groups.length === 1 && groups[0]?.key === "all");
  const groupTitle = (group: RowGroup): string => {
    if (group.title) return group.title;
    if (group.key === "folders") return t("documents.home.groups.type.folder");
    if (group.key === "unfiled") return t("documents.home.groups.unfiled");
    if (group.key.startsWith("origin:")) return t(`documents.home.origin.${group.key.slice(7)}`);
    if (group.key.startsWith("type:")) return t(`documents.home.groups.type.${group.key.slice(5)}`, { defaultValue: t("documents.home.groups.type.other") });
    return "";
  };

  const ladder = trash ? trashLadder() : libraryLadder(showType);
  const groupSpans = libraryGroupSpans(ladder);
  const columnLabel = trash ? TRASH_COLUMN_LABEL : COLUMN_LABEL;
  // A trash row names its parent folder when the parent is itself a listed
  // trash row; the row titles by id are enough for that lookup.
  const trashTitles = trash
    ? new Map(groups.flatMap((group) => group.rows.flatMap((row) => (row.type === "document" ? [[row.id, row.doc.title] as const] : []))))
    : null;

  return (
    <div className="@container/library flex flex-col">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-left" aria-label={t("documents.page.title")}>
          {/*
            Every column but Name and Actions joins by the width of this list
            (`@container/library`, see library-columns.ts), never the
            viewport: the docs aside and the sidebar take ~500px of it. Name
            takes what the fixed columns leave and never drops below 280px.
            The group header spans exactly the columns on screen (a colSpan
            wider than the visible columns would add implicit columns that
            squeeze Name to nothing).
          */}
          <colgroup>
            {ladder.columns.map((column) => (
              <col key={column.id} className={column.col || undefined} />
            ))}
          </colgroup>
          <thead className={ladder.head}>
            <tr className="border-b border-border text-caption text-muted-foreground">
              {ladder.columns.map((column) => (
                <th key={column.id} scope="col" className={cn("px-3 py-2 font-medium", column.cell)}>
                  {column.id === "actions" ? <span className="sr-only">{t(columnLabel[column.id])}</span> : t(columnLabel[column.id])}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key}>
              {showGroups ? (
                <tr className="border-b border-border bg-muted/40">
                  <th scope="rowgroup" colSpan={2} data-library-group className="whitespace-nowrap px-3 py-1.5 text-left text-caption font-medium text-foreground">
                    {groupTitle(group)}
                    <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{group.rows.length}</span>
                  </th>
                  {groupSpans.map((spanner) => (
                    <th key={spanner.cell} aria-hidden colSpan={spanner.span} className={spanner.cell} />
                  ))}
                </tr>
              ) : null}
              {group.rows.map((row) =>
                trash ? (
                  <TrashRowView
                    key={row.id}
                    row={row}
                    members={trash.members}
                    membersReady={trash.membersReady}
                    parentTitle={row.type === "document" && row.doc.parent_id ? (trashTitles?.get(row.doc.parent_id) ?? null) : null}
                    ladder={ladder}
                    trash={trash.actions}
                    focused={trash.focusId === row.id}
                    claimFocus={trash.claimFocus}
                    onOpen={handlers.onOpen}
                  />
                ) : (
                  <LibraryRowView
                    key={row.id}
                    row={row}
                    handlers={handlers}
                    ladder={ladder}
                    typeCell={showType ? t(rowTypeKey(row)) : undefined}
                  />
                ),
              )}
            </tbody>
          ))}
        </table>
      </div>
      {hasMore ? (
        <div className="flex justify-center p-4">
          <Button type="button" variant="outline" size="sm" aria-disabled={loadingMore || undefined} aria-busy={loadingMore} onClick={() => { if (!loadingMore) onLoadMore(); }}>
            {loadingMore ? t("documents.library.loading_more") : t("documents.library.load_more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
