"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as tasks from "../api/endpoints/tasks";
import type { Task, TaskGroup } from "../types/task";
import { taskKeys } from "./keys";

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

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: tasks.CreateTaskBody & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...rest } = body;
      return tasks.createTask(workspaceId, rest, { idempotencyKey });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) }),
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

/** Move / patch a task inside every loaded `taskKeys.grouped` cache entry. */
function patchGroupedCaches(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  patch: tasks.TaskPatch,
): Array<[readonly unknown[], TaskGroup[] | undefined]> {
  const snapshots = qc.getQueriesData<TaskGroup[]>({
    queryKey: taskKeys.groupedRoot(workspaceId),
  });
  for (const [key, groups] of snapshots) {
    if (!groups) continue;
    let found: Task | undefined;
    for (const group of groups) {
      found = group.tasks.find((row) => row.id === taskId);
      if (found) break;
    }
    if (!found) continue;
    const nextTask = applyTaskPatch(found, patch);
    const statusChanged =
      typeof patch.status === "string" && patch.status !== found.status;
    let nextGroups: TaskGroup[];
    if (statusChanged) {
      const targetKey = patch.status as string;
      const without = groups.map((group) => ({
        ...group,
        tasks: group.tasks.filter((row) => row.id !== taskId),
      }));
      const hasTarget = without.some((group) => group.key === targetKey);
      nextGroups = hasTarget
        ? without.map((group) =>
            group.key === targetKey
              ? {
                  ...group,
                  tasks: [...group.tasks, nextTask].sort(
                    (a, b) => a.position - b.position,
                  ),
                }
              : group,
          )
        : [
            ...without,
            { key: targetKey, tasks: [nextTask] },
          ];
    } else {
      nextGroups = groups.map((group) => ({
        ...group,
        tasks: group.tasks
          .map((row) => (row.id === taskId ? nextTask : row))
          .sort((a, b) => a.position - b.position),
      }));
    }
    qc.setQueryData(key, nextGroups);
  }
  return snapshots;
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: tasks.TaskPatch }) =>
      tasks.updateTask(taskId, patch),
    // Optimistic on purpose, and only here: a status/position patch is locally
    // predictable, the user stays on the board, failure is rare and the
    // rollback is a cache restore. Create/delete flows stay pessimistic.
    // Suite board reads `taskKeys.grouped` — patch that cache too so the drop
    // does not snap back until invalidate settles.
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(workspaceId) });
      await qc.cancelQueries({ queryKey: taskKeys.groupedRoot(workspaceId) });
      const prev = qc.getQueryData<Task[]>(taskKeys.list(workspaceId));
      if (prev) {
        qc.setQueryData<Task[]>(
          taskKeys.list(workspaceId),
          prev.map((t) => (t.id === taskId ? applyTaskPatch(t, patch) : t)),
        );
      }
      const prevGrouped = patchGroupedCaches(qc, workspaceId, taskId, patch);
      return { prev, prevGrouped };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKeys.list(workspaceId), ctx.prev);
      if (ctx?.prevGrouped) {
        for (const [key, data] of ctx.prevGrouped) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.groupedRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasks.deleteTask(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) }),
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
