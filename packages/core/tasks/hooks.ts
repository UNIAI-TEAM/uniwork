"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as tasks from "../api/endpoints/tasks";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";
import { useRecentTasksStore } from "./stores/recent-tasks-store";

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

function applyTaskPatch(task: Task, patch: tasks.TaskPatch): Task {
  return {
    ...task,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ),
  } as Task;
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: tasks.TaskPatch }) =>
      tasks.updateTask(taskId, patch),
    // Optimistic on purpose, and only here: a status/position patch is locally
    // predictable, the user stays on the same screen, failure is rare and the
    // rollback is a cache restore. Create/delete flows stay pessimistic.
    // `taskKeys.list` gets the patch applied at once. The table API
    // (`taskKeys.tableRoot`) is cursor-paged: a task's position within its
    // branch is opaque to the client (an encoded cursor, not an offset it can
    // do arithmetic on), so this hook cannot place the row itself the way the
    // pre-cursor board did — it invalidates `tableRoot` on settle instead and
    // waits for the refetch, same as every other list-style cache here.
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(workspaceId) });
      const prev = qc.getQueryData<Task[]>(taskKeys.list(workspaceId));
      if (prev) {
        qc.setQueryData<Task[]>(
          taskKeys.list(workspaceId),
          prev.map((t) => (t.id === taskId ? applyTaskPatch(t, patch) : t)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKeys.list(workspaceId), ctx.prev);
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
