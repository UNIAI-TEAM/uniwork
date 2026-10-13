"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleCheck, MessageSquareReply, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE } from "@uniwork/core/i18n";
import type { DocumentComment } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { DocumentCommentComposer, type SendOutcome } from "./document-comment-composer";
import { DocumentCommentEntry } from "./document-comment-entry";
import type { MentionNames } from "./document-comment-body";
import { K } from "./document-comments-keys";
import { anchorLabel, anchorStateKey, replyTargetOf, type DocumentThread } from "./document-comments-model";

// One thread of the panel (S12 "Một thread" / S13 list rows): a list item
// named by its author, anchor label and state (aria-labelledby, no composed
// string), the root with its anchor line and Reply / Resolve / Reopen, the
// replies indented oldest first, and the reply box when open. A write the
// server refuses leaves the thread as it was and says so under it.

export interface ThreadActions {
  reply: (parentId: string, body: string) => Promise<SendOutcome>;
  edit: (commentId: string, body: string) => Promise<boolean>;
  remove: (commentId: string) => Promise<boolean>;
  setResolved: (commentId: string, resolved: boolean) => Promise<boolean>;
  reload: () => void;
}

export interface ThreadContext {
  wsId: string;
  documentId: string;
  orgId: string;
  names: MentionNames;
  nameOf: (comment: Pick<DocumentComment, "author_id" | "author" | "display_name">) => string;
  nameOfId: (userId: string) => string;
  currentUserId: string | undefined;
  /** edit or manage: reply, resolve, edit/delete own posts. */
  canWrite: boolean;
  /** manage: edit/delete anyone's posts too. */
  canModerate: boolean;
  /** Id of the panel status line while sending is blocked. */
  blockedReasonId?: string;
  deletedKey: string;
  actions: ThreadActions;
}

export function DocumentCommentThread({
  thread,
  ctx,
  focusRequest,
  onFocusHandled,
}: {
  thread: DocumentThread;
  ctx: ThreadContext;
  /** "heading" for a deep link, "resolve" after Resolve/Reopen moved the thread between groups. */
  focusRequest?: "heading" | "resolve" | null;
  onFocusHandled: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE;
  const { root, replies } = thread;
  const [replying, setReplying] = useState(false);
  const [failed, setFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement & HTMLParagraphElement>(null);
  const resolveRef = useRef<HTMLButtonElement>(null);
  const authorId = useId();
  const anchorId = useId();
  const stateId = useId();
  const statusId = useId();

  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest === "resolve" ? (resolveRef.current ?? headingRef.current) : headingRef.current;
    target?.scrollIntoView?.({ block: "nearest" });
    target?.focus();
    onFocusHandled();
  }, [focusRequest, onFocusHandled]);

  const anchor = root.kind === "comment" ? anchorLabel(root.anchor, locale) : null;
  const stateKey = root.kind === "comment" ? anchorStateKey(root.anchor_state) : null;
  const resolved = !!root.resolved_at;
  const deleted = !!root.deleted_at;
  const target = replyTargetOf(thread);
  const mine = (comment: DocumentComment) => !!ctx.currentUserId && comment.author_id === ctx.currentUserId;
  const permissionsOf = (comment: DocumentComment) => {
    const allowed = ctx.canWrite && (mine(comment) || ctx.canModerate);
    return { canEdit: allowed, canDelete: allowed };
  };
  const guard = async (run: () => Promise<boolean>) => {
    setFailed(false);
    const ok = await run();
    if (!ok) setFailed(true);
    return ok;
  };

  const labelledBy = [deleted ? null : authorId, anchor ? anchorId : null, stateKey ? stateId : null, resolved ? statusId : null]
    .filter(Boolean)
    .join(" ");

  const meta = anchor || stateKey || resolved ? (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
      {anchor ? <span id={anchorId} title={anchor.title}>{t(anchor.key, anchor.values)}</span> : null}
      {stateKey ? (
        <span id={stateId} className="font-medium text-warning-soft-foreground" data-anchor-state={root.anchor_state}>
          {t(stateKey)}
        </span>
      ) : null}
      {resolved ? <span id={statusId} className="rounded bg-muted px-1.5 font-medium text-foreground">{t(K.collabResolved)}</span> : null}
    </p>
  ) : null;

  const entryFor = (comment: DocumentComment, isRoot: boolean) => (
    <DocumentCommentEntry
      wsId={ctx.wsId}
      documentId={ctx.documentId}
      comment={comment}
      authorName={ctx.nameOf(comment)}
      authorId={isRoot ? authorId : undefined}
      names={ctx.names}
      nameOf={ctx.nameOfId}
      permissions={permissionsOf(comment)}
      onEdit={(body) => guard(() => ctx.actions.edit(comment.id, body))}
      onDelete={() => guard(() => ctx.actions.remove(comment.id))}
      onTombstone={ctx.actions.reload}
      headingRef={isRoot ? headingRef : undefined}
      meta={isRoot ? meta : undefined}
    >
      {isRoot && ctx.canWrite && !deleted ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {target && !replying ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplying(true)}>
              <MessageSquareReply aria-hidden />
              {t(K.collabReply)}
            </Button>
          ) : null}
          <Button
            ref={resolveRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void guard(() => ctx.actions.setResolved(root.id, !resolved))}
          >
            {resolved ? <RotateCcw aria-hidden /> : <CircleCheck aria-hidden />}
            {resolved ? t(K.collabReopen) : t(K.collabResolve)}
          </Button>
        </div>
      ) : null}
    </DocumentCommentEntry>
  );

  return (
    <li
      aria-labelledby={labelledBy || undefined}
      data-testid={`document-thread-${root.id}`}
      data-thread-kind={root.kind}
      className="overflow-clip rounded-lg border border-border/60 bg-card"
    >
      {deleted && meta ? <div className="px-3 pt-2">{meta}</div> : null}
      {entryFor(root, true)}
      {replies.length > 0 ? (
        <ul className="ml-6 border-l border-border/60">
          {replies.map((reply) => (
            <li key={reply.id} className="border-t border-border/40">{entryFor(reply, false)}</li>
          ))}
        </ul>
      ) : null}
      {replying && target ? (
        <div className="border-t border-border/60 p-3">
          <DocumentCommentComposer
            wsId={ctx.wsId}
            documentId={ctx.documentId}
            orgId={ctx.orgId}
            parentId={target.id}
            placeholderKey={K.collabComposerReply}
            deletedKey={ctx.deletedKey}
            blockedReasonId={ctx.blockedReasonId}
            autoFocus
            onSend={async (body) => {
              const outcome = await ctx.actions.reply(target.id, body);
              if (outcome === "sent") setReplying(false);
              return outcome;
            }}
            onCancel={() => setReplying(false)}
            testId={`document-reply-composer-${root.id}`}
          />
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="px-3 pb-2 text-caption text-destructive">{t(K.collabActionFailed)}</p>
      ) : null}
    </li>
  );
}
