"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FolderOpen, Search, ShieldAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { DocListBulkBar } from "./doclist/bulk-bar";
import { bulkPlans, rowBulkActions, type BulkActionId, type DocListBulk } from "./doclist/bulk-actions";
import { docListSpec, type DocListScreen } from "./doclist/columns";
import type { GroupCollapse } from "./doclist/group-state";
import { docListGroupLabelKey, type DocListGroupId } from "./doclist/groups";
import { useDocListSelection } from "./doclist/selection";
import { libraryGroupSpans, specLadder } from "./library-columns";
import type { RowGroup } from "./library-rows";
import type { LibrarySort, LibrarySortColumn } from "./library-sort";
import { LibrarySortHeader } from "./library-sort-header";

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
  /** Người sửa, Cập nhật or Gần đây's segment is on: the empty line names "the filters", never a file type. */
  metaFiltered?: boolean;
  /** The create cards sit above the list, so the no-match hint may point at them. */
  cardsShown?: boolean;
  /** The no-matches copy of the open view when it is not the generic library
   *  wording (the shelved list names its own empty-filtered line). */
  emptyFiltered?: { title: string; description?: string };
  /** Custom label for the clear action in the empty-filtered state (e.g. "Xóa tìm kiếm" when searching). */
  clearFiltersLabel?: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onClearFilters: () => void;
  handlers: LibraryRowHandlers;
  /** The column sort of the table (UNI-2038, W12): the headers of the screen's sortable columns (Tên, its screen column,
   *  Người sửa, Cập nhật, Dung lượng) become buttons, and the one in `value` carries the arrow; absent, every header
   *  stays plain text (Thùng rác, whose order is fixed: Q2). The rows arrive in this order already. */
  sort?: { value: LibrarySort; onSort: (column: LibrarySortColumn) => void };
  /** The order of a screen that cannot sort (Thùng rac: `deleted` ascending, Q2): its column carries `aria-sort` and the
   *  same arrow as a sorted header, but no button, so every list shows exactly one sorted header. */
  fixedSort?: LibrarySort;
  /** The screen the table shows (doclist/columns.ts): its column order, its screen column and its narrow ladder. */
  screen?: DocListScreen;
  /** The Select column of the spec (bulk selection, W9): checkboxes and the bulk bar when `bulk` is given too. */
  selectable?: boolean;
  /** What the bulk bar runs (W9); absent, the Select column stays empty. */
  bulk?: DocListBulk;
  /** The folder, workspace and filters the rows were read with: a new value clears the selection (the screen is part of it already). */
  selectionKey?: string;
  /** The table's accessible name when it is not the Documents page's (Thùng rác names its own). */
  label?: string;
  /** The row a notification pointed at: ringed apart from hover (LibraryRowView `highlighted`). */
  highlightId?: string | null;
  /** The date groups' collapse state (W11); absent, the group headers do not collapse. */
  collapse?: GroupCollapse;
  /** The empty state's copy and actions, which depend on the open view. */
  empty: { title: string; description: string; actions?: ReactNode; icon?: LucideIcon };
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
  metaFiltered = false,
  cardsShown = false,
  emptyFiltered,
  clearFiltersLabel,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onClearFilters,
  handlers,
  sort,
  fixedSort,
  screen = "workspace",
  selectable = false,
  bulk,
  selectionKey = "",
  label,
  highlightId = null,
  collapse,
  empty,
}: DocumentsLibraryListProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  // Bulk selection (W9): a row is selectable when the bar has an action for it,
  // i.e. when its own row menu offers one the host supports.
  const bulkOn = selectable && Boolean(bulk);
  // The date groups of Gần đây, Được chia sẻ với tôi and Thùng rác (W11); "all" is a flat list.
  const showGroups = !(groups.length === 1 && groups[0]?.key === "all");
  // Only the rows a person can see take part in a selection: a collapsed group has none on screen, so select-all,
  // shift ranges, the count and the plans never reach them, and collapsing a group drops its rows from the selection.
  const rows = groups.filter((group) => !(showGroups && collapse?.isCollapsed(group.key))).flatMap((group) => group.rows);
  const actionsByRow = new Map<string, ReadonlySet<BulkActionId>>(
    bulkOn && bulk
      ? rows.map((row) => [row.id, new Set([...rowBulkActions(row, handlers, screen)].filter(bulk.supports))])
      : [],
  );
  const selectableIds = rows.filter((row) => (actionsByRow.get(row.id)?.size ?? 0) > 0).map((row) => row.id);
  const selection = useDocListSelection(selectableIds, `${screen}|${selectionKey}`);
  const selectedCount = selection.ids.length;
  const clearSelection = selection.clear;
  useEffect(() => {
    // Esc clears the selection from anywhere in the list; a native listener on
    // the box, so the portalled menus and dialogs keep their own Esc.
    const box = boxRef.current;
    if (!box || selectedCount === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    box.addEventListener("keydown", onKey);
    return () => box.removeEventListener("keydown", onKey);
  }, [selectedCount, clearSelection]);

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
          title={emptyFiltered?.title ?? t("documents.library.no_matches_title")}
          description={
            emptyFiltered && "description" in emptyFiltered
              ? emptyFiltered.description
              : t(
                  metaFiltered
                    ? clientFiltered && hasMore
                      ? "documents.home.no_matches_filters_more_description"
                      : "documents.home.no_matches_filters_description"
                    : clientFiltered && hasMore
                      ? "documents.home.no_matches_more_description"
                      : cardsShown
                        ? "documents.home.no_matches_description"
                        : "documents.home.no_matches_plain_description",
                )
          }
          role="status"
          actions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hasMore ? (
                <Button type="button" variant="outline" size="sm" aria-disabled={loadingMore || undefined} aria-busy={loadingMore || undefined} onClick={() => { if (!loadingMore) onLoadMore(); }}>
                  {loadingMore ? t("documents.library.loading_more") : t("documents.library.load_more")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
                {clearFiltersLabel ?? t("documents.library.clear_filters")}
              </Button>
            </div>
          }
        />
      );
    }
    return <CollectionPageState icon={empty.icon ?? FolderOpen} title={empty.title} description={empty.description} role="status" actions={empty.actions} />;
  }

  const ladder = specLadder(screen, { selectable });
  const groupSpans = libraryGroupSpans(ladder);
  const specColumns = docListSpec(screen).columns;
  const specLabels = new Map(specColumns.map((column) => [column.id as string, column.labelKey]));
  const columnLabel = (id: string): string => specLabels.get(id) ?? "";
  const sortKeys = new Map(specColumns.map((column) => [column.id as string, column.sortKey]));
  // The Name header's caption for a sort by a column the ladder can hide (Người sửa gần nhất, Dung lượng).
  const hintColumn = sort && (sort.value.column === "editor" || sort.value.column === "size") ? sort.value.column : null;
  const hintLabel = hintColumn ? t(columnLabel(hintColumn)) : "";
  const hint = sort && hintColumn
    ? {
        label: hintLabel,
        hides: ladder.sortHintHides[hintColumn],
        sr: `${t("documents.home.sort.column", { column: hintLabel })}, ${t(sort.value.order === "asc" ? "documents.home.sort.ascending" : "documents.home.sort.descending")}`,
      }
    : null;
  const HintArrow = sort?.value.order === "asc" ? ArrowUp : ArrowDown;
  // The group title spans the columns that are on at every width (Select, Name, Actions).
  const alwaysOn = ladder.columns.filter((column) => !column.cell).length;

  const selectedRows = rows.filter(
    (row): row is Extract<typeof row, { type: "document" }> => row.type === "document" && selection.isSelected(row.id),
  );
  const plans =
    bulk && selectedRows.length > 0
      ? bulkPlans(selectedRows, (row) => actionsByRow.get(row.id) ?? new Set(), screen, bulk.supports, (doc) => doc.title || t("documents.detail.untitled"))
      : [];

  return (
    <div ref={boxRef} className="@container/library flex flex-col">
      {bulk && selectedRows.length > 0 ? (
        <DocListBulkBar count={selectedRows.length} plans={plans} busy={bulk.busy} onRun={(plan) => bulk.run(plan, clearSelection)} onClear={clearSelection} />
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* tabIndex -1: a host may move focus onto the table itself (Thùng rác after Load more). */}
        <table tabIndex={-1} className="w-full table-fixed border-collapse text-left" aria-label={label ?? t("documents.page.title")}>
          {/*
            Every column but Name and Actions joins by the width of this list
            (`@container/library`, see library-columns.ts), never the
            viewport: the docs aside and the sidebar take ~500px of it. Name
            takes what the fixed columns leave and never drops below its floor
            (nameFloor, 288 / 260).
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
              {ladder.columns.map((column) => {
                // The spec names the key each column sorts by; Truy cập and Thao tác have none.
                const sortable = sort ? (sortKeys.get(column.id) ?? null) : null;
                const fixed = !sort && fixedSort && sortKeys.get(column.id) === fixedSort.column ? fixedSort : null;
                const FixedArrow = fixed?.order === "desc" ? ArrowDown : ArrowUp;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      sortable && sort
                        ? sort.value.column !== sortable
                          ? "none"
                          : sort.value.order === "asc"
                            ? "ascending"
                            : "descending"
                        : fixed
                          ? fixed.order === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                    }
                    className={cn("py-2 font-medium", column.pad ?? "px-3", column.cell)}
                  >
                    {sortable && sort ? (
                      hint && column.id === "name" ? (
                        <div className="flex min-w-0 items-center gap-1">
                          <LibrarySortHeader column={sortable} label={t(columnLabel(column.id))} sort={sort.value} onSort={sort.onSort} />
                          {/* RFD-23: the sorted column is off at this width, so Name carries its sort (own rung's hide class). */}
                          <span className={cn("inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap text-foreground", hint.hides)}>
                            <span aria-hidden>· {hint.label}</span>
                            <HintArrow aria-hidden className="size-3.5 shrink-0" />
                            <span className="sr-only">{hint.sr}</span>
                          </span>
                        </div>
                      ) : (
                        <LibrarySortHeader column={sortable} label={t(columnLabel(column.id))} sort={sort.value} onSort={sort.onSort} />
                      )
                    ) : fixed ? (
                      <span className="inline-flex max-w-full items-center gap-1 text-foreground">
                        <span className="truncate">{t(columnLabel(column.id))}</span>
                        <FixedArrow aria-hidden className="size-3.5 shrink-0" />
                      </span>
                    ) : column.id === "select" && bulkOn && selectableIds.length > 0 ? (
                      // Select all: every selectable row loaded so far; mixed on a partial selection.
                      <>
                        <span className="sr-only">{t(columnLabel(column.id))}</span>
                        <Checkbox
                          className="pointer-coarse:after:-inset-3.5"
                          checked={selection.all === true}
                          indeterminate={selection.all === "mixed"}
                          onCheckedChange={() => selection.setAll(selection.all !== true)}
                          aria-label={t("documents.list.bulk.select_all")}
                        />
                      </>
                    ) : column.id === "actions" || column.id === "select" ? (
                      <span className="sr-only">{t(columnLabel(column.id))}</span>
                    ) : (
                      t(columnLabel(column.id))
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {groups.map((group) => {
            const collapsed = showGroups && Boolean(collapse?.isCollapsed(group.key));
            const title = t(docListGroupLabelKey(group.key as DocListGroupId));
            return (
              // A grouped row is indented 28px under its header (the shared format rules).
              <tbody key={group.key} className={showGroups ? "[&_td[data-column=name]]:pl-10" : undefined}>
                {showGroups ? (
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="rowgroup" colSpan={alwaysOn} data-library-group className="whitespace-nowrap px-3 py-1.5 text-left text-caption font-medium text-foreground">
                      {collapse ? (
                        <button
                          type="button"
                          aria-expanded={!collapsed}
                          onClick={() => collapse.onToggle(group.key)}
                          className="-mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 font-medium transition-colors hover:text-foreground pointer-coarse:min-h-11"
                        >
                          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
                          {title}
                          <span className="font-mono tabular-nums text-muted-foreground">{group.rows.length}</span>
                        </button>
                      ) : (
                        <>
                          {title}
                          <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{group.rows.length}</span>
                        </>
                      )}
                    </th>
                    {groupSpans.map((spanner) => (
                      <th key={spanner.cell} aria-hidden colSpan={spanner.span} className={spanner.cell} />
                    ))}
                  </tr>
                ) : null}
                {collapsed ? null : group.rows.map((row) => (
                  <LibraryRowView
                    key={row.id}
                    row={row}
                    handlers={handlers}
                    ladder={ladder}
                    screen={screen}
                    highlighted={row.id === highlightId}
                    selection={
                      bulkOn
                        ? {
                            selected: selection.isSelected(row.id),
                            onToggle: actionsByRow.get(row.id)?.size ? (range) => selection.toggle(row.id, range) : undefined,
                          }
                        : undefined
                    }
                  />
                ))}
              </tbody>
            );
          })}
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
