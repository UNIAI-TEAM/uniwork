"use client";

import { ArrowDown, ArrowUp, Bell, BellOff, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFollowChatThread, useUnfollowChatThread } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { toastChatError } from "./chat-error-message";

/** Above the timeline while a thread is open: its name, Follow / Unfollow and the way out. */
export function ChatThreadBar({
  workspaceId,
  threadRootId,
  following,
  onClose,
}: {
  workspaceId: string;
  threadRootId: string;
  following: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const follow = useFollowChatThread(workspaceId);
  const unfollow = useUnfollowChatThread(workspaceId);
  const toggle = following ? unfollow : follow;
  return (
    <div className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface pr-2 pl-4 sm:pr-3 sm:pl-5">
      <p className="min-w-0 truncate font-display text-title-sm font-bold text-foreground">{t("chat.thread_title")}</p>
      <div className="flex shrink-0 items-center gap-1">
        {/* A pill toggle: the brand wash while the thread is followed. */}
        <Button
          type="button"
          variant={following ? "brandSubtle" : "secondary"}
          size="sm"
          className="h-8.5 gap-1.5 rounded-full pr-3.5 pl-2.5 font-semibold"
          disabled={toggle.isPending}
          onClick={() =>
            toggle.mutate(threadRootId, { onError: (err) => toastChatError(err, t, t("chat.errors.internal")) })
          }
        >
          {following ? <BellOff aria-hidden /> : <Bell aria-hidden />}
          {following ? t("chat.thread_unfollow") : t("chat.thread_follow")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 rounded-lg text-muted-foreground hover:text-foreground"
          aria-label={t("chat.close_thread")}
          onClick={onClose}
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Above the timeline after a search jump: the reader is in the past, one tap from now. */
export function ChatAnchorBar({ onBackToLatest }: { onBackToLatest: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-13 shrink-0 items-center gap-2.5 border-b border-border bg-info-soft py-1.5 pr-2.5 pl-4 text-info-soft-foreground">
      <Search aria-hidden className="size-4.5 shrink-0" />
      <p className="min-w-0 flex-1 truncate text-body font-semibold">{t("chat.search_jump_banner")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8.5 shrink-0 gap-1.5 rounded-full border-brand/25 bg-surface pr-3.5 pl-2.5 font-semibold text-brand hover:text-brand"
        onClick={onBackToLatest}
      >
        <ArrowDown aria-hidden />
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
      className="absolute bottom-3 left-1/2 h-8.5 -translate-x-1/2 rounded-full border-transparent bg-surface-raised px-3.5 font-semibold shadow-menu"
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
      {/* A chip on the chat wall, like the day separators. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="rounded-full bg-chat-chip px-3 text-chat-chip-foreground hover:bg-chat-chip hover:text-foreground"
        onClick={onClick}
      >
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
