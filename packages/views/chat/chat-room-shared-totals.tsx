"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, File, Image, Link, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sharedItemsFromMessages } from "./chat-person-shared";
import { SharedPhotoGallery } from "./shared-photo-gallery";
import { loadSharedRoomMessages } from "./use-person-shared";

const ROOM_KINDS = ["photo", "video", "file", "link", "gif"] as const;
type RoomSharedKind = (typeof ROOM_KINDS)[number];

const ROW_ICON: Record<Exclude<RoomSharedKind, "gif">, LucideIcon> = {
  photo: Image,
  video: Video,
  file: File,
  link: Link,
};

function labelKey(kind: RoomSharedKind): string {
  if (kind === "photo") return "chat.person_shared_photos";
  if (kind === "video") return "chat.person_shared_videos";
  if (kind === "file") return "chat.person_shared_files";
  if (kind === "link") return "chat.person_shared_links";
  return "chat.person_shared_gifs";
}

function Mark({ kind }: { kind: RoomSharedKind }) {
  const { t } = useTranslation();
  if (kind === "gif") {
    return (
      <span className="w-5 text-center text-caption font-semibold text-muted-foreground">
        {t("chat.person_shared_gif_mark")}
      </span>
    );
  }
  const Icon = ROW_ICON[kind];
  return <Icon className="size-4 text-muted-foreground" aria-hidden />;
}

/** Totals for the open room: photos, videos, files, links and GIFs. */
export function ChatRoomSharedTotals({
  workspaceId,
  roomId,
  open,
}: {
  workspaceId: string;
  roomId: string;
  open: boolean;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<RoomSharedKind | null>(null);
  const query = useQuery({
    queryKey: ["chat-person-shared", workspaceId, roomId],
    queryFn: () => loadSharedRoomMessages(workspaceId, roomId),
    enabled: open && !!workspaceId && !!roomId,
    staleTime: 30_000,
  });
  const items = sharedItemsFromMessages(query.data ?? []);

  if (!open) return null;
  if (query.isPending) {
    return (
      <p className="border-y border-border px-4 py-3 text-caption text-muted-foreground" role="status">
        {t("chat.person_shared_loading")}
      </p>
    );
  }

  if (kind) {
    const list = items[kind];
    return (
      <div className="border-y border-border">
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            type="button"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md hover:bg-surface-hover"
            onClick={() => setKind(null)}
            aria-label={t("chat.person_shared_back")}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate text-body font-semibold">{t(labelKey(kind), { count: list.length })}</p>
        </div>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-caption text-muted-foreground">{t("chat.person_shared_empty")}</p>
        ) : kind === "photo" || kind === "gif" ? (
          <SharedPhotoGallery items={list} workspaceId={workspaceId} roomId={roomId} />
        ) : (
          <div>
            {list.map((item) => (
              <div key={item.id} className="border-t border-border px-4 py-2.5">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-body hover:underline">
                    {item.title}
                  </a>
                ) : (
                  <p className="truncate text-body">{item.title}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-y border-border">
      {ROOM_KINDS.map((row) => (
        <button
          key={row}
          type="button"
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-body text-foreground hover:bg-surface-hover"
          onClick={() => setKind(row)}
        >
          <Mark kind={row} />
          {t(labelKey(row), { count: items[row].length })}
        </button>
      ))}
      {query.isError ? (
        <p className="px-4 pb-3 text-caption text-muted-foreground">{t("chat.person_shared_unavailable")}</p>
      ) : null}
    </div>
  );
}
