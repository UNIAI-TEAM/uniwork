"use client";

import { Hash, Lock, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatChannels, useJoinChatChannel } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";

export function ChannelDirectorySheet({
  open,
  onOpenChange,
  workspaceId,
  memberChannelIds,
  onJoined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  memberChannelIds: Set<string>;
  onJoined?: (room: ChatRoomRecord) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const joinChannel = useJoinChatChannel(workspaceId);

  const discoverQuery = useChatChannels(
    workspaceId,
    { scope: "discoverable", q: query.trim() || undefined },
    open,
  );

  const filtered = useMemo(() => {
    const rooms = discoverQuery.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (room) =>
        room.name.toLowerCase().includes(q) ||
        (room.topic ?? "").toLowerCase().includes(q),
    );
  }, [discoverQuery.data, query]);

  const handleJoin = (room: ChatRoomRecord) => {
    if (memberChannelIds.has(room.id) || joiningId) return;
    setJoiningId(room.id);
    void joinChannel
      .mutateAsync(room.id)
      .then((joined) => {
        if (joined) onJoined?.(joined);
      })
      .finally(() => setJoiningId(null));
  };

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

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {discoverQuery.isLoading ? (
            <p className="px-2 text-caption text-muted-foreground">{t("chat.channel.directory_loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 text-caption text-muted-foreground">{t("chat.channel.directory_empty")}</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((room) => {
                const isMember = memberChannelIds.has(room.id);
                const isPrivate = room.visibility === "private";
                return (
                  <li
                    key={room.id}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {isPrivate ? (
                        <Lock className="size-4" aria-hidden />
                      ) : (
                        <Hash className="size-4" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-foreground">#{room.name}</p>
                      {room.topic ? (
                        <p className="truncate text-caption text-muted-foreground">{room.topic}</p>
                      ) : (
                        <p className="text-caption text-muted-foreground">
                          {isPrivate
                            ? t("chat.channel.visibility_private")
                            : t("chat.channel.visibility_public")}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isMember ? "outline" : "default"}
                      className="shrink-0 rounded-full"
                      disabled={isMember || joiningId === room.id}
                      onClick={() => handleJoin(room)}
                    >
                      {isMember
                        ? t("chat.channel.joined")
                        : joiningId === room.id
                          ? t("chat.channel.joining")
                          : t("chat.channel.join")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
