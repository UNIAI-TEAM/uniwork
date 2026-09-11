import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import type { ReminderRepeat } from "@uniwork/core/chat/reminder-utils";
import type { ChatMessage } from "./chat-messages";

export interface NameContextEntry {
  user_id: string;
  display_name: string;
}

export function toChatMessage(record: ChatMessageRecord): ChatMessage {
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
    voiceCall: record.voice_call
      ? {
          outcome: record.voice_call.outcome,
          duration_seconds: record.voice_call.duration_seconds,
          caller_id: record.voice_call.caller_id,
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
