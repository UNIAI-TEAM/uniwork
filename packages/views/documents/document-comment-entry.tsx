"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Copy, Ellipsis, Pencil, RotateCcwClock, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE } from "@uniwork/core/i18n";
import type {
  DocumentComment,
  DocumentCommentMentionWithoutAccess,
} from "@uniwork/core/types/document";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { AgentBadge } from "../agents/agent-badge";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";
import { DocumentCommentBody, type MentionNames } from "./document-comment-body";
import { commentBodyToDisplay, commentDisplayToBody, mentionPeopleInBody } from "./document-comment-mention-draft";
import { PostSendMentionNotice } from "./document-comment-mention-notice";
import { DocumentCommentHistory } from "./document-comment-history";
import { K } from "./document-comments-keys";
import { formatCollabTime } from "./document-comments-model";

// One post of a thread (root or reply): the deleted frame for a tombstone, or
// author + time + body with its actions. The root also carries the thread
// heading (the focus target of a deep link) and the anchor line.

interface EntryPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

/** The frame a deleted post leaves while replies survive: no author, body, actions or history. */
function DeletedFrame({ id, headingRef }: { id: string; headingRef?: Ref<HTMLParagraphElement> }) {
  const { t } = useTranslation();
  return (
    <div data-testid={`document-comment-${id}`} data-deleted="true" className="px-3 py-2.5">
      <p ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-caption italic text-muted-foreground">
        {t(K.collabDeleted)}
      </p>
    </div>
  );
}

