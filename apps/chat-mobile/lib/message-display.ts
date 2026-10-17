// How one message reads on the phone: which card it gets (spec §4), and the
// few labels the cards print.
//   voiceCallLogLabel       ← packages/views/chat/voice-call-log-row.tsx
//   formatVoiceCallDuration ← packages/views/chat/voice-call-duration.ts
//   pollResults             ← packages/views/chat/chat-poll-message-row.tsx (hide_results_until_vote)
// message-display.test.ts covers every kind in chat-schemas plus an unknown one.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isChatImageContentType, resolveChatFileContentType } from "./file-accept";
import { parseChatMediaMessageBody } from "./media-body";

/** Every `chat_messages.kind` the server writes (migration 181's check). */
export const KNOWN_MESSAGE_KINDS = ["text", "system", "voice_call_log", "poll", "reminder", "note", "voice", "file", "post"] as const;

export type MessageView =
  | "text"
  | "media"
  | "system"
  | "image"
  | "file"
  | "voice"
  | "poll"
  | "note"
  | "post"
  | "reminder"
  | "call-log"
  | "call-summary"
  | "unsupported";

/** The card a message renders as; a kind this build does not know reads "unsupported" (→ "Mở trên web"). */
export function messageView(record: Pick<ChatMessageRecord, "kind" | "body" | "file" | "voice" | "poll" | "note" | "post" | "reminder" | "voice_call" | "voice_call_summary">): MessageView {
  if (record.voice_call_summary) return "call-summary";
  switch (record.kind) {
    case "text":
      return parseChatMediaMessageBody(record.body) ? "media" : "text";
    case "system":
      return "system";
    case "voice_call_log":
      return "call-log";
    case "file":
      if (!record.file) return "unsupported";
      return isChatImageContentType(resolveChatFileContentType(record.file), record.file.filename) ? "image" : "file";
    case "voice":
      return record.voice ? "voice" : "unsupported";
    case "poll":
      return record.poll ? "poll" : "unsupported";
    case "note":
      return record.note ? "note" : "unsupported";
    case "post":
      return record.post ? "post" : "unsupported";
    case "reminder":
      return record.reminder ? "reminder" : "unsupported";
    default:
      return "unsupported";
  }
}

/** Formats elapsed seconds as M:SS or H:MM:SS. */
export function formatVoiceCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function voiceCallLogLabel(call: ChatMessageRecord["voice_call"], currentUserId: string, t: TranslateFn): string {
  if (!call) return t("chat.voice_call_log_unknown");
  const isCaller = call.caller_id === currentUserId;
  const kind = call.video ? "video_call_log" : "voice_call_log";
  switch (call.outcome) {
    case "completed":
      return t(`chat.${kind}_completed`, { duration: formatVoiceCallDuration(call.duration_seconds ?? 0) });
    case "declined":
      return isCaller ? t(`chat.${kind}_declined_outgoing`) : t(`chat.${kind}_declined_incoming`);
    case "unanswered":
      return isCaller ? t(`chat.${kind}_cancelled`) : t(`chat.${kind}_missed`);
    default:
      return t(`chat.${kind}_unknown`);
  }
}

/** "820 KB", "1.4 MB" — the size on a file card. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Poll = NonNullable<ChatMessageRecord["poll"]>;

/** A poll's results as the reader may see them: counts stay hidden until they voted when the poll says so. */
export function pollResults(poll: Poll) {
  const voted = new Set(poll.viewer_option_ids);
  const hideCounts = poll.settings.hide_results_until_vote && voted.size === 0;
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
  return {
    hideCounts,
    total,
    options: poll.options.map((option) => ({
      id: option.id,
      label: option.label,
      votes: option.votes,
      mine: voted.has(option.id),
      percent: total > 0 ? Math.round((option.votes / total) * 100) : 0,
    })),
  };
}

export function isReminderDue(remindAt: string, now: number = Date.now()): boolean {
  const at = Date.parse(remindAt);
  return Number.isFinite(at) && at <= now;
}
