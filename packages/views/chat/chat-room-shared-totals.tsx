"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sharedItemsFromMessages } from "./chat-person-shared";
import { SharedItemList, SharedKindRow } from "./chat-person-shared-panel";
import { SharedPhotoGallery } from "./shared-photo-gallery";
import { loadSharedRoomMessages } from "./use-person-shared";

const ROOM_KINDS = ["photo", "video", "file", "link", "gif"] as const;
type RoomSharedKind = (typeof ROOM_KINDS)[number];

function labelKey(kind: RoomSharedKind): string {
  if (kind === "photo") return "chat.person_shared_photos";
  if (kind === "video") return "chat.person_shared_videos";
  if (kind === "file") return "chat.person_shared_files";
  if (kind === "link") return "chat.person_shared_links";
  return "chat.person_shared_gifs";
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
      <p className="border-t-8 border-muted px-5 py-3 text-caption text-muted-foreground" role="status">
        {t("chat.person_shared_loading")}
      </p>
    );
  }

  if (kind) {
    const list = items[kind];
    return (
      <section className="border-t-8 border-muted">
        <div className="flex h-14 items-center gap-1 border-b border-border pr-4 pl-1.5">
          <button
            type="button"
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-surface-hover"
            onClick={() => setKind(null)}
            aria-label={t("chat.person_shared_back")}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate font-display text-title-sm font-bold">
            {t(labelKey(kind), { count: list.length })}
          </p>
        </div>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-caption text-muted-foreground">{t("chat.person_shared_empty")}</p>
        ) : kind === "photo" || kind === "gif" ? (
          <SharedPhotoGallery items={list} workspaceId={workspaceId} roomId={roomId} />
        ) : (
          <SharedItemList kind={kind} items={list} />
        )}
      </section>
    );
  }

  return (
    <section className="border-t-8 border-muted py-0.5">
      {ROOM_KINDS.map((row) => (
        <SharedKindRow
          key={row}
          kind={row}
          label={t(labelKey(row), { count: items[row].length })}
          onClick={() => setKind(row)}
        />
      ))}
      {query.isError ? (
        <p className="px-5 pb-3 text-caption text-muted-foreground">{t("chat.person_shared_unavailable")}</p>
      ) : null}
    </section>
  );
}
