"use client";

import { useState } from "react";
import { ArrowLeft, CalendarClock, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../common/form-dialog";
import { emailHubLocale, formatEmailFullDate } from "./email-hub-format";

interface EmailHubScheduledDetailProps {
  item: EmailHubScheduledSendItem;
  cancelPending: boolean;
  onBack: () => void;
  onCancel: (onDone: () => void) => void;
}

/** The status the server reports, in words. Unknown values fall back to the raw one rather than vanishing. */
function statusKey(status: string): string | null {
  switch (status.toLowerCase()) {
    case "pending":
    case "scheduled":
      return "email_hub.scheduled.status.pending";
    case "sending":
      return "email_hub.scheduled.status.sending";
    case "sent":
      return "email_hub.scheduled.status.sent";
    case "failed":
      return "email_hub.scheduled.status.failed";
    case "cancelled":
    case "canceled":
      return "email_hub.scheduled.status.cancelled";
    default:
      return null;
  }
}

export function EmailHubScheduledDetail({ item, cancelPending, onBack, onCancel }: EmailHubScheduledDetailProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const key = statusKey(item.status);
  const subject = item.subject || t("email_hub.no_subject");

  return (
    <article className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 lg:px-3">
        <Button type="button" variant="ghost" size="lg" className="text-muted-foreground" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t("email_hub.back_to_list")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <CalendarClock className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-title-lg font-semibold text-balance">{subject}</h1>
              <p className="mt-1 text-body text-muted-foreground">{t("email_hub.scheduled.detail_title")}</p>
            </div>
          </header>

          <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-border px-4 py-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.scheduled.send_at_label")}</dt>
            <dd className="text-body tabular-nums">{formatEmailFullDate(item.send_at, locale)}</dd>
            <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.compose.to")}</dt>
            <dd className="text-body break-words">{item.to.join(", ") || "—"}</dd>
            <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.scheduled.status_label")}</dt>
            <dd className="text-body">{key ? t(key) : item.status}</dd>
          </dl>

          <Button type="button" variant="destructive" disabled={cancelPending} onClick={() => setConfirmOpen(true)}>
            <X aria-hidden />
            {t("email_hub.scheduled.cancel")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!cancelPending) setConfirmOpen(open);
        }}
        title={t("email_hub.scheduled.cancel_confirm_title")}
        description={t("email_hub.scheduled.cancel_confirm_body", { subject })}
        confirmLabel={t("email_hub.scheduled.cancel")}
        cancelLabel={t("email_hub.scheduled.keep")}
        pending={cancelPending}
        onConfirm={() => onCancel(() => setConfirmOpen(false))}
      />
    </article>
  );
}
