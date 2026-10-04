/**
 * Comments panel state (task A5 UI, UNI-927).
 *
 * Pure derivations the panel renders from, so its honesty rules are testable.
 * Reply/resolve are NOT offered: the vendored engine registers only
 * `addComment` and `deleteComment` (keyed by the authorId+idx pair) plus the
 * read path `getSlideComments` - there is no reply or resolve op, so this
 * module exposes the fact instead of inventing a control that cannot persist.
 * See the A5e report (worker-A5e.md, section 7).
 */

/** One comment as the vendored read path reports it (pptx-engine comments.ts:
 *  `SlideComment`); the (authorId, idx) pair is the comment's identity. */
export interface PptxComment {
  authorId: number;
  author: string;
  initials: string;
  /** ISO timestamp from the part, or an empty string when absent. */
  dt: string;
  idx: number;
  text: string;
}

export type PptxCommentsPanelMode = "unbound" | "no_slide" | "loading" | "ready";

export interface PptxCommentsPanelModeInput {
  slideIndex: number | null;
  loading: boolean;
  unbound: boolean;
}

export function commentsPanelMode(input: PptxCommentsPanelModeInput): PptxCommentsPanelMode {
  if (input.unbound) return "unbound";
  if (input.slideIndex === null || !Number.isInteger(input.slideIndex) || input.slideIndex < 0) {
    return "no_slide";
  }
  if (input.loading) return "loading";
  return "ready";
}

/** Stable React key for one comment: the identity pair, never the array index. */
export function commentRefKey(comment: Pick<PptxComment, "authorId" | "idx">): string {
  return comment.authorId + ":" + comment.idx;
}

/** Avatar label: the engine's initials, else the first two characters of the
 *  author name, else a placeholder for an unknown author. */
export function commentAvatarLabel(comment: Pick<PptxComment, "author" | "initials">): string {
  const initials = comment.initials.trim();
  if (initials.length > 0) return initials.slice(0, 2);
  const author = comment.author.trim();
  return author.length > 0 ? author.slice(0, 2) : "?";
}

/** ISO timestamp to a short local string; a value that does not parse is
 *  returned unchanged rather than replaced by "Invalid Date". */
export function formatCommentTime(dt: string, locale: string): string {
  if (typeof dt !== "string" || dt.length === 0) return "";
  const parsed = new Date(dt);
  if (Number.isNaN(parsed.getTime())) return dt;
  return parsed.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface PptxCommentDraftInput {
  author: string;
  text: string;
  readonly: boolean;
  pending: boolean;
  /** An add port is bound. */
  boundPort: boolean;
}

/**
 * Both fields are required: the vendored `addComment` refuses empty text and
 * empty author (slide-ops.ts:682-685), so the panel refuses to send one.
 */
export function commentDraftReady(input: PptxCommentDraftInput): boolean {
  if (!input.boundPort || input.readonly || input.pending) return false;
  return input.author.trim().length > 0 && input.text.trim().length > 0;
}

/** The reply/resolve capability the engine does not have (constant, so the
 *  panel and its test read the same fact). */
export const PPTX_COMMENT_REPLY_RESOLVE_SUPPORTED = false;
