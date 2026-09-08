"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as views from "../api/endpoints/task-views";
import { taskKeys } from "./keys";

function scopeHash(opts: { scope_type?: string; scope_id?: string }): string {
  return `${opts.scope_type ?? ""}:${opts.scope_id ?? ""}`;
}

export function useTaskViews(
  workspaceId: string,
  opts: { scope_type?: string; scope_id?: string } = {},
) {
  return useQuery({
    queryKey: taskKeys.viewsScoped(workspaceId, scopeHash(opts)),
    queryFn: () => views.listTaskViews(workspaceId, opts),
    enabled: !!workspaceId,
  });
}

export function useTaskView(workspaceId: string, viewId: string) {
  return useQuery({
    queryKey: taskKeys.view(workspaceId, viewId),
    queryFn: () => views.getTaskView(workspaceId, viewId),
    enabled: !!workspaceId && !!viewId,
  });
}

export function useCreateTaskView(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: views.CreateTaskViewBody) => views.createTaskView(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.views(workspaceId) }),
  });
}

export function usePatchTaskView(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: views.PatchTaskViewBody }) =>
      views.patchTaskView(workspaceId, id, body),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.views(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.view(workspaceId, id) });
    },
  });
}

export function useDeleteTaskView(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => views.deleteTaskView(workspaceId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.views(workspaceId) }),
  });
}

export function useTaskViewPreference(
  workspaceId: string,
  opts: { scope_type: string; scope_id?: string } | null,
) {
  const hash = opts ? scopeHash(opts) : "";
  return useQuery({
    queryKey: taskKeys.viewPrefsScoped(workspaceId, hash),
    queryFn: () => views.getTaskViewPreference(workspaceId, opts!),
    enabled: !!workspaceId && !!opts,
  });
}

export function usePutTaskViewPreference(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: views.PutTaskViewPreferenceBody) =>
      views.putTaskViewPreference(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.viewPrefs(workspaceId) }),
  });
}

export function usePins(workspaceId: string, opts: { include?: string } = {}) {
  return useQuery({
    queryKey: taskKeys.pins(workspaceId),
    queryFn: () => views.listPins(workspaceId, opts),
    enabled: !!workspaceId,
  });
}

export function useCreatePin(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: views.CreatePinBody) => views.createPin(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) }),
  });
}

export function useDeletePin(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: string; itemId: string }) =>
      views.deletePin(workspaceId, itemType, itemId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) }),
  });
}
