"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { loadChatFileBlob } from "@uniwork/core/api/endpoints/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  isChatImageContentType,
  isChatPdfContentType,
} from "./chat-file-accept";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { ChatReplyQuote } from "./chat-reply-quote";
import { MessageTaskCard } from "./message-task-card";
import {
  CHAT_BUBBLE_OTHER,
  CHAT_BUBBLE_OWN,
  ChatMessageMeta,
  ChatReactionChips,
  chatBubbleShape,
} from "./chat-message-row";
import { initialOf } from "./chat-initials";
import { useMessageActionsReveal } from "./use-message-actions-reveal";
import { senderNameClass } from "./sender-colors";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
  onToggleReaction,
  onThread,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
  workHubEnabled = false,
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
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onThread?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
  workHubEnabled?: boolean;
}) {
  const reveal = useMessageActionsReveal();
  const { t } = useTranslation();
  const file = message.file;
  const isImage = isChatImageContentType(file?.content_type);
  const isPdf = isChatPdfContentType(file?.content_type);
  const loadsInlinePreview = isImage || isPdf;
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    loadsInlinePreview ? "loading" : "idle",
  );
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loadsInlinePreview || !file) {
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
  }, [file, loadsInlinePreview, message.id, roomId, workspaceId]);

  const download = async () => {
    if (busy || !file) return;
    setBusy(true);
    try {
      const blob =
        previewUrl && loadsInlinePreview
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
        compactTop ? "mt-2" : "mt-4",
      )}
    >
      <div className={cn("flex max-w-[min(85%,26rem)] gap-2", isOwn && "flex-row-reverse")}>
        {isOwn ? null : showAvatar ? (
          <ActorAvatar name={senderLabel} initials={initialOf(senderLabel)} size="lg" className="shrink-0" />
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
          <ChatMessageHoverActions
            message={message}
            isOwn={isOwn}
            onReply={onReply}
            onReact={onReact}
            onThread={onThread}
            onPin={onPin}
            onCopy={onCopy}
            onDelete={onDelete}
            onCreateTask={workHubEnabled ? onCreateTask : undefined}
            onLinkTask={workHubEnabled ? onLinkTask : undefined}
            onFollowUp={workHubEnabled ? onFollowUp : undefined}
            canEdit={false}
            forceOpen={reveal.open}
          />
          {showSenderName && !isOwn ? (
            <p className={cn("px-1 text-caption font-semibold", senderNameClass(message.sender, isOwn))}>
              {senderLabel}
            </p>
          ) : null}
          <div
            className={cn(
              "max-w-full overflow-hidden",
              chatBubbleShape(isOwn, !compactTop),
              isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER,
              !isImage && !isPdf && "px-3 py-2",
            )}
          >
            {replyToMessage ? (
              <div className={cn(isImage || isPdf ? "px-2 pt-2" : undefined)}>
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
                  className="block max-w-full overflow-hidden"
                  aria-label={t("chat.file_open")}
                  onClick={openPreview}
                >
                  {/* Authenticated blob URL — not a public CDN asset. */}
                  <img
                    src={previewUrl}
                    alt={file?.filename || t("chat.file_untitled")}
                    className="max-h-56 max-w-full object-contain"
                  />
                </button>
              ) : (
                previewStatus === "error" ? (
                  <div className="flex min-h-40 min-w-48 items-center justify-center px-4 py-8">
                    <p className="text-center text-caption text-muted-foreground">
                      {t("chat.file_download_failed")}
                    </p>
                  </div>
                ) : (
                  <Skeleton className="h-40 w-56 rounded-none" aria-label={t("chat.file_loading")} />
                )
              )
            ) : isPdf ? (
              <div className="space-y-2 p-2">
                <div className="flex items-center gap-3 px-1">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-foreground">
                      {file?.filename || t("chat.file_untitled")}
                    </p>
                    <p className="text-caption text-muted-foreground tabular-nums">
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
                      <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <Download className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
                {previewStatus === "ready" && previewUrl ? (
                  <iframe
                    title={t("chat.file_pdf_preview")}
                    src={previewUrl}
                    className="h-72 w-full rounded-lg border border-border bg-background"
                  />
                ) : previewStatus === "error" ? (
                  <p className="px-1 pb-1 text-caption text-muted-foreground">
                    {t("chat.file_download_failed")}
                  </p>
                ) : (
                  <Skeleton className="h-72 w-full rounded-lg" aria-label={t("chat.file_loading")} />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
                  <FileText className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">
                    {file?.filename || t("chat.file_untitled")}
                  </p>
                  <p className="text-caption text-muted-foreground tabular-nums">
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
                    <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                  ) : (
                    <Download className="size-4" aria-hidden />
                  )}
                </Button>
              </div>
            )}
          </div>
          <div className={cn(isImage || isPdf ? "px-1" : undefined)}>
            <ChatMessageMeta message={message} isOwn={isOwn} showTime />
          </div>
          <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />
          {(message.replyCount ?? 0) > 0 && onThread && !message.threadRootId ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className={cn("h-auto px-1 py-0.5 text-brand-subtle-foreground", isOwn && "self-end")}
              onClick={() => onThread(message)}
            >
              {message.threadUnread
                ? t("chat.thread_replies_unread", { count: message.replyCount })
                : t("chat.thread_replies", { count: message.replyCount })}
            </Button>
          ) : null}
          {workHubEnabled ? (
            <MessageTaskCard
              workspaceId={workspaceId}
              messageId={message.id}
              className={cn(isOwn && "items-end self-end")}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
