"use client";

import { Download, RotateCw, SearchX, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportPeopleCsv } from "@uniwork/core/api/endpoints/people";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { useDepartments, usePeople } from "@uniwork/core/people";
import { usePeopleViewStore } from "@uniwork/core/people/view-store";
import type { PeopleFilters } from "@uniwork/core/types/people";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toast } from "sonner";
import { Notice } from "../common/notice";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { toastApiError } from "../toast-api-error";
import { PeopleCards } from "./people-cards";
import { PeopleDepartmentBar } from "./people-department-bar";
import { PeopleCardsSkeleton, PeopleRowsSkeleton } from "./people-skeleton";
import { PeopleTable } from "./people-table";
import {
  countActiveFilters,
  EMPTY_PEOPLE_FILTERS,
  PeopleToolbar,
  type PeopleFilterState,
} from "./people-toolbar";
import { useStartChat } from "./use-start-chat";

const SEARCH_DEBOUNCE_MS = 250;
/** The server ignores a shorter query (`minSearchQuery` in server/internal/service). */
const MIN_SEARCH_LENGTH = 2;

/** Hand a fetched file to the browser to save. */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next task: Safari reads the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The organization's directory. Search is debounced because every keystroke
 * would otherwise become a query key, and the server folds diacritics, so
 * "nguyen van an" finds "Nguyễn Văn Ân".
 *
 * Two views over one query — a card grid and a dense table — chosen in the
 * toolbar and remembered per browser. Filters stay here rather than in that
 * store: they go to the server, and a filter remembered across visits would
 * quietly hide colleagues.
 *
 * The header counts the organization; once a search or filter is set the
 * toolbar counts the matches, both as the server reports them — the rows
 * loaded so far are a page, not an answer.
 *
 * A new search or filter keeps the last answer on screen, dimmed and marked
 * busy, until the new one lands: dropping to a skeleton on every keystroke
 * made the page flash and lose its place.
 */
