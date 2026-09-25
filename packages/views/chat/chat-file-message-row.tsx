"use client";

import { memo } from "react";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatFileAttachment, chatFileIsEdgeToEdge } from "./chat-file-attachment";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, ChatThreadRepliesLink, chatBubbleShape } from "./chat-message-row";
import { initialOf } from "./chat-initials";
import { useMessageActionsReveal } from "./use-message-actions-reveal";
import { senderNameClass } from "./sender-colors";

function ChatFileMessageRowImpl({
  workspaceId,
  roomId,
  message,
  senderLabel,
  senderAvatarUrl,
  isOwn,
  showSenderName,
  compactTop,
  showAvatar,
  replyToMessage,
  onReply,
  onReact,
  onToggleReaction,
  onJumpToMessage,
  onThread,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  senderLabel: string;
  senderAvatarUrl?: string;
  isOwn: boolean;
  showSenderName: boolean;
  compactTop: boolean;
  showAvatar: boolean;
  replyToMessage?: ChatMessage;
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onThread?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
}) {
  const reveal = useMessageActionsReveal();
  const edgeToEdge = chatFileIsEdgeToEdge(message.file);

  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg focus-visible:outline-offset-2",
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "mt-2" : "mt-4",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      <div className={cn("flex max-w-[min(85%,26rem)] gap-2", isOwn && "flex-row-reverse")}>
        {isOwn ? null : showAvatar ? (
          <span className="shrink-0" aria-hidden>
            <ActorAvatar
              name={senderLabel}
              initials={initialOf(senderLabel)}
              avatarUrl={senderAvatarUrl}
              size="lg"
              className="shrink-0"
            />
          </span>
        ) : (
          <span className="w-8 shrink-0" aria-hidden />
        )}
        <div
          ref={reveal.rootRef}
          {...reveal.bind}
          className={cn(
            "group/message relative flex min-w-0 flex-col gap-1 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
            isOwn ? "items-end" : "items-start",
          )}
        >
          {showSenderName && !isOwn ? (
            <p className={cn("px-1 text-caption font-semibold", senderNameClass(message.sender, isOwn))} aria-hidden>
              {senderLabel}
            </p>
          ) : null}
          <div
            className={cn(
              "max-w-full overflow-hidden",
              chatBubbleShape(isOwn, !compactTop),
              isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
              !edgeToEdge && "px-3 py-2",
            )}
          >
            {replyToMessage ? (
              <div className={cn(edgeToEdge ? "px-2 pt-2" : undefined)}>
                <ChatReplyQuote
                  message={replyToMessage}
                  workspaceId={workspaceId}
                  roomId={roomId}
                  isOwn={isOwn}
                  onJump={onJumpToMessage}
                />
              </div>
            ) : null}
            <ChatFileAttachment workspaceId={workspaceId} roomId={roomId} message={message} />
          </div>
          <div className={cn(edgeToEdge ? "px-1" : undefined)}>
            <ChatMessageMeta message={message} isOwn={isOwn} showTime />
          </div>
          <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />
          <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} />
          <MessageTaskCard
            workspaceId={workspaceId}
            messageId={message.id}
            className={cn(isOwn && "items-end self-end")}
          />
          {/* After the content in reading order; positioned over the bubble. */}
          <ChatMessageHoverActions
            message={message}
            isOwn={isOwn}
            onReply={onReply}
            onReact={onReact}
            onThread={onThread}
            onPin={onPin}
            onCopy={onCopy}
            onDelete={onDelete}
            onCreateTask={onCreateTask}
            onLinkTask={onLinkTask}
            onFollowUp={onFollowUp}
            canEdit={false}
            forceOpen={reveal.open}
          />
        </div>
      </div>
    </article>
  );
}

/** One file message. Memoised like the text row. */
export const ChatFileMessageRow = memo(ChatFileMessageRowImpl);
