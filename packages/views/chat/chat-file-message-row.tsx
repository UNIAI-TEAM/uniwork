"use client";

import { memo } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatFileAttachment, chatFileIsEdgeToEdge } from "./chat-file-attachment";
import { isChatPdfContentType, resolveChatFileContentType } from "./chat-file-accept";
import { ChatShareAsDocumentAction } from "./chat-share-as-document-action";
import { ChatMessageHoverActions, chatMessageActionsRailClass } from "./chat-message-hover-actions";
import { ChatForwardedLabel } from "./chat-forwarded-label";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import {
  CHAT_BUBBLE_OTHER,
  CHAT_BUBBLE_OWN,
  chatBubbleShape,
  chatRowContentShellClass,
  chatRowHighlightClass,
  ChatThreadRepliesLink,
} from "./chat-message-row";
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
  highlighted = false,
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
  /** A deep link jumped here: ring the row like the text row does. */
  highlighted?: boolean;
}) {
  const reveal = useMessageActionsReveal();
  const edgeToEdge = chatFileIsEdgeToEdge(message.file);
  // A GIF is the message itself, like a sticker: no bubble, its time on a chip
  // under it. A photo keeps a 3px rim and its time on its corner (canvas).
  const contentType = message.file ? resolveChatFileContentType(message.file) : undefined;
  const gif = contentType === "image/gif" && !replyToMessage;
  const pdf = isChatPdfContentType(contentType);
  const photo = edgeToEdge && !gif && !pdf;
  // A file or PDF card carries its time on its own line (canvas); a photo on its corner, a GIF under it.
  const cardMeta = !edgeToEdge || pdf ? <ChatMessageMeta message={message} isOwn={isOwn} showTime inline="end" /> : undefined;

  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors duration-(--duration-standard) focus-visible:outline-offset-2",
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "mt-0.5" : "mt-3",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      <div
        className={cn(
          chatRowContentShellClass(isOwn),
          "max-w-[min(100%,27rem)]",
          chatRowHighlightClass(highlighted),
        )}
      >
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
          <span className="w-8.5 shrink-0" aria-hidden />
        )}
        <div
          ref={reveal.rootRef}
          data-chat-message-id={message.id}
          {...reveal.bind}
          className={cn(
            "group/message relative flex min-w-0 flex-col gap-1 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
            isOwn ? "items-end" : "items-start",
          )}
        >
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
            anchorRef={reveal.rootRef}
          />
          <div
            data-message-actions-anchor
            className={cn(chatMessageActionsRailClass(isOwn), reveal.open && "pointer-events-none")}
          >
            <div className="flex min-w-0 flex-col gap-1">
              {/* Text and cards sit in a bubble; photos and GIFs are edge-to-edge like Telegram. */}
              <div
                className={cn(
                  "max-w-full overflow-hidden",
                  gif && "flex w-fit flex-col gap-1",
                  photo && "relative w-fit max-w-full flex flex-col gap-1",
                  !gif &&
                    !photo &&
                    cn("p-2", chatBubbleShape(isOwn, !compactTop), isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER),
                )}
              >
                {showSenderName && !isOwn && showAvatar ? (
                  <p
                    className={cn(
                      "text-label font-semibold",
                      senderNameClass(message.sender, isOwn),
                      gif ? "px-1" : photo ? "px-2.25 pt-1 pb-1.25" : "mb-1 px-1",
                    )}
                    aria-hidden
                  >
                    {senderLabel}
                  </p>
                ) : null}
                <ChatForwardedLabel message={message} isOwn={isOwn} className={photo ? "px-2.25 pt-1" : "px-1"} />
                {replyToMessage ? (
                  <div className={cn(photo ? "px-1 pt-1" : undefined)}>
                    <ChatReplyQuote
                      message={replyToMessage}
                      isOwn={isOwn}
                      senderLabel={replyToSenderLabel}
                      onJump={onJumpToMessage}
                    />
                  </div>
                ) : null}
                <div
                  className={cn(
                    photo &&
                      cn(
                        "relative overflow-hidden [&>button]:size-full [&>button]:rounded-[inherit]",
                        chatBubbleShape(isOwn, !compactTop, true),
                      ),
                  )}
                >
                  <ChatFileAttachment
                    workspaceId={workspaceId}
                    roomId={roomId}
                    message={message}
                    isOwn={isOwn}
                    sender={{ userId: message.sender, name: senderLabel, avatarUrl: senderAvatarUrl, ts: message.ts }}
                    meta={cardMeta}
                  />
                  {photo ? <ChatMessageMeta message={message} isOwn={isOwn} showTime inline="media" /> : null}
                </div>
                {gif ? <ChatMessageMeta message={message} isOwn={isOwn} showTime onWall /> : null}
                {message.canShareAsDocument ? (
                  <ChatShareAsDocumentAction workspaceId={workspaceId} roomId={roomId} message={message} />
                ) : null}
              </div>
              <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} onReact={onReact} />
              <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} nameContext={nameContext} />
              <MessageTaskCard workspaceId={workspaceId} messageId={message.id} isOwn={isOwn} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/** One file message. Memoised like the text row. */
export const ChatFileMessageRow = memo(ChatFileMessageRowImpl);
