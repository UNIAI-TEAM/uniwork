"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { loadChatFileBlob } from "@uniwork/core/api/endpoints/chat";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";

function isImageFileMessage(message: ChatMessage): boolean {
  return message.kind === "file" && Boolean(message.file?.content_type?.startsWith("image/"));
}

function useChatImagePreviewUrl(
  workspaceId: string,
  roomId: string,
  message: ChatMessage | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const enabled = Boolean(message && isImageFileMessage(message));

  useEffect(() => {
    if (!enabled || !message) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void loadChatFileBlob(workspaceId, roomId, message.id)
      .then((blob) => {
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [enabled, message, message?.id, roomId, workspaceId]);

  return url;
}

export function replyPreviewLabel(
  message: ChatMessage,
  labels: { voice: string; file: string },
): string {
  if (message.kind === "voice") return labels.voice;
  if (message.kind === "file") {
    return message.file?.filename?.trim() || message.body.trim() || labels.file;
  }
  return message.body.trim();
}

export function ChatReplyQuote({
  message,
  workspaceId,
  roomId,
  isOwn = false,
  compact = false,
}: {
  message: ChatMessage;
  workspaceId: string;
  roomId: string;
  isOwn?: boolean;
  /** Composer banner uses a lighter layout. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const previewUrl = useChatImagePreviewUrl(workspaceId, roomId, message);
  const isImage = isImageFileMessage(message);
  const label = replyPreviewLabel(message, {
    voice: t("chat.voice_message"),
    file: t("chat.file_untitled"),
  });

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {isImage ? (
          <span className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/60">
            {previewUrl ? (
              <img src={previewUrl} alt={label} className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground">
                <ImageIcon className="size-4" aria-hidden />
              </span>
            )}
          </span>
        ) : null}
        <p className="min-w-0 truncate text-caption text-muted-foreground">
          {t("chat.replying_to", { preview: label })}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-1.5 flex min-w-0 items-center gap-2 border-l-2 pl-2",
        isOwn
          ? "border-brand-foreground/40 text-brand-foreground/85"
          : "border-brand/40 text-muted-foreground",
      )}
    >
      {isImage ? (
        <span
          className={cn(
            "relative size-10 shrink-0 overflow-hidden rounded-md ring-1",
            isOwn ? "bg-brand-foreground/15 ring-brand-foreground/25" : "bg-muted ring-border/60",
          )}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={label} className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center opacity-70">
              <ImageIcon className="size-4" aria-hidden />
            </span>
          )}
        </span>
      ) : message.kind === "file" ? (
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            isOwn ? "bg-brand-foreground/15" : "bg-muted",
          )}
        >
          <FileText className="size-3.5" aria-hidden />
        </span>
      ) : null}
      <p className="min-w-0 flex-1 truncate text-caption">{label}</p>
    </div>
  );
}

export function ChatReplyComposerBar({
  message,
  workspaceId,
  roomId,
  onCancel,
}: {
  message: ChatMessage;
  workspaceId: string;
  roomId: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-surface/90 px-4 py-2 backdrop-blur-sm">
      <ChatReplyQuote message={message} workspaceId={workspaceId} roomId={roomId} compact />
      <button
        type="button"
        className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:underline"
        onClick={onCancel}
      >
        {t("chat.cancel_reply")}
      </button>
    </div>
  );
}
