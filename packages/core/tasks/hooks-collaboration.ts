"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as collab from "../api/endpoints/task-collaboration";
import { taskKeys } from "./keys";

export function useUpdateComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      commentId,
      body,
    }: {
      commentId: string;
      body: collab.UpdateCommentBody;
    }) => collab.updateComment(commentId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}

export function useDeleteComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => collab.deleteComment(commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}

export function useResolveComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => collab.resolveComment(commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}

export function useUnresolveComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => collab.unresolveComment(commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}

export function useAddCommentReaction(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
      collab.addCommentReaction(commentId, { emoji }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}

export function useRemoveCommentReaction(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
      collab.removeCommentReaction(commentId, { emoji }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}

export function useTaskSubscribers(taskId: string) {
  return useQuery({
    queryKey: taskKeys.subscribers(taskId),
    queryFn: () => collab.listTaskSubscribers(taskId),
    enabled: !!taskId,
  });
}

export function useSubscribeTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: collab.SubscribeBody) => collab.subscribeTask(taskId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.subscribers(taskId) }),
  });
}

export function useUnsubscribeTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: collab.SubscribeBody) => collab.unsubscribeTask(taskId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.subscribers(taskId) }),
  });
}

export function useCreateCommentSuite(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      body,
      idempotencyKey,
    }: {
      body: collab.CreateCommentSuiteBody;
      idempotencyKey?: string;
    }) => collab.createCommentSuite(taskId, body, { idempotencyKey }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}
