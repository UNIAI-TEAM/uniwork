"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, errorCode, errorFields } from "@uniwork/core/api";
import {
  accessRequestOutcome,
  readDocumentAccessRequestSentAt,
  subscribeDocumentAccessRequestSent,
  useRequestDocumentAccess,
} from "@uniwork/core/documents/hooks-access-requests";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { chatErrorMessage } from "./chat-error-message";
import { bubbleControlClass } from "./chat-file-card";

type TFunction = ReturnType<typeof useTranslation>["t"];

/**
 * The look of a card control on its bubble. A bare `outline` button paints
 * `bg-background` / `dark:bg-input/30`, a white pill on my brand bubble, so on
 * mine the control is the soft `toolbar` variant with the own-bubble wash;
 * on theirs it stays the outline button.
 */
export function documentControlProps(isOwn: boolean): { variant: "outline" | "toolbar"; className: string } {
  return isOwn
    ? { variant: "toolbar", className: bubbleControlClass(true) }
    : { variant: "outline", className: "" };
}

/** The card's secondary text: the own-bubble meta tone on my bubble, grey on theirs. */
export function documentMutedClass(isOwn: boolean): string {
  return isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground";
}

/**
 * The card's own sentence for a failed version upload, or null when the
 * failure has none (the caller then keeps the documents copy). The two named
 * refusals (contract §4.4 / §2.3) and the edit lock (423, UNI-1645) come
 * first, then the shared chat table.
 */
export function chatDocumentVersionMessage(err: unknown, t: TFunction): string | null {
  const code = errorCode(err);
  // The card's own conflict copy (RFC-04): there is no history view behind a
  // chat card for the restore_conflict sentence to send the reader to.
  if (code === "document_version_conflict") return t("chat.errors.document_version_conflict");
  if (code === "unsupported_media_type" && errorFields(err)?.reason === "format_changed") {
    return t("chat.errors.document_format_changed");
  }
  if (isDocumentLocked(err)) {
    const fields = errorFields(err);
    // The reader's own hold in another tab or window: the 423 sends no lock id,
    // so this tab cannot write through it (contract D6). The document page's
    // own sentence: a page opened from here holds nothing either.
    if (fields?.held_by_me === true) return t("documents.upload.document_locked_by_me");
    const name = typeof fields?.holder_name === "string" ? fields.holder_name.trim() : "";
    return name ? t("chat.errors.document_locked", { name }) : t("chat.errors.document_locked_unnamed");
  }
  return chatErrorMessage(err, t, "") || null;
}

/** A 423 `document_locked`, from the server or the chunked pre-check. */
export function isDocumentLocked(err: unknown): boolean {
  return errorCode(err) === "document_locked" || (err instanceof ApiError && err.status === 423);
}

/** "10:32" in the reader's clock, for the note about this device's earlier request. */
function sentTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

const noFlag = () => null;

/**
 * The no-access card's "Yêu cầu quyền truy cập" button (L4 / S7): it asks the
 * document's managers for view access through
 * POST /documents/{id}/access-requests, the same route and copy as the
 * document page's locked card. The route's 202 is uniform on purpose (it also
 * answers a document the caller already reads or one that does not exist), so
 * `sent` is shown as sent; 409 `access_request_pending` reads as "already
 * waiting". Both replace the button in place for a send made in this mount, so
 * a second send is not offered; the refusals (cooldown, limiter, anything
 * else) stay a toast and keep the button for another try. The sentence is
 * written into a status region that is mounted from the start (a live region
 * created with its text is not announced) and takes focus when the button it
 * replaces had it and nothing else has taken it since, so a keyboard user
 * keeps their place.
 *
 * The 24 h device flag the hook writes is a display note, never a gate (same
 * as the document page): a remount with the flag set shows
 * `sent_earlier` above the button, which stays, so a request that was denied
 * or expired elsewhere never leaves the person without the action. The local
 * "sent" claim ends with the flag: a decided frame clears it and the card
 * stops saying a request waits.
 */
export function ChatDocumentRequestAccess({
  workspaceId,
  documentId,
  isOwn = false,
}: {
  workspaceId: string;
  documentId: string;
  /** The bubble it sits on: the controls and the note follow its palette. */
  isOwn?: boolean;
}) {
  const { t } = useTranslation();
  const control = documentControlProps(isOwn);
  const send = useRequestDocumentAccess(workspaceId, documentId);
  const sentAt = useSyncExternalStore(
    subscribeDocumentAccessRequestSent,
    () => readDocumentAccessRequestSentAt(documentId),
    noFlag,
  );
  // `tracked`: the flag was readable when the send resolved, so its later
  // absence means a decision cleared it. With storage blocked there is no flag
  // to follow and the claim stays for this mount.
  const [sent, setSent] = useState<{ kind: "sent" | "already_pending"; tracked: boolean } | null>(null);
  const done = sent && (!sent.tracked || sentAt !== null) ? sent.kind : null;
  const statusRef = useRef<HTMLParagraphElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!done || !restoreFocus.current) return;
    restoreFocus.current = false;
    // Only when nothing else holds focus: the removed button leaves the body
    // active, a field the person moved to meanwhile keeps it.
    const active = document.activeElement;
    if (!active || active === document.body) statusRef.current?.focus();
  }, [done]);
  const run = (event: MouseEvent<HTMLButtonElement>) => {
    if (send.isPending) return;
    restoreFocus.current = document.activeElement === event.currentTarget;
    send.mutate(
      { requested_level: "view" },
      {
        onSuccess: (outcome) => {
          setSent({
            kind: outcome.state === "sent" ? "sent" : "already_pending",
            tracked: readDocumentAccessRequestSentAt(documentId) !== null,
          });
        },
        onError: (err) => {
          const outcome = accessRequestOutcome(err);
          if (outcome.state === "cooldown") {
            toast.error(t("documents.access_request.cooldown", { minutes: Math.ceil(outcome.retryAfterSeconds / 60) }));
          } else if (outcome.state === "rate_limited") {
            toast.error(t("documents.access_request.rate_limited"));
          } else {
            toast.error(t("documents.access_request.send_failed"));
          }
        },
      },
    );
  };
  // Not while a send is pending: its own flag write re-renders the card before
  // `setSent` runs, and the live region would announce "you can send again".
  const note = done
    ? t(`documents.access_request.${done}`)
    : sentAt !== null && !send.isPending
      ? t("documents.access_request.sent_earlier", { time: sentTime(sentAt) })
      : null;
  return (
    <>
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={note ? cn("min-w-0 text-caption", documentMutedClass(isOwn)) : undefined}
      >
        {note}
      </p>
      {done ? null : (
        <Button
          type="button"
          variant={control.variant}
          size="sm"
          className={cn("pointer-coarse:min-h-11 gap-1.5", control.className)}
          aria-disabled={send.isPending || undefined}
          onClick={run}
        >
          {send.isPending ? <Spinner /> : null}
          {t("chat.document_request_access")}
        </Button>
      )}
    </>
  );
}
