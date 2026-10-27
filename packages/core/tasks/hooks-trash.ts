"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as trash from "../api/endpoints/tasks-trash";
import { invalidateTaskCollections } from "./invalidate";
import { trashKeys } from "../trash/keys";
import { taskKeys } from "./keys";

/** Restores the whole batch the task was trashed in; the result lists every restored id. */
export function useRestoreTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => trash.restoreTask(taskId),
    onSuccess: (result, taskId) => {
      void qc.invalidateQueries({ queryKey: trashKeys.workspace(workspaceId) });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKeys.workspace(workspaceId) }),
  });
}

/** A restored project relinks its tasks, so task collections refetch too. */
export function useRestoreProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => trash.restoreProject(workspaceId, projectId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.projects(workspaceId) });
      void qc.invalidateQueries({ queryKey: trashKeys.workspace(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) });
      return invalidateTaskCollections(qc, workspaceId);
    },
  });
}

export function usePurgeProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => trash.purgeProject(workspaceId, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKeys.workspace(workspaceId) }),
  });
}
