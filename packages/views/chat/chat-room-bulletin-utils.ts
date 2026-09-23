import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { reminderBodyLabel } from "@uniwork/core/chat/reminder-utils";

export type BulletinTab = "all" | "pinned" | "notes" | "posts" | "polls" | "reminders";

const BULLETIN_KINDS = new Set(["note", "post", "poll", "reminder"]);

export function isBulletinMessage(record: ChatMessageRecord): boolean {
  return Boolean(record.pinned) || BULLETIN_KINDS.has(record.kind);
}

export function filterBulletinMessages(
  rows: ChatMessageRecord[],
  tab: BulletinTab,
): ChatMessageRecord[] {
  let filtered: ChatMessageRecord[];
  switch (tab) {
    case "pinned":
      filtered = rows.filter((row) => row.pinned);
      break;
    case "notes":
      filtered = rows.filter((row) => row.kind === "note");
      break;
    case "posts":
      filtered = rows.filter((row) => row.kind === "post");
      break;
    case "polls":
      filtered = rows.filter((row) => row.kind === "poll");
      break;
    case "reminders":
      filtered = rows.filter((row) => row.kind === "reminder");
      break;
    case "all":
    default:
      filtered = rows.filter(isBulletinMessage);
      break;
  }
  return filtered.sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

export function bulletinMessagePreview(
  record: ChatMessageRecord,
  voiceCallLabel: string,
): string {
  if (record.kind === "post" && record.post) {
    const title = record.post.title.trim();
    if (title) return title;
    return record.post.body.trim() || "…";
  }
  if (record.kind === "note" && record.note?.body) {
    return record.note.body.trim();
  }
  if (record.kind === "poll" && record.poll?.question) {
    return record.poll.question.trim();
  }
  if (record.kind === "reminder" && record.reminder) {
    return reminderBodyLabel({
      body: record.reminder.body,
    });
  }
  if (record.kind === "voice_call_log") {
    return voiceCallLabel;
  }
  const text = record.body.replace(/\s+/g, " ").trim();
  if (text.length === 0) return "…";
  return [...text].length > 120 ? `${[...text].slice(0, 120).join("")}…` : text;
}

/** "14:05" today, "12 thg 9, 14:05" otherwise — in the app locale, not the browser's. */
export function formatBulletinTime(iso: string, locale: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}
