import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import type { Notification, NotificationKind } from "@uniwork/core/types";
import { kindTone } from "./kind-tone";

/**
 * The inbox's triage filters: what the person has to do about a row, not
 * which table it came from. Asked of you (mentions and comments), handed to
 * you (assignments), a meeting, a task moving, and the workspace itself.
 * A kind from a newer server falls into the last one.
 */
export const INBOX_CATEGORIES = ["mentions", "assigned", "meetings", "updates", "workspace"] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

const KIND_CATEGORY: Record<NotificationKind, InboxCategory> = {
  mentioned: "mentions",
  task_commented: "mentions",
  chat_follow_up: "mentions",
  task_assigned: "assigned",
  meeting_invited: "meetings",
  meeting_starting: "meetings",
  task_status_changed: "updates",
  member_added: "workspace",
  role_changed: "workspace",
  audit_export_ready: "workspace",
};

export function inboxCategory(kind: string): InboxCategory {
  return (KIND_CATEGORY as Record<string, InboxCategory>)[kind] ?? "workspace";
}

/** A category's dot takes the tint of the module its kinds come from. */
export const CATEGORY_TONE: Record<InboxCategory, Tint> = {
  mentions: kindTone("mentioned"),
  assigned: kindTone("task_assigned"),
  meetings: kindTone("meeting_invited"),
  updates: kindTone("task_status_changed"),
  workspace: kindTone("member_added"),
};

/** Unread rows per category among `rows`. */
export function unreadByCategory(rows: Notification[]): Record<InboxCategory, number> {
  const out = Object.fromEntries(INBOX_CATEGORIES.map((c) => [c, 0])) as Record<InboxCategory, number>;
  for (const n of rows) if (!n.read_at) out[inboxCategory(n.kind)] += 1;
  return out;
}
