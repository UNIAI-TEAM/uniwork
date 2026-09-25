"use client";

import { memo } from "react";
import { latestSeenOwnMessageIndex } from "@uniwork/core/chat/read-receipt-utils";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageRow } from "./chat-message-row";
import { ChatFileMessageRow } from "./chat-file-message-row";
import { ChatNoteMessageRow } from "./chat-note-message-row";
import { ChatPostMessageRow } from "./chat-post-message-row";
import { ChatPollMessageRow } from "./chat-poll-message-row";
import { ChatReminderMessageRow } from "./chat-reminder-message-row";
import { ChatVoiceMessageRow } from "./chat-voice-message-row";
import { VoiceCallLogRow } from "./voice-call-log-row";
import { VoiceCallSummaryRow } from "./voice-call-summary-row";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { messageGrouping } from "./native-chat-message-grouping";
import { messageDayKey } from "./chat-message-time";
import { ChatDaySeparator } from "./chat-day-separator";

export type NativeChatMessageActions = {
  onReply: (message: ChatMessage | null) => void;
  onReact: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onThread?: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onPin: (message: ChatMessage) => void;
  onCopy: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
};

/** What every row in one room shares; built once per change, not per row. */
export type NativeChatMessageContext = {
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  youLabel: string;
  nameContext: NameContextEntry[];
  showSenderName: boolean;
  canPinMessages: boolean;
  actions: NativeChatMessageActions;
};

/** Per-row flags, worked out once for the whole timeline. */
export type NativeChatRowLayout = {
  opensDay: boolean;
  compactTop: boolean;
  showAvatar: boolean;
  lastOfRun: boolean;
  showReadReceipt: boolean;
  senderLabel: string;
  senderAvatarUrl?: string;
  replyTarget: ChatMessage | undefined;
};

/**
 * Grouping, day breaks, sender names and the one read receipt for a whole
 * timeline in a single pass. Each of these used to be worked out inside
 * every row's render — the read receipt by scanning to the end of the list —
 * so a long room did quadratic work on every keystroke-driven re-render.
 */
export function layoutNativeChatMessages(
  messages: ChatMessage[],
  input: { currentUserId: string; youLabel: string; nameContext: NameContextEntry[]; peerLastReadAt: string | null },
): NativeChatRowLayout[] {
  const names = new Map(input.nameContext.map((entry) => [entry.user_id, entry.display_name?.trim() ?? ""]));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const receiptIndex = latestSeenOwnMessageIndex(messages, input.currentUserId, input.peerLastReadAt);
  const grouping = messages.map((_, index) => messageGrouping(messages, index));
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = grouping[index + 1];
    return {
      opensDay: !previous || messageDayKey(previous.ts) !== messageDayKey(message.ts),
      compactTop: grouping[index]?.compactTop ?? false,
      showAvatar: grouping[index]?.showAvatar ?? true,
      lastOfRun: !next || !next.compactTop,
      showReadReceipt: index === receiptIndex,
      senderLabel:
        message.sender === input.currentUserId ? input.youLabel : names.get(message.sender) || message.sender,
      senderAvatarUrl:
        message.sender === input.currentUserId
          ? undefined
          : resolveAvatarUrlFromNameContext(input.nameContext, message.sender),
      // The message this row points back to: its reply parent, or — for an
      // AI call summary — the call's log row.
      replyTarget: message.replyToEventId
        ? byId.get(message.replyToEventId)
        : message.voiceCallSummary
          ? byId.get(message.voiceCallSummary.call_log_message_id)
          : undefined,
    };
  });
}

