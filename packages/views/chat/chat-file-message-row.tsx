"use client";

import { memo } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatFileAttachment, chatFileIsEdgeToEdge } from "./chat-file-attachment";
import { ChatMessageHoverActions, chatMessageActionsRailClass } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, ChatThreadRepliesLink, chatBubbleShape } from "./chat-message-row";
import { useMessageActionsReveal } from "./use-message-actions-reveal";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatSenderAvatar } from "./chat-sender-avatar";
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
  nameContext = [],
  replyToMessage,
  replyToSenderLabel,
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
  nameContext?: ChatNameContextEntry[];
  replyToMessage?: ChatMessage;
  /** Who wrote the quoted message, named inside the quote. */
  replyToSenderLabel?: string;
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
        compactTop ? "mt-0.5" : "mt-3",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      <div className={cn("flex max-w-[min(85%,26rem)] gap-2", isOwn && "flex-row-reverse")}>
        {isOwn ? null : showAvatar ? (
          // A file is a run of its own: its avatar sits at the foot, as a run's last bubble's does.
          <span className="shrink-0 self-end">
            <ChatSenderAvatar
              userId={message.sender}
              name={senderLabel}
              avatarUrl={senderAvatarUrl}
              nameContext={nameContext}
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
          <div className={chatMessageActionsRailClass(isOwn)}>
            <div className="flex min-w-0 flex-col gap-1">
              {/* The file sits in the sender's bubble like text: name on top,
                  time under it, both inside. A photo or PDF keeps a thin rim. */}
              <div
                className={cn(
                  "max-w-full overflow-hidden",
                  chatBubbleShape(isOwn, !compactTop),
                  isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
                  edgeToEdge ? "p-1" : "px-3 py-2",
                )}
              >
                {showSenderName && !isOwn && showAvatar ? (
                  <p
                    className={cn(
                      "text-label font-semibold",
                      senderNameClass(message.sender, isOwn),
                      edgeToEdge ? "px-2 pt-1 pb-1" : "mb-1",
                    )}
                    aria-hidden
                  >
                    {senderLabel}
                  </p>
                ) : null}
                {replyToMessage ? (
                  <div className={cn(edgeToEdge ? "px-1 pt-1" : undefined)}>
                    <ChatReplyQuote
                      message={replyToMessage}
                      isOwn={isOwn}
                      senderLabel={replyToSenderLabel}
                      onJump={onJumpToMessage}
                    />
                  </div>
                ) : null}
                <ChatFileAttachment workspaceId={workspaceId} roomId={roomId} message={message} isOwn={isOwn} />
                <div className={cn(edgeToEdge ? "px-2 pb-0.5" : undefined)}>
                  <ChatMessageMeta message={message} isOwn={isOwn} showTime />
                </div>
              </div>
              <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />
              <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} />
              <MessageTaskCard
                workspaceId={workspaceId}
                messageId={message.id}
                className={cn(isOwn && "items-end self-end")}
              />
            </div>
            <ChatMessageHoverActions
              message={message}
              isOwn={isOwn}
              onReply={onReply}
              onReact={onReact}
              onToggleReaction={onToggleReaction}
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
      </div>
    </article>
  );
}

/** One file message. Memoised like the text row. */
export const ChatFileMessageRow = memo(ChatFileMessageRowImpl);
