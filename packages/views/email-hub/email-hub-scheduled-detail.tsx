"use client";

import { useState } from "react";
import { ArrowLeft, CalendarClock, RotateCw, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { emailHubLocale, formatEmailFullDate } from "./email-hub-format";
import { EmailHubScheduledStatusBadge, isScheduledSendFailed } from "./email-hub-scheduled-status";

interface EmailHubScheduledDetailProps {
  item: EmailHubScheduledSendItem;
  cancelPending: boolean;
  retryPending: boolean;
  onBack: () => void;
  onCancel: (onDone: () => void) => void;
  onRetry: () => void;
}

/**
 * One queued send. A failed one used to read "will be sent automatically" with
 * only a Cancel button; it now says it was not sent and offers to send it again
 * or drop it.
 */
export function EmailHubScheduledDetail({
  item,
  cancelPending,
  retryPending,
  onBack,
  onCancel,
  onRetry,
}: EmailHubScheduledDetailProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const subject = item.subject || t("email_hub.no_subject");
  const failed = isScheduledSendFailed(item.status);
  const when = formatEmailFullDate(item.send_at, locale);
  const Icon = failed ? TriangleAlert : CalendarClock;
  const busy = cancelPending || retryPending;

  return (
    <article className="flex h-full min-h-0 flex-col" aria-labelledby="email-hub-scheduled-subject">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 lg:px-3">
        <Button type="button" variant="ghost" size="lg" className="text-muted-foreground" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t("email_hub.back_to_list")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="flex items-start gap-3">
            <span
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-lg",
                failed ? "bg-destructive-soft text-destructive-soft-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 id="email-hub-scheduled-subject" className="text-title-lg font-semibold text-balance">
                {subject}
              </h1>
              <p className="mt-1 text-body text-pretty text-muted-foreground">
                {failed ? t("email_hub.scheduled.failed_body", { when }) : t("email_hub.scheduled.detail_title")}
              </p>
            </div>
          </header>

          <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-border px-4 py-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-caption font-medium text-muted-foreground">
              {failed ? t("email_hub.scheduled.tried_at_label") : t("email_hub.scheduled.send_at_label")}
            </dt>
            <dd className="text-body tabular-nums">{when}</dd>
            <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.compose.to")}</dt>
            <dd className="text-body break-words">{item.to.join(", ") || "—"}</dd>
            <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.scheduled.status_label")}</dt>
            <dd>
              <EmailHubScheduledStatusBadge status={item.status} />
            </dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            {failed ? (
              <Button type="button" variant="brand" size="lg" disabled={busy} onClick={onRetry}>
                <RotateCw aria-hidden />
                {retryPending ? t("email_hub.scheduled.retrying") : t("email_hub.scheduled.retry")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={failed ? "outline" : "destructive"}
              size="lg"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
            >
              <X aria-hidden />
              {failed ? t("email_hub.scheduled.dismiss") : t("email_hub.scheduled.cancel")}
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!cancelPending) setConfirmOpen(open);
        }}
        title={failed ? t("email_hub.scheduled.dismiss_confirm_title") : t("email_hub.scheduled.cancel_confirm_title")}
        description={
          failed
            ? t("email_hub.scheduled.dismiss_confirm_body", { subject })
            : t("email_hub.scheduled.cancel_confirm_body", { subject })
        }
        confirmLabel={failed ? t("email_hub.scheduled.dismiss") : t("email_hub.scheduled.cancel")}
        cancelLabel={failed ? t("email_hub.scheduled.keep_unsent") : t("email_hub.scheduled.keep")}
        pending={cancelPending}
        onConfirm={() => onCancel(() => setConfirmOpen(false))}
      />
    </article>
  );
}
