"use client";

import { memo, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useTranslation } from "react-i18next";
import {
  seekChatVoicePlayback,
  toggleChatVoicePlayback,
  useChatVoicePlaybackStore,
} from "@uniwork/core/chat/voice-playback-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageHoverActions, chatMessageActionsRailClass } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, CHAT_ROW_HOVER, chatBubbleShape, ChatThreadRepliesLink } from "./chat-message-row";
import { useFreshChatMediaUrl } from "./use-chat-media-url";
import { senderNameClass } from "./sender-colors";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import { useMessageActionsReveal } from "./use-message-actions-reveal";
import { taskLinksOf } from "@uniwork/core/chat/message-links";
import { useChatMessageLinksFor } from "./chat-message-links-context";
import { MessageTaskCard } from "./message-task-card";

/** A fixed sound-wave silhouette (the canvas's own): decoration, not the recording's real levels, in px. */
const WAVE_BARS = [8, 14, 20, 12, 24, 18, 26, 16, 10, 22, 26, 14, 8, 18, 24, 12, 20, 26, 16, 10, 14, 22, 18, 8, 12, 24, 20, 14, 26, 16, 10, 18, 12, 8, 14, 10];

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.ceil(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Play, pause and seek one voice message. The player itself is shared
 * (voice-playback-store): this control only reads its state for this message,
 * so scrolling the row away does not stop the sound and starting another
 * message pauses this one.
 */
function VoicePlayer({
  workspaceId,
  roomId,
  message,
  isOwn,
  meta,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  isOwn: boolean;
  /** The time and delivery state, at the end of the duration line. */
  meta: ReactNode;
}) {
  const { t } = useTranslation();
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  // The audio streams straight from storage through the signed URL.
  const resolveUrl = () =>
    freshUrl(message.id, { url: message.voice?.url, expiresAt: message.voice?.url_expires_at }, (fresh) => fresh.voice?.url);
  const status = useChatVoicePlaybackStore((s) => (s.activeId === message.id ? s.status : "idle"));
  const positionMs = useChatVoicePlaybackStore((s) => (s.activeId === message.id ? s.positionMs : 0));
  const mediaDurationMs = useChatVoicePlaybackStore((s) => (s.activeId === message.id ? s.durationMs : 0));
  const durationMs = message.voice?.duration_ms || mediaDurationMs;
  const playing = status === "playing";
  const active = status === "playing" || status === "paused";
  const played = active && durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          size="icon"
          className={cn(
            "size-11 shrink-0 rounded-full",
            // On my brand bubble the button inverts so it does not vanish into it.
            isOwn && "bg-chat-bubble-own-foreground text-chat-bubble-own hover:bg-chat-bubble-own-foreground/90",
          )}
          aria-label={playing ? t("chat.voice_pause") : t("chat.voice_play")}
          aria-busy={status === "loading" || undefined}
          onClick={() => void toggleChatVoicePlayback(message.id, resolveUrl)}
        >
          {status === "loading" ? (
            <Spinner />
          ) : playing ? (
            <Pause className="size-4 fill-current" aria-hidden />
          ) : (
            <Play className="size-4.5 fill-current" aria-hidden />
          )}
        </Button>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">{t("chat.voice_message")}</span>
          {/* The wave is the seek bar: an invisible range over it, a dot at the playhead (canvas). */}
          <span className="relative flex h-6.5 items-center gap-0.5 rounded-sm has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring">
            {WAVE_BARS.map((height, index) => (
              <span
                key={index}
                aria-hidden
                className={cn(
                  "max-w-0.75 flex-1 rounded-xs",
                  index / WAVE_BARS.length < played
                    ? isOwn
                      ? "bg-chat-bubble-own-foreground"
                      : "bg-brand"
                    : isOwn
                      ? "bg-chat-bubble-own-foreground/45"
                      : "bg-faint-foreground/50",
                )}
                style={{ height }}
              />
            ))}
            {active && durationMs > 0 ? (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 -mt-1.5 -ml-1.5 size-3 rounded-full ring-2",
                    isOwn ? "bg-chat-bubble-own-foreground ring-chat-bubble-own" : "bg-brand ring-chat-bubble-other",
                  )}
                  style={{ left: `${played * 100}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={durationMs}
                  step={100}
                  value={Math.min(positionMs, durationMs)}
                  aria-label={t("chat.message_list.voice_seek")}
                  aria-valuetext={t("chat.message_list.voice_position", {
                    position: formatDuration(positionMs),
                    duration: formatDuration(durationMs),
                  })}
                  onChange={(event) => seekChatVoicePlayback(message.id, Number(event.target.value))}
                  className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                />
              </>
            ) : null}
          </span>
          <span className={cn("flex items-center gap-2 text-caption tabular-nums", isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground")}>
            {active ? `${formatDuration(positionMs)} / ${formatDuration(durationMs)}` : formatDuration(durationMs)}
            {meta}
          </span>
        </span>
      </div>
      {status === "error" ? (
        <p className={cn("text-caption", !isOwn && "text-destructive")} role="alert">
          {t("chat.voice_load_failed")}
        </p>
      ) : null}
    </div>
  );
}

function ChatVoiceMessageRowImpl({
  workspaceId,
  roomId,
  message,
  senderLabel,
  senderAvatarUrl,
  isOwn,
  showSenderName,
  compactTop,
  showAvatar,
  lastOfRun = true,
  nameContext = [],
  onReply,
  onReact,
  onToggleReaction,
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
  /** First message of a run: it carries the sender's name. */
  showAvatar: boolean;
  /** Last message of a run: it carries the avatar and the tail corner. */
  lastOfRun?: boolean;
  nameContext?: ChatNameContextEntry[];
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
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
  // A task made from this message follows it as one more bubble of the run (canvas).
  const { links } = useChatMessageLinksFor(message.id);
  const taskLinks = taskLinksOf(links);
  const hasTasks = !message.deliveryStatus && taskLinks.length > 0;
  // Made from it: the card carries the time; linked: a line under a bubble that keeps it (canvas).
  const taskCard = hasTasks && taskLinks.some((link) => link.relation === "created_from");

  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors duration-(--duration-standard) focus-visible:outline-offset-2",
        CHAT_ROW_HOVER,
        compactTop ? "mt-0.5" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
        // A deep link jumped here: the row's brand wash, as the text row's (canvas).
        highlighted && "before:bg-brand-subtle before:ring-1 before:ring-brand/25 hover:before:bg-brand-subtle",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      {!isOwn ? (
        <div className="w-8.5 shrink-0 self-end">
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
      <div
        ref={reveal.rootRef}
        {...reveal.bind}
        className={cn(
          "group/message relative flex max-w-[85%] flex-col gap-1 sm:max-w-[72%] pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
          isOwn ? "items-end" : "items-start",
        )}
      >
        <div className={chatMessageActionsRailClass(isOwn)}>
          <div className={cn("flex min-w-0 flex-col gap-0.5", isOwn ? "items-end" : "items-start")}>
            <div
              className={cn(
                "w-85 max-w-full px-3 pt-[7px] pb-2",
                chatBubbleShape(isOwn, !compactTop, lastOfRun && !taskCard),
                isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
              )}
            >
              {!isOwn && showSenderName && showAvatar ? (
                <p className={cn("mb-1 text-label font-semibold", senderNameClass(message.sender, isOwn))} aria-hidden>
                  {senderLabel}
                </p>
              ) : null}
              <VoicePlayer
                workspaceId={workspaceId}
                roomId={roomId}
                message={message}
                isOwn={isOwn}
                meta={taskCard ? null : <ChatMessageMeta message={message} isOwn={isOwn} showTime={lastOfRun} inline="end" />}
              />
            </div>
            {hasTasks ? (
              <MessageTaskCard
                workspaceId={workspaceId}
                messageId={message.id}
                isOwn={isOwn}
                meta={<ChatMessageMeta message={message} isOwn={false} showTime={lastOfRun} inline="end" />}
              />
            ) : null}
            <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} onReact={onReact} />
            <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} />
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
    </article>
  );
}

/** One voice message, with the same actions a file message has. */
export const ChatVoiceMessageRow = memo(ChatVoiceMessageRowImpl);
