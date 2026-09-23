"use client";

import {
  Archive,
  CalendarClock,
  Inbox,
  Mail,
  Send,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { emailHubComposeButtonClass, emailHubNavItemClass, emailHubSecondaryNavButtonClass } from "./email-hub-ui";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { moduleTone } from "../layout/module-tones";

export type EmailHubFolderKey = "INBOX" | "STARRED" | "SENT" | "SCHEDULED" | "DRAFTS" | "ARCHIVE" | "TRASH";

const FOLDERS: { key: EmailHubFolderKey; icon: typeof Inbox; labelKey: string }[] = [
  { key: "INBOX", icon: Inbox, labelKey: "email_hub.folders.inbox" },
  { key: "STARRED", icon: Star, labelKey: "email_hub.folders.important" },
  { key: "SENT", icon: Send, labelKey: "email_hub.folders.sent" },
  { key: "SCHEDULED", icon: CalendarClock, labelKey: "email_hub.folders.scheduled" },
  { key: "DRAFTS", icon: Mail, labelKey: "email_hub.folders.drafts" },
  { key: "ARCHIVE", icon: Archive, labelKey: "email_hub.folders.archive" },
  { key: "TRASH", icon: Trash2, labelKey: "email_hub.folders.trash" },
];

interface EmailHubFolderSidebarProps {
  folder: EmailHubFolderKey;
  unreadCount: number;
  scheduledCount: number;
  composeDisabled: boolean;
  onFolderChange: (folder: EmailHubFolderKey) => void;
  onCompose: () => void;
}

export function EmailHubFolderSidebar({
  folder,
  unreadCount,
  scheduledCount,
  composeDisabled,
  onFolderChange,
  onCompose,
}: EmailHubFolderSidebarProps) {
  const { t } = useTranslation();
  const tone = moduleTone("email");

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-sidebar lg:w-60 lg:border-b-0 lg:border-r">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <IconTile icon={Mail} tone={tone} size="sm" />
          <div>
            <span className="text-title font-semibold">{t("email_hub.title")}</span>
            <p className="text-caption text-muted-foreground">{t("email_hub.subtitle")}</p>
          </div>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <Button variant="brand" className={emailHubComposeButtonClass} disabled={composeDisabled} onClick={onCompose}>
          <Mail className="size-4" />
          {t("email_hub.compose_label")}
        </Button>
        <Button variant="ghost" className={emailHubSecondaryNavButtonClass} disabled>
          <Tag className="size-4" />
          {t("email_hub.labels_rules")}
        </Button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 pb-3">
        {FOLDERS.map(({ key, icon: Icon, labelKey }) => (
          <button
            key={key}
            type="button"
            className={emailHubNavItemClass(folder === key)}
            onClick={() => onFolderChange(key)}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate text-left">{t(labelKey)}</span>
            {key === "INBOX" && unreadCount > 0 ? (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-caption font-semibold tabular-nums text-brand">
                {unreadCount}
              </span>
            ) : null}
            {key === "SCHEDULED" && scheduledCount > 0 ? (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-caption font-semibold tabular-nums text-brand">
                {scheduledCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <p className="mb-1.5 px-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {t("email_hub.labels_section")}
        </p>
        <p className="px-1 text-caption text-muted-foreground">{t("email_hub.no_labels")}</p>
      </div>
    </aside>
  );
}
