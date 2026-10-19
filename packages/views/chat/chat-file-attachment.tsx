"use client";

import { useRef, useState, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { ChatAnimatedImage } from "./chat-animated-image";
import { isChatImageContentType, isChatPdfContentType, resolveChatFileContentType } from "./chat-file-accept";
import { ChatFileCard } from "./chat-file-card";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { ChatImagePreviewDialog } from "./chat-image-preview-dialog";
import { ChatPdfAttachment } from "./chat-pdf-attachment";
import { useChatFileDownload } from "./use-chat-file-download";
import { useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media-url";

type ChatFile = NonNullable<ChatMessage["file"]>;

/**
 * Natural sizes of images already seen, by message: an image the virtual list
 * scrolls back in takes its real shape on the first frame instead of growing
 * out of a placeholder and pushing the timeline.
 */
const imageAspectByMessage = new Map<string, number>();

type ChatFileSender = { userId: string; name: string; avatarUrl?: string; ts: number };

function ImageAttachment({
  workspaceId,
  roomId,
  message,
  sender,
  busy,
  onDownload,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  sender?: ChatFileSender;
  busy: boolean;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const file = message.file;
  const name = file?.filename || t("chat.file_untitled");
  // A GIF keeps its animation, so it loads whole; any other photo shows its
  // thumbnail and loads the original only when opened.
  const isGif = file?.content_type === "image/gif";
  const preview = useChatMediaSrc(
    workspaceId,
    roomId,
    message.id,
    isGif ? file?.url : file?.thumb_url || file?.url,
    file?.url_expires_at,
  );
  const { src: url, status } = preview;
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  const previewRequest = useRef(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const openPreview = () => {
    const token = ++previewRequest.current;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewSrc(null);
    freshUrl(message.id, { url: file?.url, expiresAt: file?.url_expires_at }, (fresh) => fresh.file?.url).then(
      (href) => {
        if (previewRequest.current !== token) return;
        setPreviewSrc(href);
        setPreviewLoading(false);
      },
      (err: unknown) => {
        if (previewRequest.current !== token) return;
        setPreviewOpen(false);
        setPreviewLoading(false);
        toastChatError(err, t, t("chat.file_download_failed"));
      },
    );
  };
  const closePreview = (open: boolean) => {
    if (open) return;
    previewRequest.current += 1;
    setPreviewOpen(false);
  };
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
        <p className="text-center text-caption">{t("chat.file_download_failed")}</p>
      </div>
    );
  }
  if (status !== "ready" || !url) {
    return (
      <div role="status" className="w-56 max-w-full" style={boxStyle}>
        <span className="sr-only">{t("chat.file_loading")}</span>
        <Skeleton className="size-full rounded-xl" />
      </div>
    );
  }
  const openLabel = t("chat.message_list.file_open_named", { name });
  const imgClass = "block max-h-56 max-w-full object-contain";
  const previewDialog = (
    <ChatImagePreviewDialog
      open={previewOpen}
      name={name}
      src={previewSrc}
      loading={previewLoading}
      onOpenChange={closePreview}
      sender={sender}
      onDownload={onDownload}
      downloading={busy}
    />
  );
  if (isGif) {
    // The GIF carries its own play/pause button, so the preview is a button
    // of its own rather than the whole picture.
    return (
      <div className="relative w-fit max-w-full overflow-hidden rounded-xl" style={aspect ? undefined : boxStyle}>
        <ChatAnimatedImage
          src={url}
          alt={name}
          imgClassName={imgClass}
          onLoad={rememberAspect}
          onError={preview.onError}
          gifBadge
        />
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute top-1.5 right-1.5 rounded-full shadow-menu pointer-coarse:size-11"
          aria-label={openLabel}
          onClick={openPreview}
        >
          <Eye className="size-4" aria-hidden />
        </Button>
        {previewDialog}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="block max-w-full overflow-hidden rounded-xl"
        style={aspect ? undefined : boxStyle}
        aria-label={openLabel}
        onClick={openPreview}
      >
        {/* Short-lived signed storage URL, not a public CDN asset. */}
        <img
          src={url}
          alt={name}
          className={imgClass}
          onLoad={(e) => rememberAspect(e.currentTarget)}
          onError={preview.onError}
        />
      </button>
      {previewDialog}
    </>
  );
}

/** The body of a file message: an image, a PDF card with its preview, or a plain file card. */
export function ChatFileAttachment({
  workspaceId,
  roomId,
  message,
  isOwn = false,
  sender,
  meta,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  /** On my brand bubble the card's controls and secondary text invert. */
  isOwn?: boolean;
  /** Who sent the photo, for the viewer's top bar. */
  sender?: ChatFileSender;
  /** The message's time, drawn inside a file or PDF card; a photo carries its own. */
  meta?: ReactNode;
}) {
  const file = message.file;
  const { state, busy, download: downloadMessage, cancel } = useChatFileDownload(workspaceId, roomId, message.id);
  const download = () => downloadMessage(message);
  const contentType = file ? resolveChatFileContentType(file) : undefined;
  if (isChatImageContentType(contentType, file?.filename)) {
    return (
      <ImageAttachment
        workspaceId={workspaceId}
        roomId={roomId}
        message={message}
        sender={sender}
        busy={busy}
        onDownload={download}
      />
    );
  }
  if (isChatPdfContentType(contentType)) {
    return (
      <ChatPdfAttachment
        workspaceId={workspaceId}
        roomId={roomId}
        message={message}
        isOwn={isOwn}
        download={state}
        onDownload={download}
        onCancel={cancel}
        meta={meta}
      />
    );
  }
  return (
    <ChatFileCard file={file} isOwn={isOwn} download={state} onDownload={download} onCancel={cancel} meta={meta} />
  );
}

/** Image and PDF attachments sit edge to edge in the bubble; a file card gets padding. */
export function chatFileIsEdgeToEdge(file: ChatFile | undefined): boolean {
  const contentType = file ? resolveChatFileContentType(file) : undefined;
  return isChatImageContentType(contentType, file?.filename) || isChatPdfContentType(contentType);
}

