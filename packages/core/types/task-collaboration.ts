import { z } from "zod";

export const CommentReactionSchema = z.object({
  id: z.string(),
  comment_id: z.string(),
  actor_type: z.string(),
  actor_id: z.string(),
  emoji: z.string(),
  created_at: z.string(),
});
export type CommentReaction = z.infer<typeof CommentReactionSchema>;

export const TaskReactionSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  actor_type: z.string(),
  actor_id: z.string(),
  emoji: z.string(),
  created_at: z.string(),
});
export type TaskReaction = z.infer<typeof TaskReactionSchema>;

export const TaskSubscriberSchema = z.object({
  task_id: z.string(),
  actor_type: z.string(),
  actor_id: z.string(),
  reason: z.string(),
  created_at: z.string(),
});
export type TaskSubscriber = z.infer<typeof TaskSubscriberSchema>;
