"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { bubbleControlClass, ChatFileCard } from "./chat-file-card";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import type { ChatFileDownloadState } from "./use-chat-file-download";
import { useFreshChatMediaUrl } from "./use-chat-media-url";
import { useChatPdfPreview } from "./use-chat-pdf-preview";

/**
 * A PDF is a file card first; its size line gains the page count once the
 * first page has been read, and the preview, when open, shows the top of that
 * page with "Trang 1 / 6" (WebMessageKinds). The preview opens the whole
 * document in a new tab, where the browser's own viewer reads it.
 */
export function ChatPdfAttachment({
  workspaceId,
  roomId,
  message,
  isOwn,
  download,
  onDownload,
  onCancel,
  meta,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  isOwn: boolean;
  download: ChatFileDownloadState;
  onDownload: () => void;
  onCancel: () => void;
  /** Its time, at the end of the preview toggle's line (canvas). */
  meta?: ReactNode;
}) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { ref, preview } = useChatPdfPreview(workspaceId, roomId, message, previewOpen);
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  const name = message.file?.filename || t("chat.file_untitled");
  const pages = preview.status === "ready" ? preview.pages : undefined;
  const open = () => {
    freshUrl(message.id, { url: message.file?.url, expiresAt: message.file?.url_expires_at }, (fresh) => fresh.file?.url).then(
      (href) => {
        window.open(href, "_blank", "noopener,noreferrer");
      },
      (err: unknown) => toastChatError(err, t, t("chat.file_download_failed")),
    );
  };
  const openLabel = t("chat.message_list.file_open_named", { name });
  return (
    <div ref={ref} className="w-101 max-w-full">
      <ChatFileCard
        file={message.file}
        isOwn={isOwn}
        download={download}
        onDownload={onDownload}
        onCancel={onCancel}
        pages={pages}
        className="w-full"
      />
      {!previewOpen ? null : preview.status === "ready" ? (
        <button
          type="button"
          className="relative mt-2 block h-49 w-full overflow-hidden rounded-[10px] bg-background"
          aria-label={openLabel}
          onClick={open}
        >
          <img
            src={preview.src}
            alt={t("chat.message_list.pdf_page_alt", { count: preview.pages })}
            className="block w-full"
          />
          <span className="absolute right-2.5 bottom-2.5 rounded-full bg-meeting-video-bg/66 px-2 py-0.5 text-micro tabular-nums text-meeting-stage-foreground">
            {t("chat.message_list.pdf_page_of", { page: 1, count: preview.pages })}
          </span>
        </button>
      ) : preview.status === "error" ? (
        // No picture (a PDF pdf.js cannot read, storage that refuses the browser): the document still opens.
        <button
          type="button"
          className={cn(
            "mt-2 flex h-49 w-full flex-col items-center justify-center gap-2 rounded-[10px] text-caption",
            isOwn ? "bg-chat-bubble-own-foreground/12" : "bg-muted text-muted-foreground",
          )}
          aria-label={openLabel}
          onClick={open}
        >
          <FileText className="size-8" aria-hidden />
          {t("chat.message_list.pdf_preview_unavailable")}
        </button>
      ) : (
        <div role="status" className="mt-2 h-49 w-full">
          <span className="sr-only">{t("chat.file_loading")}</span>
          <Skeleton className="size-full rounded-[10px]" />
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2 pr-1">
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          className={cn("h-8.5 rounded-full px-3 font-semibold", bubbleControlClass(isOwn))}
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((was) => !was)}
        >
          {previewOpen ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {previewOpen ? t("chat.message_list.pdf_preview_hide") : t("chat.message_list.pdf_preview_show")}
        </Button>
        {meta}
      </div>
    </div>
  );
}
