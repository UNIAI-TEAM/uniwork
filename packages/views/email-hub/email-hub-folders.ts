import {
  Archive,
  CalendarClock,
  Clock,
  FileText,
  Inbox,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";

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

export type EmailHubMailFolderKey = Exclude<EmailHubFolderKey, "SCHEDULED">;

export interface EmailHubFolderDef {
  key: EmailHubFolderKey;
  icon: LucideIcon;
  labelKey: string;
}

export const EMAIL_HUB_PRIMARY_FOLDERS: readonly EmailHubFolderDef[] = [
  { key: "INBOX", icon: Inbox, labelKey: "email_hub.folders.inbox" },
  { key: "STARRED", icon: Star, labelKey: "email_hub.folders.starred" },
  { key: "SNOOZED", icon: Clock, labelKey: "email_hub.folders.snoozed" },
  { key: "SENT", icon: Send, labelKey: "email_hub.folders.sent" },
  { key: "SCHEDULED", icon: CalendarClock, labelKey: "email_hub.folders.scheduled" },
  { key: "DRAFTS", icon: FileText, labelKey: "email_hub.folders.drafts" },
];

export const EMAIL_HUB_MORE_FOLDERS: readonly EmailHubFolderDef[] = [
  { key: "ARCHIVE", icon: Archive, labelKey: "email_hub.folders.archive" },
  { key: "SPAM", icon: ShieldAlert, labelKey: "email_hub.folders.spam" },
  { key: "TRASH", icon: Trash2, labelKey: "email_hub.folders.trash" },
];

export const EMAIL_HUB_ALL_FOLDERS = [...EMAIL_HUB_PRIMARY_FOLDERS, ...EMAIL_HUB_MORE_FOLDERS];

export function emailHubFolderDef(key: EmailHubFolderKey): EmailHubFolderDef {
  return EMAIL_HUB_ALL_FOLDERS.find((f) => f.key === key) ?? EMAIL_HUB_PRIMARY_FOLDERS[0]!;
}

export interface EmailHubFolderCounts {
  inboxUnread: number;
  scheduled: number;
  snoozed: number;
}

/** Only the counts that ask for attention: unread mail, queued sends, mail waiting to come back. */
export function emailHubFolderBadge(key: EmailHubFolderKey, counts: EmailHubFolderCounts): number | undefined {
  if (key === "INBOX") return counts.inboxUnread;
  if (key === "SCHEDULED") return counts.scheduled;
  if (key === "SNOOZED") return counts.snoozed;
  return undefined;
}

/** What an empty folder says: why it is empty here, not a generic "no email". */
export function emailHubEmptyFolderKey(folder: EmailHubFolderKey): string {
  switch (folder) {
    case "INBOX":
      return "email_hub.empty.inbox";
    case "STARRED":
      return "email_hub.empty.starred";
    case "SNOOZED":
      return "email_hub.empty.snoozed";
    case "SENT":
      return "email_hub.empty.sent";
    case "SCHEDULED":
      return "email_hub.empty.scheduled";
    case "DRAFTS":
      return "email_hub.empty.drafts";
    case "ARCHIVE":
      return "email_hub.empty.archive";
    case "SPAM":
      return "email_hub.empty.spam";
    case "TRASH":
      return "email_hub.empty.trash";
  }
}
