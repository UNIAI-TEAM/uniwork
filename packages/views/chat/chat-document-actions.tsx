"use client";

import { useState } from "react";
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
 * The no-access card's "Yêu cầu quyền truy cập" button (L4 / S7): it asks the
 * document's managers for view access through
 * POST /documents/{id}/access-requests, the same route and copy as the
 * document page's locked card. The route's 202 is uniform on purpose (it also
 * answers a document the caller already reads or one that does not exist), so
 * `sent` is shown as sent; 409 `access_request_pending` reads as "already
 * waiting". Both replace the button in place, so a second send is not offered;
 * the refusals (cooldown, limiter, anything else) stay a toast and keep the
 * button for another try.
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
  const [done, setDone] = useState<"sent" | "already_pending" | null>(null);
  const run = () => {
    if (send.isPending) return;
    send.mutate(
      { requested_level: "view" },
      {
        onSuccess: (outcome) => {
          setDone(outcome.state === "sent" ? "sent" : "already_pending");
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
  if (done) {
    return (
      <p role="status" className="min-w-0 max-w-[60%] text-right text-caption text-muted-foreground">
        {t(`documents.access_request.${done}`)}
      </p>
    );
  }
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