function EditBox({ initial, onSave, onClose }: { initial: string; onSave: (body: string) => Promise<boolean>; onClose: () => void }) {
  const { t } = useTranslation();
  // The textarea shows "@Name"; people mentioned in `initial` go back to their tokens on save.
  const [value, setValue] = useState(() => commentBodyToDisplay(initial));
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const body = commentDisplayToBody(value, mentionPeopleInBody(initial));
  const changed = body !== initial;
  const save = async () => {
    if (saving || value.trim() === "") return;
    if (!changed) return onClose();
    setSaving(true);
    try {
      if (await onSave(body)) onClose();
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => (changed ? setDiscardOpen(true) : onClose());
  return (
    <div className="space-y-2">
      <textarea
        aria-label={t(K.collabEdit)}
        value={value}
        rows={3}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
        className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-body text-foreground"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>{t(K.collabCancel)}</Button>
        <Button type="button" size="sm" aria-disabled={saving || value.trim() === "" || undefined} onClick={() => void save()}>
          {t(K.collabSave)}
        </Button>
      </div>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(K.collabDiscardTitle)}</AlertDialogTitle>
            <AlertDialogDescription>{t(K.collabDiscardBody)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t(K.collabKeepWriting)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setDiscardOpen(false); onClose(); }}>
              {t(K.collabDiscard)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function DocumentCommentEntry({
  wsId,
  documentId,
  documentWorkspaceId,
  comment,
  authorName,
  authorId,
  names,
  nameOf,
  permissions,
  onEdit,
  onDelete,
  onTombstone,
  headingRef,
  meta,
  mentionsWithoutAccess,
  reply = false,
  children,
}: {
  wsId: string;
  documentId: string;
  documentWorkspaceId?: string;
  comment: DocumentComment;
  authorName: string;
  /** Id of the author's name element, part of the thread's accessible name. */
  authorId?: string;
  names: MentionNames;
  nameOf: (userId: string) => string;
  permissions: EntryPermissions;
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  /** The server said the post is a tombstone (history 409): reload the list. */
  onTombstone: () => void;
  /** The root's heading: the element a deep link focuses. */
  headingRef?: Ref<HTMLHeadingElement & HTMLParagraphElement>;
  /** Anchor and state labels shown in the root's head line. */
  meta?: ReactNode;
  /** Post-send mentions without access returned by create/update (G8-18). */
  mentionsWithoutAccess?: readonly DocumentCommentMentionWithoutAccess[];
  /** A reply: smaller avatar and no card padding, it sits under the root's left rule. */
  reply?: boolean;
  /** The root's action row (reply, resolve). */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE;
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyOpener = useRef<HTMLElement | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const fallbackAuthorId = useId();
  const actionsLabelId = useId();
  const nameId = authorId ?? fallbackAuthorId;
  const wasOpen = useRef(false);

  // Opening or closing the history hands focus back to the control that opened it.
  useEffect(() => {
    if (wasOpen.current && !historyOpen) (historyOpener.current ?? menuButton.current)?.focus();
    wasOpen.current = historyOpen;
  }, [historyOpen]);

  if (comment.deleted_at) return <DeletedFrame id={comment.id} headingRef={headingRef} />;

  const edited = comment.revision > 1;
  const toggleHistory = (opener: HTMLElement | null) => {
    historyOpener.current = opener;
    setHistoryOpen((open) => !open);
  };
  const time = formatCollabTime(comment.created_at, locale);
  const Heading = headingRef ? "h3" : "p";
  const noticeItems = mentionsWithoutAccess ?? comment.mentions_without_access;

  return (
    <div data-testid={`document-comment-${comment.id}`} className={reply ? "py-1" : "px-3 py-2.5"}>
      <div className="flex items-start gap-2">
        <CommentActorAvatar
          name={authorName}
          avatarUrl={comment.author?.avatar_url || comment.avatar_url || undefined}
          kind={comment.author_kind}
          size={reply ? "md" : "lg"}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <Heading
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground"
          >
            <span id={nameId} className="min-w-0 truncate font-medium text-foreground">{authorName}</span>
            {comment.author_kind === "agent" ? <AgentBadge /> : null}
            {time ? <time dateTime={comment.created_at}>{time}</time> : null}
            {edited && !editing ? (
              <button
                type="button"
                aria-expanded={historyOpen}
                title={t(K.collabEdited, { time: formatCollabTime(comment.updated_at, locale) })}
                onClick={(event) => toggleHistory(event.currentTarget)}
                className="inline-flex min-h-6 items-center rounded text-micro text-muted-foreground underline-offset-2 hover:underline pointer-coarse:min-h-11"
              >
                {t(K.collabEditedMark)}
              </button>
            ) : null}
          </Heading>
          {meta}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={menuButton}
                type="button"
                variant="ghost"
                size="icon-sm"
                // The post's author is part of the name, so a list of "More actions" buttons tells posts apart.
                aria-labelledby={`${actionsLabelId} ${nameId}`}
              />
            }
          >
            <span id={actionsLabelId} hidden>{t(K.collabActions)}</span>
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {permissions.canEdit ? (
              <DropdownMenuItem onClick={() => setEditing(true)}><Pencil aria-hidden />{t(K.collabEdit)}</DropdownMenuItem>
            ) : null}
            {permissions.canDelete ? (
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden />{t(K.collabDelete)}</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => void copyText(comment.body)}><Copy aria-hidden />{t(K.collabCopyText)}</DropdownMenuItem>
            {edited ? (
              <DropdownMenuItem onClick={() => toggleHistory(null)}><RotateCcwClock aria-hidden />{t(K.collabHistory)}</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className={reply ? "pl-8" : "pl-10"}>
        {editing ? (
          <EditBox initial={comment.body} onSave={onEdit} onClose={() => setEditing(false)} />
        ) : (
          <DocumentCommentBody body={comment.body} names={names} className="mt-1" />
        )}
        {!editing && noticeItems && noticeItems.length > 0 ? (
          <PostSendMentionNotice
            wsId={wsId}
            documentId={documentId}
            documentWorkspaceId={documentWorkspaceId}
            items={noticeItems}
            nameOfId={nameOf}
            body={comment.body}
            testId={`document-comment-post-send-notice-${comment.id}`}
          />
        ) : null}
        {edited && historyOpen ? (
          <DocumentCommentHistory
            wsId={wsId}
            documentId={documentId}
            comment={comment}
            names={names}
            nameOf={nameOf}
            onTombstone={() => {
              setHistoryOpen(false);
              onTombstone();
            }}
          />
        ) : null}
        {children}
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(K.collabDeleteTitle)}</AlertDialogTitle>
            <AlertDialogDescription>{t(K.collabDeleteBody)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(K.collabCancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                void onDelete();
              }}
            >
              {t(K.collabDeleteConfirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
