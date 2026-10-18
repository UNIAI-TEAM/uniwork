"use client";

import { memo } from "react";
import { latestSeenOwnMessageIndex } from "@uniwork/core/chat/read-receipt-utils";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageRow } from "./chat-message-row";
import { ChatFileMessageRow } from "./chat-file-message-row";
import { ChatImageAlbumRow } from "./chat-image-album";
import { ChatNoteMessageRow } from "./chat-note-message-row";
import { ChatPostMessageRow } from "./chat-post-message-row";
import { ChatPollMessageRow } from "./chat-poll-message-row";
import { ChatReminderMessageRow } from "./chat-reminder-message-row";
import { ChatVoiceMessageRow } from "./chat-voice-message-row";
import { VoiceCallLogRow } from "./voice-call-log-row";
import { VoiceCallSummaryRow } from "./voice-call-summary-row";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { imageAlbumSpans, messageGrouping } from "./native-chat-message-grouping";
import { messageDayKey } from "./chat-message-time";
import { ChatDaySeparator, ChatRepliesSeparator, ChatUnreadSeparator } from "./chat-day-separator";
import { ChatSenderAvatar } from "./chat-sender-avatar";

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
  /** The timeline is one thread: its root does not link to itself. */
  inThread: boolean;
  canPinMessages: boolean;
  /** Room moderator: may delete someone else's reminder (the server's isChatRoomModerator). */
  canModerate: boolean;
  actions: NativeChatMessageActions;
};

/** Per-row flags, worked out once for the whole timeline. */
export type NativeChatRowLayout = {
  opensDay: boolean;
  /** First message from someone else after the reader's pre-open read pointer. */
  opensUnread: boolean;
  compactTop: boolean;
  showAvatar: boolean;
  lastOfRun: boolean;
  showReadReceipt: boolean;
  senderLabel: string;
  senderAvatarUrl?: string;
  replyTarget: ChatMessage | undefined;
  /** Who wrote replyTarget ("Bạn" for me), named inside the quote. */
  replySenderLabel: string | undefined;
  /** The photos this row draws as one album, itself first. */
  album?: ChatMessage[];
  /** Drawn inside an earlier row's album: renders nothing of its own. */
  inAlbum: boolean;
  /** A call log row: the UNI summary of that call, when there is one. */
  callSummaryId?: string;
  /** In a thread, the first reply: "N trả lời" between the root and its replies (canvas). */
  opensReplies?: number;
};

/**
 * Grouping, day breaks, sender names and the one read receipt for a whole
 * timeline in a single pass. Each of these used to be worked out inside
 * every row's render — the read receipt by scanning to the end of the list —
 * so a long room did quadratic work on every keystroke-driven re-render.
 */
export function layoutNativeChatMessages(
  messages: ChatMessage[],
  input: {
    currentUserId: string;
    youLabel: string;
    nameContext: NameContextEntry[];
    peerLastReadAt: string | null;
    unreadSince?: string | null;
    /** The timeline is this thread: its root first, then the replies. */
    threadRoot?: { id: string; replyCount: number } | null;
  },
): NativeChatRowLayout[] {
  const names = new Map(input.nameContext.map((entry) => [entry.user_id, entry.display_name?.trim() ?? ""]));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const receiptIndex = latestSeenOwnMessageIndex(messages, input.currentUserId, input.peerLastReadAt);
  const grouping = messages.map((_, index) => messageGrouping(messages, index));
  const unreadIndex = firstUnreadIndex(messages, input.currentUserId, input.unreadSince ?? null);
  const albums = new Map<number, ChatMessage[]>();
  const inAlbum = new Set<number>();
  for (const { start, end } of imageAlbumSpans(messages, unreadIndex)) {
    albums.set(start, messages.slice(start, end));
    for (let index = start + 1; index < end; index += 1) inAlbum.add(index);
  }
  const summaryOfCall = new Map<string, string>();
  for (const message of messages) {
    if (message.voiceCallSummary) summaryOfCall.set(message.voiceCallSummary.call_log_message_id, message.id);
  }
  const labelOf = (sender: string) =>
    sender === input.currentUserId ? input.youLabel : names.get(sender) || sender;
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = grouping[index + 1];
    // The message this row points back to: its reply parent, or — for an
    // AI call summary — the call's log row.
    // In a thread every reply answers the root above it: no quote of it (canvas).
    const replyTarget = message.replyToEventId
      ? message.replyToEventId === input.threadRoot?.id
        ? undefined
        : byId.get(message.replyToEventId)
      : message.voiceCallSummary
        ? byId.get(message.voiceCallSummary.call_log_message_id)
        : undefined;
    return {
      // A thread opens on its root, not on a day chip.
      opensDay: previous ? messageDayKey(previous.ts) !== messageDayKey(message.ts) : !input.threadRoot,
      opensUnread: index === unreadIndex,
      compactTop: grouping[index]?.compactTop ?? false,
      showAvatar: grouping[index]?.showAvatar ?? true,
      lastOfRun: !next || !next.compactTop,
      showReadReceipt: index === receiptIndex,
      senderLabel: labelOf(message.sender),
      senderAvatarUrl:
        message.sender === input.currentUserId
          ? undefined
          : resolveAvatarUrlFromNameContext(input.nameContext, message.sender),
      replyTarget,
      replySenderLabel: replyTarget ? labelOf(replyTarget.sender) : undefined,
      album: albums.get(index),
      inAlbum: inAlbum.has(index),
      callSummaryId: summaryOfCall.get(message.id),
      opensReplies:
        input.threadRoot && previous?.id === input.threadRoot.id ? input.threadRoot.replyCount : undefined,
    };
  });
}

