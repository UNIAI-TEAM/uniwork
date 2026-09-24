"use client";

import { useState } from "react";
import {
  Archive,
  CalendarClock,
  ChevronDown,
  Clock,
  Inbox,
  Mail,
  Send,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { emailHubComposeButtonClass, emailHubNavItemClass, emailHubSecondaryNavButtonClass } from "./email-hub-ui";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { moduleTone } from "../layout/module-tones";

export type EmailHubFolderKey =
  | "INBOX"
  | "STARRED"
  | "SENT"
  | "SCHEDULED"
  | "SNOOZED"
  | "DRAFTS"
  | "ARCHIVE"
  | "SPAM"
  | "TRASH";

const PRIMARY_FOLDERS: { key: EmailHubFolderKey; icon: typeof Inbox; labelKey: string }[] = [
  { key: "INBOX", icon: Inbox, labelKey: "email_hub.folders.inbox" },
  { key: "STARRED", icon: Star, labelKey: "email_hub.folders.important" },
  { key: "SENT", icon: Send, labelKey: "email_hub.folders.sent" },
  { key: "SCHEDULED", icon: CalendarClock, labelKey: "email_hub.folders.scheduled" },
  { key: "SNOOZED", icon: Clock, labelKey: "email_hub.folders.snoozed" },
  { key: "DRAFTS", icon: Mail, labelKey: "email_hub.folders.drafts" },
];

const MORE_FOLDERS: { key: EmailHubFolderKey; icon: typeof Inbox; labelKey: string }[] = [
  { key: "ARCHIVE", icon: Archive, labelKey: "email_hub.folders.archive" },
  { key: "SPAM", icon: ShieldAlert, labelKey: "email_hub.folders.spam" },
  { key: "TRASH", icon: Trash2, labelKey: "email_hub.folders.trash" },
];

const LABELS_PREVIEW = 6;

interface EmailHubFolderSidebarProps {
  folder: EmailHubFolderKey;
  selectedLabel: string | null;
  imapLabels: string[];
  unreadCount: number;
  scheduledCount: number;
  snoozedCount: number;
  composeDisabled: boolean;
  onFolderChange: (folder: EmailHubFolderKey) => void;
  onLabelChange: (label: string | null) => void;
  onCompose: () => void;
}

function FolderNavButton({
  active,
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: typeof Inbox;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={emailHubNavItemClass(active)} onClick={onClick}>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-caption font-semibold tabular-nums text-brand">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function EmailHubFolderSidebar({
  folder,
  selectedLabel,
  imapLabels,
  unreadCount,
  scheduledCount,
  snoozedCount,
  composeDisabled,
  onFolderChange,
  onLabelChange,
  onCompose,
}: EmailHubFolderSidebarProps) {
  const { t } = useTranslation();
  const tone = moduleTone("email");
  const [moreOpen, setMoreOpen] = useState(
    folder === "ARCHIVE" || folder === "SPAM" || folder === "TRASH",
  );
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const visibleLabels = labelsExpanded ? imapLabels : imapLabels.slice(0, LABELS_PREVIEW);

  const pickFolder = (key: EmailHubFolderKey) => {
    onLabelChange(null);
    onFolderChange(key);
  };

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
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {PRIMARY_FOLDERS.map(({ key, icon, labelKey }) => (
          <FolderNavButton
            key={key}
            active={folder === key && !selectedLabel}
            icon={icon}
            label={t(labelKey)}
            badge={
              key === "INBOX"
                ? unreadCount
                : key === "SCHEDULED"
                  ? scheduledCount
                  : key === "SNOOZED"
                    ? snoozedCount
                    : undefined
            }
            onClick={() => pickFolder(key)}
          />
        ))}
        <button
          type="button"
          className={cn(emailHubNavItemClass(false), "text-caption font-medium")}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", moreOpen && "rotate-180")} aria-hidden />
          <span className="flex-1 truncate text-left">{t("email_hub.folders.more")}</span>
        </button>
        {moreOpen
          ? MORE_FOLDERS.map(({ key, icon, labelKey }) => (
              <FolderNavButton
                key={key}
                active={folder === key && !selectedLabel}
                icon={icon}
                label={t(labelKey)}
                onClick={() => pickFolder(key)}
              />
            ))
          : null}
      </nav>
      <div className="max-h-44 overflow-y-auto border-t border-border px-3 py-3">
        <p className="mb-1.5 px-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {t("email_hub.labels_section")}
        </p>
        {imapLabels.length === 0 ? (
          <p className="px-1 text-caption text-muted-foreground">{t("email_hub.labels_sync_hint")}</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {visibleLabels.map((label) => (
                <li key={label}>
                  <button
                    type="button"
                    className={cn(emailHubNavItemClass(selectedLabel === label), "min-h-9 py-1.5 text-caption")}
                    onClick={() => {
                      onFolderChange("INBOX");
                      onLabelChange(selectedLabel === label ? null : label);
                    }}
                  >
                    <Tag className="size-3.5 shrink-0" />
                    <span className="flex-1 truncate text-left">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
            {imapLabels.length > LABELS_PREVIEW ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 h-8 w-full justify-start px-2 text-caption text-muted-foreground"
                onClick={() => setLabelsExpanded((v) => !v)}
              >
                {labelsExpanded
                  ? t("email_hub.labels_show_less")
                  : t("email_hub.labels_show_more", { count: imapLabels.length - LABELS_PREVIEW })}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
