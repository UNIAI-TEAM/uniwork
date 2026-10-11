"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, ChevronRight, Copy, Ellipsis, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { DEFAULT_LOCALE } from "@uniwork/core/i18n";
import type { UploadResult } from "@uniwork/core/hooks/use-file-upload";
import type { Attachment } from "@uniwork/core/types";
import { ReactionBar } from "@uniwork/ui/components/common/reaction-bar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../agents/agent-badge";
import { ReadonlyContent } from "../editor";
import { CommentActorAvatar } from "./comment-actor-avatar";
import { CommentEditor } from "./comment-editor";
import { formatCommentDateTime, formatCommentTimeAgo } from "./comment-time";
import { deriveThreadResolution } from "./comment-thread";
import type { CommentLike } from "./comment-types";

/**
 * Shared comment card (G1-07c): one root comment and its replies, extracted
 * from the task detail timeline so document comments render the same
 * interaction model instead of a second copy that drifts.
 *
 * Task and document surfaces differ in three places only, and all three are
 * props: the i18n prefix (`tPrefix`), the testid prefix (`testIdPrefix`), and
 * whether attachment upload exists (`upload` — documents bind none). The
 * permission rules stay with the caller: `onEdit`/`onDelete` are only passed
 * when the surface already knows the server would accept the write, and the
 * card additionally gates them per row on author-or-moderate.
 */

export type CommentCallbacks = {
  onToggleReaction?: (commentId: string, emoji: string) => void;
  onEdit?: (commentId: string, body: string) => Promise<boolean>;
  onResolveToggle?: (commentId: string, resolved: boolean) => void;
  onDelete?: (commentId: string) => void;
};

export type CommentUploadWiring = {
  onFile: (file: File, uploadId: string) => Promise<UploadResult | null>;
  uploading?: boolean;
};

