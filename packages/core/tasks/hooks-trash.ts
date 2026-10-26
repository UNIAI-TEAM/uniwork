"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as trash from "../api/endpoints/tasks-trash";
import { invalidateTaskCollections } from "./invalidate";
import { taskKeys } from "./keys";

export function useTaskTrash(workspaceId: string) {
  return useInfiniteQuery({
    queryKey: taskKeys.trash(workspaceId),
    queryFn: ({ pageParam }) => trash.listTaskTrash(workspaceId, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!workspaceId,
  });
}

export function useProjectTrash(workspaceId: string) {
  return useInfiniteQuery({
    queryKey: taskKeys.projectTrash(workspaceId),
    queryFn: ({ pageParam }) => trash.listProjectTrash(workspaceId, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!workspaceId,
  });
}

/** Restores the whole batch the task was trashed in; the result lists every restored id. */
export function useRestoreTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => trash.restoreTask(taskId),
    onSuccess: (result, taskId) => {
      void qc.invalidateQueries({ queryKey: taskKeys.trash(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) });
      for (const id of new Set([taskId, ...result.ids])) {
        void qc.invalidateQueries({ queryKey: taskKeys.detail(id) });
      }
      return invalidateTaskCollections(qc, workspaceId);
    },
  });
}

export function usePurgeTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => trash.purgeTask(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.trash(workspaceId) }),
  });
}

/** A restored project relinks its tasks, so task collections refetch too. */
export function useRestoreProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => trash.restoreProject(workspaceId, projectId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.projects(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.projectTrash(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) });
      return invalidateTaskCollections(qc, workspaceId);
    },
  });
}

export function usePurgeProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => trash.purgeProject(workspaceId, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.projectTrash(workspaceId) }),
  });
}
