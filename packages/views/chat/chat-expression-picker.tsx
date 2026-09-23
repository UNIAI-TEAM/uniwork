"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Search,
  Smile,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatGifs, useChatStickers } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatGifItem, ChatStickerItem, ChatStickerPack } from "./chat-expression-catalog";
import { formatChatMediaMessageBody, normalizeExpressionSearchQuery } from "./chat-expression-utils";
import { filterStickerPacks, loadChatStickerPacks } from "./chat-sticker-packs";
import { ComposerToolbarButton } from "./chat-composer-attach-menu";

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

/**
 * Arrow keys move through a grid of stickers or GIFs, one tab stop for the
 * whole grid (roving tabindex): Tab enters on the current tile and leaves
 * the grid, arrows move by one or by a row, Home and End jump to the ends.
 */
function onGridKeyDown(event: KeyboardEvent<HTMLUListElement>, columns: number) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-grid-item]"));
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const last = items.length - 1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "ArrowRight"
            ? Math.min(index + 1, last)
            : event.key === "ArrowUp"
              ? index - columns >= 0
                ? index - columns
                : index
              : Math.min(index + columns, last);
  items.forEach((item, i) => item.setAttribute("tabindex", i === next ? "0" : "-1"));
  items[next]?.focus();
}

function PickerEmpty({ label }: { label: string }) {
  return <p className="px-6 py-10 text-center text-caption text-pretty text-muted-foreground">{label}</p>;
}

/** Loading in the grid's own shape: tiles where the stickers or GIFs will land. */
function PickerGridSkeleton({ columns, label }: { columns: 2 | 4; label: string }) {
  return (
    <div className={cn("grid gap-2 p-3", columns === 4 ? "grid-cols-4" : "grid-cols-2")} aria-busy>
      <span className="sr-only">{label}</span>
      {Array.from({ length: columns === 4 ? 12 : 6 }, (_, i) => (
        <Skeleton key={i} className={cn("rounded-lg", columns === 4 ? "size-16" : "aspect-video w-full")} />
      ))}
    </div>
  );
}