export function PeopleView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const wsPaths = paths.workspace(orgSlug, workspace.slug);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filterState, setFilterState] = useState<PeopleFilterState>(EMPTY_PEOPLE_FILTERS);
  const { canExport, canManageMembers } = usePeoplePermissions(orgSlug);
  const { data: departments } = useDepartments(orgSlug);
  const viewMode = usePeopleViewStore((s) => s.viewMode);
  const setViewMode = usePeopleViewStore((s) => s.setViewMode);
  const hiddenColumns = usePeopleViewStore((s) => s.hiddenColumns);
  const toggleColumn = usePeopleViewStore((s) => s.toggleColumn);
  const startChat = useStartChat();

  useEffect(() => {
    // A query the server would ignore is no search here either: it would
    // otherwise count as a filter, reset the list and relabel the export.
    const id = setTimeout(() => {
      const trimmed = rawQuery.trim();
      setQuery([...trimmed].length >= MIN_SEARCH_LENGTH ? trimmed : "");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const filters: PeopleFilters = useMemo(
    () => ({
      q: query,
      department_id: filterState.departmentId,
      role: filterState.role,
      status: filterState.status,
    }),
    [filterState, query],
  );
  const {
    data,
    isLoading,
    isError,
    isPlaceholderData,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePeople(orgSlug, filters);
  const [exporting, setExporting] = useState(false);
  const people = useMemo(() => (data?.pages ?? []).flatMap((p) => p.people), [data]);
  const firstPage = data?.pages[0];
  const totalActive = firstPage?.total_active ?? 0;
  const total = firstPage?.total ?? people.length;
  // A new answer starts at its top, not wherever the last one was scrolled to.
  const listKey = JSON.stringify(filters);
  const searching = query !== "";
  const filtering = countActiveFilters(filterState) > 0;
  const narrowed = searching || filtering;
  // What the rows on screen were fetched for. While a new answer is on its
  // way the previous one stays up, and an empty state has to describe that
  // one: clearing a search that found nobody must not flash "nobody here".
  const [shown, setShown] = useState({ query, filterState });
  if (data && !isPlaceholderData && (shown.query !== query || shown.filterState !== filterState)) {
    setShown({ query, filterState });
  }
  const shownSearching = shown.query !== "";
  const shownFiltering = countActiveFilters(shown.filterState) > 0;
  const shownNarrowed = shownSearching || shownFiltering;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const runExport = () => {
    setExporting(true);
    exportPeopleCsv(orgSlug, filters)
      .then((blob) => saveFile(blob, `${orgSlug}-people.csv`))
      .catch((err) => toastApiError(err, t("people.export_failed")))
      .finally(() => setExporting(false));
  };
  const clearSearch = () => {
    setRawQuery("");
    setQuery("");
  };
  const clearAll = () => {
    clearSearch();
    setFilterState(EMPTY_PEOPLE_FILTERS);
  };

  const hrefFor = useCallback(
    (userId: string) => paths.workspace(orgSlug, workspace.slug).person(userId),
    [orgSlug, workspace.slug],
  );
  // A directory holding only the reader is the moment to invite, not an empty
  // state: the reader is in it, so the list is not empty.
  const alone = !shownNarrowed && !hasNextPage && people.length === 1 && people[0]?.is_self === true;

  return (
    // `people` is the pane the toolbar asks about: the table switches to its
    // narrow zone on the same width, and the column switches go with it.
    <div className="@container/people flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Users}
        tone={moduleTone("people")}
        title={t("people.title")}
        count={isError ? undefined : totalActive}
        actions={
          canExport.allowed ? (
            // Fetched, then saved: a refused or failed export says so here
            // instead of leaving the app for the server's error body. It
            // carries the same filters as the list, so what is saved is what
            // is on screen.
            <CollectionPageHeaderAction
              icon={Download}
              label={narrowed ? t("people.export_filtered") : t("people.export")}
              onClick={runExport}
              disabled={exporting}
              aria-busy={exporting || undefined}
            />
          ) : null
        }
      />
      <PeopleToolbar
        search={rawQuery}
        onSearchChange={setRawQuery}
        // The previous answer's count would name the wrong search while the
        // new one loads, so nothing is said until it lands.
        matching={narrowed && firstPage && !isPlaceholderData ? firstPage.total : null}
        filters={filterState}
        onFiltersChange={setFilterState}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
      />
      <PeopleDepartmentBar
        departments={departments ?? []}
        value={filterState.departmentId}
        onChange={(departmentId) => setFilterState({ ...filterState, departmentId })}
        showCounts={filterState.status === EMPTY_PEOPLE_FILTERS.status}
      />

      {isError ? (
        <CollectionPageState
          icon={Users}
          tone="destructive"
          role="alert"
          title={t("people.error_title")}
          description={t("people.error_description")}
          actions={
            <Button variant="outline" onClick={() => void refetch()} aria-busy={isRefetching || undefined}>
              <RotateCw aria-hidden="true" className={isRefetching ? "motion-safe:animate-spin" : undefined} />
              {t("common.retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        // Skeletons, not a spinner: they hold the layout still and say what is
        // coming, so the first page lands in place instead of pushing the page
        // around (PRODUCT.md, "speed is a feature").
        <div className="min-h-0 flex-1 overflow-hidden px-5 pt-4">
          {viewMode === "table" ? (
            <PeopleRowsSkeleton count={8} />
          ) : (
            <PeopleCardsSkeleton count={8} />
          )}
        </div>
      ) : people.length === 0 && !shownNarrowed ? (
        <CollectionPageState
          icon={Users}
          tone={moduleTone("people")}
          title={t("people.empty_title")}
          description={t("people.empty_description")}
        />
      ) : people.length === 0 ? (
        <CollectionPageState
          icon={SearchX}
          tone={moduleTone("people")}
          title={
            shownSearching && !shownFiltering
              ? t("people.empty_search_title", { query: shown.query })
              : t("people.empty_filtered_title")
          }
          description={
            shownSearching && !shownFiltering
              ? t("people.empty_search_description")
              : t("people.empty_filtered_description")
          }
          actions={
            shownSearching && !shownFiltering ? (
              <Button variant="outline" onClick={clearSearch}>
                {t("people.search_clear")}
              </Button>
            ) : (
              <Button variant="outline" onClick={clearAll}>
                {t("people.filter_clear_all")}
              </Button>
            )
          }
        />
      ) : (
        <div
          key={listKey}
          aria-busy={isPlaceholderData || undefined}
          className={cn(
            "flex min-h-0 flex-1 flex-col transition-opacity duration-[var(--duration-fast)]",
            isPlaceholderData && "opacity-60",
          )}
        >
          {alone ? (
            <div className="px-5 pt-3">
              <Notice
                tone="info"
                layout="inline"
                icon={UserPlus}
                live="off"
                action={
                  canManageMembers.allowed ? (
                    <AppLink
                      href={`${wsPaths.settings()}?tab=organization`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {t("people.alone_invite")}
                    </AppLink>
                  ) : null
                }
              >
                <span className="font-semibold">{t("people.alone_title")}</span>{" "}
                {canManageMembers.allowed ? t("people.alone_description_admin") : t("people.alone_description")}
              </Notice>
            </div>
          ) : null}
          {viewMode === "table" ? (
            <PeopleTable
              people={people}
              total={total}
              hrefFor={hrefFor}
              hiddenColumns={hiddenColumns}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={loadMore}
            />
          ) : (
            <PeopleCards
              people={people}
              total={total}
              hrefFor={hrefFor}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={loadMore}
              onChat={startChat}
            />
          )}
        </div>
      )}
    </div>
  );
}
