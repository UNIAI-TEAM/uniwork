"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { loadChatVoiceBlob } from "@uniwork/core/api/endpoints/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";

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
        compactTop ? "mt-1" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
      )}
    >
      {!isOwn ? (
        <div className="flex w-8 shrink-0 flex-col justify-end self-stretch">
          {showAvatar ? (
            <ActorAvatar
              name={senderLabel}
              initials={senderLabel.trim().slice(0, 1).toUpperCase() || "?"}
              size="sm"
              className="mx-auto shrink-0"
            />
          ) : null}
        </div>
      ) : null}
      <div className={cn("flex max-w-[20rem] flex-col gap-1", isOwn ? "items-end" : "items-start")}>
        {!isOwn && showSenderName && showAvatar ? (
          <p className="px-1 text-caption font-medium text-foreground">{senderLabel}</p>
        ) : null}
        <div
          className={cn(
            "flex min-w-48 items-center gap-3 rounded-[18px] px-3 py-2 shadow-sm",
            isOwn
              ? "rounded-br-[4px] bg-brand text-brand-foreground"
              : "rounded-bl-[4px] bg-surface text-foreground ring-1 ring-border/60",
          )}
        >
          <Button
            type="button"
            size="icon-sm"
            variant={isOwn ? "secondary" : "ghost"}
            className="size-9 shrink-0 rounded-full"
            aria-label={status === "playing" ? t("chat.voice_pause") : t("chat.voice_play")}
            onClick={() => void togglePlayback()}
            disabled={status === "loading"}
          >
            {status === "loading" ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : status === "playing" ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
          </Button>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium">{t("chat.voice_message")}</span>
            <span className={cn("block text-caption", isOwn ? "text-brand-foreground/75" : "text-muted-foreground")}>
              {duration}
            </span>
          </span>
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
