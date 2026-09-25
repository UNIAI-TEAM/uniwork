"use client";

import { memo } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatVoiceBlobLoader } from "@uniwork/core/chat";
import {
  seekChatVoicePlayback,
  toggleChatVoicePlayback,
  useChatVoicePlaybackStore,
} from "@uniwork/core/chat/voice-playback-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, ChatReactionChips, chatMessageLabelId } from "./chat-message-parts";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, ChatThreadRepliesLink, chatBubbleShape } from "./chat-message-row";
import { initialOf } from "./chat-initials";
import { senderNameClass } from "./sender-colors";
import { useMessageActionsReveal } from "./use-message-actions-reveal";

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
function VoicePlayer({ workspaceId, roomId, message }: { workspaceId: string; roomId: string; message: ChatMessage }) {
  const { t } = useTranslation();
  const loadVoice = useChatVoiceBlobLoader(workspaceId, roomId);
  const status = useChatVoicePlaybackStore((s) => (s.activeId === message.id ? s.status : "idle"));
  const positionMs = useChatVoicePlaybackStore((s) => (s.activeId === message.id ? s.positionMs : 0));
  const mediaDurationMs = useChatVoicePlaybackStore((s) => (s.activeId === message.id ? s.durationMs : 0));
  const durationMs = message.voice?.duration_ms || mediaDurationMs;
  const playing = status === "playing";
  const active = status === "playing" || status === "paused";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon-lg"
          variant="outline"
          className="shrink-0 rounded-full bg-surface"
          aria-label={playing ? t("chat.voice_pause") : t("chat.voice_play")}
          aria-busy={status === "loading" || undefined}
          onClick={() => void toggleChatVoicePlayback(message.id, () => loadVoice(message.id))}
        >
          {status === "loading" ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
        </Button>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium">{t("chat.voice_message")}</span>
          <span className="block text-caption text-muted-foreground tabular-nums">
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
          className="h-1.5 w-full cursor-pointer accent-brand pointer-coarse:h-6"
        />
      ) : null}
      {status === "error" ? (
        <p className="text-caption text-destructive" role="alert">
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
        compactTop ? "mt-2" : "mt-4",
        isOwn ? "justify-end" : "justify-start gap-2",
      )}
    >
      <ChatMessageA11yLabel messageId={message.id} senderLabel={senderLabel} ts={message.ts} />
      {!isOwn ? (
        <div className="w-8 shrink-0" aria-hidden>
          {showAvatar ? (
            <ActorAvatar
              name={senderLabel}
              initials={initialOf(senderLabel)}
              avatarUrl={senderAvatarUrl}
              size="lg"
              className="shrink-0"
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
        {!isOwn && showSenderName && showAvatar ? (
          <p className={cn("px-1 text-caption font-semibold", senderNameClass(message.sender, isOwn))} aria-hidden>
            {senderLabel}
          </p>
        ) : null}
        <div
          className={cn(
            "min-w-48 px-3 py-2 text-foreground",
            chatBubbleShape(isOwn, !compactTop),
            isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
          )}
        >
          <VoicePlayer workspaceId={workspaceId} roomId={roomId} message={message} />
          <ChatMessageMeta message={message} isOwn={isOwn} showTime />
        </div>
        <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />
        <ChatThreadRepliesLink message={message} isOwn={isOwn} onThread={onThread} />
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
    </article>
  );
}

/** One voice message, with the same actions a file message has. */
export const ChatVoiceMessageRow = memo(ChatVoiceMessageRowImpl);
