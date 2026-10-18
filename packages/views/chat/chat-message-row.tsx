"use client";

import { memo } from "react";
import { Bell, ChevronRight, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageBody } from "./chat-message-body";
import { ChatFailedSendBar } from "./chat-failed-send-bar";
import { isChatMediaMessageBody } from "./chat-expression-utils";
import { ChatMessageHoverActions, chatMessageActionsRailClass } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import { useChatMessageLinksFor } from "./chat-message-links-context";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { senderNameClass } from "./sender-colors";
import { useMessageActionsReveal } from "./use-message-actions-reveal";

/**
 * Fixed gutter matching the 34px avatar — keeps grouped bubbles aligned. The
 * avatar closes a run, at the foot of its last bubble; the name opens it.
 */
const INCOMING_AVATAR_SLOT_CLASS = "w-8.5 shrink-0 self-end";

/**
 * The two bubble fills. Mine is the brand fill with its own text colour (the
 * body, links and meta all read it); theirs is the raised white bubble with
 * a hairline shadow on the chat wall.
 */
export const CHAT_BUBBLE_OWN = "bg-chat-bubble-own text-chat-bubble-own-foreground";
export const CHAT_BUBBLE_OTHER = "bg-chat-bubble-other text-foreground shadow-chat-bubble";

/**
 * A soft fill, its hover and a hairline for controls inside their bubble, a
 * card or the composer field. In dark, --muted, --surface-hover and the
 * bubble are one grey (and --border all but vanishes on it), so there they
 * lift with a little ink instead.
 */
export const CHAT_ON_BUBBLE_FILL = "bg-muted dark:bg-foreground/8";
export const CHAT_ON_BUBBLE_HOVER = "hover:bg-surface-hover dark:hover:bg-foreground/12";
export const CHAT_ON_BUBBLE_LINE = "border-border dark:border-foreground/12";

/**
 * A bubble's corners by its place in the run: 18 everywhere except the
 * sender's side, where bubbles of one run join at 6 and the run's last one
 * ends in a 4 tail corner (canvas).
 */
export function chatBubbleShape(isOwn: boolean, firstOfRun: boolean, lastOfRun = true): string {
  if (isOwn) return cn("rounded-[18px]", !firstOfRun && "rounded-tr-sm", lastOfRun ? "rounded-br-[4px]" : "rounded-br-sm");
  return cn("rounded-[18px]", !firstOfRun && "rounded-tl-sm", lastOfRun ? "rounded-bl-[4px]" : "rounded-bl-sm");
}

/**
 * The hovered message's row lifts in a soft wash a little wider than the row
 * (canvas), drawn behind it so nothing moves.
 */
export const CHAT_ROW_HOVER =
  "relative isolate before:pointer-events-none before:absolute before:-inset-x-2 before:-inset-y-1.5 before:-z-10 before:rounded-2xl before:transition-colors before:duration-(--duration-fast) before:content-[''] hover:before:bg-chat-bubble-other/40";

/** Important is a warning, urgent is a danger — never the same red. A pill at the bubble's top. */
export function ChatPriorityFlag({ priority }: { priority: ChatMessage["priority"] }) {
  const { t } = useTranslation();
  if (priority !== "important" && priority !== "urgent") return null;
  const urgent = priority === "urgent";
  return (
    <span
      className={cn(
        "inline-flex h-5.5 w-fit items-center gap-1 rounded-full px-2 text-caption font-semibold",
        urgent
          ? "bg-destructive-soft text-destructive-soft-foreground"
          : "bg-warning-soft text-warning-soft-foreground",
      )}
    >
      {urgent ? <Bell className="size-3 shrink-0" aria-hidden /> : <CircleAlert className="size-3 shrink-0" aria-hidden />}
      {urgent ? t("chat.message_flag_urgent") : t("chat.message_flag_important")}
    </span>
  );
}

/**
 * "4 trả lời · chưa đọc" under a thread root: a raised white pill on the wall,
 * a brand dot after the words while there is something unread (else when the
 * last reply came), and a chevron (canvas). It opens the thread.
 */
