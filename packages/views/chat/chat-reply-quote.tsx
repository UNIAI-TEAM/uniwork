"use client";

import { FileText, ImageIcon, Reply, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { describeChatMediaBody, type ChatMediaLabels } from "./chat-expression-utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { useChatFileObjectUrl } from "./use-chat-file-object-url";

function isImageFileMessage(message: ChatMessage): boolean {
  return message.kind === "file" && Boolean(message.file?.content_type?.startsWith("image/"));
}

/**
 * The quote's thumbnail. There is no thumbnail endpoint, so this is the full
 * image — but read from the same cache the file row fills, so quoting an
 * image already on screen costs no second download.
 */
function useQuotedImageUrl(workspaceId: string, roomId: string, message: ChatMessage): string | null {
  return useChatFileObjectUrl(workspaceId, roomId, message.id, isImageFileMessage(message)).url;
}

export function replyPreviewLabel(
  message: ChatMessage,
  labels: { voice: string; file: string; media?: ChatMediaLabels },
): string {
  if (message.kind === "voice") return labels.voice;
  if (message.kind === "file") {
    return message.file?.filename?.trim() || message.body.trim() || labels.file;
  }
  const media = labels.media ? describeChatMediaBody(message.body, labels.media) : null;
  return media ?? deserializeMessageBodyToComposerDraft(message.body).trim();
}

export function ChatReplyQuote({
  message,
  workspaceId,
  roomId,
  isOwn: _isOwn = false,
  compact = false,
  onJump,
}: {
  message: ChatMessage;
  workspaceId: string;
  roomId: string;
  isOwn?: boolean;
  /** Composer banner uses a lighter layout. */
  compact?: boolean;
  /** Scrolls to the quoted message; the quote becomes a button when set. */
  onJump?: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const previewUrl = useQuotedImageUrl(workspaceId, roomId, message);
  const isImage = isImageFileMessage(message);
  const label = replyPreviewLabel(message, {
    voice: t("chat.voice_message"),
    file: t("chat.file_untitled"),
    media: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") },
  });

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {isImage ? (
          <span className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border">
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

  // Both bubbles are pale washes, so one quote style serves mine and theirs:
  // an inset of the page surface inside the bubble, led by a reply glyph —
  // a quote reads as "set into" the message rather than a coloured side rule.
  const content = (
    <>
      <Reply aria-hidden className="size-3.5 shrink-0 text-brand-subtle-foreground" />
      {isImage ? (
        <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-surface ring-1 ring-border">
          {previewUrl ? (
            <img src={previewUrl} alt={label} className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-4" aria-hidden />
            </span>
          )}
        </span>
      ) : message.kind === "file" ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground">
          <FileText className="size-3.5" aria-hidden />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-caption">{label}</span>
    </>
  );
  const quoteClass =
    "mb-1.5 flex w-full min-w-0 items-center gap-2 rounded-lg bg-surface px-2 py-1 text-left text-muted-foreground";
  if (onJump) {
    return (
      <button
        type="button"
        className={cn(quoteClass, "transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground")}
        aria-label={t("chat.reply_quote_jump", { preview: label })}
        onClick={() => onJump(message.id)}
      >
        {content}
      </button>
    );
  }
  return <div className={quoteClass}>{content}</div>;
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
    <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-4 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <Reply aria-hidden className="size-4 shrink-0 text-brand-subtle-foreground" />
        <ChatReplyQuote message={message} workspaceId={workspaceId} roomId={roomId} compact />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t("chat.cancel_reply")}
        title={t("chat.cancel_reply")}
        onClick={onCancel}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
