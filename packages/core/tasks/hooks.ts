"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as tasks from "../api/endpoints/tasks";
import type { Task } from "../types/task";

export type { CreateTaskBody, TaskPatch } from "../api/endpoints/tasks";

export const taskKeys = {
  list: (wsId: string) => ["tasks", wsId] as const,
  detail: (taskId: string) => ["task", taskId] as const,
  comments: (taskId: string) => ["comments", taskId] as const,
};

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
    mutationFn: (body: tasks.CreateTaskBody) => tasks.createTask(workspaceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) }),
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
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(workspaceId) });
      const prev = qc.getQueryData<Task[]>(taskKeys.list(workspaceId));
      if (prev) {
        qc.setQueryData<Task[]>(
          taskKeys.list(workspaceId),
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
                }
              : t,
          ),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKeys.list(workspaceId), ctx.prev);
    },
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
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
