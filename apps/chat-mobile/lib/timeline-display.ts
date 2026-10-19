// How a conversation's messages are laid out, copied from the web and kept in
// parity by timeline-display.test.ts (the web tests' cases):
//   messageDayKey, formatMessageTime, formatMessageDateTime, formatMessageDay ← packages/views/chat/chat-message-time.ts
//   messageGrouping                       ← packages/views/chat/native-chat-message-grouping.ts
//   buildMainTimelineMessages, buildThreadViewMessages ← packages/views/chat/native-chat-message-timeline.ts
// TimelineMessage is the slice of the web's ChatMessage those rules read; the
// row renders from `record` (a server message) or `pending` (a local send).
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { mergeOptimisticChatMessages, type PendingSend } from "./send-pipeline";

export interface TimelineMessage {
  id: string;
  sender: string;
  body: string;
  kind?: string;
  ts: number;
  clientMsgId?: string;
  threadRootId?: string;
  replyToEventId?: string;
  voiceCall?: unknown;
  voiceCallSummary?: unknown;
  record?: ChatMessageRecord;
  pending?: PendingSend;
}

// React Query keeps an unchanged record the same object across refetches, so
// mapping through this cache keeps an unchanged row the same object too.
const mapped = new WeakMap<ChatMessageRecord, TimelineMessage>();

export function toTimelineMessage(record: ChatMessageRecord): TimelineMessage {
  const cached = mapped.get(record);
  if (cached && cached.record?.pinned === record.pinned && cached.record?.pinned_at === record.pinned_at) return cached;
  const message: TimelineMessage = {
    id: record.id,
    sender: record.sender_id,
    body: record.body,
    kind: record.kind,
    ts: Date.parse(record.created_at),
    clientMsgId: record.client_msg_id,
    threadRootId: record.thread_root_id,
    replyToEventId: record.reply_to_message_id,
    voiceCall: record.voice_call,
    voiceCallSummary: record.voice_call_summary,
    record,
  };
  mapped.set(record, message);
  return message;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** Local calendar day of a timestamp, as a comparable key. */
export function messageDayKey(ts: number): number {
  return startOfDay(new Date(ts));
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    cache.set(locale, formatter);
  }
  return formatter;
}

/** "14:05" — the time printed on a message. */
export function formatMessageTime(ts: number, locale: string): string {
  return cachedFormatter(timeFormatters, locale, { hour: "2-digit", minute: "2-digit" }).format(ts);
}

/** Full date and time, for a screen reader's label of a message. */
export function formatMessageDateTime(ts: number, locale: string): string {
  return cachedFormatter(dateTimeFormatters, locale, { dateStyle: "full", timeStyle: "short" }).format(ts);
}

/** Day separator: today and yesterday by name, this week by weekday, older by date. */
export function formatMessageDay(
  ts: number,
  locale: string,
  labels: { today: string; yesterday: string },
  now: Date = new Date(),
): string {
  const date = new Date(ts);
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return labels.today;
  if (diff === 1) return labels.yesterday;
  if (diff > 1 && diff < 7) return date.toLocaleDateString(locale, { weekday: "long" });
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

type GroupedMessage = Pick<TimelineMessage, "kind" | "sender" | "ts" | "voiceCall" | "voiceCallSummary">;

const CARD_KINDS = new Set(["voice_call_log", "poll", "reminder", "note", "post", "file"]);

function isBubbleMessage(message: GroupedMessage): boolean {
  return !CARD_KINDS.has(message.kind ?? "") && !message.voiceCall && !message.voiceCallSummary;
}

const MESSAGE_GROUP_MS = 5 * 60 * 1000;

/** A bubble under the same sender's bubble within five minutes on one day drops its name and avatar. */
export function messageGrouping(
  messages: readonly GroupedMessage[],
  index: number,
): { compactTop: boolean; showAvatar: boolean } {
  const message = messages[index];
  const prev = messages[index - 1];
  if (!message || !prev || !isBubbleMessage(message) || !isBubbleMessage(prev)) {
    return { compactTop: false, showAvatar: true };
  }
  const sameSender = prev.sender === message.sender;
  const closeInTime = message.ts - prev.ts < MESSAGE_GROUP_MS && messageDayKey(prev.ts) === messageDayKey(message.ts);
  return { compactTop: sameSender && closeInTime, showAvatar: !(sameSender && closeInTime) };
}

/** Main room timeline: the anchored page when jumping to a message, else every loaded page plus local sends, minus thread replies. */
export function buildMainTimelineMessages(input: {
  anchorRows: ChatMessageRecord[] | null;
  latestRows: ChatMessageRecord[];
  pending: readonly PendingSend[];
  currentUserId: string;
}): TimelineMessage[] {
  const { anchorRows, latestRows, pending, currentUserId } = input;
  if (anchorRows) return anchorRows.map(toTimelineMessage).filter((message) => !message.threadRootId);
  const merged = mergeOptimisticChatMessages(
    latestRows.map(toTimelineMessage),
    pending.filter((entry) => !entry.threadRootId),
    currentUserId,
  ) as TimelineMessage[];
  return merged.filter((message) => !message.threadRootId);
}

/** A thread: its root, then the server's replies and this thread's local sends. */
export function buildThreadViewMessages(input: {
  threadRoot: ChatMessageRecord;
  threadRows: ChatMessageRecord[] | undefined;
  pending: readonly PendingSend[];
  currentUserId: string;
}): TimelineMessage[] {
  const { threadRoot, threadRows, pending, currentUserId } = input;
  const merged = mergeOptimisticChatMessages(
    (threadRows ?? []).map(toTimelineMessage),
    pending.filter((entry) => entry.threadRootId === threadRoot.id),
    currentUserId,
  ) as TimelineMessage[];
  const root = toTimelineMessage(threadRoot);
  return [root, ...merged.filter((message) => message.id !== root.id)].sort((a, b) => a.ts - b.ts);
}

export type TimelineRow =
  | { type: "day"; key: string; ts: number }
  | { type: "message"; key: string; message: TimelineMessage; compactTop: boolean; showAvatar: boolean };

/** Messages (oldest first) with a day separator before each new local day, newest last. */
export function buildTimelineRows(messages: readonly TimelineMessage[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  messages.forEach((message, index) => {
    const day = messageDayKey(message.ts);
    const prev = messages[index - 1];
    if (!prev || messageDayKey(prev.ts) !== day) rows.push({ type: "day", key: `day:${day}`, ts: message.ts });
    rows.push({ type: "message", key: message.id, message, ...messageGrouping(messages, index) });
  });
  return rows;
}
