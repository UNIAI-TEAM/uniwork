"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { loadChatVoiceBlob } from "@uniwork/core/api/endpoints/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import {
  CHAT_BUBBLE_OTHER,
  CHAT_BUBBLE_OWN,
  ChatMessageMeta,
  chatBubbleShape,
} from "./chat-message-row";
import { initialOf } from "./chat-initials";
import { senderNameClass } from "./sender-colors";

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.ceil(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ChatVoiceMessageRow({
  workspaceId,
  roomId,
  message,
  senderLabel,
  isOwn,
  showSenderName,
  compactTop,
  showAvatar,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  senderLabel: string;
  isOwn: boolean;
  showSenderName: boolean;
  compactTop: boolean;
  showAvatar: boolean;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const togglePlayback = async () => {
    if (status === "loading") return;
    try {
      if (!audioRef.current) {
        setStatus("loading");
        const blob = await loadChatVoiceBlob(workspaceId, roomId, message.id);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audio.onended = () => setStatus("paused");
        audio.onpause = () => setStatus("paused");
        audio.onplay = () => setStatus("playing");
        audio.onerror = () => setStatus("error");
        audioRef.current = audio;
      }
      if (audioRef.current.paused) {
        await audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    } catch {
      setStatus("error");
    }
  };

  const duration = formatDuration(message.voice?.duration_ms ?? 0);

  return (
    <article
      id={`chat-msg-${message.id}`}
      className={cn(
        "flex w-full max-w-full",
        compactTop ? "mt-2" : "mt-4",
        isOwn ? "justify-end" : "justify-start gap-2",
      )}
    >
      {!isOwn ? (
        <div className="w-8 shrink-0">
          {showAvatar ? (
            <ActorAvatar name={senderLabel} initials={initialOf(senderLabel)} size="lg" className="shrink-0" />
          ) : null}
        </div>
      ) : null}
      <div className={cn("flex max-w-[min(85%,22rem)] flex-col gap-1", isOwn ? "items-end" : "items-start")}>
        {!isOwn && showSenderName && showAvatar ? (
          <p className={cn("px-1 text-caption font-semibold", senderNameClass(message.sender, isOwn))}>
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
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              className="shrink-0 rounded-full bg-surface"
              aria-label={status === "playing" ? t("chat.voice_pause") : t("chat.voice_play")}
              onClick={() => void togglePlayback()}
              disabled={status === "loading"}
            >
              {status === "loading" ? (
                <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
              ) : status === "playing" ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
            </Button>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium">{t("chat.voice_message")}</span>
              <span className="block text-caption text-muted-foreground tabular-nums">{duration}</span>
            </span>
          </div>
          <ChatMessageMeta message={message} isOwn={isOwn} showTime />
        </div>
        {status === "error" ? (
          <p className="px-1 text-caption text-destructive" role="alert">
            {t("chat.voice_load_failed")}
          </p>
        ) : null}
      </div>
    </article>
  );
}
