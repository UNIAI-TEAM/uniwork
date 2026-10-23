import { AlarmClock, CalendarClock, type LucideIcon } from "lucide-react";
import type { IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";

export type HomeMarkKey = "due_today" | "overdue" | "meetings_today" | "unread";

export interface HomeMark {
  icon: LucideIcon;
  tone: IconTileTone;
  /** A signal mark reports state, so it goes quiet when its count is zero. */
  signal: boolean;
}

/**
 * One mark per thing the home screen counts, shared by the stat tiles and the
 * brief so a sentence and the number it explains look alike. Due and overdue
 * are states and take signal colours; meetings and unread are modules and take
 * the tint and glyph the sidebar gives them.
 */
export const HOME_MARKS: Record<HomeMarkKey, HomeMark> = {
  due_today: { icon: CalendarClock, tone: "warning", signal: true },
  overdue: { icon: AlarmClock, tone: "destructive", signal: true },
  meetings_today: { icon: MODULE_ICONS.meetings, tone: moduleTone("meetings"), signal: false },
  unread: { icon: MODULE_ICONS.inbox, tone: moduleTone("inbox"), signal: false },
};

export function homeMarkTone(key: HomeMarkKey, count: number): IconTileTone {
  const mark = HOME_MARKS[key];
  return mark.signal && count === 0 ? "muted" : mark.tone;
}
