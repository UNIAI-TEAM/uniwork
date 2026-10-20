"use client";

import type { ReactNode } from "react";
import { Check, Download, FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tintClass, tintForegroundClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { formatChatFileProgress, formatChatFileSize } from "./chat-file-size";
import type { ChatMessage } from "./chat-messages";
import { CHAT_ON_BUBBLE_FILL, CHAT_ON_BUBBLE_HOVER } from "./chat-message-row";
import { chatDownloadPercent, type ChatFileDownloadState } from "./use-chat-file-download";

type ChatFile = NonNullable<ChatMessage["file"]>;

/** The family a file belongs to, by extension: its type tile wears that tint. */
const FILE_TINTS: Record<string, Tint> = { pdf: "red", docx: "blue", xlsx: "green" };

/** The app a file opens in, named after its size ("86 KB · Word"); proper names, not copy. */
const FILE_KINDS: Record<string, string> = { pdf: "PDF", doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel" };

/** The ring around the cancel button: r=19 in a 44 box (canvas). */
const RING_LENGTH = 2 * Math.PI * 19;

/** A soft control on the bubble: a white wash on my brand bubble, the muted fill on theirs. */
export function bubbleControlClass(isOwn: boolean): string {
  return isOwn
    ? "bg-chat-bubble-own-foreground/15 text-chat-bubble-own-foreground hover:bg-chat-bubble-own-foreground/25 hover:text-chat-bubble-own-foreground aria-expanded:bg-chat-bubble-own-foreground/25 aria-expanded:text-chat-bubble-own-foreground"
    : cn(CHAT_ON_BUBBLE_FILL, CHAT_ON_BUBBLE_HOVER, "text-foreground");
}

/**
 * The file's name, size and kind and a download button: every attachment has
 * one. `meta` (its time) ends the size line (canvas); `pages` joins it for a
 * PDF once its first page has been read. While it downloads, a bar and
 * "1,3 / 2,1 MB" take the size line and the button cancels (WebMessageKinds).
 */
export function ChatFileCard({
  file,
  isOwn,
  download,
  onDownload,
  onCancel,
  meta,
  pages,
  className,
}: {
  file: ChatFile | undefined;
  isOwn: boolean;
  download: ChatFileDownloadState;
  onDownload: () => void;
  onCancel: () => void;
  meta?: ReactNode;
  pages?: number;
  /** A plain file card is 360 px with its bubble's padding (WebMessageKinds); a PDF's fills its own. */
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const name = file?.filename || t("chat.file_untitled");
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const kind = FILE_KINDS[ext];
  // A PDF is a page, not a type label: its tile shows a document (canvas).
  const showExt = ext && ext.length <= 4 && ext !== "pdf";
  const progress = download.status === "downloading" && download.total ? download : null;
  const percent = progress?.total ? chatDownloadPercent(progress.loaded, progress.total) : 0;
  const metaTone = isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground";
  return (
    <div className={cn("flex w-86 max-w-full items-center gap-3", className)}>
      <span
        aria-hidden
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-micro font-extrabold uppercase",
          !showExt && isOwn
            ? "bg-chat-bubble-own-foreground/18 text-chat-bubble-own-foreground"
            : isOwn
              ? cn("bg-surface", tintForegroundClass[FILE_TINTS[ext] ?? "gray"])
              : tintClass[FILE_TINTS[ext] ?? "gray"],
        )}
      >
        {showExt ? ext : <FileText className="size-6" />}
      </span>
      <div className={cn("flex min-w-0 flex-1 flex-col", progress && "gap-0.75")}>
        <p className="truncate text-body font-semibold">{name}</p>
        {progress?.total ? (
          <>
            <Progress
              value={percent}
              aria-label={t("chat.message_list.file_downloading_named", { name })}
              className={cn(
                "block",
                isOwn
                  ? "[&_[data-slot=progress-indicator]]:bg-chat-bubble-own-foreground [&_[data-slot=progress-track]]:bg-chat-bubble-own-foreground/28"
                  : "[&_[data-slot=progress-track]]:bg-foreground/10",
              )}
            />
            <p className={cn("text-caption tabular-nums", metaTone)}>
              {t("chat.message_list.file_downloading", {
                progress: formatChatFileProgress(progress.loaded, progress.total, i18n.language),
              })}
            </p>
          </>
        ) : (
          <p className={cn("flex items-center gap-1.5 text-caption tabular-nums", metaTone)}>
            {download.status === "failed" ? (
              t("chat.file_download_failed")
            ) : (
              <>
                {formatChatFileSize(file?.size_bytes ?? 0, i18n.language)}
                {kind ? ` · ${kind}` : null}
                {pages ? ` · ${t("chat.message_list.pdf_pages", { count: pages })}` : null}
              </>
            )}
            {meta}
          </p>
        )}
      </div>
      {progress ? (
        <Button
          type="button"
          size="icon"
          variant="toolbar"
          className={cn("relative size-11 shrink-0 rounded-full", bubbleControlClass(isOwn))}
          aria-label={t("chat.message_list.file_download_cancel_named", { name })}
          onClick={onCancel}
        >
          <svg viewBox="0 0 44 44" aria-hidden className="absolute inset-0 size-11 -rotate-90">
            <circle cx="22" cy="22" r="19" fill="none" strokeWidth="2.5" className="stroke-current opacity-28" />
            <circle
              cx="22"
              cy="22"
              r="19"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(percent / 100) * RING_LENGTH} ${RING_LENGTH}`}
              className={isOwn ? "stroke-current" : "stroke-primary"}
            />
          </svg>
          <X className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          variant="toolbar"
          className={cn("size-11 shrink-0 rounded-full", bubbleControlClass(isOwn))}
          disabled={download.status === "downloading"}
          aria-label={t("chat.message_list.file_download_named", { name })}
          onClick={onDownload}
        >
          {download.status === "downloading" ? (
            <Spinner />
          ) : download.status === "done" ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
        </Button>
      )}
    </div>
  );
}
