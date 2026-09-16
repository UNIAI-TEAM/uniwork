"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  TableFilter,
  TableGroupsResult,
  TableQuery,
} from "@uniwork/core/api/endpoints/tasks-table";
import { ApiError } from "@uniwork/core/api/http";
import { useTableGroups } from "@uniwork/core/tasks";
import { normalizeTableQuery, tableGroupsBody } from "@uniwork/core/tasks/surface/table-query";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task, TaskProperty } from "@uniwork/core/types";
import { propertyOptions } from "../properties/property-value";
import { useCursorBranches } from "../surface/use-cursor-branches";
import {
  buildDisplayRows,
  expandedParentsInView,
  planBranches,
  tableBranchKey,
  tableGroupByParam,
  tableParentsSignature,
  type TableParentRef,
} from "./table-branches";
import {
  TABLE_PAGE_SIZE,
  groupLabelFromDescriptor,
  type TaskTableDisplayRow,
} from "./table-view-model";
import { useDebouncedValue } from "./use-debounced-value";

const EMPTY_TASKS: Task[] = [];
const NO_PARENTS: TableParentRef[] = [];
const SEARCH_DEBOUNCE_MS = 300;
const UNSUPPORTED_GROUP = "unsupported_group";

export interface UseTableViewDataResult {
  displayRows: TaskTableDisplayRow[];
  loadedTasks: Task[];
  total: number;
  isLoading: boolean;
  isRefreshing: boolean;
  /** Rows or groups on screen are the previous query's, while a changed query loads. */
  isShowingPrevious: boolean;
  isEmpty: boolean;
  /** The search the shown rows answer, trimmed; empty when there is none. */
  search: string;
  groupBy: string;
  /** The table has nothing to show because its groups (or its only branch) failed. */
  groupsError: boolean;
  /** Asks the failed groups, or the failed ungrouped table, again. */
  retry: () => void;
}

/**
 * Table data on the cursor table API: the server filters, searches, sorts and
 * groups. Each open group (or the whole table, ungrouped) is a root branch, and
 * each expanded parent on screen a child branch under the same query, paged
 * through `useCursorBranches`. Parents start closed; the store lists the open
 * ones. With sub-tasks hidden the table asks `hierarchy: false` and lists every
 * matching task flat.
 */
