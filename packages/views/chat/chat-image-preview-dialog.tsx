"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { chatPersonFaceClass } from "./chat-person-card";
import { initialsOf } from "./chat-initials";
import { formatMessageDateTime } from "./chat-message-time";

/** A soft round control on the dark stage (canvas: a white wash). */
const STAGE_CONTROL = "rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20 hover:text-foreground";

/**
 * The original image, in the chat, instead of a new browser tab: a dark stage
 * with who sent it, a download, and — opened from an album — arrows, ←/→ keys
 * and "2 / 3". Every extra is optional; Esc closes (the dialog's own).
 */
export function ChatImagePreviewDialog({
  open,
  name,
  src,
  loading,
  onOpenChange,
  sender,
  onDownload,
  downloading = false,
  position,
  onPrev,
  onNext,
  thumbnails,
}: {
  open: boolean;
  name: string;
  src: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who sent the photo and when, in the top bar. */
  sender?: { userId: string; name: string; avatarUrl?: string; ts: number };
  onDownload?: () => void;
  downloading?: boolean;
  /** 1-based place in the album. */
  position?: { current: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
  /** The album's photos as a strip under the stage, the one on show ringed (canvas). */
  thumbnails?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const go = event.key === "ArrowLeft" ? onPrev : event.key === "ArrowRight" ? onNext : undefined;
    if (!go) return;
    event.preventDefault();
    go();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("chat.message_list.image_preview_close")}
        overlayClassName="bg-black/70"
        onKeyDown={onKeyDown}
        // The photo sits on the dark palette (.dark re-themes this subtree) whatever the app theme.
        className="dark flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-background p-0 text-foreground sm:max-w-4xl [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:rounded-lg"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <div className="flex min-h-17 shrink-0 items-center gap-3 py-3 pr-16 pl-5">
          {sender ? (
            <>
              <ActorAvatar
                name={sender.name}
                initials={initialsOf(sender.name)}
                avatarUrl={sender.avatarUrl}
                size="lg"
                className={chatPersonFaceClass(sender.userId)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-body font-bold">{sender.name}</p>
                <p className="truncate text-caption text-muted-foreground tabular-nums">
                  {formatMessageDateTime(sender.ts, i18n.language)}
                </p>
              </div>
            </>
          ) : (
            <span className="flex-1" />
          )}
          {onDownload ? (
            <Button
              type="button"
              variant="ghost"
              className={cn("h-10 gap-2 px-4 text-label font-semibold", STAGE_CONTROL)}
              disabled={downloading}
              onClick={onDownload}
            >
              {downloading ? <Spinner /> : <Download aria-hidden />}
              {t("chat.image_viewer_download")}
            </Button>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-2 px-3 sm:gap-4 sm:px-5">
          {onPrev ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-11 shrink-0 sm:size-14", STAGE_CONTROL)}
              aria-label={t("chat.image_viewer_prev")}
              onClick={onPrev}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-1 justify-center">
            {loading || !src ? (
              <div role="status" className="flex h-64 items-center justify-center">
                <span className="sr-only">{t("chat.message_list.image_preview_loading")}</span>
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : (
              <img src={src} alt={name} className="max-h-[70dvh] max-w-full rounded-sm object-contain shadow-floating" />
            )}
          </div>
          {onNext ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-11 shrink-0 sm:size-14", STAGE_CONTROL)}
              aria-label={t("chat.image_viewer_next")}
              onClick={onNext}
            >
              <ChevronRight className="size-6" aria-hidden />
            </Button>
          ) : null}
        </div>
        <div className="flex min-h-5 shrink-0 items-center justify-center gap-2 px-5 pt-4 pb-6">
          {thumbnails}
          {position ? (
            <span
              aria-live="polite"
              className="rounded-full bg-foreground/10 px-2.5 py-1 text-label font-semibold tabular-nums"
            >
              {t("chat.image_viewer_position", position)}
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
