"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as tasks from "../api/endpoints/tasks";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";
import { useRecentTasksStore } from "./stores/recent-tasks-store";
import { applyTaskPatch, patchTableCaches } from "./table-cache-patch";

export type { CreateTaskBody, TaskPatch } from "../api/endpoints/tasks";
export { taskKeys } from "./keys";
export { planCacheUpdate } from "./cache-coordinator";
export type { CacheUpdateEvent, CacheUpdatePlan } from "./cache-coordinator";

export * from "./hooks-suite";
export * from "./hooks-catalog";
export * from "./hooks-views";
export * from "./hooks-projects";
export * from "./hooks-collaboration";
export * from "./hooks-attachments";

export function useTasks(workspaceId: string) {
  return useQuery({
    queryKey: taskKeys.list(workspaceId),
    queryFn: () => tasks.listTasks(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => tasks.getTask(taskId),
    enabled: !!taskId,
  });
}

/**
 * List, My Tasks, Gantt and swimlane read infinite queries under these two
 * roots. A local write refreshes them itself rather than waiting for its
 * realtime echo, which never comes while the socket is down. An invalidation
 * replays every loaded page, so each write invalidates each root once.
 */
function invalidatePagedTaskLists(qc: QueryClient, workspaceId: string) {
  void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
  void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
}

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: tasks.CreateTaskBody & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...rest } = body;
      const task = await tasks.createTask(workspaceId, rest, { idempotencyKey });
      // A create command cannot degrade to a false success: callers must keep
      // their draft open when the server answered with a malformed task.
      if (!task) throw new Error("task_create_response_invalid");
      return task;
    },
    onSuccess: (task) => {
      useRecentTasksStore.getState().recordVisit(workspaceId, {
        id: task.id,
        identifier: task.identifier,
        title: task.title,
      });
      invalidatePagedTaskLists(qc, workspaceId);
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      return qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
    },
  });
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: tasks.TaskPatch }) =>
      tasks.updateTask(taskId, patch),
    // Optimistic on purpose, and only here: a status/position patch is locally
    // predictable, the user stays on the board, failure is rare and the
    // rollback is a cache restore. Create/delete flows stay pessimistic.
    // The board and the table read `taskKeys.tableRows` pages and status
    // `taskKeys.tableGroups` counts (patched in ./table-cache-patch on the
    // cursor contract), so the drop is applied there too (an already-cached
    // first page of the target column gets the row) and does not snap back
    // until the refetch lands. The infinite list pages are refreshed on
    // settle, never patched.
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(workspaceId) });
      await qc.cancelQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      const prev = qc.getQueryData<Task[]>(taskKeys.list(workspaceId));
      if (prev) {
        qc.setQueryData<Task[]>(
          taskKeys.list(workspaceId),
          prev.map((t) => (t.id === taskId ? applyTaskPatch(t, patch) : t)),
        );
      }
      const tableWrites = patchTableCaches(qc, workspaceId, taskId, patch);
      return { prev, tableWrites };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKeys.list(workspaceId), ctx.prev);
      for (const { key, before, after } of ctx?.tableWrites ?? []) {
        // Rewritten since (a refetch, another member's event): newer than the snapshot, so it stays.
        if (qc.getQueryData(key) !== after) continue;
        if (before === undefined) qc.removeQueries({ queryKey: key, exact: true });
        else qc.setQueryData(key, before);
      }
    },
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      invalidatePagedTaskLists(qc, workspaceId);
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasks.deleteTask(taskId),
    onSuccess: () => {
      invalidatePagedTaskLists(qc, workspaceId);
      return qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
    },
  });
}

export function useComments(taskId: string) {
  return useQuery({
    queryKey: taskKeys.comments(taskId),
    queryFn: () => tasks.listComments(taskId),
    enabled: !!taskId,
  });
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => tasks.addComment(taskId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}
