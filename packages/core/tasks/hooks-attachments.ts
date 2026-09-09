"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as attachments from "../api/endpoints/task-attachments";
import { taskKeys } from "./keys";

export function useTaskAttachments(workspaceId: string, taskId: string) {
  return useQuery({
    queryKey: taskKeys.attachments(workspaceId, taskId),
    queryFn: () => attachments.listTaskAttachments(taskId),
    enabled: !!workspaceId && !!taskId,
  });
}

export function useUploadTaskAttachment(workspaceId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => attachments.uploadTaskAttachment(taskId, file),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: taskKeys.attachments(workspaceId, taskId) }),
  });
}

export function useDeleteAttachment(workspaceId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => attachments.deleteAttachment(attachmentId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: taskKeys.attachments(workspaceId, taskId) }),
  });
}