/** Sent-at in ms, from the micro-precision cursor when there is one (created_at is whole seconds). */
function sentAtMs(message: ChatMessage): number {
  const micros = Number(message.cursor?.split(".")[0]);
  return Number.isFinite(micros) && micros > 0 ? micros / 1000 : message.ts;
}

function firstUnreadIndex(messages: ChatMessage[], currentUserId: string, since: string | null): number {
  const at = since ? Date.parse(since) : Number.NaN;
  if (Number.isNaN(at)) return -1;
  return messages.findIndex(
    (message) => message.sender !== currentUserId && !message.deliveryStatus && sentAtMs(message) > at,
  );
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
  const {
    workspaceId,
    roomId,
    currentUserId,
    youLabel,
    nameContext,
    showSenderName,
    canPinMessages,
    canModerate,
    actions,
  } = context;
  const { compactTop, showAvatar, senderLabel, senderAvatarUrl } = layout;
  // Its photo is a tile of the album row above; the empty row keeps the virtual list's one-per-message count.
  if (layout.inAlbum) return null;
  const isOwn = message.sender === currentUserId;
  const avatar = isOwn ? undefined : (
    <ChatSenderAvatar userId={message.sender} name={senderLabel} avatarUrl={senderAvatarUrl} nameContext={nameContext} />
  );
  const cardProps = { senderLabel, senderId: message.sender, isOwn, ts: message.ts, showSenderName, compactTop, avatar };

  if (message.kind === "reminder" && message.reminder) {
    return (
      <ChatReminderMessageRow
        reminder={message.reminder}
        {...cardProps}
        onDelete={isOwn || canModerate ? () => actions.onDelete(message) : undefined}
      />
    );
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
    const summaryId = layout.callSummaryId;
    const jump = actions.onJumpToMessage;
    return (
      <VoiceCallLogRow
        workspaceId={workspaceId}
        roomId={roomId}
        message={message}
        currentUserId={currentUserId}
        nameContext={nameContext}
        onViewSummary={summaryId && jump ? () => jump(summaryId) : undefined}
      />
    );
  }
  if (message.voiceCallSummary) {
    return (
      <VoiceCallSummaryRow
        workspaceId={workspaceId}
        message={message}
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
    onThread: live && !context.inThread ? actions.onThread : undefined,
    onPin: live && canPinMessages ? actions.onPin : undefined,
    onCopy: live ? actions.onCopy : undefined,
    onDelete: live ? actions.onDelete : undefined,
    onCreateTask: live ? actions.onCreateTask : undefined,
    onLinkTask: live ? actions.onLinkTask : undefined,
    onFollowUp: live ? actions.onFollowUp : undefined,
    nameContext,
  };

  if (message.kind === "voice" && message.voice) {
    return <ChatVoiceMessageRow {...common} lastOfRun={layout.lastOfRun} highlighted={highlighted} />;
  }
  if (layout.album) {
    const { message: _head, ...rest } = common;
    return <ChatImageAlbumRow {...rest} album={layout.album} />;
  }
  if (message.kind === "file" && message.file) {
    return (
      <ChatFileMessageRow
        {...common}
        replyToMessage={layout.replyTarget}
        replyToSenderLabel={layout.replySenderLabel}
        onJumpToMessage={actions.onJumpToMessage}
        highlighted={highlighted}
      />
    );
  }
  return (
    <ChatMessageRow
      {...common}
      showReadReceipt={layout.showReadReceipt}
      replyToMessage={layout.replyTarget}
      replyToSenderLabel={layout.replySenderLabel}
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
  if (!layout.opensDay && !layout.opensUnread && !layout.opensReplies) return body;
  return (
    <div>
      {layout.opensReplies ? <ChatRepliesSeparator count={layout.opensReplies} /> : null}
      {layout.opensDay && !layout.opensReplies ? <ChatDaySeparator ts={message.ts} /> : null}
      {layout.opensUnread ? <ChatUnreadSeparator /> : null}
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
    a.opensUnread === b.opensUnread &&
    a.compactTop === b.compactTop &&
    a.showAvatar === b.showAvatar &&
    a.lastOfRun === b.lastOfRun &&
    a.showReadReceipt === b.showReadReceipt &&
    a.senderLabel === b.senderLabel &&
    a.replyTarget === b.replyTarget &&
    a.replySenderLabel === b.replySenderLabel &&
    a.inAlbum === b.inAlbum &&
    a.callSummaryId === b.callSummaryId &&
    a.opensReplies === b.opensReplies &&
    sameMessages(a.album, b.album)
  );
}

/** Albums are sliced afresh on every layout; the same photos are the same album. */
function sameMessages(a: ChatMessage[] | undefined, b: ChatMessage[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((message, index) => message === b[index]);
}
