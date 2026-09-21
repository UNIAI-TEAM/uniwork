"use client";

import { Check, Compass, Hash, Lock, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
import { toastApiError } from "../toast-api-error";
import { ChatRoomMark } from "./chat-room-mark";

/** Channels are loading: rows in their own shape — a mark, a name, a line. */
function ChannelDirectorySkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-1" aria-busy>
      <span className="sr-only">{label}</span>
      {["w-32", "w-24", "w-40", "w-28"].map((w) => (
        <div key={w} className="flex items-center gap-3 px-2 py-2.5">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-20 rounded-full" />
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

  const discoverQuery = useChatChannels(
    workspaceId,
    { scope: "discoverable", q: query.trim() || undefined },
    open,
  );

  // Every keystroke is a new query key. Keep the last answer on screen and
  // narrow it locally while the server catches up, instead of flashing the
  // skeleton on each letter.
  const [lastRooms, setLastRooms] = useState<ChatRoomRecord[] | undefined>(undefined);
  if (discoverQuery.data && discoverQuery.data !== lastRooms) {
    setLastRooms(discoverQuery.data);
  }
  const rooms = discoverQuery.data ?? lastRooms;
  const trimmedQuery = query.trim();

  const filtered = useMemo(() => {
    const list = rooms ?? [];
    const q = trimmedQuery.toLowerCase();
    if (!q) return list;
    return list.filter(
      (room) =>
        room.name.toLowerCase().includes(q) ||
        (room.topic ?? "").toLowerCase().includes(q),
    );
  }, [rooms, trimmedQuery]);

  const setJoining = (roomId: string, joining: boolean) =>
    setJoiningIds((prev) => {
      const next = new Set(prev);
      if (joining) next.add(roomId);
      else next.delete(roomId);
      return next;
    });

  const handleJoin = (room: ChatRoomRecord) => {
    if (memberChannelIds.has(room.id) || joiningIds.has(room.id)) return;
    setJoining(room.id, true);
    void joinChannel
      .mutateAsync(room.id)
      .then((joined) => {
        if (joined) onJoined?.(joined);
        else toast.error(t("chat.channel.join_failed", { name: room.name }));
      })
      .catch((err: unknown) => toastApiError(err, t("chat.channel.join_failed", { name: room.name })))
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
      <div role="alert" className="flex flex-col items-start gap-2 px-2 py-2">
        <p className="text-body text-destructive">{t("chat.channel.directory_load_failed")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void discoverQuery.refetch()}>
          {t("chat.retry")}
        </Button>
      </div>
    );
  } else if (filtered.length === 0 && trimmedQuery) {
    body = (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IconTile icon={Search} tone="muted" size="lg" />
          </EmptyMedia>
          <EmptyTitle>{t("chat.channel.directory_no_match_title", { query: trimmedQuery })}</EmptyTitle>
          <EmptyDescription className="text-caption">
            {t("chat.channel.directory_no_match_hint")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
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
            <IconTile icon={Compass} tone={moduleTone("chat")} size="lg" />
          </EmptyMedia>
          <EmptyTitle>{t("chat.channel.directory_none_title")}</EmptyTitle>
          <EmptyDescription className="text-caption">
            {onCreateChannel
              ? t("chat.channel.directory_none_hint")
              : t("chat.channel.directory_none_hint_where")}
          </EmptyDescription>
        </EmptyHeader>
        {onCreateChannel ? (
          <EmptyContent>
            <Button type="button" size="sm" onClick={onCreateChannel}>
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
          const isMember = memberChannelIds.has(room.id);
          const isPrivate = room.visibility === "private";
          const joining = joiningIds.has(room.id);
          const topic = (room.topic ?? "").trim();
          return (
            <li
              key={room.id}
              className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
            >
              <ChatRoomMark icon={isPrivate ? Lock : Hash} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground">{room.name}</p>
                <p className="truncate text-caption text-muted-foreground">
                  {topic ||
                    (isPrivate
                      ? t("chat.channel.visibility_private_title")
                      : t("chat.channel.visibility_public_title"))}
                </p>
              </div>
              {isMember ? (
                <span className="inline-flex shrink-0 items-center gap-1 px-2 text-caption text-muted-foreground">
                  <Check className="size-3.5" aria-hidden />
                  {t("chat.channel.joined")}
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant={joining ? "outline" : "default"}
                  className="shrink-0 rounded-full"
                  aria-busy={joining || undefined}
                  aria-label={joining ? undefined : t("chat.channel.join_named", { name: room.name })}
                  disabled={joining}
                  onClick={() => handleJoin(room)}
                >
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
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b border-border px-5 py-4">
          <SheetTitle>{t("chat.channel.directory_title")}</SheetTitle>
          <SheetDescription>{t("chat.channel.directory_description")}</SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chat.channel.directory_search")}
              aria-label={t("chat.channel.directory_search")}
              type="search"
              className="h-10 rounded-full pl-9"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