export function useTableViewData({
  workspaceId,
  filter,
  search = "",
  assigneeNames,
  properties,
}: {
  workspaceId: string;
  filter?: TableFilter;
  search?: string;
  assigneeNames?: ReadonlyMap<string, string>;
  /** The property catalog by id; a select property's groups take their option colour. */
  properties?: ReadonlyMap<string, TaskProperty>;
}): UseTableViewDataResult {
  const { t } = useTranslation();
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const setTableGrouping = useViewStore((s) => s.setTableGrouping);
  const tableCollapsedGroups = useViewStore((s) => s.tableCollapsedGroups);
  const tableExpandedParents = useViewStore((s) => s.tableExpandedParents);
  const hierarchy = useViewStore((s) => s.showSubTasks);
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const groupBy = tableGroupByParam(tableGrouping);
  const grouped = groupBy !== "none";

  const query = useMemo<TableQuery>(
    () =>
      normalizeTableQuery({
        filter,
        search: debouncedSearch,
        sort: { field: sortBy, direction: sortDirection },
      }),
    [debouncedSearch, filter, sortBy, sortDirection],
  );

  const groupsQuery = useTableGroups(
    workspaceId,
    grouped ? tableGroupsBody({ query, groupBy }) : null,
    { keepPrevious: true },
  );
  const unsupportedGroup =
    groupsQuery.error instanceof ApiError && groupsQuery.error.code === UNSUPPORTED_GROUP;
  const groups: TableGroupsResult["groups"] | undefined = grouped
    ? groupsQuery.data?.groups
    : undefined;

  // The server cannot group by this (an archived or retyped property): fall
  // back to no grouping, and say so once for this failure.
  const handledGroupErrors = useRef(new WeakSet<object>());
  useEffect(() => {
    const error = groupsQuery.error;
    if (!(error instanceof ApiError) || error.code !== UNSUPPORTED_GROUP) return;
    if (handledGroupErrors.current.has(error)) return;
    handledGroupErrors.current.add(error);
    setTableGrouping("none");
    toast.info(t("tasks.table.grouping_reset"));
  }, [groupsQuery.error, setTableGrouping, t]);

  const collapsedGroups = useMemo(() => new Set(tableCollapsedGroups), [tableCollapsedGroups]);
  const expandedIds = useMemo(() => new Set(tableExpandedParents), [tableExpandedParents]);

  // Child branches need the group each open parent sits in, which only the
  // loaded rows know: the walk below finds them, and a changed list plans again.
  const [parentsInView, setParentsInView] = useState<TableParentRef[]>(NO_PARENTS);

  const branches = planBranches({
    groupBy,
    groups,
    collapsedGroups,
    hierarchy,
    expandedParents: parentsInView,
    baseBody: { query, group_by: groupBy, hierarchy, limit: TABLE_PAGE_SIZE },
  });
  const {
    byKey,
    isRefreshing: branchesRefreshing,
    isShowingPrevious: branchesShowingPrevious,
  } = useCursorBranches(workspaceId, branches, {
    keepPreviousFirstPage: true,
  });

  const walkInput = useMemo(
    () => ({ groupBy, groups, branches: byKey, collapsedGroups, hierarchy, expandedParents: expandedIds }),
    [byKey, collapsedGroups, expandedIds, groupBy, groups, hierarchy],
  );
  const nextParents = useMemo(
    () => keepPendingParents(expandedParentsInView(walkInput), parentsInView, walkInput),
    [walkInput, parentsInView],
  );
  if (tableParentsSignature(nextParents) !== tableParentsSignature(parentsInView)) {
    setParentsInView(nextParents.length > 0 ? nextParents : NO_PARENTS);
  }

  const groupLabel = useCallback(
    (group: TableGroupsResult["groups"][number]) => {
      const translated = (key: string, fallback: string) => {
        const text = t(key);
        return text === key ? fallback : text;
      };
      return groupLabelFromDescriptor(group.key, group.value, {
        translateStatus: (status) => translated(`tasks.status_${status}`, status),
        translatePriority: (priority) => translated(`tasks.priority_${priority}`, priority),
        unassigned: t("tasks.unassigned"),
        noProject: t("tasks.table.no_project"),
        noValue: t("tasks.table.no_value"),
        checked: t("tasks.table.checked"),
        unchecked: t("tasks.table.unchecked"),
        resolveAssignee: (id) => assigneeNames?.get(id),
      });
    },
    [assigneeNames, t],
  );

  const groupColor = useCallback(
    (group: TableGroupsResult["groups"][number]) => {
      const { property_id: propertyId, option } = group.value;
      if (group.value.kind !== "property" || !propertyId || !option) return undefined;
      const property = properties?.get(propertyId);
      if (property?.type !== "select") return undefined;
      return propertyOptions(property).find((candidate) => candidate.id === option)?.color;
    },
    [properties],
  );

  const displayRows = useMemo(
    () => buildDisplayRows({ ...walkInput, groupLabel, groupColor }),
    [groupColor, groupLabel, walkInput],
  );

  const loadedTasks = useMemo(() => {
    const byId = new Map<string, Task>();
    for (const branch of byKey.values()) {
      for (const row of branch.rows) {
        if (!byId.has(row.task.id)) byId.set(row.task.id, row.task);
      }
    }
    return byId.size > 0 ? [...byId.values()] : EMPTY_TASKS;
  }, [byKey]);

  const ungrouped = grouped ? undefined : byKey.get(tableBranchKey(null, null));
  const rootsLoading = (groups ?? []).some(
    (group) => byKey.get(tableBranchKey(group.key, null))?.isLoading,
  );
  const isLoading = grouped
    ? groupsQuery.isLoading || rootsLoading
    : !ungrouped || ungrouped.isLoading;
  const isRefreshing =
    !isLoading &&
    ((grouped && groupsQuery.isFetching && !groupsQuery.isLoading) || branchesRefreshing);
  const total = grouped
    ? (groupsQuery.data?.total ?? loadedTasks.length)
    : (ungrouped?.total ?? loadedTasks.length);
  const isEmpty = !isLoading && total === 0;

  const refetchGroups = groupsQuery.refetch;
  const retryUngrouped = ungrouped?.retry;
  const retry = useCallback(() => {
    if (grouped) void refetchGroups();
    else retryUngrouped?.();
  }, [grouped, refetchGroups, retryUngrouped]);

  return {
    displayRows,
    loadedTasks,
    total,
    isLoading,
    isRefreshing,
    isShowingPrevious: (grouped && groupsQuery.isPlaceholderData) || branchesShowingPrevious,
    isEmpty,
    search: query.search ?? "",
    groupBy,
    groupsError: grouped
      ? // A failed background refetch keeps the groups it had: rows stay on screen.
        groupsQuery.isError && !groupsQuery.data && !unsupportedGroup
      : !!ungrouped?.isError && ungrouped.rows.length === 0,
    retry,
  };
}

/**
 * The walk only sees parents under roots that have rows. While a root is still
 * on its way (its groups, or its first page, not there yet), the parents it
 * showed before stay planned — if still open — so their children are asked with
 * the roots, not one level after another once the roots arrive.
 */
function keepPendingParents(
  next: TableParentRef[],
  previous: TableParentRef[],
  walk: {
    groupBy: string;
    groups: TableGroupsResult["groups"] | undefined;
    branches: ReadonlyMap<string, { isLoading: boolean }>;
    expandedParents: ReadonlySet<string>;
  },
): TableParentRef[] {
  const rootPending = (groupKey: string | null) => {
    if (walk.groupBy !== "none" && !walk.groups) return true;
    const root = walk.branches.get(tableBranchKey(groupKey, null));
    return !root || root.isLoading;
  };
  const planned = new Set(next.map((parent) => tableBranchKey(parent.groupKey, parent.parentId)));
  const kept = previous.filter(
    (parent) =>
      walk.expandedParents.has(parent.parentId) &&
      !planned.has(tableBranchKey(parent.groupKey, parent.parentId)) &&
      rootPending(parent.groupKey),
  );
  return kept.length > 0 ? [...next, ...kept] : next;
}
