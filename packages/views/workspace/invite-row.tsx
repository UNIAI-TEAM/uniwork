"use client";
import { MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SentInvite {
  email: string;
}

/** Một dòng lời mời đã gửi: email + dấu đã gửi. Link không hiển thị nữa — mail tự đi. */
export function InviteRow({ sent }: { sent: SentInvite }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <MailCheck aria-hidden className="size-4 text-success" />
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{sent.email}</span>
      <span className="text-caption text-muted-foreground">{t("workspace.inviteEmailed")}</span>
    </li>
  );
}
