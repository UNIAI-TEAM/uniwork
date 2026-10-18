"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { cn } from "@uniwork/ui/lib/utils";
import { sharedItemsFromMessages } from "./chat-person-shared";
import { SharedItemList } from "./chat-person-shared-panel";
import { formatMessageDateTime } from "./chat-message-time";
import { ChatInfoSection } from "./chat-info-panel-parts";
import { SharedPhotoCell } from "./shared-photo-gallery";
import { loadSharedRoomMessages } from "./use-person-shared";
import { formatVoiceCallDuration } from "./voice-call-duration";

type MediaTab = "photo" | "file" | "link" | "voice";
const TABS: readonly MediaTab[] = ["photo", "file", "link", "voice"];
const NO_MESSAGES: ChatMessageRecord[] = [];
/** Photos shown before the last tile turns into "+N". */
const PHOTO_PREVIEW = 6;

const byNewest = (left: { at: string }, right: { at: string }) => Date.parse(right.at) - Date.parse(left.at);

/**
 * What the room has shared — photos, files, links, voice messages — as
 * scrollable pill tabs over a 3-column grid (photos) or a list. A photo or a
 * voice message jumps to where it was sent.
 */
export function ChatInfoMedia({
  workspaceId,
  roomId,
  onJumpToMessage,
}: {
  workspaceId: string;
  roomId: string;
  onJumpToMessage: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<MediaTab>("photo");
  const [allPhotos, setAllPhotos] = useState(false);
  // Same key as the settings sheet's totals: opening it reads this cache.
  // shortcut: counts cover the last 500 messages paged on the client; a server count endpoint replaces it when rooms outgrow that.
  const query = useQuery({
    queryKey: ["chat-person-shared", workspaceId, roomId],
    queryFn: () => loadSharedRoomMessages(workspaceId, roomId),
    enabled: !!workspaceId && !!roomId,
    staleTime: 30_000,
  });
  const messages = query.data ?? NO_MESSAGES;
  const { photos, files, links, voices } = useMemo(() => {
    const items = sharedItemsFromMessages(messages);
    return {
      photos: [...items.photo, ...items.gif].sort(byNewest),
      files: items.file.sort(byNewest),
      links: items.link.sort(byNewest),
      voices: messages.filter((message) => message.kind === "voice").sort((a, b) => byNewest({ at: a.created_at }, { at: b.created_at })),
    };
  }, [messages]);
  const counts: Record<MediaTab, number> = { photo: photos.length, file: files.length, link: links.length, voice: voices.length };
  const shownPhotos = allPhotos ? photos : photos.slice(0, PHOTO_PREVIEW);
  const hiddenPhotos = photos.length - PHOTO_PREVIEW;

  return (
    <ChatInfoSection className="pt-3">
      <div role="group" aria-label={t("chat.info_panel.media_aria")} className="-mx-1.5 mb-3 flex gap-1 overflow-x-auto">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            className={cn(
              "h-8 shrink-0 cursor-pointer rounded-full px-3 text-label font-semibold tabular-nums transition-colors duration-(--duration-fast)",
              tab === key ? "bg-brand-subtle text-brand-subtle-foreground" : "text-muted-foreground hover:bg-surface-hover",
            )}
            onClick={() => setTab(key)}
          >
            {t(`chat.info_panel.tab_${key}`, { count: counts[key] })}
          </button>
        ))}
      </div>
      <div>
        {query.isPending ? (
          <p role="status" className="py-2 text-caption text-muted-foreground">
            {t("chat.person_shared_loading")}
          </p>
        ) : query.isError ? (
          <p className="py-2 text-caption text-muted-foreground">{t("chat.person_shared_unavailable")}</p>
        ) : counts[tab] === 0 ? (
          <p className="py-2 text-caption text-muted-foreground">{t("chat.person_shared_empty")}</p>
        ) : tab === "photo" ? (
          <div className="grid grid-cols-3 gap-0.75">
            {shownPhotos.map((item, index) => {
              const more = !allPhotos && index === PHOTO_PREVIEW - 1 && hiddenPhotos > 0;
              return (
                <SharedPhotoCell
                  key={item.id}
                  item={item}
                  workspaceId={workspaceId}
                  roomId={roomId}
                  className="rounded-md"
                  onOpen={() => (more ? setAllPhotos(true) : onJumpToMessage(item.id))}
                >
                  {more ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-foreground/75 font-display text-body-lg font-extrabold text-background">
                      {t("chat.info_panel.more_photos", { count: hiddenPhotos })}
                    </span>
                  ) : null}
                </SharedPhotoCell>
              );
            })}
          </div>
        ) : tab === "voice" ? (
          <ul className="-mx-2">
            {voices.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover"
                  onClick={() => onJumpToMessage(message.id)}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand-subtle-foreground">
                    <Mic className="size-4" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-medium text-foreground">
                      {message.sender_display_name || t("chat.voice_message")}
                    </span>
                    <span className="truncate text-caption text-muted-foreground tabular-nums">
                      {formatVoiceCallDuration(Math.round((message.voice?.duration_ms ?? 0) / 1000))}
                      {" · "}
                      {formatMessageDateTime(Date.parse(message.created_at), i18n.language)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="-mx-5">
            <SharedItemList kind={tab} items={tab === "file" ? files : links} />
          </div>
        )}
      </div>
    </ChatInfoSection>
  );
}
