"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { documentCommentDraftKey, useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";
import { K } from "./document-comments-keys";
import { useMentionPicker, type PickerRow } from "./use-mention-picker";

// The S12/S13 composer of the web panel: a labelled textarea whose draft
// survives a reload (the per-account draft store), Ctrl/⌘+Enter to send, the
// S14 mention picker, and the composer rows of the state table - sending,
// send failed (the text stays), target deleted while writing (the text stays,
// with a copy button), and the discard question when a draft is cancelled.

/** What a send ended with; the composer keeps the draft for every outcome but "sent". */
export type SendOutcome = "sent" | "failed" | "target_deleted";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function PickerOption({ row, active, query, onPick }: { row: PickerRow; active: boolean; query: string; onPick: (row: PickerRow) => void }) {
  const { t } = useTranslation();
  const base = "flex min-h-6 items-center gap-2 rounded px-2 py-1 text-caption pointer-coarse:min-h-11";
  if (row.type === "message") {
    const key = {
      searching: K.collabMentionSearching,
      noMatch: K.collabMentionNoMatch,
      noCandidates: K.collabMentionNoCandidates,
      error: K.collabMentionError,
    }[row.key];
    return (
      <li id={row.id} role="option" aria-disabled="true" aria-selected={false} className={cn(base, "text-muted-foreground")}>
        {t(key, { query })}
      </li>
    );
  }
  const label = row.type === "retry" ? t(K.collabRetry) : row.candidate.display_name || row.candidate.user_id;
  return (
    // The textarea keeps focus and drives the options from the keyboard (aria-activedescendant,
    // APG combobox); the click is the pointer path, and a pointer pick must not steal focus first.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      id={row.id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(row)}
      className={cn(base, "cursor-pointer", active ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
    >
      {row.type === "person" ? (
        <>
          <CommentActorAvatar name={label} avatarUrl={row.candidate.avatar_url} kind="human" />
          <span className="min-w-0 truncate font-medium">{label}</span>
          {row.candidate.email ? <span className="min-w-0 truncate text-muted-foreground">{row.candidate.email}</span> : null}
        </>
      ) : label}
    </li>
  );
}

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
  onSend: (body: string) => Promise<SendOutcome>;
  /** Closes the composer (reply box); asks first when a draft would be lost. */
  onCancel?: () => void;
  autoFocus?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const accountId = useAuthStore((s) => s.user?.id ?? "");
  const key = documentCommentDraftKey({ accountId, orgId, wsId, documentId, parentId });
  const value = useDocumentCommentDraftStore((s) => s.draftFor(key));
  const setDraft = useDocumentCommentDraftStore((s) => s.setDraft);
  const clearDraft = useDocumentCommentDraftStore((s) => s.clearDraft);
  const setValue = useCallback((next: string) => setDraft(key, next), [key, setDraft]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<"failed" | "target_deleted" | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const hintId = useId();
  const problemId = useId();
  const sendingId = useId();
  const picker = useMentionPicker({ wsId, documentId, value, setValue, textarea: () => ref.current });

  const blocked = !!blockedReasonId;
  const canSend = !sending && !blocked && value.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setProblem(null);
    try {
      const outcome = await onSend(value);
      if (outcome === "sent") clearDraft(key);
      else setProblem(outcome);
    } finally {
      setSending(false);
    }
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

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="relative">
        <textarea
          ref={ref}
          // Placeholder doubles as the accessible name (Accessibility Floor › Composer).
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
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
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
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
      {problem ? (
        <div id={problemId} role="alert" className="flex items-center gap-2 text-caption text-destructive" data-testid={`${testId}-problem`}>
          <span className="min-w-0 flex-1">{problem === "failed" ? t(K.collabSendFailed) : t(deletedKey)}</span>
          {problem === "target_deleted" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void copyText(value)}>
              <Copy aria-hidden />
              {t(K.collabCopyText)}
            </Button>
          ) : null}
        </div>
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
        <Button
          type="button"
          size="sm"
          aria-disabled={!canSend || undefined}
          onClick={() => void send()}
          data-testid={`${testId}-send`}
        >
          {sending ? t(K.collabSending) : t(K.collabSend)}
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
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                clearDraft(key);
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
