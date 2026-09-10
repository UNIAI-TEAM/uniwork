"use client";

import type { ReactNode } from "react";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageRow } from "./chat-message-row";
import { ChatFileMessageRow } from "./chat-file-message-row";
import { ChatNoteMessageRow } from "./chat-note-message-row";
import { ChatPollMessageRow } from "./chat-poll-message-row";
import { ChatReminderMessageRow } from "./chat-reminder-message-row";
import { ChatVoiceMessageRow } from "./chat-voice-message-row";
import { VoiceCallLogRow } from "./voice-call-log-row";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { senderLabelFor } from "./native-chat-message-mapping";
import { messageGrouping } from "./native-chat-message-grouping";

export type NativeChatMessageActions = {
  onReply: (message: ChatMessage | null) => void;
  onReact: (message: ChatMessage) => void;
  onThread: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onPin: (message: ChatMessage) => void;
  onCopy: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
};

export function renderNativeChatMessage(input: {
  messages: ChatMessage[];
  index: number;
  messagesById: Map<string, ChatMessage>;
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  youLabel: string;
  nameContext: NameContextEntry[];
  showSenderName: boolean;
  canPinMessages: boolean;
  highlightMessageId: string | null;
  workHubEnabled?: boolean;
  actions: NativeChatMessageActions;
}): ReactNode {
  const {
    messages,
    index,
    messagesById,
    workspaceId,
    roomId,
    currentUserId,
    youLabel,
    nameContext,
    showSenderName,
    canPinMessages,
    highlightMessageId,
    workHubEnabled = false,
    actions,
  } = input;
  const message = messages[index];
  if (!message) return null;

  if (message.kind === "reminder" && message.reminder) {
    const { compactTop } = messageGrouping(messages, index);
    return (
      <ChatReminderMessageRow
        key={message.id}
        reminder={message.reminder}
        senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
        showSenderName={showSenderName}
        compactTop={compactTop}
      />
    );
  }
  if (message.kind === "note" && message.note) {
    const { compactTop } = messageGrouping(messages, index);
    return (
      <ChatNoteMessageRow
        key={message.id}
        note={message.note}
        senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
        showSenderName={showSenderName}
        compactTop={compactTop}
      />
    );
  }
  if (message.kind === "poll" && message.poll) {
    const { compactTop } = messageGrouping(messages, index);
    return (
      <ChatPollMessageRow
        key={message.id}
        messageId={message.id}
        workspaceId={workspaceId}
        roomId={roomId}
        poll={message.poll}
        senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
        showSenderName={showSenderName}
        compactTop={compactTop}
        nameContext={nameContext}
        currentUserId={currentUserId}
        youLabel={youLabel}
      />
    );
  }
  if (message.kind === "voice_call_log" || message.voiceCall) {
    return (
      <VoiceCallLogRow key={message.id} message={message} currentUserId={currentUserId} />
    );
  }
  if (message.kind === "voice" && message.voice) {
    const isOwn = message.sender === currentUserId;
    const { compactTop, showAvatar } = messageGrouping(messages, index);
    return (
      <ChatVoiceMessageRow
        key={message.id}
        workspaceId={workspaceId}
        roomId={roomId}
        message={message}
        senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
        isOwn={isOwn}
        showSenderName={showSenderName}
        compactTop={compactTop}
        showAvatar={showAvatar}
      />
    );
  }
  if (message.kind === "file" && message.file) {
    const isOwn = message.sender === currentUserId;
    const { compactTop, showAvatar } = messageGrouping(messages, index);
    const replyTarget = message.replyToEventId
      ? messagesById.get(message.replyToEventId)
      : undefined;
    return (
      <ChatFileMessageRow
        key={message.id}
        workspaceId={workspaceId}
        roomId={roomId}
        message={message}
        senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
        isOwn={isOwn}
        showSenderName={showSenderName}
        compactTop={compactTop}
        showAvatar={showAvatar}
        replyToMessage={replyTarget}
        onReply={actions.onReply}
        onReact={actions.onReact}
        onThread={actions.onThread}
        onPin={canPinMessages ? actions.onPin : undefined}
        onCopy={actions.onCopy}
        onDelete={actions.onDelete}
        onCreateTask={workHubEnabled ? actions.onCreateTask : undefined}
        onLinkTask={workHubEnabled ? actions.onLinkTask : undefined}
        workHubEnabled={workHubEnabled}
      />
    );
  }

  const isOwn = message.sender === currentUserId;
  const isPending = Boolean(message.deliveryStatus) || isPendingChatMessageId(message.id);
  const replyTarget = message.replyToEventId
    ? messagesById.get(message.replyToEventId)
    : undefined;
  const { compactTop, showAvatar } = messageGrouping(messages, index);
  return (
    <ChatMessageRow
      key={message.id}
      message={message}
      isOwn={isOwn}
      showReadReceipt={false}
      senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
      replyToMessage={replyTarget}
      workspaceId={workspaceId}
      roomId={roomId}
      onReply={isPending ? undefined : actions.onReply}
      onReact={isPending ? undefined : actions.onReact}
      onThread={isPending ? undefined : actions.onThread}
      onEdit={isPending ? undefined : actions.onEdit}
      onPin={isPending || !canPinMessages ? undefined : actions.onPin}
      onCopy={isPending ? undefined : actions.onCopy}
      onDelete={isPending ? undefined : actions.onDelete}
      onCreateTask={isPending || !workHubEnabled ? undefined : actions.onCreateTask}
      onLinkTask={isPending || !workHubEnabled ? undefined : actions.onLinkTask}
      workHubEnabled={workHubEnabled}
      showSenderName={showSenderName}
      compactTop={compactTop}
      nameContext={nameContext}
      showAvatar={showAvatar}
      highlighted={message.id === highlightMessageId}
    />
  );
}
