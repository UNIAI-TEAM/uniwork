"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as suite from "../api/endpoints/tasks-suite";
import * as table from "../api/endpoints/tasks-table";
import type { TaskQueryPage } from "../types/task";
import { taskKeys } from "./keys";
import type { MyTasksRelation } from "./surface/scope";

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

export function useGroupedTasks(
  workspaceId: string,
  opts: { group_by?: string; status?: string; limit?: number; offset?: number } = {},
) {
  const hash = stableHash(opts);
  return useQuery({
    queryKey: taskKeys.grouped(workspaceId, hash),
    queryFn: () => suite.groupedTasks(workspaceId, opts),
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
    queryFn: ({ pageParam }) =>
      suite.queryTasks(workspaceId, { ...body, limit: TASK_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(last, pages),
    enabled: !!workspaceId,
  });
}

export function useInfiniteMyTasks(workspaceId: string, opts: { relation?: MyTasksRelation }) {
  const hash = stableHash(opts);
  return useInfiniteQuery({
    queryKey: taskKeys.myTasksInfinite(workspaceId, hash),
    queryFn: ({ pageParam }) =>
      suite.listMyTasks(workspaceId, { ...opts, limit: TASK_PAGE_SIZE, offset: pageParam }),
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

export function useTableGroups(workspaceId: string, body: table.TableGroupsBody | null) {
  const hash = stableHash(body);
  return useQuery({
    queryKey: taskKeys.tableGroups(workspaceId, hash),
    queryFn: () => table.tableGroups(workspaceId, body!),
    enabled: !!workspaceId && !!body,
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
