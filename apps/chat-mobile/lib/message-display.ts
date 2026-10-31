// How one message reads on the phone: which card it gets (spec §4), and the
// few labels the cards print.
//   voiceCallLogLabel       ← packages/views/chat/voice-call-log-row.tsx
//   pollResults             ← packages/views/chat/chat-poll-message-row.tsx (hide_results_until_vote, closed)
// message-display.test.ts covers every kind in chat-schemas plus an unknown one.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isPollExpired } from "@uniwork/core/chat/poll-utils";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import { isChatImageContentType, resolveChatFileContentType } from "./file-accept";
import { numberFormat } from "./locale-format";
import { parseChatMediaMessageBody } from "./media-body";
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import { formatChatSidebarPreviewText } from "./rooms-display";
import type { PendingSend } from "./send-pipeline";

/** Every `chat_messages.kind` the server writes (migration poll_vote_kind + document kinds). */
export const KNOWN_MESSAGE_KINDS = [
  "text",
  "system",
  "voice_call_log",
  "poll",
  "poll_vote",
  "reminder",
  "note",
  "voice",
  "file",
  "post",
  "document",
  "document_version",
] as const;

type Payload<K extends keyof ChatMessageRecord> = NonNullable<ChatMessageRecord[K]>;

/**
 * What a message renders as, with the payload its card draws, read once from
 * the record. The tag and the payload travel together, so a card never
 * asserts that a field is there: a record whose payload is missing (drifted,
 * or a kind this build does not know) is "unsupported" (→ "Mở trên web").
 */
export type MessageContent =
  | { view: "text" }
  | { view: "media"; media: NonNullable<ReturnType<typeof parseChatMediaMessageBody>> }
  | { view: "system" }
  | { view: "image"; file: Payload<"file"> }
  | { view: "file"; file: Payload<"file"> }
  | { view: "voice"; voice: Payload<"voice"> }
  | { view: "poll"; poll: Payload<"poll"> }
  | { view: "note"; note: Payload<"note"> }
  | { view: "post"; post: Payload<"post"> }
  | { view: "reminder"; reminder: Payload<"reminder"> }
  | { view: "document"; document: Payload<"document"> }
  | { view: "call-log" }
  | { view: "call-summary"; summary: Payload<"voice_call_summary"> }
  | { view: "poll-vote-activity"; pollVote: Payload<"poll_vote"> }
  | { view: "unsupported" };

export type MessageView = MessageContent["view"];

type ContentFields = Pick<
  ChatMessageRecord,
  | "kind"
  | "body"
  | "file"
  | "voice"
  | "poll"
  | "poll_vote"
  | "note"
  | "post"
  | "reminder"
  | "document"
  | "voice_call"
  | "voice_call_summary"
>;

const UNSUPPORTED: MessageContent = { view: "unsupported" };

/** The card a message renders as and what it draws; a kind this build does not know reads "unsupported". */
export function messageContent(record: ContentFields): MessageContent {
  if (record.voice_call_summary) return { view: "call-summary", summary: record.voice_call_summary };
  switch (record.kind) {
    case "text": {
      const media = parseChatMediaMessageBody(record.body);
      return media ? { view: "media", media } : { view: "text" };
    }
    case "system":
      return { view: "system" };
    case "voice_call_log":
      return { view: "call-log" };
    case "file":
      if (!record.file) return UNSUPPORTED;
      return { view: isChatImageContentType(resolveChatFileContentType(record.file), record.file.filename) ? "image" : "file", file: record.file };
    case "voice":
      return record.voice ? { view: "voice", voice: record.voice } : UNSUPPORTED;
    case "poll":
      return record.poll ? { view: "poll", poll: record.poll } : UNSUPPORTED;
    case "poll_vote": {
      const pollVote = record.poll_vote;
      return pollVote?.poll_message_id && pollVote.question ? { view: "poll-vote-activity", pollVote } : UNSUPPORTED;
    }
    case "note":
      return record.note ? { view: "note", note: record.note } : UNSUPPORTED;
    case "post":
      return record.post ? { view: "post", post: record.post } : UNSUPPORTED;
    case "reminder":
      return record.reminder ? { view: "reminder", reminder: record.reminder } : UNSUPPORTED;
    case "document":
    case "document_version":
      return record.document?.document_id ? { view: "document", document: record.document } : UNSUPPORTED;
    default:
      return UNSUPPORTED;
  }
}

