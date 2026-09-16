"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as suite from "../api/endpoints/tasks-suite";
import * as table from "../api/endpoints/tasks-table";
import type { TaskQueryPage } from "../types/task";
import { taskKeys } from "./keys";
import type { MyTasksRelation } from "./surface/scope";
import { tableQueryRetry } from "./surface/table-query";

function stableHash(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function useQueryTasks(workspaceId: string, body: suite.QueryTasksBody = {}) {
  const hash = stableHash(body);
  return useQuery({
    queryKey: taskKeys.query(workspaceId, hash),
    queryFn: () => suite.queryTasks(workspaceId, body),
    enabled: !!workspaceId,
  });
}

export function useMyTasks(
  workspaceId: string,
  opts: {
    relation?: "all" | "assigned" | "created" | "involved";
    limit?: number;
    offset?: number;
  } = {},
) {
  const hash = stableHash(opts);
  return useQuery({
    queryKey: taskKeys.myTasksFiltered(workspaceId, hash),
    queryFn: () => suite.listMyTasks(workspaceId, opts),
    enabled: !!workspaceId,
  });
}

/** Page size sent explicitly by the infinite task queries (server default 50, cap 200). */
export const TASK_PAGE_SIZE = 50;

function nextOffset(page: TaskQueryPage, pages: TaskQueryPage[]): number | undefined {
  // A short page means the server has nothing more, whatever `total` claims.
  // Without this a drifted count would re-request the same offset forever.
  // "Short" is judged against the limit the server served, since it may clamp
  // below ours; a broken `limit` (0) falls back to ours so it cannot loop.
  // The cap at ours matters too: the server never serves more rows than we
  // asked for, so an echoed limit above ours (its own cap, say 200) must not
  // make a full page of 50 look short and end paging early.
  const served = Math.min(page.limit > 0 ? page.limit : TASK_PAGE_SIZE, TASK_PAGE_SIZE);
  if (page.tasks.length < served) return undefined;
  const loaded = pages.reduce((sum, p) => sum + p.tasks.length, 0);
  return loaded < page.total ? loaded : undefined;
}

export function useInfiniteQueryTasks(
  workspaceId: string,
  body: { status?: string; project_id?: string },
) {
  const hash = stableHash(body);
  return useInfiniteQuery({
    queryKey: taskKeys.queryInfinite(workspaceId, hash),
    // Reading `signal` is what lets TanStack stop a refetch that a newer
    // invalidate cancelled: unread, the stale wave walks every remaining page.
    queryFn: ({ pageParam, signal }) =>
      suite.queryTasks(
        workspaceId,
        { ...body, limit: TASK_PAGE_SIZE, offset: pageParam },
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(last, pages),
    enabled: !!workspaceId,
  });
}

export function useInfiniteMyTasks(workspaceId: string, opts: { relation?: MyTasksRelation }) {
  const hash = stableHash(opts);
  return useInfiniteQuery({
    queryKey: taskKeys.myTasksInfinite(workspaceId, hash),
    // See useInfiniteQueryTasks: `signal` stops a cancelled refetch.
    queryFn: ({ pageParam, signal }) =>
      suite.listMyTasks(
        workspaceId,
        { ...opts, limit: TASK_PAGE_SIZE, offset: pageParam },
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(last, pages),
    enabled: !!workspaceId,
  });
}

export function useTaskChildren(taskId: string) {
  return useQuery({
    queryKey: taskKeys.children(taskId),
    queryFn: () => suite.listTaskChildren(taskId),
    enabled: !!taskId,
  });
}

export function useChildTaskProgress(workspaceId: string) {
  return useQuery({
    queryKey: taskKeys.childProgress(workspaceId),
    queryFn: () => suite.childTaskProgress(workspaceId),
    enabled: !!workspaceId,
  });
}

export function usePutTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      body,
      ifMatch,
      idempotencyKey,
    }: {
      taskId: string;
      body: suite.PutTaskBody;
      ifMatch?: string;
      idempotencyKey?: string;
    }) => suite.putTask(taskId, body, { ifMatch, idempotencyKey }),
    onSuccess: (_d, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useBatchUpdateTasks(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: suite.BatchUpdateBody) => suite.batchUpdateTasks(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
    },
  });
}

export function useBatchDeleteTasks(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskIds: string[]) => suite.batchDeleteTasks(workspaceId, taskIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
    },
  });
}

export function useSetTaskParent(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: suite.SetTaskParentBody }) =>
      suite.setTaskParent(taskId, body),
    onSuccess: (_d, { taskId, body }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.groupedRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      void qc.invalidateQueries({ queryKey: taskKeys.children(taskId) });
      if (body.parent_task_id) {
        void qc.invalidateQueries({ queryKey: taskKeys.children(body.parent_task_id) });
      }
      void qc.invalidateQueries({ queryKey: taskKeys.childProgress(workspaceId) });
    },
  });
}

export function useSetTaskDependency(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      body,
    }: {
      taskId: string;
      body: suite.SetTaskDependencyBody;
    }) => suite.setTaskDependency(taskId, body),
    onSuccess: (_d, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
    },
  });
}

/** The `group_by` a groups key was hashed from, or undefined for a key of another shape. */
function groupByOfKey(queryKey: readonly unknown[]): unknown {
  const hash = queryKey[3];
  if (typeof hash !== "string") return undefined;
  try {
    return (JSON.parse(hash) as { group_by?: unknown } | null)?.group_by;
  } catch {
    return undefined;
  }
}

/**
 * The table's groups. With `keepPrevious`, a changed query (a search, a filter)
 * keeps showing the last groups of the same workspace and `group_by` until the
 * new ones arrive; a changed grouping starts empty, since the old groups' keys
 * mean nothing to it.
 */
export function useTableGroups(
  workspaceId: string,
  body: table.TableGroupsBody | null,
  options: { keepPrevious?: boolean } = {},
) {
  const hash = stableHash(body);
  const keepPrevious = options.keepPrevious ?? false;
  return useQuery({
    queryKey: taskKeys.tableGroups(workspaceId, hash),
    queryFn: () => table.tableGroups(workspaceId, body!),
    enabled: !!workspaceId && !!body,
    retry: tableQueryRetry,
    placeholderData: keepPrevious
      ? (previous: table.TableGroupsResult | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
          previousQuery &&
          previousQuery.queryKey[1] === workspaceId &&
          groupByOfKey(previousQuery.queryKey) === body?.group_by
            ? previous
            : undefined
      : undefined,
  });
}

export function useTableRows(workspaceId: string, body: table.TableRowsBody | null) {
  const hash = stableHash(body);
  return useQuery({
    queryKey: taskKeys.tableRows(workspaceId, hash),
    queryFn: () => table.tableRows(workspaceId, body!),
    enabled: !!workspaceId && !!body,
  });
}

export function useTableFacets(workspaceId: string, body: table.TableFacetsBody | null) {
  const hash = stableHash(body);
  return useQuery({
    queryKey: taskKeys.tableFacets(workspaceId, hash),
    queryFn: () => table.tableFacets(workspaceId, body!),
    enabled: !!workspaceId && !!body,
  });
}