export function ChatThreadRepliesLink({
  message,
  isOwn,
  onThread,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onThread?: (message: ChatMessage) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!((message.replyCount ?? 0) > 0 && onThread && !message.threadRootId)) return null;
  return (
    <button
      type="button"
      className={cn(
        "mt-1 inline-flex h-8.5 w-fit items-center gap-2 rounded-full bg-chat-bubble-other pr-2.5 pl-3 shadow-chat-bubble transition-colors duration-(--duration-fast)",
        CHAT_ON_BUBBLE_HOVER,
        isOwn && "self-end",
      )}
      onClick={() => onThread(message)}
    >
      <span className="text-label font-semibold text-brand">
        {message.threadUnread
          ? t("chat.thread_replies_unread", { count: message.replyCount })
          : t("chat.thread_replies", { count: message.replyCount })}
      </span>
      {message.threadUnread ? (
        <span aria-hidden className="size-2 rounded-full bg-brand" />
      ) : message.lastReplyAt ? (
        <time
          dateTime={new Date(message.lastReplyAt).toISOString()}
          aria-hidden
          className="text-caption text-muted-foreground tabular-nums"
        >
          {formatMessageTime(message.lastReplyAt, i18n.language)}
        </time>
      ) : null}
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </button>
  );
}

type ChatMessageRowProps = {
  message: ChatMessage;
  senderLabel: string;
  isOwn: boolean;
  showReadReceipt: boolean;
  replyToMessage?: ChatMessage;
  /** Who wrote the quoted message, named inside the quote. */
  replyToSenderLabel?: string;
  workspaceId?: string;
  roomId?: string;
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
  showSenderName?: boolean;
  compactTop?: boolean;
  /** First message of a run: it carries the sender's name. */
  showAvatar?: boolean;
  senderAvatarUrl?: string;
  /** The next message starts a new run (other sender or a pause): print the time and the avatar here. */
  lastOfRun?: boolean;
  highlighted?: boolean;
  nameContext?: ChatNameContextEntry[];
};

const EMPTY_NAME_CONTEXT: ChatNameContextEntry[] = [];

