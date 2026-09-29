import type { CommentReaction } from "@uniwork/core/types";

/**
 * The structural comment shape the shared comment views render.
 *
 * `TaskComment` and `DocumentComment` both satisfy this shape, which is what
 * lets `packages/views/comments` hold ONE thread/card/editor implementation
 * while the task and document surfaces keep their own DTOs, hooks and
 * testids. Every field the card reads is optional or nullable here: a comment
 * from a server that omits `author` or a resolution stamp must still render,
 * exactly like it does on the task side today.
 */
export interface CommentLike {
  id: string;
  body: string;
  parent_id?: string | null;
  author_id?: string;
  author_kind?: string;
  author?: { display_name?: string; avatar_url?: string } | null;
  display_name?: string;
  avatar_url?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
  reactions?: CommentReaction[] | null;
}
