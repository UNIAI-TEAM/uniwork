"use client";

import { FileText, ImageIcon, Reply, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { describeChatMediaBody, type ChatMediaLabels } from "./chat-expression-utils";
import { isChatMediaUrlFresh } from "@uniwork/core/chat";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { senderNameClass, senderQuoteClass } from "./sender-colors";
import { formatChatFileSize } from "./chat-file-size";

function isImageFileMessage(message: ChatMessage): boolean {
  return message.kind === "file" && Boolean(message.file?.content_type?.startsWith("image/"));
}

/**
 * The quote's thumbnail: the same signed URL the file row shows, so the
 * browser cache serves a photo already on screen. A GIF row shows the whole
 * file, so its quote does too. A URL past its expiry shows the placeholder
 * until the message is loaded again.
 */
function quotedImageUrl(message: ChatMessage): string | null {
  const file = message.file;
  if (!isImageFileMessage(message) || !file) return null;
  const url = file.content_type === "image/gif" ? file.url : file.thumb_url || file.url;
  return isChatMediaUrlFresh(url, file.url_expires_at) ? (url ?? null) : null;
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

/** The quoted photo, or a placeholder while its link is stale. */
function QuoteThumbnail({ url, label, className }: { url: string | null; label: string; className: string }) {
  return (
    <span className={cn("relative shrink-0 overflow-hidden rounded-md", className)}>
      {url ? (
        <img src={url} alt={label} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center">
          <ImageIcon className="size-4" aria-hidden />
        </span>
      )}
    </span>
  );
}

export function ChatReplyQuote({
  message,
  isOwn = false,
  senderLabel,
  compact = false,
  onJump,
}: {
  message: ChatMessage;
  /** The quote sits in my (brand) bubble: drawn in the bubble's own colours. */
  isOwn?: boolean;
  /** Who wrote the quoted message; shown above the preview in their colour. */
  senderLabel?: string;
  /** Composer banner uses a lighter layout. */
  compact?: boolean;
  /** Scrolls to the quoted message; the quote becomes a button when set. */
  onJump?: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const previewUrl = quotedImageUrl(message);
  const isImage = isImageFileMessage(message);
  const label = replyPreviewLabel(message, {
    voice: t("chat.voice_message"),
    file: t("chat.file_untitled"),
    media: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") },
  });

  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        {isImage ? (
          <QuoteThumbnail url={previewUrl} label={label} className="size-10 rounded-lg bg-surface text-muted-foreground" />
        ) : null}
        <span className="flex min-w-0 flex-col">
          {senderLabel ? (
            <>
              <span className="truncate text-label font-semibold text-brand">
                {t("chat.replying_to_name", { name: senderLabel })}
              </span>
              <span className="truncate text-label text-muted-foreground">{label}</span>
            </>
          ) : (
            <span className="truncate text-label text-muted-foreground">
              {t("chat.replying_to", { preview: label })}
            </span>
          )}
        </span>
      </span>
    );
  }

  // A quoted file says how big it is too: "Danh-sach-khach-moi.xlsx · 48 KB" (canvas).
  const fileSize =
    message.kind === "file" && !isImage && message.file?.size_bytes
      ? formatChatFileSize(message.file.size_bytes, i18n.language)
      : null;

  // A side bar and a light wash in the quoted sender's colour; on my brand
  // bubble both turn to the bubble's own white so the quote stays legible.
  const tile = isOwn
    ? "bg-chat-bubble-own-foreground/20 text-chat-bubble-own-foreground"
    : "bg-surface text-muted-foreground";
  const content = (
    <>
      {isImage ? (
        <QuoteThumbnail url={previewUrl} label={label} className={cn("size-9", tile)} />
      ) : message.kind === "file" ? (
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", tile)}>
          <FileText className="size-4" aria-hidden />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        {senderLabel ? (
          <span
            className={cn(
              "truncate text-label font-semibold",
              isOwn ? "text-chat-bubble-own-foreground" : senderNameClass(message.sender, false),
            )}
          >
            {senderLabel}
          </span>
        ) : null}
        <span
          className={cn(
            "truncate text-label",
            isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground",
          )}
        >
          {fileSize ? `${label} · ${fileSize}` : label}
        </span>
      </span>
    </>
  );
  const quoteClass = cn(
    "mb-1.5 flex w-full min-w-0 items-center gap-2.5 rounded-control border-l-3 py-1 pr-2.5 pl-2 text-left",
    isOwn
      ? "border-chat-bubble-own-foreground bg-chat-bubble-own-foreground/15"
      : senderQuoteClass(message.sender),
  );
  if (onJump) {
    return (
      <button
        type="button"
        className={cn(quoteClass, "transition-[filter] duration-(--duration-fast) hover:brightness-95")}
        aria-label={t("chat.reply_quote_jump", { preview: label })}
        onClick={() => onJump(message.id)}
      >
        {content}
      </button>
    );
  }
  return <div className={quoteClass}>{content}</div>;
}

/**
 * The strip at the top of the composer pill while replying or editing: a
 * brand bar on a soft fill, what it is about, and the way out (canvas).
 */
export const COMPOSER_QUOTE_BAR_CLASS =
  "mt-1 flex items-center gap-2.5 rounded-[18px] border-l-3 border-brand bg-muted py-1.5 pr-1 pl-3";

/** Inside the composer pill while replying: who is quoted, what they said, and the way out. */
export function ChatReplyComposerBar({
  message,
  senderLabel,
  onCancel,
}: {
  message: ChatMessage;
  senderLabel?: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={COMPOSER_QUOTE_BAR_CLASS}>
      <Reply aria-hidden className="size-4.5 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <ChatReplyQuote message={message} senderLabel={senderLabel} compact />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
        aria-label={t("chat.cancel_reply")}
        title={t("chat.cancel_reply")}
        onClick={onCancel}
      >
        <X className="size-4.5" aria-hidden />
      </Button>
    </div>
  );
}
