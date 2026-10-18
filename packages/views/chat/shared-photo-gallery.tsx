"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Image } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { isChatMediaUrlFresh, useRefreshChatMessageMedia } from "@uniwork/core/chat";
import { parseChatMediaMessageBody } from "./chat-expression-utils";
import { groupSharedItemsByMonth, type PersonSharedItem } from "./chat-person-shared";

/** A square photo grid, newest month first, the way a chat gallery reads. */
export function SharedPhotoGallery({
  items,
  workspaceId,
  roomId,
}: {
  items: readonly PersonSharedItem[];
  workspaceId: string;
  roomId: string;
}) {
  const { i18n } = useTranslation();
  const groups = groupSharedItemsByMonth(items, i18n.language);
  const [zoom, setZoom] = useState<{ url: string; alt: string } | null>(null);

  if (zoom) {
    return (
      <button type="button" className="block w-full cursor-pointer bg-foreground/90 p-2" onClick={() => setZoom(null)}>
        <img alt={zoom.alt} src={zoom.url} className="max-h-[70vh] w-full object-contain" />
      </button>
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.key}>
          {group.label ? (
            <h3 className="px-4 pt-3 pb-2.5 text-body-lg font-semibold capitalize text-foreground">{group.label}</h3>
          ) : null}
          <div className="grid grid-cols-3 gap-0.5">
            {group.items.map((item) => (
              <SharedPhotoCell
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                roomId={roomId}
                onOpen={setZoom}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function signedThumb(item: PersonSharedItem): string {
  return item.thumbUrl || item.url || "";
}

/** One square thumbnail; its signed URL is re-signed when it has expired. */
export function SharedPhotoCell({
  item,
  workspaceId,
  roomId,
  onOpen,
  className,
  children,
}: {
  item: PersonSharedItem;
  workspaceId: string;
  roomId: string;
  onOpen: (image: { url: string; alt: string }) => void;
  className?: string;
  /** Drawn over the photo (the info panel's "+42"). */
  children?: ReactNode;
}) {
  const refresh = useRefreshChatMessageMedia(workspaceId, roomId);
  const initial = signedThumb(item);
  const fresh = isChatMediaUrlFresh(initial, item.expiresAt);
  const [src, setSrc] = useState(initial);

  useEffect(() => {
    if (fresh || !workspaceId || !roomId) return;
    let cancel = false;
    void refresh(item.id)
      .then((message) => {
        if (cancel || !message) return;
        const file = message.file?.thumb_url || message.file?.url || "";
        const media = file || parseChatMediaMessageBody(message.body)?.url || "";
        if (media) setSrc(media);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [fresh, item.id, refresh, roomId, workspaceId]);

  return (
    <button
      type="button"
      className={cn(
        "relative flex aspect-square cursor-zoom-in items-center justify-center overflow-hidden bg-muted",
        className,
      )}
      aria-label={item.title}
      onClick={() => src && onOpen({ url: src, alt: item.title })}
    >
      {src ? (
        <img alt="" src={src} className="size-full object-cover" />
      ) : (
        <Image className="size-5 text-muted-foreground" aria-hidden />
      )}
      {children}
    </button>
  );
}
