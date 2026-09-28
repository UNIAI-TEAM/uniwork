// Task comment thread helpers are the shared comment implementation (G1-07c
// extraction): `buildCommentThreads`/`deriveThreadResolution` moved to
// packages/views/comments and are generic over the comment DTO. This module
// stays as the task-side import path with the task DTO pinned, so the task
// views and their tests keep exactly the types and API they had.
import type { TaskComment } from "@uniwork/core/types";
import {
  buildCommentThreads as buildSharedCommentThreads,
  deriveThreadResolution as deriveSharedThreadResolution,
  type ThreadResolution,
} from "../../../comments/comment-thread";

export type CommentThread = {
  root: TaskComment;
  replies: TaskComment[];
};

export type { ThreadResolution };

export function deriveThreadResolution(root: TaskComment, replies: TaskComment[]): ThreadResolution {
  return deriveSharedThreadResolution(root, replies);
}

export function buildCommentThreads(comments: TaskComment[]): CommentThread[] {
  return buildSharedCommentThreads(comments);
}
