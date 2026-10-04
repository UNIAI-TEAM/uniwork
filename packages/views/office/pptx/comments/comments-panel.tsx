"use client";

/**
 * The comments panel (task A5 UI, UNI-927).
 *
 * A self-contained panel: it lists the selected slide's comments, adds one
 * (author + text) and deletes one by its (authorId, idx) identity. It reports
 * edits through `onAddComment` / `onDeleteComment` and never touches the shared
 * editor files - the UI-wire round mounts it and binds those callbacks to the
 * `add_comment` / `delete_comment` edit kinds
 * (packages/office-engine/src/pptx/edits/notes-comment-edits.ts).
 *
 * Reply and resolve are shown as disabled controls with the reason, because
 * the vendored engine registers no reply/resolve op: an enabled control that
 * silently does nothing would be a lie (the lane's "pending command" pattern).
 */
import { useCallback, useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import {
  commentAvatarLabel,
  commentDraftReady,
  commentRefKey,
  commentsPanelMode,
  formatCommentTime,
  PPTX_COMMENT_REPLY_RESOLVE_SUPPORTED,
  type PptxComment,
} from "./comments-panel-state";

export interface PptxCommentsPanelProps {
  /** 0-based selected slide; null when no slide is bound. */
  slideIndex: number | null;
  comments: readonly PptxComment[];
  /** Add one comment on the selected slide. */
  onAddComment?: (slideIndex: number, text: string, author: string) => Promise<unknown> | unknown;
  /** Delete one comment by its (authorId, idx) identity. */
  onDeleteComment?: (slideIndex: number, authorId: number, idx: number) => Promise<unknown> | unknown;
  /** The host is fetching the selected slide's comments. */
  loading?: boolean;
  /** Read-only document. */
  readonly?: boolean;
  /** No comments port is bound to this editor. */
  unbound?: boolean;
  /** A host error to surface. */
  error?: string | null;
  /** An add/delete is in flight. */
  pending?: boolean;
  /** Author name pre-filled from the session, when the host knows it. */
  defaultAuthor?: string;
  /** BCP-47 tag for the timestamp formatting; defaults to the document lang. */
  locale?: string;
  onClose?: () => void;
  className?: string;
}

export function PptxCommentsPanel({
  slideIndex,
  comments,
  onAddComment,
  onDeleteComment,
  loading = false,
  readonly = false,
  unbound = false,
  error = null,
  pending = false,
  defaultAuthor = "",
  locale,
  onClose,
  className,
}: PptxCommentsPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const authorId = useId();
  const textId = useId();
  const mode = commentsPanelMode({ slideIndex, loading, unbound });
  const [author, setAuthor] = useState(defaultAuthor);
  const [draft, setDraft] = useState("");

  const boundAdd = typeof onAddComment === "function";
  const boundDelete = typeof onDeleteComment === "function";
  const ready = commentDraftReady({ author, text: draft, readonly, pending, boundPort: boundAdd });
  const slideLabel = slideIndex === null ? "" : String(slideIndex + 1);
  const timeLocale = locale ?? (typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined);

  const post = useCallback(() => {
    if (!ready || slideIndex === null) return;
    const text = draft.trim();
    const name = author.trim();
    setDraft("");
    // Fire-and-forget: the host reports the outcome through `comments` /
    // `error`; a rejection must not become an unhandled promise.
    void Promise.resolve(onAddComment?.(slideIndex, text, name)).catch(() => undefined);
  }, [author, draft, onAddComment, ready, slideIndex]);

  const remove = useCallback(
    (comment: PptxComment) => {
      if (!boundDelete || readonly || pending || slideIndex === null) return;
      void Promise.resolve(onDeleteComment?.(slideIndex, comment.authorId, comment.idx)).catch(() => undefined);
    },
    [boundDelete, onDeleteComment, pending, readonly, slideIndex],
  );

  const onTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      post();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
    }
  };

  return (
    <section
      aria-label={t("comments.title")}
      data-pptx-comments-panel
      data-testid="pptx-comments-panel"
      data-pptx-comments-mode={mode}
      className={cn("flex min-w-0 flex-col gap-2 border-l border-border bg-muted/10 p-2", className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-label font-medium text-foreground">{t("comments.title")}</span>
        {mode === "ready" ? (
          <span className="min-w-0 truncate text-caption text-muted-foreground" data-pptx-comments-slide data-testid="pptx-comments-slide">
            {t("comments.for_slide", { index: slideLabel })}
          </span>
        ) : null}
        {mode === "ready" ? (
          <span className="shrink-0 text-caption text-muted-foreground" data-pptx-comments-count data-testid="pptx-comments-count">
            {t("comments.count", { value: String(comments.length) })}
          </span>
        ) : null}
        {onClose ? (
          <Button type="button" size="icon-xs" variant="ghost" className="ml-auto shrink-0" aria-label={t("comments.close")} onClick={onClose}>
            <span aria-hidden="true">{"\u00d7"}</span>
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" data-pptx-comments-error className="text-caption text-destructive">
          {t("comments.error_title")} {t("comments.error", { message: error })}
        </p>
      ) : null}

      {mode === "unbound" ? (
        <p className="text-caption text-muted-foreground" data-pptx-comments-unbound data-testid="pptx-comments-unbound">{t("comments.unbound")}</p>
      ) : mode === "no_slide" ? (
        <p className="text-caption text-muted-foreground" data-pptx-comments-no-slide data-testid="pptx-comments-no-slide">{t("comments.no_slide")}</p>
      ) : mode === "loading" ? (
        <p className="text-caption text-muted-foreground" role="status" data-pptx-comments-loading data-testid="pptx-comments-loading">{t("comments.loading")}</p>
      ) : (
        <>
          {comments.length === 0 ? (
            <p className="text-caption text-muted-foreground" data-pptx-comments-empty data-testid="pptx-comments-empty">{t("comments.empty")}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2" data-pptx-comment-list>
              {comments.map((comment) => (
                <li
                  key={commentRefKey(comment)}
                  data-pptx-comment={commentRefKey(comment)}
                  className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-background p-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground"
                    >
                      {commentAvatarLabel(comment)}
                    </span>
                    <span className="min-w-0 truncate text-caption font-medium text-foreground">{comment.author}</span>
                    {comment.dt ? (
                      <span className="shrink-0 text-caption text-muted-foreground">{formatCommentTime(comment.dt, timeLocale ?? "en")}</span>
                    ) : null}
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="ml-auto shrink-0"
                      disabled={readonly || pending || !boundDelete}
                      aria-label={t("comments.delete")}
                      data-pptx-comment-action="delete"
                      onClick={() => remove(comment)}
                    >
                      <span aria-hidden="true">{"\u00d7"}</span>
                    </Button>
                  </div>
                  <p className="text-body whitespace-pre-wrap break-words text-foreground">{comment.text}</p>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="xs" variant="ghost" disabled aria-disabled="true" data-pptx-comment-action="reply">
                      {t("comments.reply")}
                    </Button>
                    <Button type="button" size="xs" variant="ghost" disabled aria-disabled="true" data-pptx-comment-action="resolve">
                      {t("comments.resolve")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!PPTX_COMMENT_REPLY_RESOLVE_SUPPORTED ? (
            <p className="text-caption text-muted-foreground" data-pptx-comments-unsupported data-testid="pptx-comments-unsupported">{t("comments.unsupported")}</p>
          ) : null}

          {readonly ? (
            <p className="text-caption text-muted-foreground" data-pptx-comments-readonly data-testid="pptx-comments-readonly">{t("comments.readonly")}</p>
          ) : (
            <div className="flex min-w-0 flex-col gap-1" data-pptx-comment-composer>
              <label className="text-caption text-muted-foreground" htmlFor={authorId}>{t("comments.author_label")}</label>
              <Input
                id={authorId}
                value={author}
                disabled={!boundAdd || pending}
                placeholder={t("comments.author_placeholder")}
                onChange={(event) => setAuthor(event.target.value)}
              />
              <Textarea
                id={textId}
                value={draft}
                rows={2}
                disabled={!boundAdd || pending}
                aria-label={t("comments.text_placeholder")}
                placeholder={t("comments.text_placeholder")}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onTextKeyDown}
              />
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" disabled={!ready} data-pptx-comment-action="post" onClick={post}>
                  {t("comments.post")}
                </Button>
                {pending ? <span className="text-caption text-muted-foreground" role="status">{t("comments.pending")}</span> : null}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
