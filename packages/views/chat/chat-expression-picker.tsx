"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Settings,
  Smile,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatGifs, useChatStickers } from "@uniwork/core/chat";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatGifItem, ChatStickerItem, ChatStickerPack } from "./chat-expression-catalog";
import { formatChatMediaMessageBody, normalizeExpressionSearchQuery } from "./chat-expression-utils";
import { filterStickerPacks, loadChatStickerPacks } from "./chat-sticker-packs";

const EmojiPicker = lazy(() =>
  import("@uniwork/ui/components/common/emoji-picker").then((module) => ({
    default: module.EmojiPicker,
  })),
);

const TENOR_STICKER_PACK_ID = "tenor-featured";

function tenorRecordsToPack(
  records: { id: string; label: string; url: string; previewUrl: string }[],
  name: string,
): ChatStickerPack | null {
  if (records.length === 0) return null;
  return {
    id: TENOR_STICKER_PACK_ID,
    name,
    coverUrl: records[0]?.previewUrl ?? records[0]?.url,
    stickers: records.map((item) => ({
      id: item.id,
      emoji: "✨",
      label: item.label,
      url: item.url,
    })),
  };
}

type ExpressionTab = "sticker" | "emoji" | "gif";

function ExpressionTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "relative px-3 py-2 text-caption font-semibold uppercase tracking-wide transition-colors",
        active ? "text-brand" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
      {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" aria-hidden /> : null}
    </button>
  );
}

function MediaThumbnail({
  src,
  alt,
  className,
  onBroken,
}: {
  src: string;
  alt: string;
  className?: string;
  onBroken: () => void;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={onBroken}
    />
  );
}

