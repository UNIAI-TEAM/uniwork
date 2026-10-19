"use client";

import { CircleAlert, Compass, Hash, Lock, Plus, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatChannels, useJoinChatChannel } from "@uniwork/core/chat";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@uniwork/ui/components/ui/empty";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import {
  CHAT_EMPTY_TILE_CLASS,
  CHAT_EMPTY_TITLE_CLASS,
  CHAT_PILL_SM_CLASS,
  CHAT_SHEET_CLASS,
} from "./chat-dialog-look";
import { toastChatError } from "./chat-error-message";
import { foldedIncludes } from "./chat-search-fold";

/**
 * One directory: channels you could join and those you are in, each once, by
 * name. The default channel is the workspace room, always atop the list, so
 * it is not repeated here.
 */
export function directoryChannels(
  discoverable: ChatRoomRecord[] | undefined,
  mine: ChatRoomRecord[] | undefined,
): ChatRoomRecord[] | undefined {
  if (!discoverable) return undefined;
  const byId = new Map<string, ChatRoomRecord>();
  for (const room of [...(mine ?? []), ...discoverable]) {
    if (room.kind === "channel" && !room.is_default) byId.set(room.id, room);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** Channels are loading: rows in their own shape — a mark, a name, a line. */
function ChannelDirectorySkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-1">
      <span className="sr-only">{label}</span>
      {["w-32", "w-24", "w-40", "w-28"].map((w) => (
        <div key={w} className="flex min-h-17 items-center gap-3 py-2.5 pr-2.5 pl-3" aria-hidden>
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8.5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ChannelDirectorySheet({
  open,
  onOpenChange,
  workspaceId,
  memberChannelIds,
  onJoined,
  onCreateChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  memberChannelIds: Set<string>;
  onJoined?: (room: ChatRoomRecord) => void;
  /** Opens the create-channel dialog; the empty directory offers it as the next step. */
  onCreateChannel?: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [joiningIds, setJoiningIds] = useState<ReadonlySet<string>>(() => new Set());
  const joinChannel = useJoinChatChannel(workspaceId);

  // A workspace's public channels are few: load them once and search only
  // here, accent-insensitively ("phong" finds "Phòng") and with no wildcards.
  const discoverQuery = useChatChannels(workspaceId, { scope: "discoverable" }, open);
  // The canvas lists the channels you are already in too (with "Mở"): the
  // server's discoverable scope holds only those you could join.
  const { data: mine } = useChatChannels(workspaceId, { scope: "mine" }, open);
  const mineIds = useMemo(() => new Set((mine ?? []).map((room) => room.id)), [mine]);
  const rooms = useMemo(() => directoryChannels(discoverQuery.data, mine), [discoverQuery.data, mine]);
  const trimmedQuery = query.trim();
  const localQuery = useDeferredValue(trimmedQuery);
  const filtered = useMemo(() => {
    const list = rooms ?? [];
    if (!localQuery) return list;
    return list.filter(
      (room) => foldedIncludes(room.name, localQuery) || foldedIncludes(room.topic ?? "", localQuery),
    );
  }, [rooms, localQuery]);

  const setJoining = (roomId: string, joining: boolean) =>
    setJoiningIds((prev) => {
      const next = new Set(prev);
      if (joining) next.add(roomId);
      else next.delete(roomId);
      return next;
    });

  const handleJoin = (room: ChatRoomRecord) => {
    if (memberChannelIds.has(room.id) || mineIds.has(room.id) || joiningIds.has(room.id)) return;
    setJoining(room.id, true);
    void joinChannel
      .mutateAsync(room.id)
      .then((joined) => {
        if (joined) onJoined?.(joined);
        else toast.error(t("chat.channel.join_failed", { name: room.name }));
      })
      .catch((err: unknown) => toastChatError(err, t, t("chat.channel.join_failed", { name: room.name })))
      .finally(() => setJoining(room.id, false));
  };

  const showSkeleton =
    (rooms === undefined && discoverQuery.isLoading) ||
    (filtered.length === 0 && discoverQuery.isFetching && !discoverQuery.isError);

  let body: ReactNode;
  if (showSkeleton) {
    body = <ChannelDirectorySkeleton label={t("chat.channel.directory_loading")} />;
  } else if (discoverQuery.isError && filtered.length === 0) {
    body = (
      <Notice
        tone="destructive"
        icon={CircleAlert}
        layout="inline"
        live="assertive"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={CHAT_PILL_SM_CLASS}
            onClick={() => void discoverQuery.refetch()}
          >
            {t("chat.retry")}
          </Button>
        }
      >
        {t("chat.channel.directory_load_failed")}
      </Notice>
    );
  } else if (filtered.length === 0 && trimmedQuery) {
    body = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IconTile icon={Search} tone="muted" size="lg" className={CHAT_EMPTY_TILE_CLASS} />
          </EmptyMedia>
          <EmptyTitle className={CHAT_EMPTY_TITLE_CLASS}>
            {t("chat.channel.directory_no_match_title", { query: trimmedQuery })}
          </EmptyTitle>
          <EmptyDescription className="text-caption">
            {t("chat.channel.directory_no_match_hint")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="secondary" size="sm" className={CHAT_PILL_SM_CLASS} onClick={() => setQuery("")}>
            {t("chat.channel.directory_clear_search")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else if (filtered.length === 0) {
    body = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IconTile icon={Compass} tone="brand" size="lg" className={CHAT_EMPTY_TILE_CLASS} />
          </EmptyMedia>
          <EmptyTitle className={CHAT_EMPTY_TITLE_CLASS}>{t("chat.channel.directory_none_title")}</EmptyTitle>
          <EmptyDescription className="text-caption">
            {onCreateChannel
              ? t("chat.channel.directory_none_hint")
              : t("chat.channel.directory_none_hint_where")}
          </EmptyDescription>
        </EmptyHeader>
        {onCreateChannel ? (
          <EmptyContent>
            <Button type="button" size="sm" className={CHAT_PILL_SM_CLASS} onClick={onCreateChannel}>
              <Plus aria-hidden />
              {t("chat.channel.create")}
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  } else {
    body = (
      <ul className="space-y-0.5">
        {filtered.map((room) => {
          const isMember = memberChannelIds.has(room.id) || mineIds.has(room.id);
          const isPrivate = room.visibility === "private";
          const joining = joiningIds.has(room.id);
          const topic = (room.topic ?? "").trim();
          return (
            <li
              key={room.id}
              className="flex min-h-17 items-center gap-3 rounded-xl py-2.5 pr-2.5 pl-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
            >
              {/* The channel squircle: slate with a white # (or lock for a private one). */}
              <IconTile
                icon={isPrivate ? Lock : Hash}
                tone="gray"
                variant="solid"
                size="md"
                className="size-11 rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-body-lg font-bold text-foreground">{room.name}</p>
                <p className="mt-0.5 truncate text-label text-muted-foreground">
                  {topic ||
                    (isPrivate
                      ? t("chat.channel.visibility_private_title")
                      : t("chat.channel.visibility_public_title"))}
                </p>
              </div>
              {isMember ? (
                // Already in: the way in is to open it.
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={cn("shrink-0", CHAT_PILL_SM_CLASS, "px-4")}
                  aria-label={t("chat.channel.open_named", { name: room.name })}
                  onClick={() => onJoined?.(room)}
                >
                  {t("chat.channel.open")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant={joining ? "outline" : "default"}
                  className={cn("shrink-0", CHAT_PILL_SM_CLASS, !joining && "px-4")}
                  aria-busy={joining || undefined}
                  aria-label={joining ? undefined : t("chat.channel.join_named", { name: room.name })}
                  disabled={joining}
                  onClick={() => handleJoin(room)}
                >
                  {joining ? <Spinner data-icon="inline-start" /> : null}
                  {joining ? t("chat.channel.joining") : t("chat.channel.join")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className={CHAT_SHEET_CLASS} closeLabel={t("common.close")}>
        <SheetHeader className="gap-1 pt-4.5 pr-16 pb-3.5 pl-6">
          <SheetTitle>{t("chat.channel.directory_title")}</SheetTitle>
          <SheetDescription>{t("chat.channel.directory_description")}</SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-5 pb-3.5">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chat.channel.directory_search")}
              aria-label={t("chat.channel.directory_search")}
              type="search"
              variant="subtle"
              className="h-11 rounded-full bg-muted pl-11.5 hover:bg-surface-hover md:text-body-lg dark:bg-muted"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
