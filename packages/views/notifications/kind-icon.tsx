import {
  AtSign,
  Bell,
  CalendarClock,
  CalendarPlus,
  FileDown,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import type { NotificationKind } from "@uniwork/core/types";

const ICONS: Record<NotificationKind, LucideIcon> = {
  task_assigned: UserRoundCheck,
  task_status_changed: RefreshCw,
  task_commented: MessageSquare,
  mentioned: AtSign,
  meeting_invited: CalendarPlus,
  meeting_starting: CalendarClock,
  member_added: UserPlus,
  role_changed: ShieldCheck,
  audit_export_ready: FileDown,
};

/** One glyph per kind; an unknown kind from a newer server gets the bell. */
export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = (ICONS as Record<string, LucideIcon>)[kind] ?? Bell;
  return <Icon aria-hidden className={className} />;
}
