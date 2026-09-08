import { z } from "zod";
import {
  CommentReactionSchema,
  TaskReactionSchema,
  TaskSubscriberSchema,
  type CommentReaction,
  type TaskReaction,
  type TaskSubscriber,
} from "../../types/task-collaboration";
import { TaskCommentSchema, type TaskComment } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const CommentResponse = z.object({ comment: TaskCommentSchema });
const CommentReactionResponse = z.object({ reaction: CommentReactionSchema });
const TaskReactionResponse = z.object({ reaction: TaskReactionSchema });
const SubscribersResponse = z.object({ subscribers: z.array(TaskSubscriberSchema) });

export interface UpdateCommentBody {
  body: string;
}

export interface ReactionBody {
  emoji: string;
}

export interface SubscribeBody {
  user_id?: string;
  user_type?: string;
}

export interface CreateCommentSuiteBody {
  body: string;
  parent_id?: string | null;
  type?: string;
}

const enc = encodeURIComponent;

export async function updateComment(
  commentId: string,
  body: UpdateCommentBody,
): Promise<TaskComment | null> {
  const raw = await request(`/api/v1/comments/${enc(commentId)}`, {
    method: "PUT",
    body,
  });
  return parseWithFallback<{ comment: TaskComment } | null>(raw, CommentResponse, null, {
    endpoint: "PUT /api/v1/comments/{id}",
  })?.comment ?? null;
}

export async function deleteComment(commentId: string): Promise<void> {
  await request(`/api/v1/comments/${enc(commentId)}`, { method: "DELETE" });
}

export async function resolveComment(commentId: string): Promise<TaskComment | null> {
  const raw = await request(`/api/v1/comments/${enc(commentId)}/resolve`, { method: "POST" });
  return parseWithFallback<{ comment: TaskComment } | null>(raw, CommentResponse, null, {
    endpoint: "POST /api/v1/comments/{id}/resolve",
  })?.comment ?? null;
}

export async function unresolveComment(commentId: string): Promise<TaskComment | null> {
  const raw = await request(`/api/v1/comments/${enc(commentId)}/resolve`, { method: "DELETE" });
  return parseWithFallback<{ comment: TaskComment } | null>(raw, CommentResponse, null, {
    endpoint: "DELETE /api/v1/comments/{id}/resolve",
  })?.comment ?? null;
}

export async function addCommentReaction(
  commentId: string,
  body: ReactionBody,
): Promise<CommentReaction | null> {
  const raw = await request(`/api/v1/comments/${enc(commentId)}/reactions`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ reaction: CommentReaction } | null>(raw, CommentReactionResponse, null, {
    endpoint: "POST /api/v1/comments/{id}/reactions",
  })?.reaction ?? null;
}

export async function removeCommentReaction(
  commentId: string,
  body: ReactionBody,
): Promise<void> {
  await request(`/api/v1/comments/${enc(commentId)}/reactions`, {
    method: "DELETE",
    body,
  });
}

export async function addTaskReaction(
  taskId: string,
  body: ReactionBody,
): Promise<TaskReaction | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/reactions`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ reaction: TaskReaction } | null>(raw, TaskReactionResponse, null, {
    endpoint: "POST /api/v1/tasks/{id}/reactions",
  })?.reaction ?? null;
}

export async function removeTaskReaction(taskId: string, body: ReactionBody): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/reactions`, {
    method: "DELETE",
    body,
  });
}

export async function listTaskSubscribers(taskId: string): Promise<TaskSubscriber[]> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/subscribers`);
  return parseWithFallback<{ subscribers: TaskSubscriber[] }>(raw, SubscribersResponse, {
    subscribers: [],
  }, {
    endpoint: "GET /api/v1/tasks/{id}/subscribers",
  }).subscribers;
}

export async function subscribeTask(taskId: string, body: SubscribeBody = {}): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/subscribe`, { method: "POST", body });
}

export async function unsubscribeTask(taskId: string, body: SubscribeBody = {}): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/unsubscribe`, { method: "POST", body });
}

export async function unsubscribeTaskSubtree(
  taskId: string,
  body: SubscribeBody = {},
): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/unsubscribe/subtree`, { method: "POST", body });
}

/** Suite create with parent_id / type / optional Idempotency-Key. */
export async function createCommentSuite(
  taskId: string,
  body: CreateCommentSuiteBody,
  opts?: { idempotencyKey?: string },
): Promise<TaskComment | null> {
  const headers: Record<string, string> = {};
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/comments`, {
    method: "POST",
    body,
    headers,
  });
  return parseWithFallback<{ comment: TaskComment } | null>(raw, CommentResponse, null, {
    endpoint: "POST /api/v1/tasks/{id}/comments (suite)",
  })?.comment ?? null;
}