function MessageBody({
  message,
  layout,
  context,
  highlighted,
}: {
  message: ChatMessage;
  layout: NativeChatRowLayout;
  context: NativeChatMessageContext;
  highlighted: boolean;
}) {
  const { workspaceId, roomId, currentUserId, youLabel, nameContext, showSenderName, canPinMessages, actions } =
    context;
  const { compactTop, showAvatar, senderLabel, senderAvatarUrl } = layout;
  const isOwn = message.sender === currentUserId;
  const cardProps = { senderLabel, senderId: message.sender, isOwn, ts: message.ts, showSenderName, compactTop };

  if (message.kind === "reminder" && message.reminder) {
    return <ChatReminderMessageRow reminder={message.reminder} {...cardProps} />;
  }
  if (message.kind === "note" && message.note) {
    return <ChatNoteMessageRow note={message.note} {...cardProps} />;
  }
  if (message.kind === "post" && message.post) {
    return <ChatPostMessageRow post={message.post} {...cardProps} />;
  }
  if (message.kind === "poll" && message.poll) {
    return (
      <ChatPollMessageRow
        messageId={message.id}
        workspaceId={workspaceId}
        roomId={roomId}
        poll={message.poll}
        {...cardProps}
        nameContext={nameContext}
        currentUserId={currentUserId}
        youLabel={youLabel}
      />
    );
  }
  if (message.kind === "voice_call_log" || message.voiceCall) {
    return <VoiceCallLogRow workspaceId={workspaceId} roomId={roomId} message={message} currentUserId={currentUserId} />;
  }
  if (message.voiceCallSummary) {
    return (
      <VoiceCallSummaryRow
        workspaceId={workspaceId}
        message={message}
        senderLabel={senderLabel}
        showSenderName={showSenderName}
        compactTop={compactTop}
        isOwn={isOwn}
        callLog={layout.replyTarget}
        onJumpToMessage={actions.onJumpToMessage}
      />
    );
  }

  const isPending = Boolean(message.deliveryStatus) || isPendingChatMessageId(message.id);
  const live = !isPending;
  const common = {
    workspaceId,
    roomId,
    message,
    senderLabel,
    senderAvatarUrl,
    isOwn,
    showSenderName,
    compactTop,
    showAvatar,
    onReply: live ? actions.onReply : undefined,
    onReact: live ? actions.onReact : undefined,
    onToggleReaction: live ? actions.onToggleReaction : undefined,
    onThread: live ? actions.onThread : undefined,
    onPin: live && canPinMessages ? actions.onPin : undefined,
    onCopy: live ? actions.onCopy : undefined,
    onDelete: live ? actions.onDelete : undefined,
    onCreateTask: live ? actions.onCreateTask : undefined,
    onLinkTask: live ? actions.onLinkTask : undefined,
    onFollowUp: live ? actions.onFollowUp : undefined,
  };

  if (message.kind === "voice" && message.voice) {
    return <ChatVoiceMessageRow {...common} />;
  }
  if (message.kind === "file" && message.file) {
    return <ChatFileMessageRow {...common} replyToMessage={layout.replyTarget} onJumpToMessage={actions.onJumpToMessage} />;
  }
  return (
    <ChatMessageRow
      {...common}
      showReadReceipt={layout.showReadReceipt}
      replyToMessage={layout.replyTarget}
      onJumpToMessage={actions.onJumpToMessage}
      onEdit={live ? actions.onEdit : undefined}
      nameContext={nameContext}
      lastOfRun={layout.lastOfRun}
      highlighted={highlighted}
    />
  );
}

/**
 * One timeline row, preceded by a day separator when it opens a new calendar
 * day. The separator lives inside the row so the virtual list still measures
 * one element per message. Memoised: a row re-renders when its own message,
 * layout or highlight changes, not whenever the timeline does.
 */
export const NativeChatMessageItem = memo(function NativeChatMessageItem({
  message,
  layout,
  context,
  highlighted,
}: {
  message: ChatMessage;
  layout: NativeChatRowLayout;
  context: NativeChatMessageContext;
  highlighted: boolean;
}) {
  const body = <MessageBody message={message} layout={layout} context={context} highlighted={highlighted} />;
  if (!layout.opensDay) return body;
  return (
    <div>
      <ChatDaySeparator ts={message.ts} />
      {body}
    </div>
  );
},
sameRow);

function sameRow(
  prev: { message: ChatMessage; layout: NativeChatRowLayout; context: NativeChatMessageContext; highlighted: boolean },
  next: { message: ChatMessage; layout: NativeChatRowLayout; context: NativeChatMessageContext; highlighted: boolean },
): boolean {
  if (prev.message !== next.message || prev.context !== next.context || prev.highlighted !== next.highlighted) {
    return false;
  }
  const a = prev.layout;
  const b = next.layout;
  return (
    a.opensDay === b.opensDay &&
    a.compactTop === b.compactTop &&
    a.showAvatar === b.showAvatar &&
    a.lastOfRun === b.lastOfRun &&
    a.showReadReceipt === b.showReadReceipt &&
    a.senderLabel === b.senderLabel &&
    a.replyTarget === b.replyTarget
  );
}
