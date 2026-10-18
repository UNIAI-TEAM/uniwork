"use client";

import { useRef, useState } from "react";
import { Download, Eye, EyeOff, FileText } from "lucide-react";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useTranslation } from "react-i18next";
import { tintClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { ChatAnimatedImage } from "./chat-animated-image";
import { isChatImageContentType, isChatPdfContentType, resolveChatFileContentType } from "./chat-file-accept";
import { formatChatFileSize } from "./chat-file-size";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { ChatImagePreviewDialog } from "./chat-image-preview-dialog";
import { useChatFileDownload } from "./use-chat-file-download";
import { CHAT_ON_BUBBLE_FILL, CHAT_ON_BUBBLE_HOVER } from "./chat-message-row";
import { useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media-url";

type ChatFile = NonNullable<ChatMessage["file"]>;

/**
 * Natural sizes of images already seen, by message: an image the virtual list
 * scrolls back in takes its real shape on the first frame instead of growing
 * out of a placeholder and pushing the timeline.
 */
const imageAspectByMessage = new Map<string, number>();

/** The family a file belongs to, by extension: its type tile wears that tint. */
const FILE_TINTS: Record<string, Tint> = { pdf: "red", docx: "blue", xlsx: "green" };

/** A soft control on the bubble: a white wash on my brand bubble, the muted fill on theirs. */
function bubbleControlClass(isOwn: boolean): string {
  return isOwn
    ? "bg-chat-bubble-own-foreground/15 text-chat-bubble-own-foreground hover:bg-chat-bubble-own-foreground/25 hover:text-chat-bubble-own-foreground aria-expanded:bg-chat-bubble-own-foreground/25 aria-expanded:text-chat-bubble-own-foreground"
    : cn(CHAT_ON_BUBBLE_FILL, CHAT_ON_BUBBLE_HOVER, "text-foreground");
}

/** The file's name, size and a download button: every attachment has one. */
function FileCard({
  file,
  isOwn,
  busy,
  onDownload,
}: {
  file: ChatFile | undefined;
  isOwn: boolean;
  busy: boolean;
  onDownload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const name = file?.filename || t("chat.file_untitled");
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return (
    <div className="flex min-w-64 items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-lg font-display text-micro font-extrabold uppercase",
          tintClass[FILE_TINTS[ext] ?? "gray"],
        )}
      >
        {ext && ext.length <= 4 ? ext : <FileText className="size-6" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold">{name}</p>
        <p className={cn("text-caption tabular-nums", isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground")}>
          {formatChatFileSize(file?.size_bytes ?? 0, i18n.language)}
        </p>
      </div>
      <Button
        type="button"
        size="icon"
        variant="toolbar"
        className={cn("size-11 shrink-0 rounded-full", bubbleControlClass(isOwn))}
        disabled={busy}
        aria-label={t("chat.message_list.file_download_named", { name })}
        onClick={onDownload}
      >
        {busy ? (
          <Spinner />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}

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

/**
 * A PDF is a file card first. The inline preview downloads the whole
 * document, so it loads only when someone asks to see it.
 */
function PdfAttachment({
  workspaceId,
  roomId,
  message,
  isOwn,
  busy,
  onDownload,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  isOwn: boolean;
  busy: boolean;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { src: url, status } = useChatMediaSrc(
    workspaceId,
    roomId,
    message.id,
    message.file?.url,
    message.file?.url_expires_at,
    previewOpen,
  );
  return (
    <div className="w-80 max-w-full space-y-2 p-1">
      <FileCard file={message.file} isOwn={isOwn} busy={busy} onDownload={onDownload} />
      {!previewOpen ? null : status === "ready" && url ? (
        <iframe
          title={t("chat.file_pdf_preview")}
          src={url}
          className="h-72 w-full rounded-lg border border-border bg-background"
        />
      ) : status === "error" ? (
        <p className="px-1 text-caption" role="alert">
          {t("chat.file_download_failed")}
        </p>
      ) : (
        <div role="status" className="h-72 w-full">
          <span className="sr-only">{t("chat.file_loading")}</span>
          <Skeleton className="size-full rounded-lg" />
        </div>
      )}
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        className={cn("h-8 rounded-full px-3 font-semibold", bubbleControlClass(isOwn))}
        aria-expanded={previewOpen}
        aria-label={previewOpen ? t("chat.message_list.pdf_preview_hide") : t("chat.message_list.pdf_preview_show")}
        onClick={() => setPreviewOpen((open) => !open)}
      >
        {previewOpen ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        {previewOpen ? t("chat.message_list.pdf_preview_hide") : t("chat.message_list.pdf_preview_show")}
      </Button>
    </div>
  );
}

/** The body of a file message: an image, a PDF card with its preview, or a plain file card. */
export function ChatFileAttachment({
  workspaceId,
  roomId,
  message,
  isOwn = false,
  sender,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  /** On my brand bubble the card's controls and secondary text invert. */
  isOwn?: boolean;
  /** Who sent the photo, for the viewer's top bar. */
  sender?: ChatFileSender;
}) {
  const file = message.file;
  const { busy, download: downloadMessage } = useChatFileDownload(workspaceId, roomId);
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
      <PdfAttachment
        workspaceId={workspaceId}
        roomId={roomId}
        message={message}
        isOwn={isOwn}
        busy={busy}
        onDownload={download}
      />
    );
  }
  return <FileCard file={file} isOwn={isOwn} busy={busy} onDownload={download} />;
}

/** Image and PDF attachments sit edge to edge in the bubble; a file card gets padding. */
export function chatFileIsEdgeToEdge(file: ChatFile | undefined): boolean {
  const contentType = file ? resolveChatFileContentType(file) : undefined;
  return isChatImageContentType(contentType, file?.filename) || isChatPdfContentType(contentType);
}

