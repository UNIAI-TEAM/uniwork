"use client";

import { Download, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { exportPeopleUrl } from "@uniwork/core/api/endpoints/people";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { useDepartments, usePeople } from "@uniwork/core/people";
import { usePeopleViewStore } from "@uniwork/core/people/view-store";
import type { PeopleFilters } from "@uniwork/core/types/people";
import { CollectionPageHeader, CollectionPageHeaderLinkAction, CollectionPageState } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { PeopleCards } from "./people-cards";
import { PeopleCardsSkeleton, PeopleRowsSkeleton } from "./people-skeleton";
import { PeopleTable } from "./people-table";
import {
  countActiveFilters,
  EMPTY_PEOPLE_FILTERS,
  PeopleToolbar,
  type PeopleFilterState,
} from "./people-toolbar";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The organization's directory. Search is debounced because every keystroke
 * would otherwise become a query key, and the server folds diacritics, so
 * "nguyen van an" finds "Nguyễn Văn Ân".
 *
 * Two views over one query — a card grid and a dense table — chosen in the
 * toolbar and remembered per browser. Filters stay here rather than in that
 * store: they go to the server, and a filter remembered across visits would
 * quietly hide colleagues.
 */
export function PeopleView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filterState, setFilterState] = useState<PeopleFilterState>(EMPTY_PEOPLE_FILTERS);
  const { canExport } = usePeoplePermissions(orgSlug);
  const { data: departments } = useDepartments(orgSlug);
  const viewMode = usePeopleViewStore((s) => s.viewMode);
  const setViewMode = usePeopleViewStore((s) => s.setViewMode);
  const hiddenColumns = usePeopleViewStore((s) => s.hiddenColumns);
  const toggleColumn = usePeopleViewStore((s) => s.toggleColumn);

  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS);
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
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = usePeople(
    orgSlug,
    filters,
  );
  const people = useMemo(() => (data?.pages ?? []).flatMap((p) => p.people), [data]);
  const totalActive = data?.pages[0]?.total_active ?? 0;
  const filtered = query !== "" || countActiveFilters(filterState) > 0;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const hrefFor = useCallback(
    (userId: string) => paths.workspace(orgSlug, workspace.slug).person(userId),
    [orgSlug, workspace.slug],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Users}
        title={t("people.title")}
        count={totalActive}
        actions={
          canExport.allowed ? (
            // The response is a file the browser saves, so this is a plain
            // navigation rather than a fetch: the session cookie travels with
            // it and the bytes never enter the client.
            <CollectionPageHeaderLinkAction
              icon={Download}
              label={t("people.export")}
              href={exportPeopleUrl(orgSlug, runtimeConfig().apiUrl)}
              download
            />
          ) : null
        }
      />
      <PeopleToolbar
        search={rawQuery}
        onSearchChange={setRawQuery}
        shown={people.length}
        total={totalActive}
        departments={departments ?? []}
        filters={filterState}
        onFiltersChange={setFilterState}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
      />

      {isError ? (
        <CollectionPageState
          icon={Users}
          tone="destructive"
          role="alert"
          title={t("people.error_title")}
          description={t("people.error_description")}
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
      ) : people.length === 0 ? (
        <CollectionPageState
          icon={Users}
          title={filtered ? t("people.empty_filtered_title") : t("people.empty_title")}
          description={filtered ? t("people.empty_filtered_description") : t("people.empty_description")}
        />
      ) : viewMode === "table" ? (
        <PeopleTable
          people={people}
          hrefFor={hrefFor}
          hiddenColumns={hiddenColumns}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      ) : (
        <PeopleCards
          people={people}
          hrefFor={hrefFor}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      )}
    </div>
  );
}
