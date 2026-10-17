"use client";

import { memo } from "react";
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
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, ChatThreadRepliesLink, chatBubbleShape } from "./chat-message-row";
import { useFreshChatMediaUrl } from "./use-chat-media-url";
import { senderNameClass } from "./sender-colors";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import { useMessageActionsReveal } from "./use-message-actions-reveal";

/** A fixed sound-wave silhouette: decoration, not the recording's real levels (percent heights). */
const WAVE_BARS = [30, 50, 75, 45, 90, 65, 100, 60, 40, 80, 100, 50, 30, 65, 90, 45, 75, 100, 60, 40, 50, 80, 65, 30, 45, 90, 75, 50, 100, 60, 40, 65];

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
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  isOwn: boolean;
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
      <div className="flex items-center gap-3">
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
            <Play className="size-4 fill-current" aria-hidden />
          )}
        </Button>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">{t("chat.voice_message")}</span>
          <span aria-hidden className="flex h-7 items-center justify-between gap-0.5">
            {WAVE_BARS.map((height, index) => (
              <span
                key={index}
                className={cn(
                  "w-0.75 shrink-0 rounded-full",
                  index / WAVE_BARS.length < played
                    ? isOwn
                      ? "bg-chat-bubble-own-foreground"
                      : "bg-brand"
                    : isOwn
                      ? "bg-chat-bubble-own-foreground/45"
                      : "bg-faint-foreground/50",
                )}
                style={{ height: `${height}%` }}
              />
            ))}
          </span>
          <span className={cn("text-caption tabular-nums", isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground")}>
            {active ? `${formatDuration(positionMs)} / ${formatDuration(durationMs)}` : formatDuration(durationMs)}
          </span>
        </span>
      </div>
      {active && durationMs > 0 ? (
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
          className={cn(
            "h-1.5 w-full cursor-pointer pointer-coarse:h-6",
            isOwn ? "accent-chat-bubble-own-foreground" : "accent-brand",
          )}
        />
      ) : null}
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
}) {
  const reveal = useMessageActionsReveal();

  return (
    <article
      id={`chat-msg-${message.id}`}
      aria-labelledby={chatMessageLabelId(message.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg focus-visible:outline-offset-2",
        compactTop ? "mt-0.5" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      {!isOwn ? (
        <div className="w-8 shrink-0">
          {showAvatar ? (
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
          "group/message relative flex max-w-[min(85%,22rem)] flex-col gap-1 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
          isOwn ? "items-end" : "items-start",
        )}
      >
        <div className={chatMessageActionsRailClass(isOwn)}>
          <div className="flex min-w-0 flex-col gap-1">
            <div
              className={cn(
                "w-72 max-w-full px-3 py-2",
                chatBubbleShape(isOwn, !compactTop),
                isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
              )}
            >
              {!isOwn && showSenderName && showAvatar ? (
                <p className={cn("mb-1 text-label font-semibold", senderNameClass(message.sender, isOwn))} aria-hidden>
                  {senderLabel}
                </p>
              ) : null}
              <VoicePlayer workspaceId={workspaceId} roomId={roomId} message={message} isOwn={isOwn} />
              <ChatMessageMeta message={message} isOwn={isOwn} showTime />
            </div>
            <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />
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
