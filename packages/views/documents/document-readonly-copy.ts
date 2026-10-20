import type { Document } from "@uniwork/core/types/document";
import { canCommentInPanel } from "./document-comments-model";

/**
 * A reader without edit rights is "view only" only when they cannot comment
 * either: a comment-level share must not read as view only. The same rule
 * as the comments panel, so the badge never contradicts the composer
 * (a shelved document takes no comments at any level).
 */
export function readonlyReaderCanComment(doc: Pick<Document, "my_level" | "shelved_at">): boolean {
  return canCommentInPanel(doc);
}

/** The read-only copy for a reader who cannot edit: badge, notice title and description, file hint. */
export function readonlyKeys(canComment: boolean) {
  return canComment
    ? {
        badge: "documents.save.readonly_comment",
        title: "documents.detail.readonly_comment_title",
        description: "documents.detail.readonly_comment_description",
        fileHint: "documents.file.readonly_comment_hint",
      }
    : {
        badge: "documents.save.readonly",
        title: "documents.detail.readonly_title",
        description: "documents.detail.readonly_description",
        fileHint: "documents.file.readonly_hint",
      };
}
