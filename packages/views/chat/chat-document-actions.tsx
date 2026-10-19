"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode, errorFields } from "@uniwork/core/api";
import {
  accessRequestOutcome,
  useRequestDocumentAccess,
} from "@uniwork/core/documents/hooks-access-requests";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { chatErrorMessage } from "./chat-error-message";

/**
 * UNI-1966 (L4 / S7): the request-access route lands with S-DOC07 (UNI-1631)
 * ahead of this card in the lane. Until the merged base serves it, the card's
 * no-access state ships the sentence only — the lead flips this to true to
 * reveal the action, per the packet rule "hidden, never inert".
 */
export const CHAT_DOCUMENT_ACCESS_REQUESTS_ENABLED = false;

type TFunction = ReturnType<typeof useTranslation>["t"];

/**
 * One sentence for a failed version upload from the document card. The two
 * named refusals (contract §4.4 / §2.3) get their own copy before the shared
 * chat table or the caller's fallback.
 */
export function chatDocumentVersionError(err: unknown, t: TFunction, fallback: string): string {
  const code = errorCode(err);
  // The card's own conflict copy (RFC-04): there is no history view behind a
  // chat card for the restore_conflict sentence to send the reader to.
  if (code === "document_version_conflict") return t("chat.errors.document_version_conflict");
  if (code === "unsupported_media_type" && errorFields(err)?.reason === "format_changed") {
    return t("chat.errors.document_format_changed");
  }
  return chatErrorMessage(err, t, fallback);
}

/**
 * The no-access card's "Yêu cầu quyền truy cập" button. Only mounted when
 * CHAT_DOCUMENT_ACCESS_REQUESTS_ENABLED is true (see the constant): it asks
 * the document's managers for view access and reports the outcome in place.
 */
export function ChatDocumentRequestAccess({
  workspaceId,
  documentId,
}: {
  workspaceId: string;
  documentId: string;
}) {
  const { t } = useTranslation();
  const send = useRequestDocumentAccess(workspaceId, documentId);
  const run = () => {
    if (send.isPending) return;
    send.mutate(
      { requested_level: "view" },
      {
        onSuccess: (outcome) => {
          toast.message(
            t(outcome.state === "sent" ? "documents.access_request.sent" : "documents.access_request.already_pending"),
          );
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
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="pointer-coarse:min-h-11 gap-1.5"
      aria-disabled={send.isPending || undefined}
      onClick={run}
    >
      {send.isPending ? <Spinner /> : null}
      {t("chat.document_request_access")}
    </Button>
  );
}
