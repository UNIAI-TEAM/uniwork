"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { documentCommentDraftKey, useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import type { DocumentCommentMentionWithoutAccess } from "@uniwork/core/types/document";
import type { MentionCandidate } from "@uniwork/core/types/document-access";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { commentBodyToDisplay, commentDisplayToBody, mentionPeopleInBody } from "./document-comment-mention-draft";
import { PostSendMentionNotice } from "./document-comment-mention-notice";
import { MentionWarningDialog } from "./document-comment-mention-warning";
import { NoAccessChips, PickerOption } from "./document-comment-picker-option";
import { K } from "./document-comments-keys";
import { formatMentionList, resolveNoAccessMentionsForSend, type CommentDocContext } from "./document-comments-model";
import { useMentionPicker } from "./use-mention-picker";
import { useMentionWarning } from "./use-mention-warning";

// The S12/S13 composer of the web panel + G8-18 mention-without-access states:
// a labelled textarea whose draft survives a reload, Ctrl/⌘+Enter to send, the
// S14 mention picker with the `can_view: false` lock badge, the pre-send
// warning (sequential `view` shares, then ONE comment call) and the post-send
// inline notice.

export type SendStatus = "sent" | "failed" | "target_deleted";
/** What a send ended with; the composer keeps the draft for every outcome but "sent". */
export type SendOutcome =
  | SendStatus
  | { status: SendStatus; mentionsWithoutAccess?: DocumentCommentMentionWithoutAccess[] };

/** What the composer tells the sender about the comment it posts. */
export interface SendOptions {
  /** Upper-cased ids the pre-send warning already listed: the post-send notice leaves them out. */
  warnedUserIds: ReadonlySet<string>;
}

