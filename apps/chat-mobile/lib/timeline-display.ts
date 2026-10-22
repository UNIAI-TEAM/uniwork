// How a conversation's messages are laid out, copied from the web and kept in
// parity by timeline-display.test.ts (the web tests' cases):
//   messageDayKey, formatMessageTime, formatMessageDateTime, formatMessageDay ← packages/views/chat/chat-message-time.ts
//   messageGrouping                       ← packages/views/chat/native-chat-message-grouping.ts
//   buildMainTimelineMessages, buildThreadViewMessages ← packages/views/chat/native-chat-message-timeline.ts
// TimelineMessage is the slice of the web's ChatMessage those rules read; the
// row renders from `record` (a server message) or `pending` (a local send).
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { mergeOptimisticChatMessages, type PendingSend } from "./send-pipeline";
import { dateTimeFormat } from "./locale-format";

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

// A timeline asks for the day of each message several times per change (rows, runs, albums), and a local
// day takes two Date objects and a time-zone lookup: on Hermes that was most of a 2,000-message rebuild
// (lib/timeline-perf.test.ts). Each timestamp is worked out once. The memo is bounded, and starts over when
// the device's current UTC offset moves (a trip, a DST change), looked at no more than once a minute.
const DAY_KEYS_MAX = 10_000;
const ZONE_CHECK_MS = 60_000;
const dayKeys = new Map<number, number>();
let zoneCheckedAt = Number.NEGATIVE_INFINITY;
let zoneOffset = Number.NaN;
/** Moves each time the day keys start over for a new UTC offset: a day worked out before then may be wrong now. */
let zoneEpoch = 0;

function dropDayKeysOnZoneChange(): void {
  const now = Date.now();
  if (now - zoneCheckedAt < ZONE_CHECK_MS) return;
  zoneCheckedAt = now;
  const offset = new Date(now).getTimezoneOffset();
  if (offset === zoneOffset) return;
  zoneOffset = offset;
  zoneEpoch += 1;
  dayKeys.clear();
}

/** The current time-zone epoch: anything that kept a day key (lib/timeline-layout.ts) is stale once it moves. */
export function dayKeysEpoch(): number {
  dropDayKeysOnZoneChange();
  return zoneEpoch;
}

/** Local calendar day of a timestamp, as a comparable key. */
export function messageDayKey(ts: number): number {
  dropDayKeysOnZoneChange();
  const cached = dayKeys.get(ts);
  if (cached !== undefined) return cached;
  if (dayKeys.size >= DAY_KEYS_MAX) dayKeys.clear();
  const key = startOfDay(new Date(ts));
  dayKeys.set(ts, key);
  return key;
}

/** "14:05" (or "2:05 pm" on a 12-hour phone) — the time printed on a message; `locale` is the app's language. */
export function formatMessageTime(ts: number, locale: string): string {
  return dateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(ts);
}

/** Full date and time, for a screen reader's label of a message. */
export function formatMessageDateTime(ts: number, locale: string): string {
  return dateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(ts);
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
  if (diff > 1 && diff < 7) return dateTimeFormat(locale, { weekday: "long" }).format(date);
  return dateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

type GroupedMessage = Pick<TimelineMessage, "kind" | "sender" | "ts" | "voiceCall" | "voiceCallSummary">;

const CARD_KINDS = new Set(["voice_call_log", "poll", "poll_vote", "reminder", "note", "post", "file"]);

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
  // A local send is a TimelineMessage too (its id, sender, body, time and the pending entry itself).
  const merged: TimelineMessage[] = mergeOptimisticChatMessages(
    latestRows.map(toTimelineMessage),
    pending.filter((entry) => !entry.threadRootId),
    currentUserId,
  );
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
  const merged: TimelineMessage[] = mergeOptimisticChatMessages(
    (threadRows ?? []).map(toTimelineMessage),
    pending.filter((entry) => entry.threadRootId === threadRoot.id),
    currentUserId,
  );
  const root = toTimelineMessage(threadRoot);
  return [root, ...merged.filter((message) => message.id !== root.id)].sort((a, b) => a.ts - b.ts);
}

export type TimelineRow =
  | { type: "day"; key: string; ts: number }
  | { type: "message"; key: string; message: TimelineMessage; compactTop: boolean; showAvatar: boolean };

/**
 * Messages (oldest first) with a day separator before each new local day, newest last. The plain definition:
 * the screen lays a timeline out with lib/timeline-layout.ts, which builds the same rows newest first, reusing each
 * unchanged message's rows, and is checked against this one.
 */
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
