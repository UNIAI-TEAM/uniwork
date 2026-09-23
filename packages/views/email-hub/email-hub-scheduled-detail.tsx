"use client";

import { Clock, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { formatWhen } from "./email-hub-view-parts";

interface EmailHubScheduledDetailProps {
  item: EmailHubScheduledSendItem;
  cancelPending: boolean;
  onBack: () => void;
  onCancel: () => void;
}

export function EmailHubScheduledDetail({ item, cancelPending, onBack, onCancel }: EmailHubScheduledDetailProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 lg:hidden">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {t("email_hub.back_to_list")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Clock className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-title font-semibold">{item.subject || t("email_hub.no_subject")}</h1>
              <p className="mt-1 text-caption text-muted-foreground">{t("email_hub.scheduled.detail_title")}</p>
            </div>
          </div>

          <dl className="space-y-4 rounded-xl border border-border bg-muted/20 px-4 py-4">
            <div>
              <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.scheduled.send_at_label")}</dt>
              <dd className="mt-1 text-body">{formatWhen(item.send_at)}</dd>
            </div>
            <div>
              <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.compose.to")}</dt>
              <dd className="mt-1 text-body">{item.to.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-caption font-medium text-muted-foreground">{t("email_hub.scheduled.status_label")}</dt>
              <dd className="mt-1 text-body capitalize">{item.status}</dd>
            </div>
          </dl>

          <Button
            type="button"
            variant="destructive"
            className="gap-2 rounded-xl shadow-none"
            disabled={cancelPending}
            onClick={onCancel}
          >
            <X className="size-4" aria-hidden />
            {t("email_hub.scheduled.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