function StickerGrid({
  stickers,
  onSelect,
  emptyLabel,
}: {
  stickers: ChatStickerItem[];
  onSelect: (sticker: ChatStickerItem) => void;
  emptyLabel: string;
}) {
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleStickers = stickers.filter((sticker) => !brokenIds.has(sticker.id));

  if (visibleStickers.length === 0) {
    return <PickerEmpty label={emptyLabel} />;
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys bubble up from the tile buttons; the list itself takes no focus
    <ul className="grid grid-cols-4 gap-2 px-3 pb-3" onKeyDown={(event) => onGridKeyDown(event, 4)}>
      {visibleStickers.map((sticker, index) => (
        <li key={sticker.id}>
          <button
            type="button"
            data-grid-item
            tabIndex={index === 0 ? 0 : -1}
            className="flex size-16 items-center justify-center rounded-lg transition-colors duration-(--duration-fast) hover:bg-surface-hover"
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

function GifGrid({
  items,
  onSelect,
  emptyLabel,
}: {
  items: ChatGifItem[];
  onSelect: (item: ChatGifItem) => void;
  emptyLabel: string;
}) {
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleItems = items.filter((item) => !brokenIds.has(item.id));

  if (visibleItems.length === 0) {
    return <PickerEmpty label={emptyLabel} />;
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys bubble up from the tile buttons; the list itself takes no focus
    <ul className="grid grid-cols-2 gap-2 px-3 pb-3" onKeyDown={(event) => onGridKeyDown(event, 2)}>
      {visibleItems.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            data-grid-item
            tabIndex={index === 0 ? 0 : -1}
            className="overflow-hidden rounded-lg border border-border bg-muted transition-colors duration-(--duration-fast) hover:border-ring"
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
  const [stickersFailed, setStickersFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // The emoji sticker packs load with the picker; a failure says so and
  // offers another try instead of showing an empty grid as if none existed.
  const loadPacks = useCallback(() => {
    setStickersLoading(true);
    setStickersFailed(false);
    void loadChatStickerPacks()
      .then((packs) => {
        setStickerPacks(packs);
        setActivePackIndex(0);
      })
      .catch(() => setStickersFailed(true))
      .finally(() => setStickersLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadPacks();
  }, [loadPacks, open]);

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

  const {
    data: gifRecords = [],
    isFetching: gifsLoading,
    isError: gifsFailed,
    refetch: refetchGifs,
  } = useChatGifs(
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

  const searchField = (
    <div className="border-b border-border px-3 py-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-8 pl-8"
        />
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <ComposerToolbarButton
            label={t("chat.expression_picker_open")}
            disabled={disabled}
            className={className}
          >
            <Smile className="size-5" aria-hidden />
          </ComposerToolbarButton>
        }
      />
      <PopoverContent
        align={align}
        side="top"
        className={cn(
          "flex flex-col overflow-hidden p-0",
          // Never taller than the room the popover has above the composer.
          expanded
            ? "h-[min(32.5rem,var(--available-height))] w-[min(30rem,calc(100vw-2rem))]"
            : "h-[min(25rem,var(--available-height))] w-[min(22.5rem,calc(100vw-2rem))]",
        )}
      >
        {/* Registry tabs: arrow keys between tabs, each panel labelled by its tab. */}
        <Tabs value={tab} onValueChange={(next) => setTab(next as ExpressionTab)} className="min-h-0 flex-1 gap-0">
          <div className="flex items-center border-b border-border px-2 py-1.5">
            <TabsList variant="line" className="min-w-0 flex-1 justify-start" aria-label={t("chat.expression_picker_tabs")}>
              <TabsTrigger value="sticker" className="flex-none px-2.5">
                {t("chat.expression_tab_sticker")}
              </TabsTrigger>
              <TabsTrigger value="emoji" className="flex-none px-2.5">
                {t("chat.expression_tab_emoji")}
              </TabsTrigger>
              <TabsTrigger value="gif" className="flex-none px-2.5">
                {t("chat.expression_tab_gif")}
              </TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={expanded ? t("chat.expression_collapse") : t("chat.expression_expand")}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            </Button>
          </div>

          <TabsContent value="sticker" className="flex min-h-0 flex-col">
            {searchField}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {stickersLoading || tenorStickersLoading ? (
                <PickerGridSkeleton columns={4} label={t("common.loading")} />
              ) : stickersFailed && filteredPacks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
                  <p className="text-caption text-pretty text-muted-foreground">
                    {t("chat.message_list.stickers_failed")}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={loadPacks}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="px-3 pt-3 pb-1 text-overline text-muted-foreground uppercase">
                    {activePack?.name ?? t("chat.expression_tab_sticker")}
                  </p>
                  <StickerGrid
                    stickers={visibleStickers}
                    onSelect={sendSticker}
                    emptyLabel={t("chat.expression_stickers_empty")}
                  />
                </>
              )}
            </div>
            {filteredPacks.length > 0 ? (
              <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={t("chat.expression_prev_pack")}
                  onClick={() =>
                    setActivePackIndex((index) => (index <= 0 ? filteredPacks.length - 1 : index - 1))
                  }
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                  {filteredPacks.map((pack, index) => (
                    <button
                      key={pack.id}
                      type="button"
                      aria-label={pack.name}
                      aria-pressed={index === activePackIndex}
                      className={cn(
                        "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-title-sm transition-colors duration-(--duration-fast) pointer-coarse:size-11",
                        index === activePackIndex ? "bg-surface-selected" : "hover:bg-surface-hover",
                      )}
                      onClick={() => setActivePackIndex(index)}
                    >
                      {pack.coverUrl ? (
                        <img src={pack.coverUrl} alt="" className="size-6 object-contain" loading="lazy" />
                      ) : (
                        (pack.stickers[0]?.emoji ?? "🙂")
                      )}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={t("chat.expression_next_pack")}
                  onClick={() =>
                    setActivePackIndex((index) => (index >= filteredPacks.length - 1 ? 0 : index + 1))
                  }
                >
                  <ChevronRight aria-hidden />
                </Button>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="emoji" className="min-h-0 overflow-y-auto">
            <Suspense fallback={<PickerGridSkeleton columns={4} label={t("common.loading")} />}>
              <div className="h-full min-h-70 overflow-hidden [&_em-emoji-picker]:!w-full [&_em-emoji-picker]:!border-0">
                <EmojiPicker onSelect={handleEmojiSelect} />
              </div>
            </Suspense>
          </TabsContent>

          <TabsContent value="gif" className="flex min-h-0 flex-col">
            {searchField}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {gifsLoading ? (
                <PickerGridSkeleton columns={2} label={t("common.loading")} />
              ) : gifsFailed ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
                  <p className="text-caption text-pretty text-muted-foreground">{t("chat.message_list.gifs_failed")}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void refetchGifs()}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : (
                <GifGrid items={gifItems} onSelect={sendGif} emptyLabel={t("chat.expression_gifs_empty")} />
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