function StickerGrid({
  stickers,
  onSelect,
}: {
  stickers: ChatStickerItem[];
  onSelect: (sticker: ChatStickerItem) => void;
}) {
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleStickers = stickers.filter((sticker) => !brokenIds.has(sticker.id));

  if (visibleStickers.length === 0) {
    return <p className="px-3 py-6 text-center text-caption text-muted-foreground">—</p>;
  }

  return (
    <ul className="grid grid-cols-4 gap-2 px-3 pb-3">
      {visibleStickers.map((sticker) => (
        <li key={sticker.id}>
          <button
            type="button"
            className="flex size-16 items-center justify-center rounded-lg transition-colors hover:bg-muted"
            aria-label={sticker.label}
            onClick={() => onSelect(sticker)}
          >
            <MediaThumbnail
              src={sticker.url}
              alt=""
              className="size-12 object-contain"
              onBroken={() => setBrokenIds((prev) => new Set(prev).add(sticker.id))}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function GifGrid({ items, onSelect }: { items: ChatGifItem[]; onSelect: (item: ChatGifItem) => void }) {
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleItems = items.filter((item) => !brokenIds.has(item.id));

  if (visibleItems.length === 0) {
    return <p className="px-3 py-6 text-center text-caption text-muted-foreground">—</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-2 px-3 pb-3">
      {visibleItems.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="overflow-hidden rounded-lg border border-border bg-muted/30 transition-colors hover:border-brand/40"
            aria-label={item.label}
            onClick={() => onSelect(item)}
          >
            <MediaThumbnail
              src={item.previewUrl}
              alt=""
              className="aspect-video w-full object-cover"
              onBroken={() => setBrokenIds((prev) => new Set(prev).add(item.id))}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ChatExpressionPicker({
  workspaceId,
  disabled,
  align = "start",
  className,
  onSelectEmoji,
  onSendMedia,
}: {
  workspaceId: string;
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
  onSelectEmoji: (emoji: string) => void;
  onSendMedia: (body: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ExpressionTab>("sticker");
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activePackIndex, setActivePackIndex] = useState(0);
  const [stickerPacks, setStickerPacks] = useState<ChatStickerPack[]>([]);
  const [stickersLoading, setStickersLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setStickersLoading(true);
    void loadChatStickerPacks()
      .then((packs) => {
        setStickerPacks(packs);
        setActivePackIndex(0);
      })
      .finally(() => setStickersLoading(false));
  }, [open]);

  const normalizedQuery = normalizeExpressionSearchQuery(query);
  const emojiPacks = useMemo(
    () => filterStickerPacks(stickerPacks, normalizedQuery),
    [stickerPacks, normalizedQuery],
  );

  const { data: tenorStickerRecords = [], isFetching: tenorStickersLoading } = useChatStickers(
    workspaceId,
    debouncedQuery,
    open && tab === "sticker",
  );

  const filteredPacks = useMemo(() => {
    const tenorName = debouncedQuery.trim()
      ? debouncedQuery.trim()
      : t("chat.expression_sticker_pack_featured");
    const tenorPack = tenorRecordsToPack(tenorStickerRecords, tenorName);
    return tenorPack ? [tenorPack, ...emojiPacks] : emojiPacks;
  }, [debouncedQuery, emojiPacks, tenorStickerRecords, t]);
  const activePack = filteredPacks[activePackIndex] ?? filteredPacks[0];
  const visibleStickers = activePack?.stickers ?? [];

  const { data: gifRecords = [], isFetching: gifsLoading } = useChatGifs(
    workspaceId,
    debouncedQuery,
    open && tab === "gif",
  );
  const gifItems = useMemo<ChatGifItem[]>(
    () =>
      gifRecords.map((item) => ({
        id: item.id,
        label: item.label,
        url: item.url,
        previewUrl: item.previewUrl,
      })),
    [gifRecords],
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setDebouncedQuery("");
      setExpanded(false);
    }
  };

  const sendSticker = (sticker: ChatStickerItem) => {
    onSendMedia(formatChatMediaMessageBody(sticker.url, `sticker:${sticker.label}`));
    setOpen(false);
  };

  const sendGif = (item: ChatGifItem) => {
    onSendMedia(formatChatMediaMessageBody(item.url, `gif:${item.label}`));
    setOpen(false);
  };

  const handleEmojiSelect = (emoji: string) => {
    onSelectEmoji(emoji);
    setOpen(false);
  };

  const searchPlaceholder =
    tab === "sticker"
      ? t("chat.expression_search_stickers")
      : tab === "gif"
        ? t("chat.expression_search_gifs")
        : t("chat.expression_search_emojis");

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={t("chat.expression_picker_open")}
            disabled={disabled}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              "disabled:pointer-events-none disabled:opacity-50",
              "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              className,
            )}
          >
            <Smile className="size-5" aria-hidden />
          </button>
        }
      />
      <PopoverContent
        align={align}
        side="top"
        className={cn(
          "flex flex-col overflow-hidden p-0",
          expanded ? "h-[520px] w-[min(480px,calc(100vw-2rem))]" : "h-[400px] w-[min(360px,calc(100vw-2rem))]",
        )}
      >
        <div className="flex items-center border-b border-border px-2 pt-1">
          <div className="flex min-w-0 flex-1 items-center" role="tablist" aria-label={t("chat.expression_picker_tabs")}>
            <ExpressionTabButton
              active={tab === "sticker"}
              label={t("chat.expression_tab_sticker")}
              onClick={() => setTab("sticker")}
            />
            <ExpressionTabButton
              active={tab === "emoji"}
              label={t("chat.expression_tab_emoji")}
              onClick={() => setTab("emoji")}
            />
            <ExpressionTabButton
              active={tab === "gif"}
              label={t("chat.expression_tab_gif")}
              onClick={() => setTab("gif")}
            />
          </div>
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expanded ? t("chat.expression_collapse") : t("chat.expression_expand")}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          </button>
        </div>

        {tab !== "emoji" ? (
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9 rounded-full border-border bg-muted/40 pl-9"
              />
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "sticker" ? (
            stickersLoading || tenorStickersLoading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-caption text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("common.loading")}
              </p>
            ) : (
              <>
                <p className="px-3 pt-3 pb-1 text-caption font-semibold text-foreground">
                  {activePack?.name ?? t("chat.expression_tab_sticker")}
                </p>
                <StickerGrid stickers={visibleStickers} onSelect={sendSticker} />
              </>
            )
          ) : null}

          {tab === "emoji" ? (
            <Suspense fallback={<p className="p-4 text-caption text-muted-foreground">{t("common.loading")}</p>}>
              <div className="h-full min-h-[280px] overflow-hidden [&_em-emoji-picker]:!w-full [&_em-emoji-picker]:!border-0">
                <EmojiPicker onSelect={handleEmojiSelect} />
              </div>
            </Suspense>
          ) : null}

          {tab === "gif" ? (
            gifsLoading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-caption text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("common.loading")}
              </p>
            ) : (
              <GifGrid items={gifItems} onSelect={sendGif} />
            )
          ) : null}
        </div>

        {tab === "sticker" && filteredPacks.length > 0 ? (
          <div className="flex items-center gap-1 border-t border-border px-2 py-2">
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label={t("chat.expression_prev_pack")}
              onClick={() =>
                setActivePackIndex((index) =>
                  index <= 0 ? filteredPacks.length - 1 : index - 1,
                )
              }
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {filteredPacks.map((pack, index) => (
                <button
                  key={pack.id}
                  type="button"
                  aria-label={pack.name}
                  aria-current={index === activePackIndex ? "true" : undefined}
                  className={cn(
                    "inline-flex size-10 shrink-0 items-center justify-center rounded-md border text-title-sm transition-colors",
                    index === activePackIndex
                      ? "border-brand/30 bg-brand/10"
                      : "border-transparent hover:bg-muted",
                  )}
                  onClick={() => setActivePackIndex(index)}
                >
                  {pack.coverUrl ? (
                    <img src={pack.coverUrl} alt="" className="size-7 object-contain" loading="lazy" />
                  ) : (
                    (pack.stickers[0]?.emoji ?? "🙂")
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label={t("chat.expression_next_pack")}
              onClick={() =>
                setActivePackIndex((index) =>
                  index >= filteredPacks.length - 1 ? 0 : index + 1,
                )
              }
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label={t("chat.expression_pack_settings")}
              disabled
            >
              <Settings className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label={t("chat.expression_add_pack")}
              disabled
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
