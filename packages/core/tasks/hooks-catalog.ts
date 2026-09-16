"use client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import * as catalog from "../api/endpoints/task-catalog";
import type { TableRowLabel, TableRowsResult } from "../api/endpoints/tasks-table";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";

export function useTaskStatuses(workspaceId: string) {
  return useQuery({
    queryKey: taskKeys.statuses(workspaceId),
    queryFn: () => catalog.listTaskStatuses(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useCreateTaskStatus(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: catalog.CreateTaskStatusBody) =>
      catalog.createTaskStatus(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.statuses(workspaceId) }),
  });
}

export function usePatchTaskStatus(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: catalog.PatchTaskStatusBody }) =>
      catalog.patchTaskStatus(workspaceId, id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.statuses(workspaceId) }),
  });
}

export function useDeleteTaskStatus(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => catalog.deleteTaskStatus(workspaceId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.statuses(workspaceId) }),
  });
}

export function useTaskLabels(workspaceId: string) {
  return useQuery({
    queryKey: taskKeys.labels(workspaceId),
    queryFn: () => catalog.listTaskLabels(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useCreateTaskLabel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: catalog.CreateTaskLabelBody) => catalog.createTaskLabel(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.labels(workspaceId) }),
  });
}

export function usePutTaskLabel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: catalog.PutTaskLabelBody }) =>
      catalog.putTaskLabel(workspaceId, id, body),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.labels(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.label(workspaceId, id) });
    },
  });
}

export function useDeleteTaskLabel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => catalog.deleteTaskLabel(workspaceId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.labels(workspaceId) }),
  });
}

export function useTaskProperties(workspaceId: string) {
  return useQuery({
    queryKey: taskKeys.properties(workspaceId),
    queryFn: () => catalog.listTaskProperties(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useCreateTaskProperty(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: catalog.CreateTaskPropertyBody) =>
      catalog.createTaskProperty(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.properties(workspaceId) }),
  });
}

export function useLabelsOnTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.taskLabels(taskId),
    queryFn: () => catalog.listLabelsOnTask(taskId),
    enabled: !!taskId,
  });
}

