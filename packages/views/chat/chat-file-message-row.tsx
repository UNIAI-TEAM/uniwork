"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { loadChatFileBlob } from "@uniwork/core/api/endpoints/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { ChatReplyQuote } from "./chat-reply-quote";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageContentType(contentType: string | undefined): boolean {
  return Boolean(contentType?.startsWith("image/"));
}

export function ChatFileMessageRow({
  workspaceId,
  roomId,
  message,
  senderLabel,
  isOwn,
  showSenderName,
  compactTop,
  showAvatar,
  replyToMessage,
  onReply,
  onReact,
  onThread,
  onPin,
  onCopy,
  onDelete,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  senderLabel: string;
  isOwn: boolean;
  showSenderName: boolean;
  compactTop: boolean;
  showAvatar: boolean;
  replyToMessage?: ChatMessage;
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onThread?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
}) {
  const { t } = useTranslation();
  const file = message.file;
  const isImage = isImageContentType(file?.content_type);
  const reactionEntries = Object.entries(message.reactions);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    isImage ? "loading" : "idle",
  );
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isImage || !file) {
      setPreviewStatus("idle");
      return;
    }
    let cancelled = false;
    setPreviewStatus("loading");
    void loadChatFileBlob(workspaceId, roomId, message.id)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setPreviewStatus("error");
      });
    return () => {
      cancelled = true;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [file, isImage, message.id, roomId, workspaceId]);

  const download = async () => {
    if (busy || !file) return;
    setBusy(true);
    try {
      const blob =
        previewUrl && isImage
          ? await fetch(previewUrl).then((res) => res.blob())
          : await loadChatFileBlob(workspaceId, roomId, message.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename || "file";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("chat.file_download_failed"));
    } finally {
      setBusy(false);
    }
  };

  const openPreview = () => {
    if (!previewUrl) return;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <article
      id={`chat-msg-${message.id}`}
      className={cn(
        "flex w-full max-w-full",
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "pt-0.5" : "pt-3",
      )}
    >
      <div className={cn("flex max-w-[min(100%,24rem)] gap-2", isOwn && "flex-row-reverse")}>
        {showAvatar && !isOwn ? (
          <ActorAvatar
            name={senderLabel}
            initials={senderLabel.trim().slice(0, 1).toUpperCase() || "?"}
            className="mt-0.5 size-8 shrink-0"
          />
        ) : (
          <span className="size-8 shrink-0" aria-hidden />
        )}
        <div
          className={cn(
            "group relative min-w-0",
            isOwn ? "items-end" : "items-start",
          )}
        >
          <ChatMessageHoverActions
            message={message}
            isOwn={isOwn}
            onReply={onReply}
            onReact={onReact}
            onThread={onThread}
            onPin={onPin}
            onCopy={onCopy}
            onDelete={onDelete}
            canEdit={false}
          />
          {showSenderName && !isOwn ? (
            <p className="mb-1 px-1 text-caption font-medium text-brand">{senderLabel}</p>
          ) : null}
          <div
            className={cn(
              "overflow-hidden rounded-2xl border shadow-sm",
              isOwn ? "border-brand/30 bg-brand/10" : "border-border bg-surface",
              !isImage && "px-3 py-2",
            )}
          >
            {replyToMessage ? (
              <div className={cn(isImage ? "px-2 pt-2" : undefined)}>
                <ChatReplyQuote
                  message={replyToMessage}
                  workspaceId={workspaceId}
                  roomId={roomId}
                  isOwn={isOwn}
                />
              </div>
            ) : null}
            {isImage ? (
              previewStatus === "ready" && previewUrl ? (
                <button
                  type="button"
                  className="block max-w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("chat.file_open")}
                  onClick={openPreview}
                >
                  {/* Authenticated blob URL — not a public CDN asset. */}
                  <img
                    src={previewUrl}
                    alt={file?.filename || t("chat.file_untitled")}
                    className="max-h-80 max-w-full object-contain"
                  />
                </button>
              ) : (
                <div className="flex min-h-40 min-w-48 items-center justify-center px-4 py-8">
                  {previewStatus === "error" ? (
                    <p className="text-center text-caption text-muted-foreground">
                      {t("chat.file_download_failed")}
                    </p>
                  ) : (
                    <LoaderCircle
                      className="size-5 animate-spin text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </div>
              )
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <FileText className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">
                    {file?.filename || t("chat.file_untitled")}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {formatBytes(file?.size_bytes ?? 0)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9 shrink-0"
                  disabled={busy}
                  aria-label={t("chat.file_download")}
                  onClick={() => void download()}
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="size-4" aria-hidden />
                  )}
                </Button>
              </div>
            )}
          </div>
          {reactionEntries.length > 0 ? (
            <div className={cn("mt-1 flex flex-wrap gap-1 px-0.5", isOwn && "justify-end")}>
              {reactionEntries.map(([emoji, count]) => (
                <span
                  key={emoji}
                  className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-caption shadow-sm"
                >
                  <span aria-hidden>{emoji}</span>
                  {count > 1 ? <span className="text-muted-foreground">{count}</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          {(message.replyCount ?? 0) > 0 && onThread && !message.threadRootId ? (
            <button
              type="button"
              className={cn(
                "mt-1 px-1 text-left text-caption font-medium text-brand hover:underline",
                isOwn && "self-end",
              )}
              onClick={() => onThread(message)}
            >
              {message.threadUnread
                ? t("chat.thread_replies_unread", { count: message.replyCount })
                : t("chat.thread_replies", { count: message.replyCount })}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
