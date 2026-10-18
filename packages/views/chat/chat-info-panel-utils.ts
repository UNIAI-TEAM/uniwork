"use client";

import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";

/** How many of `userIds` are online now (the caller is never in the presence set). */
export function useOnlineCount(userIds: readonly string[]): number {
  return usePresenceStore((state) => {
    let count = 0;
    for (const id of userIds) if (state.onlineUserIds[normalizeTypingUserId(id)]) count += 1;
    return count;
  });
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null;
}

function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type LinkedTaskLine =
  | { tone: "done" }
  | { tone: "overdue"; days: number }
  | { tone: "open"; due?: string };

/**
 * The second line of a task linked from the room: done, overdue by N days,
 * or open with its due date. Dates are `YYYY-MM-DD`; today is the viewer's.
 */
export function linkedTaskLine(task: { status: string; due_date?: string }, now = new Date()): LinkedTaskLine {
  if (task.status === "done") return { tone: "done" };
  const due = task.due_date ? dayNumber(task.due_date) : null;
  const today = dayNumber(localDay(now));
  if (due !== null && today !== null && task.status !== "cancelled" && due < today) {
    return { tone: "overdue", days: today - due };
  }
  return { tone: "open", due: due === null ? undefined : task.due_date };
}

/** "T4, 23/10"-style short due date in the reader's language. */
export function formatTaskDue(due: string, locale: string): string {
  const day = dayNumber(due);
  if (day === null) return due;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(day * DAY_MS),
  );
}

/** A one-line preview shows the words, not the markdown around them ("**thứ Năm**" → "thứ Năm"). */
export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*|__|~~|`/g, "");
}

/**
 * A settings member list's order: you first, then the leads (room admins, or
 * whoever `isLead` adds), then everyone else in the room's own order.
 */
export function settingsMemberOrder<T extends { user_id: string; role: string }>(
  members: readonly T[],
  currentUserId: string,
  isLead: (member: T) => boolean = () => false,
): T[] {
  const rank = (m: T) => (m.user_id === currentUserId ? 0 : m.role === "admin" || isLead(m) ? 1 : 2);
  return [...members].sort((a, b) => rank(a) - rank(b));
}
