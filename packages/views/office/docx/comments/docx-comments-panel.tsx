"use client";

// B2 (UNI-924): the review ▸ comments pane. Presentational on purpose — the
// toolbar group owns open/compose state and calls the command runtime; this
// file renders threads (open list + a collapsible resolved group), the new /
// reply composers, resolve/reopen, delete-with-confirm and the empty state.
import { Check, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@uniwork/ui/components/ui/alert-dialog";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@uniwork/ui/components/ui/empty";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";
import { commentInitials, formatCommentDate, groupCommentThreads, type DocxCommentThread } from "./docx-comment-model";

export interface DocxCommentsPanelProps {
  comments: DocxCommentInfo[];
  /** Anchor text per comment id, read from the rendered surface. */
  anchorTexts: ReadonlyMap<string, string>;
  /** Comment whose anchor was last jumped to (row highlight). */
  activeId: string | null;
  readOnly: boolean;
  /** The editor selection can take a new comment. */
  canComment: boolean;
  /** The new-comment composer is open. */
  composing: boolean;
  onComposingChange(composing: boolean): void;
  /** True when the comment was created; false keeps the draft (a collapsed
   * selection or a lost anchor must not silently discard the typed text). */
  onSubmit(text: string): boolean;
  /** True when the reply was created; false keeps the draft. */
  onReply(parentId: string, text: string): boolean;
  onResolve(id: string, done: boolean): void;
  onDelete(id: string): void;
  onJump(id: string): void;
  onClose(): void;
}

export function DocxCommentsPanel({
  comments,
  anchorTexts,
  activeId,
  readOnly,
  canComment,
  composing,
  onComposingChange,
  onSubmit,
  onReply,
  onResolve,
  onDelete,
  onJump,
  onClose,
}: DocxCommentsPanelProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocxCommentInfo | null>(null);
  const { open, resolved } = useMemo(() => groupCommentThreads(comments), [comments]);
  const editable = !readOnly;

  const submitNew = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    // A refusal (collapsed selection, lost anchor) keeps the composer and the
    // draft: the user's text is never discarded without a trace (F5).
    if (!onSubmit(text)) return;
    setDraft("");
    onComposingChange(false);
  };

  const submitReply = (parentId: string) => {
    const text = replyDraft.trim();
    if (text.length === 0) return;
    if (!onReply(parentId, text)) return;
    setReplyDraft("");
    setReplyTo(null);
  };

  const renderHeader = (comment: DocxCommentInfo) => (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground" aria-hidden>
        {commentInitials(comment)}
      </span>
      <span className="min-w-0 flex-1 truncate text-caption font-medium">{comment.author || t("office.docx.comments.unknownAuthor")}</span>
      <span className="shrink-0 text-caption text-muted-foreground">{formatCommentDate(comment.date, i18n.language)}</span>
      {comment.done ? <Badge variant="secondary">{t("office.docx.comments.resolved")}</Badge> : null}
    </div>
  );

  const renderThread = (thread: DocxCommentThread) => {
    const anchor = anchorTexts.get(thread.id) ?? "";
    const active = activeId === thread.id;
    return (
      <div
        key={thread.id}
        className={cn(
          "flex flex-col gap-2 rounded-lg p-2 ring-1 ring-surface-border",
          active ? "bg-surface-hover" : "bg-surface-raised",
          thread.comment.done && "opacity-80",
        )}
      >
        <button type="button" className="flex flex-col gap-1 text-left" onClick={() => onJump(thread.id)}>
          {renderHeader(thread.comment)}
          {anchor ? <span className="line-clamp-2 text-caption text-muted-foreground" title={anchor}>{anchor}</span> : null}
          <span className="text-body">{thread.comment.text}</span>
        </button>
        {thread.replies.map((reply) => (
          <div key={reply.id} className="flex flex-col gap-1 border-l-2 border-surface-border pl-2">
            {renderHeader(reply)}
            <span className="text-body">{reply.text}</span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => { setReplyTo(thread.id); setReplyDraft(""); }}>
            {t("office.docx.comments.reply")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => onResolve(thread.id, thread.comment.done !== true)}>
            {thread.comment.done ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
            {thread.comment.done ? t("office.docx.comments.reopen") : t("office.docx.comments.resolve")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => setPendingDelete(thread.comment)}>
            <Trash2 aria-hidden />
            {t("office.docx.comments.delete")}
          </Button>
        </div>
        {replyTo === thread.id ? (
          <div className="flex flex-col gap-1.5">
            <Textarea
              autoFocus
              rows={2}
              value={replyDraft}
              placeholder={t("office.docx.comments.replyPlaceholder")}
              aria-label={t("office.docx.comments.replyPlaceholder")}
              onChange={(event) => setReplyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitReply(thread.id);
                if (event.key === "Escape") setReplyTo(null);
              }}
            />
            <div className="flex justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setReplyTo(null)}>{t("office.docx.comments.cancel")}</Button>
              <Button type="button" size="sm" disabled={replyDraft.trim().length === 0} onClick={() => submitReply(thread.id)}>{t("office.docx.comments.submit")}</Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex max-h-[70vh] w-full min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-heading text-title-sm font-medium">
          <MessageSquare aria-hidden />
          {t("office.docx.comments.title")}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.docx.comments.close")} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {editable && composing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            autoFocus
            rows={2}
            value={draft}
            placeholder={t("office.docx.comments.newPlaceholder")}
            aria-label={t("office.docx.comments.newPlaceholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitNew();
              if (event.key === "Escape") onComposingChange(false);
            }}
          />
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => onComposingChange(false)}>{t("office.docx.comments.cancel")}</Button>
            <Button type="button" size="sm" disabled={draft.trim().length === 0} onClick={submitNew}>{t("office.docx.comments.submit")}</Button>
          </div>
        </div>
      ) : null}
      {editable && !composing ? (
        <Button type="button" variant="outline" size="sm" disabled={!canComment} title={!canComment ? t("office.docx.comments.noSelection") : undefined} onClick={() => onComposingChange(true)}>
          {t("office.docx.comments.add")}
        </Button>
      ) : null}
      {!editable ? <p className="text-caption text-muted-foreground">{t("office.docx.comments.readOnlyNote")}</p> : null}
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
        {open.map(renderThread)}
        {resolved.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => setShowResolved((value) => !value)}>
              {t("office.docx.comments.resolvedCount", { count: resolved.length })}
            </Button>
            {showResolved ? resolved.map(renderThread) : null}
          </div>
        ) : null}
        {comments.length === 0 ? (
          <Empty className="border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><MessageSquare aria-hidden /></EmptyMedia>
              <EmptyTitle as="h3">{t("office.docx.comments.empty")}</EmptyTitle>
              <EmptyDescription>{t("office.docx.comments.emptyHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("office.docx.comments.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("office.docx.comments.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("office.docx.comments.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructiveSolid"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {t("office.docx.comments.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