export function useAttachTaskLabel(workspaceId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => catalog.attachTaskLabel(taskId, labelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.taskLabels(taskId) });
      void qc.invalidateQueries({ queryKey: taskKeys.labels(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useDetachTaskLabel(workspaceId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => catalog.detachTaskLabel(taskId, labelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.taskLabels(taskId) });
      void qc.invalidateQueries({ queryKey: taskKeys.labels(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export interface TaskCacheWrite {
  key: QueryKey;
  before: unknown;
  after: unknown;
}

function writeTaskCache(
  qc: QueryClient,
  writes: TaskCacheWrite[],
  key: QueryKey,
  before: unknown,
  next: unknown,
) {
  const after = qc.setQueryData(key, next) ?? next;
  writes.push({ key, before, after });
}

/**
 * Applies `apply` to the task's row in every `taskKeys.tableRoot` rows page
 * that holds it. The shared primitive behind every optimistic table-row
 * patch (a property value, a label toggle): group and facet entries under
 * the same root are left alone — neither a property value nor a label ever
 * moves a row between the branches this client can place rows in (unlike
 * status, `table-cache-patch.ts`), so only the rows pages need patching.
 * Returns every write, for a rollback that undoes only entries nothing has
 * rewritten since (compared by reference).
 */
function patchTaskTableRows(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  apply: (row: TableRowsResult["rows"][number]) => TableRowsResult["rows"][number],
): TaskCacheWrite[] {
  const writes: TaskCacheWrite[] = [];
  const rowsEntries = qc.getQueriesData<TableRowsResult>({ queryKey: taskKeys.tableRoot(workspaceId) });
  for (const [key, data] of rowsEntries) {
    if (!data || !Array.isArray(data.rows)) continue;
    const index = data.rows.findIndex((row) => row.task.id === taskId);
    if (index === -1) continue;
    const row = data.rows[index]!;
    writeTaskCache(qc, writes, key, data, { ...data, rows: data.rows.with(index, apply(row)) });
  }
  return writes;
}

/**
 * Applies `apply` to the task's cached copy in every `taskKeys.tableRoot`
 * rows page that holds it, plus `taskKeys.detail`. Optimistic per CLAUDE.md
 * State Rules: a property value is locally predictable, the user stays on
 * the same screen, failure is rare, and rollback is a cache restore. Returns
 * every write, for a rollback that undoes only entries nothing has rewritten
 * since (compared by reference, as `useUpdateTask` does).
 */
function patchTaskPropertyCaches(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  apply: (task: Task) => Task,
): TaskCacheWrite[] {
  const writes = patchTaskTableRows(qc, workspaceId, taskId, (row) => ({ ...row, task: apply(row.task) }));

  const detailKey = taskKeys.detail(taskId);
  const detailBefore = qc.getQueryData<Task | null>(detailKey);
  if (detailBefore) writeTaskCache(qc, writes, detailKey, detailBefore, apply(detailBefore));

  return writes;
}

/**
 * Applies `apply` to the task's cached labels in every `taskKeys.tableRoot`
 * rows page that holds it — the optimistic half of a label toggle
 * (`useTaskLabelToggle` in `packages/views/tasks/pickers/`, which owns the
 * mutation, the rollback-on-error and the settle-time invalidate). No
 * `taskKeys.detail` write: `Task` carries no `labels` field, only the table
 * row does (task 18: the row's own `labels`, not a per-row query).
 */
export function patchTaskLabelCaches(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  apply: (labels: TableRowLabel[]) => TableRowLabel[],
): TaskCacheWrite[] {
  return patchTaskTableRows(qc, workspaceId, taskId, (row) => ({ ...row, labels: apply(row.labels) }));
}

/** Restores every write from a table-row patch that nothing has rewritten since. */
export function rollbackTaskCacheWrites(qc: QueryClient, writes: TaskCacheWrite[]) {
  for (const { key, before, after } of writes) {
    if (qc.getQueryData(key) !== after) continue;
    qc.setQueryData(key, before);
  }
}

/**
 * Inserts (or replaces, by id) `label` into `labels`, kept sorted by name
 * case-insensitively — the same order the rows API returns. The optimistic
 * half of attaching a label; mirrors the server's own ordering so the
 * settle-time invalidate never visibly reshuffles the row.
 */
export function withLabelSorted(labels: TableRowLabel[], label: TableRowLabel): TableRowLabel[] {
  const next = [...labels.filter((existing) => existing.id !== label.id), label];
  next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return next;
}

/** Removes a label by id — the optimistic half of detaching a label. */
export function withoutLabelId(labels: TableRowLabel[], labelId: string): TableRowLabel[] {
  return labels.filter((label) => label.id !== labelId);
}

function setTaskProperty(task: Task, propertyId: string, value: unknown): Task {
  return { ...task, properties: { ...task.properties, [propertyId]: value } };
}

function unsetTaskProperty(task: Task, propertyId: string): Task {
  const { [propertyId]: _removed, ...rest } = task.properties ?? {};
  return { ...task, properties: rest };
}

export function useSetTaskPropertyValue(
  workspaceId: string,
): UseMutationResult<void, Error, { taskId: string; propertyId: string; value: unknown }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, propertyId, value }) => {
      await catalog.putTaskPropertyValue(taskId, propertyId, value);
    },
    onMutate: async ({ taskId, propertyId, value }) => {
      await qc.cancelQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      await qc.cancelQueries({ queryKey: taskKeys.detail(taskId) });
      const writes = patchTaskPropertyCaches(qc, workspaceId, taskId, (task) =>
        setTaskProperty(task, propertyId, value),
      );
      return { writes };
    },
    onError: (_e, _v, ctx) => rollbackTaskCacheWrites(qc, ctx?.writes ?? []),
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useUnsetTaskPropertyValue(
  workspaceId: string,
): UseMutationResult<void, Error, { taskId: string; propertyId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, propertyId }) => {
      await catalog.deleteTaskPropertyValue(taskId, propertyId);
    },
    onMutate: async ({ taskId, propertyId }) => {
      await qc.cancelQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      await qc.cancelQueries({ queryKey: taskKeys.detail(taskId) });
      const writes = patchTaskPropertyCaches(qc, workspaceId, taskId, (task) =>
        unsetTaskProperty(task, propertyId),
      );
      return { writes };
    },
    onError: (_e, _v, ctx) => rollbackTaskCacheWrites(qc, ctx?.writes ?? []),
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}