function ChatMessageRowImpl({
  message,
  senderLabel,
  isOwn,
  showReadReceipt,
  replyToMessage,
  replyToSenderLabel,
  workspaceId,
  roomId,
  onReply,
  onReact,
  onToggleReaction,
  onJumpToMessage,
  onThread,
  onEdit,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
  showSenderName = false,
  compactTop = false,
  showAvatar = true,
  senderAvatarUrl,
  lastOfRun = true,
  highlighted = false,
  nameContext = EMPTY_NAME_CONTEXT,
}: ChatMessageRowProps) {
  const { i18n } = useTranslation();
  const reveal = useMessageActionsReveal();
  const nameClass = senderNameClass(message.sender, isOwn);
  // Sending, queued or failed: not on the server yet, so nothing to act on.
  const isPending = Boolean(message.deliveryStatus);
  // A sticker or GIF is not text: there is nothing to edit in it.
  const isMedia = isChatMediaMessageBody(message.body);
  const canEdit = isOwn && !isPending && message.kind !== "voice_call_log" && !message.voiceCall && !isMedia;
  // A sticker, GIF or image is the message itself: no bubble behind it, its
  // time on a chip under it — unless it answers another message.
  const bare = isMedia && !replyToMessage;
  // Their name opens the first bubble of a run in a group, in their colour.
  const showName = !isOwn && showSenderName && showAvatar;
  const urgent = message.priority === "urgent";
  // A task made from this message follows it as one more bubble of the run,
  // and the run's time moves down onto it; a linked one is a line under the
  // bubble, which keeps its time (canvas).
  const { links } = useChatMessageLinksFor(message.id);
  const taskLinks = taskLinksOf(links);
  const hasTasks = !isPending && Boolean(workspaceId) && taskLinks.length > 0;
  const taskCard = hasTasks && taskLinks.some((link) => link.relation === "created_from");
  const meta = (
    <ChatMessageMeta
      message={message}
      isOwn={isOwn}
      showTime={lastOfRun}
      showReadReceipt={showReadReceipt}
      onWall={bare}
      inline={bare ? undefined : "float"}
    />
  );

  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      // Focus lands here after a delete or a jump, never by Tab.
      tabIndex={-1}
      data-highlighted={highlighted || undefined}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors duration-(--duration-standard) focus-visible:outline-offset-2",
        CHAT_ROW_HOVER,
        compactTop ? "mt-0.5" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
        // The thread open beside the timeline, or a jump's target: the row's wash in the brand (canvas).
        highlighted && "before:bg-brand-subtle before:ring-1 before:ring-brand/25 hover:before:bg-brand-subtle",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      {!isOwn ? (
        <div className={INCOMING_AVATAR_SLOT_CLASS}>
          {lastOfRun ? (
            <ChatSenderAvatar
              userId={message.sender}
              name={senderLabel}
              avatarUrl={senderAvatarUrl}
              nameContext={nameContext}
            />
          ) : null}
        </div>
      ) : null}

      {/* Long press opens the actions on touch; the copy callout is off there
          because "Sao chép" lives in that same bar. */}
      <div
        ref={reveal.rootRef}
        {...reveal.bind}
        className={cn(
          "group/message relative flex min-w-0 max-w-[85%] flex-col gap-0.5 sm:max-w-[72%] pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
          isOwn ? "items-end" : "items-start",
        )}
      >
        {bare && showName ? (
          <p className={cn("px-1 text-label font-semibold", nameClass)} aria-hidden>
            {senderLabel}
          </p>
        ) : null}

        <div className={chatMessageActionsRailClass(isOwn)}>
          <div className={cn("flex min-w-0 flex-col gap-0.5", isOwn ? "items-end" : "items-start")}>
            {bare ? <ChatPriorityFlag priority={message.priority} /> : null}

            <div
              title={formatMessageDateTime(message.ts, i18n.language)}
              className={cn(
                "w-fit max-w-full",
                !bare &&
                  cn(
                    "px-3 pt-[7px] pb-2",
                    chatBubbleShape(isOwn, !compactTop, lastOfRun && !taskCard),
                    isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
                    urgent && "ring-1 ring-destructive/30",
                  ),
              )}
            >
              {!bare && (showName || message.priority === "important" || urgent) ? (
                <div className="mb-px flex flex-wrap items-center gap-2">
                  {showName ? (
                    <span className={cn("text-label font-semibold", nameClass)} aria-hidden>
                      {senderLabel}
                    </span>
                  ) : null}
                  <ChatPriorityFlag priority={message.priority} />
                </div>
              ) : null}

              {replyToMessage ? (
                <ChatReplyQuote
                  message={replyToMessage}
                  isOwn={isOwn}
                  senderLabel={replyToSenderLabel}
                  onJump={onJumpToMessage}
                />
              ) : null}

              <ChatMessageBody
                body={message.body}
                isOwn={isOwn}
                nameContext={nameContext}
                trailing={bare || taskCard ? null : meta}
              />
            </div>

            {bare && !taskCard ? meta : null}

            {hasTasks && workspaceId ? (
              <MessageTaskCard
                workspaceId={workspaceId}
                messageId={message.id}
                isOwn={isOwn}
                meta={
                  <ChatMessageMeta
                    message={message}
                    isOwn={false}
                    showTime={lastOfRun}
                    showReadReceipt={showReadReceipt}
                    inline="end"
                  />
                }
              />
            ) : null}

            {message.deliveryStatus === "failed" && workspaceId ? (
              <ChatFailedSendBar workspaceId={workspaceId} message={message} />
            ) : null}

            <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} onReact={onReact} />

            <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} />

          </div>
        </div>

        {!isPending ? (
          <ChatMessageHoverActions
            message={message}
            isOwn={isOwn}
            onReply={onReply}
            onReact={onReact}
            onToggleReaction={onToggleReaction}
            onThread={onThread}
            onEdit={onEdit}
            onPin={onPin}
            onCopy={onCopy}
            onDelete={onDelete}
            onCreateTask={onCreateTask}
            onLinkTask={onLinkTask}
            onFollowUp={onFollowUp}
            canEdit={canEdit}
            forceOpen={reveal.open}
          />
        ) : null}
      </div>
    </article>
  );
}

/** One text message. Memoised: the timeline re-renders often, a row rarely changes. */
export const ChatMessageRow = memo(ChatMessageRowImpl);
