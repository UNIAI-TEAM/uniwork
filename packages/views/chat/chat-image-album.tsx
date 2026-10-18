"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { ChatImagePreviewDialog } from "./chat-image-preview-dialog";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { ChatMessageA11yLabel, ChatMessageMeta, chatMessageLabelId } from "./chat-message-parts";
import { CHAT_BUBBLE_OTHER, CHAT_BUBBLE_OWN, CHAT_ROW_HOVER, chatBubbleShape } from "./chat-message-row";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatSenderAvatar } from "./chat-sender-avatar";
import { MessageTaskCard } from "./message-task-card";
import { senderNameClass } from "./sender-colors";
import { useChatFileDownload } from "./use-chat-file-download";
import { useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media-url";
import { useMessageActionsReveal } from "./use-message-actions-reveal";

type MessageAction = (message: ChatMessage) => void;

type AlbumActions = {
  onReply?: MessageAction;
  onReact?: MessageAction;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onThread?: MessageAction;
  onPin?: MessageAction;
  onCopy?: MessageAction;
  onDelete?: MessageAction;
  onCreateTask?: MessageAction;
  onLinkTask?: MessageAction;
  onFollowUp?: MessageAction;
};

/** Tiles the grid shows; the rest open from the "+N" tile in the viewer. */
const ALBUM_VISIBLE = 4;

/** The grid by how many tiles show (canvas: 3 = a tall photo beside two). */
const GRID_CLASS: Record<number, string> = {
  2: "grid-cols-2 grid-rows-[12rem]",
  3: "grid-cols-[1.55fr_1fr] grid-rows-[repeat(2,6.5rem)]",
  4: "grid-cols-2 grid-rows-[repeat(2,8rem)]",
};

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_CLASS: Record<Corner, string> = {
  tl: "rounded-tl-xl",
  tr: "rounded-tr-xl",
  bl: "rounded-bl-xl",
  br: "rounded-br-xl",
};
/** Which of each tile's corners meet the bubble's edge, by tile count. */
const OUTER_CORNERS: Record<number, Corner[][]> = {
  2: [["tl", "bl"], ["tr", "br"]],
  3: [["tl", "bl"], ["tr"], ["br"]],
  4: [["tl"], ["tr"], ["bl"], ["br"]],
};

/** Outer corners follow the bubble, inner ones and the sender's tail corner stay tight (canvas 15 / 4). */
function tileCorners(index: number, visible: number, isOwn: boolean): string {
  const tail: Corner = isOwn ? "br" : "bl";
  return cn(
    "rounded-xs",
    (OUTER_CORNERS[visible]?.[index] ?? []).filter((corner) => corner !== tail).map((corner) => CORNER_CLASS[corner]),
  );
}

/** The original of the photo on show, signed fresh; null while it loads. */
function useViewerSrc(workspaceId: string, roomId: string, image: ChatMessage | undefined, onFail: () => void) {
  const { t } = useTranslation();
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  const [shown, setShown] = useState<{ id: string; src: string } | null>(null);
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    freshUrl(image.id, { url: image.file?.url, expiresAt: image.file?.url_expires_at }, (fresh) => fresh.file?.url).then(
      (src) => {
        if (!cancelled) setShown({ id: image.id, src });
      },
      (err: unknown) => {
        if (cancelled) return;
        onFail();
        toastChatError(err, t, t("chat.file_download_failed"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [freshUrl, image, onFail, t]);
  return image && shown?.id === image.id ? shown.src : null;
}

function AlbumTile({
  workspaceId,
  roomId,
  message,
  isOwn,
  anchor,
  className,
  moreCount,
  onOpen,
  actions,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  isOwn: boolean;
  /** Carries the message's id for jump-to-message (the album's first photo uses the article's). */
  anchor: boolean;
  className: string;
  /** Photos past this tile, shown as "+N" over it. */
  moreCount: number;
  onOpen: () => void;
  actions: AlbumActions;
}) {
  const { t } = useTranslation();
  const reveal = useMessageActionsReveal();
  const file = message.file;
  const name = file?.filename || t("chat.file_untitled");
  const { src, status, onError } = useChatMediaSrc(
    workspaceId,
    roomId,
    message.id,
    file?.thumb_url || file?.url,
    file?.url_expires_at,
  );
  return (
    // Each photo is its own message: hover or long-press shows that photo's actions above it.
    <div
      ref={reveal.rootRef}
      {...reveal.bind}
      className={cn(
        "group/message relative min-h-0 min-w-0 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
        className,
      )}
    >
      <button
        type="button"
        id={anchor ? `chat-msg-${message.id}` : undefined}
        aria-label={t("chat.message_list.file_open_named", { name })}
        className="relative block size-full cursor-zoom-in overflow-hidden rounded-[inherit] bg-muted focus-visible:outline-offset-2"
        onClick={onOpen}
      >
        {status === "ready" && src ? (
          // Short-lived signed storage URL, not a public CDN asset.
          <img src={src} alt="" className="size-full object-cover" onError={onError} />
        ) : status === "error" ? (
          <ImageOff className="m-auto size-6 text-faint-foreground" aria-hidden />
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
        {moreCount > 0 ? (
          // The meeting stage's media colours are dark in both themes; foreground/background would flip to a pale wash in dark mode.
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center bg-meeting-video-bg/55 font-display text-title font-bold text-meeting-stage-foreground"
          >
            +{moreCount}
          </span>
        ) : null}
      </button>
      <ChatMessageHoverActions message={message} isOwn={isOwn} {...actions} canEdit={false} forceOpen={reveal.open} />
    </div>
  );
}

/** One photo in the viewer's strip; the one on show is ringed. */
function ViewerThumb({
  workspaceId,
  roomId,
  message,
  current,
  onPick,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  current: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const file = message.file;
  const { src, status, onError } = useChatMediaSrc(workspaceId, roomId, message.id, file?.thumb_url || file?.url, file?.url_expires_at);
  return (
    <button
      type="button"
      aria-label={t("chat.message_list.file_open_named", { name: file?.filename || t("chat.file_untitled") })}
      aria-current={current || undefined}
      onClick={onPick}
      className={cn(
        "h-12 w-16 shrink-0 overflow-hidden rounded-md bg-foreground/10",
        current && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
      )}
    >
      {status === "ready" && src ? <img src={src} alt="" className="size-full object-cover" onError={onError} /> : null}
    </button>
  );
}

function ChatImageAlbumRowImpl({
  workspaceId,
  roomId,
  album,
  senderLabel,
  senderAvatarUrl,
  isOwn,
  showSenderName,
  compactTop,
  showAvatar,
  nameContext = [],
  ...actions
}: AlbumActions & {
  workspaceId: string;
  roomId: string;
  /** Two or more photos from one sender, oldest first (imageAlbumSpans). */
  album: ChatMessage[];
  senderLabel: string;
  senderAvatarUrl?: string;
  isOwn: boolean;
  showSenderName: boolean;
  compactTop: boolean;
  showAvatar: boolean;
  nameContext?: ChatNameContextEntry[];
}) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const image = viewing === null ? undefined : album[viewing];
  const src = useViewerSrc(workspaceId, roomId, image, closeViewer);
  const { busy, download } = useChatFileDownload(workspaceId, roomId);
  const head = album[0];
  const last = album[album.length - 1];
  if (!head || !last) return null;
  const visible = Math.min(album.length, ALBUM_VISIBLE);
  const step = (by: number) => setViewing((index) => (index === null ? null : (index + by + album.length) % album.length));

  return (
    <article
      id={`chat-msg-${head.id}`}
      aria-labelledby={chatMessageLabelId(head.id)}
      tabIndex={-1}
      className={cn(
        "flex w-full max-w-full rounded-lg focus-visible:outline-offset-2",
        CHAT_ROW_HOVER,
        isOwn ? "justify-end" : "justify-start",
        compactTop ? "mt-0.5" : "mt-3",
      )}
    >
      <ChatMessageA11yLabel messageId={head.id} senderLabel={senderLabel} ts={head.ts} />
      <div className={cn("flex max-w-[min(85%,26rem)] gap-2", isOwn && "flex-row-reverse")}>
        {isOwn ? null : showAvatar ? (
          <span className="shrink-0 self-end">
            <ChatSenderAvatar userId={head.sender} name={senderLabel} avatarUrl={senderAvatarUrl} nameContext={nameContext} />
          </span>
        ) : (
          <span className="w-8.5 shrink-0" aria-hidden />
        )}
        <div className={cn("flex min-w-0 flex-col gap-1", isOwn ? "items-end" : "items-start")}>
          <div
            role="group"
            aria-label={t("chat.album_aria", { count: album.length })}
            className={cn("w-100 max-w-full p-0.75", chatBubbleShape(isOwn, !compactTop), isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER)}
          >
            {showSenderName && !isOwn && showAvatar ? (
              <p className={cn("px-2 pt-1 pb-1 text-label font-semibold", senderNameClass(head.sender, isOwn))} aria-hidden>
                {senderLabel}
              </p>
            ) : null}
            <div className={cn("grid gap-0.75", GRID_CLASS[visible])}>
              {album.slice(0, visible).map((message, index) => (
                <AlbumTile
                  key={message.id}
                  workspaceId={workspaceId}
                  roomId={roomId}
                  message={message}
                  isOwn={isOwn}
                  anchor={index > 0}
                  className={cn(tileCorners(index, visible, isOwn), visible === 3 && index === 0 && "row-span-2")}
                  moreCount={index === visible - 1 ? album.length - visible : 0}
                  onOpen={() => setViewing(index)}
                  actions={actions}
                />
              ))}
            </div>
            {/* Photos past the grid keep an anchor for jump-to-message: it lands on the album. */}
            {album.slice(visible).map((message) => (
              <span key={message.id} id={`chat-msg-${message.id}`} tabIndex={-1} className="sr-only" />
            ))}
            <div className="px-2 pb-0.5">
              <ChatMessageMeta message={last} isOwn={isOwn} showTime />
            </div>
          </div>
          {album.map((message) => (
            <MessageTaskCard key={message.id} workspaceId={workspaceId} messageId={message.id} isOwn={isOwn} />
          ))}
        </div>
      </div>
      <ChatImagePreviewDialog
        open={image !== undefined}
        name={image?.file?.filename || t("chat.file_untitled")}
        src={src}
        loading={!src}
        onOpenChange={(open) => {
          if (!open) closeViewer();
        }}
        sender={image ? { userId: image.sender, name: senderLabel, avatarUrl: senderAvatarUrl, ts: image.ts } : undefined}
        onDownload={image ? () => download(image) : undefined}
        downloading={busy}
        position={viewing === null ? undefined : { current: viewing + 1, total: album.length }}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        thumbnails={album.map((message, index) => (
          <ViewerThumb
            key={message.id}
            workspaceId={workspaceId}
            roomId={roomId}
            message={message}
            current={index === viewing}
            onPick={() => setViewing(index)}
          />
        ))}
      />
    </article>
  );
}

/** Photos one person sent back to back, as one bubble with a grid. Memoised like the other rows. */
export const ChatImageAlbumRow = memo(ChatImageAlbumRowImpl);