const LISTBOX_MAX = 256;
const LISTBOX_GAP = 8;

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function DocumentCommentComposer({
  wsId,
  documentId,
  orgId,
  parentId,
  placeholderKey,
  deletedKey,
  blockedReasonId,
  onSend,
  onCancel,
  autoFocus = false,
  testId,
  doc,
  canSeeMembers,
  canShare,
  onShareView,
  renderPostSendInline = true,
}: {
  wsId: string;
  documentId: string;
  orgId: string;
  /** The comment answered; absent for a new Discussion post. */
  parentId?: string;
  placeholderKey: string;
  /** The line shown when the thread was deleted while writing (comment or discussion wording). */
  deletedKey: string;
  /** Id of the panel status line when sending is blocked (offline, server error, signed out). */
  blockedReasonId?: string;
  onSend: (body: string, opts?: SendOptions) => Promise<SendOutcome>;
  /** Closes the composer (reply box); asks first when a draft would be lost. */
  onCancel?: () => void;
  autoFocus?: boolean;
  testId: string;
  /** Document permission context for G8-18 `can_share` resolution. */
  doc?: CommentDocContext | null;
  /** Whether the caller may list workspace members (`seeMembers`); gates `include=no_access`. */
  canSeeMembers?: boolean;
  /** Optional override for whether the caller can share `view` access with a candidate. */
  canShare?: boolean | ((userId: string) => boolean);
  /** Optional override for the share transport call (`POST /api/v1/documents/{id}/shares`). */
  onShareView?: (userId: string) => Promise<void>;
  /** Whether to render the post-send inline notice directly below the composer (false when the panel entry renders it). */
  renderPostSendInline?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const accountId = useAuthStore((s) => s.user?.id ?? "");
  const key = documentCommentDraftKey({ accountId, orgId, wsId, documentId, parentId });
  // The store holds the body as it will be sent (mention tokens); the textarea shows "@Name".
  const value = useDocumentCommentDraftStore((s) => s.draftFor(key));
  const display = useMemo(() => commentBodyToDisplay(value), [value]);
  const setDraft = useDocumentCommentDraftStore((s) => s.setDraft);
  const clearDraft = useDocumentCommentDraftStore((s) => s.clearDraft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<"failed" | "target_deleted" | null>(null);
  const [sharedNamesOnFailedSend, setSharedNamesOnFailedSend] = useState<string[] | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [postSendItems, setPostSendItems] = useState<DocumentCommentMentionWithoutAccess[]>([]);
  const [lastSentBody, setLastSentBody] = useState("");
  const hintId = useId();
  const problemId = useId();
  const sendingId = useId();
  const pickedRef = useRef<ReadonlyMap<string, MentionCandidate>>(new Map());
  // Edited text back to the stored body: people already in the body keep their ids, then the
  // person just picked, then the other picks of this session.
  const setValue = useCallback(
    (next: string, picked?: MentionCandidate) =>
      setDraft(
        key,
        commentDisplayToBody(next, [
          ...mentionPeopleInBody(value),
          ...(picked ? [picked] : []),
          ...pickedRef.current.values(),
        ]),
      ),
    [key, setDraft, value],
  );
  const picker = useMentionPicker({
    wsId,
    documentId,
    value: display,
    body: value,
    setValue,
    textarea: () => ref.current,
    canSeeMembers,
  });

  pickedRef.current = picker.pickedCandidates;

  const blocked = !!blockedReasonId;
  const canSend = !sending && !blocked && value.trim() !== "";

  const executeSend = async (sharedNamesForFailure?: string[]) => {
    if (sending || blocked || value.trim() === "") return;
    const bodyToSend = value;
    setSending(true);
    setProblem(null);
    try {
      const warned = new Set(mention.warnedRef.current);
      const raw = await onSend(bodyToSend, { warnedUserIds: warned });
      const outcome: SendStatus = typeof raw === "string" ? raw : raw.status;
      if (outcome === "sent") {
        setLastSentBody(bodyToSend);
        clearDraft(key);
        picker.clearPicked();
        mention.resetShared();
        setSharedNamesOnFailedSend(null);
        const fromServer = typeof raw === "object" ? (raw.mentionsWithoutAccess ?? []) : [];
        setPostSendItems(fromServer.filter((item) => !warned.has(item.user_id.toUpperCase())));
      } else {
        setProblem(outcome);
        if (outcome === "failed" && sharedNamesForFailure && sharedNamesForFailure.length > 0) {
          setSharedNamesOnFailedSend(sharedNamesForFailure);
        }
      }
    } finally {
      setSending(false);
    }
  };

  const documentWorkspaceId = doc?.workspace_id ?? "";
  const mention = useMentionWarning({ wsId, documentId, documentWorkspaceId, onShareView, sendNow: executeSend });
  const { resetShared } = mention;

  useEffect(() => {
    if (!value.trim()) {
      resetShared();
      setSharedNamesOnFailedSend(null);
    }
  }, [value, resetShared]);

  const fieldRef = useRef<HTMLDivElement>(null);
  const [listbox, setListbox] = useState({ up: false, maxHeight: LISTBOX_MAX });
  useLayoutEffect(() => {
    if (!picker.open) return;
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - LISTBOX_GAP;
    const above = rect.top - LISTBOX_GAP;
    const up = below < LISTBOX_MAX && above > below;
    setListbox({ up, maxHeight: Math.max(96, Math.min(LISTBOX_MAX, up ? above : below)) });
  }, [picker.open]);

  const noAccessChips = useMemo(
    () => picker.pickedInBody.filter((person) => person.can_view === false && !mention.sharedUserIds.has(person.user_id.toUpperCase())),
    [picker.pickedInBody, mention.sharedUserIds],
  );

  const send = async () => {
    if (!canSend) return;
    const pendingNoAccess = resolveNoAccessMentionsForSend({
      body: value,
      pickedCandidates: picker.pickedCandidates,
      sharedUserIds: mention.sharedRef.current,
      doc,
      currentUserId: accountId,
      canShare,
    });
    if (pendingNoAccess.length > 0) {
      mention.open(pendingNoAccess);
      return;
    }
    await executeSend(sharedNamesOnFailedSend ?? undefined);
  };

  const cancel = () => {
    if (value.trim() !== "") setDiscardOpen(true);
    else onCancel?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker.onKeyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      cancel();
    }
  };

  const describedBy = [hintId, problem ? problemId : null, sending ? sendingId : null, blockedReasonId ?? null]
    .filter(Boolean)
    .join(" ");
  const placeholder = t(placeholderKey);
  const shortcut = isMac() ? "⌘+Enter" : "Ctrl+Enter";

  const problemText = (() => {
    if (!problem) return null;
    if (problem === "target_deleted") return t(deletedKey);
    if (sharedNamesOnFailedSend && sharedNamesOnFailedSend.length > 0) {
      return t(K.collabSendFailedAfterShare, { sharedNames: formatMentionList(sharedNamesOnFailedSend, i18n.language) });
    }
    return t(K.collabSendFailed);
  })();

  return (
    <div className="space-y-2" data-testid={testId}>
      <NoAccessChips people={noAccessChips} testId={`${testId}-mention-chips`} />
      <div ref={fieldRef} className="relative">
        <textarea
          ref={ref}
          aria-label={placeholder}
          placeholder={placeholder}
          value={display}
          rows={2}
          autoFocus={autoFocus}
          aria-describedby={describedBy || undefined}
          {...(picker.open
            ? {
                role: "combobox",
                "aria-expanded": true,
                "aria-controls": picker.listboxId,
                "aria-autocomplete": "list" as const,
                "aria-activedescendant": picker.activeId,
              }
            : {})}
          onChange={(event) => {
            setValue(event.target.value);
            if (postSendItems.length > 0) setPostSendItems([]);
            picker.sync(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={(event) => picker.sync(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
          onBlur={() => picker.close()}
          onKeyDown={onKeyDown}
          className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground"
        />
        {picker.open ? (
          <ul
            id={picker.listboxId}
            role="listbox"
            aria-label={t(K.collabMentionLabel)}
            data-placement={listbox.up ? "top" : "bottom"}
            style={{ maxHeight: listbox.maxHeight }}
            className={cn(
              "absolute inset-x-0 z-20 space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
              listbox.up ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            {picker.rows.map((row) => (
              <PickerOption key={row.id} row={row} active={row.id === picker.activeId} query={picker.query} onPick={picker.activate} />
            ))}
          </ul>
        ) : null}
        {picker.open && picker.rows.some((row) => row.type === "person") ? (
          <span className="sr-only" aria-live="polite">{t(K.collabMentionCount, { count: picker.count })}</span>
        ) : null}
      </div>
      {problem && problemText ? (
        <div id={problemId} role="alert" className="flex items-center gap-2 text-caption text-destructive" data-testid={`${testId}-problem`}>
          <span className="min-w-0 flex-1">{problemText}</span>
          {problem === "target_deleted" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void copyText(display)}>
              <Copy aria-hidden />
              {t(K.collabCopyText)}
            </Button>
          ) : null}
        </div>
      ) : null}
      {renderPostSendInline && postSendItems.length > 0 ? (
        <PostSendMentionNotice
          wsId={wsId}
          documentId={documentId}
          documentWorkspaceId={documentWorkspaceId}
          items={postSendItems}
          body={lastSentBody}
          onShareView={onShareView}
          testId={`${testId}-post-send-notice`}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <span id={hintId} className="min-w-0 flex-1 truncate text-micro text-muted-foreground">
          {t(K.collabSendHint, { shortcut })}
        </span>
        {sending ? <span id={sendingId} className="sr-only">{t(K.collabSending)}</span> : null}
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            {t(K.collabCancel)}
          </Button>
        ) : null}
        <Button type="button" size="sm" aria-disabled={!canSend || undefined} onClick={() => void send()} data-testid={`${testId}-send`}>
          {sending ? t(K.collabSending) : t(K.collabSend)}
        </Button>
      </div>

      <MentionWarningDialog
        state={mention.warn}
        testId={testId}
        onCancel={mention.close}
        onShare={(targets) => void mention.shareThenSend(targets)}
        onSendOnly={() => void mention.sendOnly()}
      />

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(K.collabDiscardTitle)}</AlertDialogTitle>
            <AlertDialogDescription>{t(K.collabDiscardBody)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t(K.collabKeepWriting)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                clearDraft(key);
                picker.clearPicked();
                setDiscardOpen(false);
                onCancel?.();
              }}
            >
              {t(K.collabDiscard)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
