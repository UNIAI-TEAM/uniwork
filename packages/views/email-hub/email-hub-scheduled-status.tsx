"use client";

import { useTranslation } from "react-i18next";
import { SettingsBadge, type SettingsBadgeTone } from "../settings/components/settings-layout";

/** The server's status for a scheduled send, as a signal. Unknown values keep their raw text rather than vanishing. */
function scheduledStatus(status: string): { key: string; tone: SettingsBadgeTone } | null {
  switch (status.toLowerCase()) {
    case "pending":
    case "scheduled":
      return { key: "email_hub.scheduled.status.pending", tone: "info" };
    case "sending":
      return { key: "email_hub.scheduled.status.sending", tone: "warning" };
    case "sent":
      return { key: "email_hub.scheduled.status.sent", tone: "success" };
    case "failed":
      return { key: "email_hub.scheduled.status.failed", tone: "destructive" };
    case "cancelled":
    case "canceled":
      return { key: "email_hub.scheduled.status.cancelled", tone: "muted" };
    default:
      return null;
  }
}

export function isScheduledSendFailed(status: string) {
  return status.toLowerCase() === "failed";
}

export function EmailHubScheduledStatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useTranslation();
  const known = scheduledStatus(status);
  return (
    <SettingsBadge tone={known?.tone ?? "muted"} className={className}>
      {known ? t(known.key) : status}
    </SettingsBadge>
  );
}
