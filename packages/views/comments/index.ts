// Shared comment views (G1-07c, UNI-681): the thread/card/editor components
// extracted from the task comment surface so document comments render the
// same interaction model. Import from here rather than reaching into files.
export type { CommentLike } from "./comment-types";
export {
  buildCommentThreads,
  deriveThreadResolution,
  type CommentThread,
  type ThreadResolution,
} from "./comment-thread";
export { formatCommentDateTime, formatCommentTimeAgo } from "./comment-time";
export { commentPreviewOrFallback, commentPreviewText } from "./comment-preview-text";
export { CommentActorAvatar } from "./comment-actor-avatar";
export { CommentReplyQuote } from "./comment-reply-quote";
export { CommentEditor } from "./comment-editor";
export { CommentComposer } from "./comment-composer";
export { CommentCard, type CommentCallbacks, type CommentUploadWiring } from "./comment-card";
export { ResolvedThreadBar } from "./resolved-thread-bar";
