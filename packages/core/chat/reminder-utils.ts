export const REMINDER_BODY_MAX_LENGTH = 500;

export type ReminderQuickPreset = "15m" | "30m" | "tomorrow_9" | "custom";

export type ReminderRepeat = "none" | "daily" | "weekly" | "monthly";

export const REMINDER_REPEAT_OPTIONS: ReminderRepeat[] = ["none", "daily", "weekly", "monthly"];

export function remindAtFromPreset(preset: ReminderQuickPreset, now = new Date()): Date | null {
  switch (preset) {
    case "15m":
      return new Date(now.getTime() + 15 * 60_000);
    case "30m":
      return new Date(now.getTime() + 30 * 60_000);
    case "tomorrow_9": {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      return next;
    }
    case "custom":
      return null;
    default:
      return null;
  }
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDatetimeLocalValue(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

export function canSubmitReminder(body: string, remindAt: Date | null, now = Date.now()): boolean {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > REMINDER_BODY_MAX_LENGTH) return false;
  if (!remindAt || !Number.isFinite(remindAt.getTime())) return false;
  return remindAt.getTime() > now;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isTomorrow(from: Date, target: Date): boolean {
  const tomorrow = new Date(from);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameCalendarDay(tomorrow, target);
}

export function formatReminderTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function advanceReminderDate(current: Date, repeat: ReminderRepeat): Date | null {
  if (repeat === "none") return null;
  const next = new Date(current);
  switch (repeat) {
    case "daily":
      next.setDate(next.getDate() + 1);
      return next;
    case "weekly":
      next.setDate(next.getDate() + 7);
      return next;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      return next;
    default:
      return null;
  }
}

export function reminderBodyLabel(entry: { body?: string; title?: string }): string {
  return (entry.body ?? entry.title ?? "").trim();
}
