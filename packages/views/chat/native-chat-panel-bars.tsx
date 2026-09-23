"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";

/** Above the timeline while a thread is open: its name and the way out. */
export function ChatThreadBar({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-1.5">
      <p className="min-w-0 truncate text-label font-semibold text-foreground">{t("chat.thread_title")}</p>
      <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onClose}>
        <X aria-hidden />
        {t("chat.close_thread")}
      </Button>
    </div>
  );
}

/** Above the timeline after a search jump: the reader is in the past, one tap from now. */
export function ChatAnchorBar({ onBackToLatest }: { onBackToLatest: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-info-soft px-4 py-1.5 text-info-soft-foreground">
      <p className="min-w-0 truncate text-caption font-medium">{t("chat.search_jump_banner")}</p>
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onBackToLatest}>
        {t("chat.search_back_to_latest")}
      </Button>
    </div>
  );
}

/** Floats over the timeline once the reader has scrolled away from the newest message. */
export function ChatJumpToLatestButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface-raised shadow-[var(--menu-shadow)]"
      onClick={onClick}
    >
      <ArrowDown aria-hidden />
      {t("chat.search_back_to_latest")}
    </Button>
  );
}

/**
 * Asks for older history without scrolling to the top — for a keyboard, a
 * switch or a screen reader, where "scroll up to load" never fires.
 */
export function ChatLoadOlderButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center pb-2">
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onClick}>
        <ArrowUp aria-hidden />
        {t("chat.message_list.load_older")}
      </Button>
    </div>
  );
}

/** Older history arrives in the message's own shape. */
export function ChatOlderMessagesSkeleton({ label }: { label: string }) {
  return (
    <div className="pb-3" role="status" aria-busy>
      <span className="sr-only">{label}</span>
      <div className="flex items-start gap-2">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-56 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
