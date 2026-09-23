import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import type { ReminderRepeat } from "@uniwork/core/chat/reminder-utils";
import type { ChatMessage } from "./chat-messages";

export interface NameContextEntry {
  user_id: string;
  display_name: string;
}

// React Query keeps an unchanged record the same object across refetches
// (structural sharing), so mapping through this cache gives an unchanged
// message the same object too: rows can memoise on it, and an attachment
// preview keyed on it does not reload when the timeline rebuilds.
const mapped = new WeakMap<ChatMessageRecord, ChatMessage>();

export function toChatMessage(record: ChatMessageRecord): ChatMessage {
  const cached = mapped.get(record);
  if (cached) return cached;
  const message = mapRecord(record);
  mapped.set(record, message);
  return message;
}

function mapRecord(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    sender: record.sender_id,
    body: record.body,
    kind: record.kind,
    ts: Date.parse(record.created_at),
    replyToEventId: record.reply_to_message_id,
    threadRootId: record.thread_root_id,
    replyCount: record.reply_count,
    lastReplyAt: record.last_reply_at ? Date.parse(record.last_reply_at) : undefined,
    threadUnread: record.thread_unread,
    editedAt: record.edited_at ? Date.parse(record.edited_at) : undefined,
    pinned: record.pinned,
    mentionedUserIds: record.mentioned_user_ids,
    reactions: record.reactions ?? {},
    myReactions: record.my_reactions,
    voiceCall: record.voice_call
      ? {
          outcome: record.voice_call.outcome,
          duration_seconds: record.voice_call.duration_seconds,
          caller_id: record.voice_call.caller_id,
          participants: record.voice_call.participants?.map((p) => ({
            user_id: p.user_id,
            display_name: p.display_name ?? "",
          })),
          recording_id: record.voice_call.recording_id,
          recording_status: record.voice_call.recording_status,
          recording_url: record.voice_call.recording_url,
        }
      : undefined,
    voiceCallSummary: record.voice_call_summary
      ? {
          call_id: record.voice_call_summary.call_id,
          call_log_message_id: record.voice_call_summary.call_log_message_id,
          summary: record.voice_call_summary.summary ?? "",
          highlights: record.voice_call_summary.highlights ?? [],
          action_items: record.voice_call_summary.action_items.map((item) => ({
            title: item.title,
            owner: item.owner ?? "",
            due: item.due ?? "",
            source_message_id: item.source_message_id ?? "",
          })),
        }
      : undefined,
    voice: record.voice,
    file: record.file
      ? {
          filename: record.file.filename,
          content_type: record.file.content_type,
          size_bytes: record.file.size_bytes,
        }
      : undefined,
    poll: record.poll
      ? {
          question: record.poll.question,
          options: record.poll.options.map((option) => ({
            id: option.id,
            label: option.label,
            votes: option.votes,
          })),
          settings: {
            deadline_at: record.poll.settings.deadline_at ?? null,
            pin_to_top: record.poll.settings.pin_to_top ?? false,
            allow_multiple: record.poll.settings.allow_multiple ?? true,
            allow_add_options: record.poll.settings.allow_add_options ?? true,
            hide_results_until_vote: record.poll.settings.hide_results_until_vote ?? false,
            hide_voters: record.poll.settings.hide_voters ?? false,
          },
          viewer_option_ids: record.poll.viewer_option_ids,
          votes_by_user: record.poll.votes_by_user,
        }
      : undefined,
    reminder: record.reminder
      ? {
          body: record.reminder.body,
          remindAt: record.reminder.remind_at,
          repeat: (record.reminder.repeat ?? "none") as ReminderRepeat,
        }
      : undefined,
    note: record.note
      ? {
          body: record.note.body,
          pinToTop: record.note.pin_to_top ?? false,
        }
      : undefined,
    post: record.post
      ? {
          title: record.post.title,
          body: record.post.body,
          pinToTop: record.post.pin_to_top ?? false,
        }
      : undefined,
    priority:
      record.priority === "important" || record.priority === "urgent"
        ? record.priority
        : undefined,
    clientMsgId: record.client_msg_id,
  };
}

export function senderLabelFor(
  message: ChatMessage,
  currentUserId: string,
  youLabel: string,
  nameContext: NameContextEntry[],
): string {
  if (message.sender === currentUserId) return youLabel;
  const match = nameContext.find((entry) => entry.user_id === message.sender);
  return match?.display_name?.trim() || message.sender;
}