/** The card's tag alone, for a caller that only branches on it. */
export function messageView(record: ContentFields): MessageView {
  return messageContent(record).view;
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

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/** "820 KB", "1,4 MB" (vi) / "1.4 MB" (en) — the size on a file card, in the app's language. */
export function formatFileSize(bytes: number, language: string | undefined): string {
  if (bytes < 1024) return `${numberFormat(language).format(Math.max(0, Math.round(bytes)))} B`;
  if (bytes < 1024 * 1024) return `${numberFormat(language).format(Math.round(bytes / 1024))} KB`;
  return `${numberFormat(language, ONE_DECIMAL).format(bytes / (1024 * 1024))} MB`;
}

type Poll = NonNullable<ChatMessageRecord["poll"]>;

/**
 * A poll's results as the reader may see them: counts stay hidden until they
 * voted when the poll says so, and a poll past its deadline takes no vote.
 */
export function pollResults(poll: Poll, now = Date.now()) {
  const voted = new Set(poll.viewer_option_ids);
  const hideCounts = poll.settings.hide_results_until_vote && voted.size === 0;
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
  return {
    hideCounts,
    total,
    closed: isPollExpired(poll.settings.deadline_at, now),
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

/** A signed URL counts as dead this long before it ends, so a tap never lands on one. */
const CHAT_MEDIA_URL_MARGIN_MS = 60_000;

/**
 * Whether a file or voice message's signed storage URL can still be used
 * (packages/core/chat/chat-hooks-messages.ts › isChatMediaUrlFresh). A screen
 * left open past url_expires_at holds dead ones; the message is then fetched
 * again for fresh ones.
 */
export function isChatMediaUrlFresh(url: string | undefined, expiresAt: string | undefined, now: number = Date.now()): boolean {
  if (!url) return false;
  const at = Date.parse(expiresAt ?? "");
  return Number.isFinite(at) && at - CHAT_MEDIA_URL_MARGIN_MS > now;
}

/**
 * One line for a message (a reply quote, the copy of a card): the list
 * preview's words for it, without the sender prefix.
 */
export function messagePreviewText(
  record: Pick<ChatMessageRecord, "body" | "kind" | "sender_id" | "created_at" | "file" | "poll" | "note" | "post" | "reminder" | "document">,
  t: TranslateFn,
): string {
  const body =
    record.kind === "file"
      ? (record.file?.filename ?? record.body)
      : record.kind === "document" || record.kind === "document_version"
        ? (record.document?.title ?? record.body)
        : (record.poll?.question ?? record.post?.title ?? record.note?.body ?? record.reminder?.body ?? record.body);
  const preview = { body, kind: record.kind, senderId: record.sender_id, senderName: "", createdAt: record.created_at };
  return (
    formatChatSidebarPreviewText(preview, {
      currentUserId: "",
      isGroup: false,
      youLabel: "",
      voiceCallLabel: t("chat.sidebar_voice_call_preview"),
      voiceMessageLabel: t("chat.sidebar_voice_message_preview"),
      fileMessageLabel: t("chat.sidebar_file_message_preview"),
      mediaLabels: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") },
    }) ?? ""
  );
}

/**
 * A message still on its way, in its bubble and its sheet: the text with
 * mentions as names, its file's name, "Voice message", or the reminder's text.
 */
export function pendingPreviewText(
  pending: Pick<PendingSend, "body" | "file" | "voiceDurationMs" | "reminder" | "poll" | "note" | "post">,
  t: TranslateFn,
): string {
  if (pending.voiceDurationMs !== undefined) return t("chat.sidebar_voice_message_preview");
  if (pending.file) return pending.file.name;
  if (pending.reminder) return pending.reminder.body;
  if (pending.poll) return pending.poll.question;
  if (pending.note) return pending.note.body;
  if (pending.post) return pending.post.title;
  return deserializeMessageBodyToComposerDraft(pending.body);
}
