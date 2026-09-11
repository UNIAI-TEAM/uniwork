"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as catalog from "../api/endpoints/task-catalog";
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
