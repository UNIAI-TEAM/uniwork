"use client";

import type { ReactNode } from "react";
import { FolderOpen, Search, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { rowTypeKey, type RowGroup } from "./library-rows";

export interface DocumentsLibraryListProps {
  groups: RowGroup[];
  /** First page still loading: skeleton rows, never fake counts or rows. */
  loading: boolean;
  /** The query failed and no rows are cached; `permission` is a 403 tab. */
  failure: "error" | "permission" | null;
  /** The rows are empty because a filter is on, not because the library is. */
  filtered: boolean;
  /** The access filter (not only the type chip) is on, so the empty line names access, not file type. */
  accessFiltered?: boolean;
  /** The create cards sit above the list, so the no-match hint may point at them. */
  cardsShown?: boolean;
  /** Show the archive badge on every row (the archive tab). */
  archived?: boolean;
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
  filtered,
  accessFiltered = false,
  cardsShown = false,
  archived = false,
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
    if (filtered) {
      // The type filter runs on the pages already loaded; while the server has
      // more, "no matches" is not an answer yet, so offer the next page.
      return (
        <CollectionPageState
          icon={Search}
          title={t("documents.library.no_matches_title")}
          description={t(
            accessFiltered
              ? hasMore
                ? "documents.home.no_matches_access_more_description"
                : "documents.home.no_matches_access_description"
              : hasMore
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
    if (group.key === "unfiled") return t("documents.home.groups.unfiled");
    if (group.key.startsWith("origin:")) return t(`documents.home.origin.${group.key.slice(7)}`);
    if (group.key.startsWith("type:")) return t(`documents.home.groups.type.${group.key.slice(5)}`, { defaultValue: t("documents.home.groups.type.other") });
    return "";
  };

  return (
    <div className="flex flex-col">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-left" aria-label={t("documents.page.title")}>
          {/*
            Below `md` only Name and Actions exist: the other columns are
            display:none, so the group header spans two columns there and all
            columns from `md`, and My access + Visibility from `lg` (a colSpan
            wider than the visible columns would add implicit columns that
            squeeze Name to nothing). Name takes what the fixed columns leave.
          */}
          <colgroup>
            <col />
            {showType ? <col className="hidden w-36 md:table-column" /> : null}
            <col className="hidden w-28 md:table-column" />
            <col className="hidden w-36 md:table-column" />
            <col className="hidden w-24 md:table-column" />
            <col className="hidden w-24 md:table-column" />
            <col className="hidden w-28 lg:table-column" />
            <col className="hidden w-32 lg:table-column" />
            <col className="w-14 md:w-24" />
          </colgroup>
          <thead className="hidden bg-muted/50 md:table-header-group">
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.name")}</th>
              {showType ? <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.type")}</th> : null}
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.source")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.editor")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.updated")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.size")}</th>
              <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">{t("documents.home.columns.my_access")}</th>
              <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">{t("documents.home.columns.visibility")}</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("documents.home.columns.actions")}</span></th>
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
                  <th aria-hidden colSpan={showType ? 5 : 4} className="hidden md:table-cell" />
                  <th aria-hidden colSpan={2} className="hidden lg:table-cell" />
                </tr>
              ) : null}
              {group.rows.map((row) => (
                <LibraryRowView
                  key={row.id}
                  row={row}
                  handlers={handlers}
                  archived={archived}
                  typeCell={showType ? t(rowTypeKey(row)) : undefined}
                />
              ))}
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