function CommentEntry<T extends CommentLike>({
  comment,
  attachments,
  upload,
  editorTaskId,
  highlighted,
  canModerate,
  getActorName,
  callbacks,
  collapse,
  reactionsReadOnly,
  tPrefix,
  testIdPrefix,
}: {
  comment: T;
  attachments?: Attachment[];
  upload?: CommentUploadWiring;
  editorTaskId?: string;
  highlighted?: boolean;
  canModerate: boolean;
  getActorName: (type: string, id: string) => string;
  callbacks: CommentCallbacks;
  collapse?: { open: boolean; preview: string; replyCount: number; onToggle: () => void };
  reactionsReadOnly?: boolean;
  tPrefix: string;
  testIdPrefix: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const authorLabel = comment.author?.display_name ?? comment.display_name ?? comment.author_id ?? "";
  const isOwn = currentUserId != null && comment.author_id === currentUserId;
  const canEdit = !!callbacks.onEdit && (isOwn || canModerate);
  const canDelete = !!callbacks.onDelete && (isOwn || canModerate);
  const resolved = !!comment.resolved_at;
  const locale = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE;
  const edited = !!comment.updated_at && comment.updated_at !== comment.created_at;
  const displayedAt = edited ? comment.updated_at : comment.created_at;
  const timeAgo = now === null
    ? null
    : formatCommentTimeAgo(displayedAt, locale, now);
  const exactTime = formatCommentDateTime(displayedAt, locale);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div id={`comment-${comment.id}`} data-testid={`${testIdPrefix}-${comment.id}`} className={cn(
      "transition-colors duration-700",
      highlighted && "bg-[color-mix(in_srgb,var(--card)_92%,var(--brand)_8%)]",
      resolved && "opacity-80",
    )}>
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-card px-3 py-2.5 text-caption text-muted-foreground">
        {collapse ? (
          <button
            type="button"
            aria-expanded={collapse.open}
            aria-label={collapse.open ? t(`${tPrefix}.comment_collapse`) : t(`${tPrefix}.comment_expand`)}
            onClick={collapse.onToggle}
            className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", collapse.open && "rotate-90")} aria-hidden />
          </button>
        ) : null}
        <CommentActorAvatar name={authorLabel} avatarUrl={comment.author?.avatar_url ?? comment.avatar_url} kind={comment.author_kind} />
        <span className="min-w-0 truncate font-medium text-foreground">{authorLabel}</span>
        {comment.author_kind === "agent" ? <AgentBadge /> : null}
        {timeAgo ? (
          <time dateTime={displayedAt} title={exactTime ?? undefined} className="shrink-0">
            {edited ? t(`${tPrefix}.comment_edited_time`, { time: timeAgo }) : timeAgo}
          </time>
        ) : null}
        {collapse && !collapse.open ? <span className="min-w-0 flex-1 truncate">{collapse.preview}</span> : null}
        {collapse && !collapse.open && collapse.replyCount > 0 ? (
          <span className="shrink-0">{t(`${tPrefix}.comment_reply_count`, { count: collapse.replyCount })}</span>
        ) : null}
        {resolved ? <span className="text-micro">{t(`${tPrefix}.comment_resolved`)}</span> : null}
        {collapse?.open !== false ? <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t(`${tPrefix}.comment_actions`)} />}>
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void copyText(comment.body)}><Copy aria-hidden />{t(`${tPrefix}.comment_copy`)}</DropdownMenuItem>
              {callbacks.onResolveToggle ? (
                <DropdownMenuItem onClick={() => callbacks.onResolveToggle?.(comment.id, !resolved)}>
                  {resolved ? <RotateCcw aria-hidden /> : <CircleCheck aria-hidden />}
                  {resolved ? t(`${tPrefix}.comment_unresolve`) : t(`${tPrefix}.comment_resolve`)}
                </DropdownMenuItem>
              ) : null}
              {canEdit || canDelete ? <DropdownMenuSeparator /> : null}
              {canEdit ? <DropdownMenuItem onClick={() => setEditing(true)}><Pencil aria-hidden />{t(`${tPrefix}.comment_edit`)}</DropdownMenuItem> : null}
              {canDelete ? <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden />{t("common.delete")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div> : null}
      </header>
      {collapse?.open !== false ? <div className="px-3 pb-3 pl-12">
        {editing && callbacks.onEdit ? (
          <CommentEditor
            testId={`${testIdPrefix}-editor`}
            body={comment.body}
            placeholder={t(`${tPrefix}.comment_edit_placeholder`)}
            attachments={attachments}
            upload={upload}
            currentTaskId={editorTaskId}
            onSave={(body) => callbacks.onEdit?.(comment.id, body) ?? Promise.resolve(false)}
            onCancel={() => setEditing(false)}
          />
        ) : <ReadonlyContent content={comment.body} attachments={attachments} className="text-body text-foreground" />}
        {!editing && (callbacks.onToggleReaction || reactionsReadOnly) ? (
          <ReactionBar
            reactions={comment.reactions ?? []}
            currentUserId={currentUserId}
            readOnly={reactionsReadOnly}
            onToggle={(emoji) => callbacks.onToggleReaction?.(comment.id, emoji)}
            getActorName={getActorName}
            className="mt-2"
          />
        ) : null}
      </div> : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${tPrefix}.comment_delete_title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${tPrefix}.comment_delete_description`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { callbacks.onDelete?.(comment.id); setDeleteOpen(false); }}>
              {t(`${tPrefix}.comment_delete_confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One card owns a complete comment thread, matching the reference interaction model. */
export function CommentCard<T extends CommentLike>({
  comment, replies = [], tPrefix, testIdPrefix = "comment", attachments, upload, editorTaskId,
  highlighted, highlightedId, canModerate = false, getActorName = (_type, id) => id, replyComposer,
  reactionsReadOnly = false,
  onToggleReaction, onEdit, onResolveToggle, onDelete,
}: {
  comment: T;
  replies?: T[];
  /** i18n prefix (`tasks.detail` or `documents.comments`). */
  tPrefix: string;
  /** Testid prefix: the card reads `${testIdPrefix}-<id>`, the editor `${testIdPrefix}-editor`. */
  testIdPrefix?: string;
  attachments?: Attachment[];
  upload?: CommentUploadWiring;
  /** Task id for the editor's sub-task action; documents pass none. */
  editorTaskId?: string;
  highlighted?: boolean;
  highlightedId?: string | null;
  canModerate?: boolean;
  getActorName?: (type: string, id: string) => string;
  replyComposer?: ReactNode;
  /** Viewers without the edit level see the reactions as plain chips. */
  reactionsReadOnly?: boolean;
  onToggleReaction?: (commentId: string, emoji: string) => void;
  onEdit?: (commentId: string, body: string) => Promise<boolean>;
  onResolveToggle?: (commentId: string, resolved: boolean) => void;
  onDelete?: (commentId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [resolvedRepliesOpen, setResolvedRepliesOpen] = useState(false);
  const preview = comment.body.replace(/\s+/g, " ").trim().slice(0, 80);
  const callbacks = { onToggleReaction, onEdit, onResolveToggle, onDelete };
  const resolution = deriveThreadResolution(comment, replies);
  const resolutionId = resolution.kind === "reply" ? resolution.resolutionId : null;
  const foldedReplies = resolutionId ? replies.filter((reply) => reply.id !== resolutionId) : [];
  const visibleReplies = resolutionId && !resolvedRepliesOpen
    ? replies.filter((reply) => reply.id === resolutionId)
    : replies;

  return (
    <article className="overflow-clip rounded-lg border border-border/50 bg-card shadow-[var(--surface-shadow)]">
      <CommentEntry
        comment={comment}
        attachments={attachments}
        upload={upload}
        editorTaskId={editorTaskId}
        highlighted={highlighted || highlightedId === comment.id}
        canModerate={canModerate}
        getActorName={getActorName}
        callbacks={callbacks}
        collapse={{ open, preview, replyCount: replies.length, onToggle: () => setOpen((value) => !value) }}
        reactionsReadOnly={reactionsReadOnly}
        tPrefix={tPrefix}
        testIdPrefix={testIdPrefix}
      />
      {open ? (
        <div>
          {resolutionId && !resolvedRepliesOpen && foldedReplies.length > 0 ? (
            <button
              type="button"
              onClick={() => setResolvedRepliesOpen(true)}
              className="flex w-full items-center gap-2 border-t border-border/50 bg-muted/40 px-3 py-2.5 text-left text-caption text-muted-foreground hover:bg-muted"
            >
              <ChevronRight className="size-3.5 rotate-90" aria-hidden />
              {t(`${tPrefix}.comment_resolved_fold`, { count: foldedReplies.length })}
            </button>
          ) : null}
          {visibleReplies.map((reply) => (
            <div key={reply.id} className="border-t border-border/50">
              <CommentEntry comment={reply} attachments={attachments} upload={upload} editorTaskId={editorTaskId} highlighted={highlightedId === reply.id} canModerate={canModerate} getActorName={getActorName} callbacks={callbacks} reactionsReadOnly={reactionsReadOnly} tPrefix={tPrefix} testIdPrefix={testIdPrefix} />
            </div>
          ))}
          {resolutionId && resolvedRepliesOpen ? (
            <button
              type="button"
              onClick={() => setResolvedRepliesOpen(false)}
              className="w-full border-t border-border/50 px-3 py-2 text-left text-caption text-muted-foreground hover:bg-muted/50"
            >
              {t(`${tPrefix}.comment_resolved_fold_close`)}
            </button>
          ) : null}
          {replyComposer ? <div className="border-t border-border/50 px-3 py-2">{replyComposer}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
