"use client";

import { useState, type ReactNode } from "react";
import { Download, ExternalLink, Eye, EyeOff, FileText, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatFileBlobLoader } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { ChatAnimatedImage } from "./chat-animated-image";
import { isChatImageContentType, isChatPdfContentType } from "./chat-file-accept";
import { formatChatFileSize } from "./chat-file-size";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { useChatFileObjectUrl } from "./use-chat-file-object-url";

type ChatFile = NonNullable<ChatMessage["file"]>;

/**
 * Natural sizes of images already seen, by message: an image the virtual list
 * scrolls back in takes its real shape on the first frame instead of growing
 * out of a placeholder and pushing the timeline.
 */
const imageAspectByMessage = new Map<string, number>();

/** The file's name, size and a download button: every attachment has one. */
function FileCard({
  file,
  busy,
  onDownload,
  trailing,
}: {
  file: ChatFile | undefined;
  busy: boolean;
  onDownload: () => void;
  trailing?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const name = file?.filename || t("chat.file_untitled");
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
        <FileText className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-foreground">{name}</p>
        <p className="text-caption text-muted-foreground tabular-nums">
          {formatChatFileSize(file?.size_bytes ?? 0, i18n.language)}
        </p>
      </div>
      {trailing}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-9 shrink-0 pointer-coarse:size-11"
        disabled={busy}
        aria-label={t("chat.message_list.file_download_named", { name })}
        onClick={onDownload}
      >
        {busy ? (
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}

function useDownload(workspaceId: string, roomId: string, messageId: string, filename: string) {
  const { t } = useTranslation();
  const loadBlob = useChatFileBlobLoader(workspaceId, roomId);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await loadBlob(messageId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || "file";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastChatError(err, t, t("chat.file_download_failed"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, download: () => void download() };
}

function ImageAttachment({
  workspaceId,
  roomId,
  message,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
}) {
  const { t } = useTranslation();
  const file = message.file;
  const name = file?.filename || t("chat.file_untitled");
  const { url, status } = useChatFileObjectUrl(workspaceId, roomId, message.id, true);
  const [aspect, setAspect] = useState(() => imageAspectByMessage.get(message.id) ?? null);
  const rememberAspect = (img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const next = img.naturalWidth / img.naturalHeight;
    imageAspectByMessage.set(message.id, next);
    setAspect(next);
  };
  // Until the image says its shape, reserve the box a typical photo takes.
  const boxStyle = { aspectRatio: String(aspect ?? 4 / 3) };

  if (status === "error") {
    return (
      <div className="flex min-h-40 min-w-48 items-center justify-center px-4 py-8">
        <p className="text-center text-caption text-muted-foreground">{t("chat.file_download_failed")}</p>
      </div>
    );
  }
  if (status !== "ready" || !url) {
    return (
      <div role="status" className="w-56 max-w-full" style={boxStyle}>
        <span className="sr-only">{t("chat.file_loading")}</span>
        <Skeleton className="size-full rounded-none" />
      </div>
    );
  }
  const open = () => window.open(url, "_blank", "noopener,noreferrer");
  const openLabel = t("chat.message_list.file_open_named", { name });
  const imgClass = "block max-h-56 max-w-full object-contain";
  if (file?.content_type === "image/gif") {
    // The GIF carries its own play/pause button, so opening it is a button
    // of its own rather than the whole picture.
    return (
      <div className="relative w-fit max-w-full" style={aspect ? undefined : boxStyle}>
        <ChatAnimatedImage src={url} alt={name} imgClassName={imgClass} onLoad={rememberAspect} />
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute top-1.5 right-1.5 pointer-coarse:size-11"
          aria-label={openLabel}
          onClick={open}
        >
          <ExternalLink aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="block max-w-full overflow-hidden"
      style={aspect ? undefined : boxStyle}
      aria-label={openLabel}
      onClick={open}
    >
      {/* Authenticated blob URL — not a public CDN asset. */}
      <img src={url} alt={name} className={imgClass} onLoad={(e) => rememberAspect(e.currentTarget)} />
    </button>
  );
}

/**
 * A PDF is a file card first. The inline preview downloads the whole
 * document, so it loads only when someone asks to see it.
 */
function PdfAttachment({
  workspaceId,
  roomId,
  message,
  busy,
  onDownload,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  busy: boolean;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { url, status } = useChatFileObjectUrl(workspaceId, roomId, message.id, previewOpen);
  return (
    <div className="space-y-2 p-2">
      <div className="px-1">
        <FileCard
          file={message.file}
          busy={busy}
          onDownload={onDownload}
          trailing={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 pointer-coarse:size-11"
              aria-expanded={previewOpen}
              aria-label={previewOpen ? t("chat.message_list.pdf_preview_hide") : t("chat.message_list.pdf_preview_show")}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </Button>
          }
        />
      </div>
      {!previewOpen ? null : status === "ready" && url ? (
        <iframe
          title={t("chat.file_pdf_preview")}
          src={url}
          className="h-72 w-full rounded-lg border border-border bg-background"
        />
      ) : status === "error" ? (
        <p className="px-1 pb-1 text-caption text-muted-foreground" role="alert">
          {t("chat.file_download_failed")}
        </p>
      ) : (
        <div role="status" className="h-72 w-full">
          <span className="sr-only">{t("chat.file_loading")}</span>
          <Skeleton className="size-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

/** The body of a file message: an image, a PDF card with its preview, or a plain file card. */
export function ChatFileAttachment({
  workspaceId,
  roomId,
  message,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
}) {
  const file = message.file;
  const { busy, download } = useDownload(workspaceId, roomId, message.id, file?.filename ?? "");
  if (isChatImageContentType(file?.content_type)) {
    return <ImageAttachment workspaceId={workspaceId} roomId={roomId} message={message} />;
  }
  if (isChatPdfContentType(file?.content_type)) {
    return (
      <PdfAttachment workspaceId={workspaceId} roomId={roomId} message={message} busy={busy} onDownload={download} />
    );
  }
  return <FileCard file={file} busy={busy} onDownload={download} />;
}

/** Image and PDF attachments sit edge to edge in the bubble; a file card gets padding. */
export function chatFileIsEdgeToEdge(file: ChatFile | undefined): boolean {
  return isChatImageContentType(file?.content_type) || isChatPdfContentType(file?.content_type);
}

