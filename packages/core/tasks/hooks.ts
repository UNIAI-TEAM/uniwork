"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { TaskCommentSchema, TaskSchema, type Task } from "../types";

const TasksResponse = z.object({ tasks: z.array(TaskSchema) });
const TaskResponse = z.object({ task: TaskSchema });
const CommentsResponse = z.object({ comments: z.array(TaskCommentSchema) });
const CommentResponse = z.object({ comment: TaskCommentSchema });

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: Task["status"];
  priority?: Task["priority"];
  position?: number;
  assignee_id?: string | null;
  due_date?: string | null;
}

export function useTasks(workspaceId: string) {
  return useQuery({
    queryKey: ["tasks", workspaceId],
    queryFn: () => api.request(`/api/v1/workspaces/${workspaceId}/tasks`, { schema: TasksResponse }),
    // The response schema is lenient on status/priority (see types/task.ts);
    // the call site asserts the known unions, and switches carry a default.
    select: (d) => d.tasks as Task[],
    enabled: !!workspaceId,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.request(`/api/v1/tasks/${taskId}`, { schema: TaskResponse }),
    select: (d) => d.task as Task,
    enabled: !!taskId,
  });
}

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string; priority?: Task["priority"] }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body,
        schema: TaskResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) =>
      api.request(`/api/v1/tasks/${taskId}`, { method: "PATCH", body: patch, schema: TaskResponse }),
    // optimistic: board phản hồi tức thì khi kéo-thả
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks", workspaceId] });
      const prev = qc.getQueryData<{ tasks: Task[] }>(["tasks", workspaceId]);
      if (prev) {
        qc.setQueryData(["tasks", workspaceId], {
          tasks: prev.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
                }
              : t,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks", workspaceId], ctx.prev);
    },
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.request(`/api/v1/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
}

export function useComments(taskId: string) {
  return useQuery({
    queryKey: ["comments", taskId],
    queryFn: () => api.request(`/api/v1/tasks/${taskId}/comments`, { schema: CommentsResponse }),
    select: (d) => d.comments,
    enabled: !!taskId,
  });
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.request(`/api/v1/tasks/${taskId}/comments`, {
        method: "POST",
        body: { body },
        schema: CommentResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", taskId] }),
  });
}
