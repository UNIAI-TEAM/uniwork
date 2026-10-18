import {
  AlarmClock,
  AtSign,
  Bell,
  Bookmark,
  CircleCheck,
  CircleX,
  FileDown,
  KeyRound,
  Lock,
  MessageSquare,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import type { NotificationKind } from "@uniwork/core/types";
import { MODULE_ICONS } from "../layout/module-icons";

const ICONS: Record<NotificationKind, LucideIcon> = {
  task_assigned: UserRoundCheck,
  task_status_changed: RefreshCw,
  task_commented: MessageSquare,
  mentioned: AtSign,
  meeting_invited: MODULE_ICONS.meetings,
  meeting_starting: MODULE_ICONS.meetings,
  meeting_summary_reminder: Sparkles,
  member_added: UserPlus,
  role_changed: ShieldCheck,
  audit_export_ready: FileDown,
  chat_follow_up: Bookmark,
  chat_reminder: AlarmClock,
  email_hub_new_mail: MODULE_ICONS.email,
  document_commented: MessageSquare,
  document_mentioned: AtSign,
  document_comment_replied: MessageSquare,
  document_discussion_mentioned: AtSign,
  document_discussion_replied: MessageSquare,
  document_comment_resolved: CircleCheck,
  document_edit_requested: Pencil,
  document_edit_request_answered: CircleCheck,
  document_edit_taken_over: Lock,
  document_break_glass: ShieldAlert,
  chat_mentioned: AtSign,
  chat_dm: MODULE_ICONS.chat,
  chat_thread_replied: MessageSquare,
  document_access_requested: KeyRound,
  document_access_approved: CircleCheck,
  document_access_declined: CircleX,
  document_trashed_by_other: Trash2,
};

/**
 * One glyph per kind; an unknown kind from a newer server gets the bell. An
 * edit-request answer that was declined is not a success: it gets CircleX.
 */
export function kindIcon(kind: string, params?: Record<string, string | undefined>): LucideIcon {
  if (kind === "document_edit_request_answered" && params?.decision === "decline") return CircleX;
  return (ICONS as Record<string, LucideIcon>)[kind] ?? Bell;
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kindIcon(kind);
  return <Icon aria-hidden className={className} />;
}
