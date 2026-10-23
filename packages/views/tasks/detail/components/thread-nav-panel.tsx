"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessagesSquare, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  createShortcutChord,
  useShortcut,
} from "@uniwork/core/shortcuts";
import { isImeComposing } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ShortcutKeycaps } from "../../../editor/shortcut-keycaps";
import { pickerNavigationDirection } from "../../../editor/picker-keys";
import { ThreadNavRow } from "./thread-nav-row";
import {
  commentThreadPreview,
  matchesFilter,
  threadDayGroup,
  type ThreadDayGroup,
  type ThreadNavFilter,
  type ThreadNavThread,
} from "./thread-nav-helpers";

/** Below this the header button is noise — a task with no discussion. */
const MIN_THREADS = 1;

/** Hover intent delay before the preview opens. */
const HOVER_OPEN_DELAY_MS = 200;
/** Grace period on leave — long enough to travel from the button into the panel. */
const HOVER_CLOSE_DELAY_MS = 200;

const KEY_UP = createShortcutChord("Up");
const KEY_DOWN = createShortcutChord("Down");
const KEY_ENTER = createShortcutChord("Enter");
const KEY_ESCAPE = createShortcutChord("Escape");

type PreparedThread = {
  thread: ThreadNavThread;
  title: string;
  excerpt: string;
  authorName: string;
  group: ThreadDayGroup;
  haystack: string;
};

export type { ThreadNavThread };

/**
 * Header entry point for jumping between comment threads. Hover previews;
 * press (or the page shortcut) pins so search, filters, and arrow keys work.
 */
export function ThreadNavPanel({
  threads,
  onJump,
  onHoverThread,
  open,
  pinned,
  onOpenChange,
  getActorName,
}: {
  threads: ThreadNavThread[];
  onJump: (threadId: string) => void;
  onHoverThread: (threadId: string | null) => void;
  open: boolean;
  pinned: boolean;
  onOpenChange: (open: boolean, pinned: boolean) => void;
  getActorName: (kind: string, id: string) => string;
}) {
  const { t } = useTranslation();
  const openShortcutChord = useShortcut("openThreadNav");
  const listId = useId();
  const optionId = useCallback(
    (threadId: string) => `${listId}-${threadId}`,
    [listId],
  );

  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ThreadNavFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previewCacheRef = useRef(
    new Map<string, { content: string | undefined; preview: { title: string; body: string } }>(),
  );

  const prepared = useMemo<PreparedThread[]>(() => {
    const nowMs = Date.now();
    const nextCache = new Map<
      string,
      { content: string | undefined; preview: { title: string; body: string } }
    >();
    const rows = threads.map((thread) => {
      const cached = previewCacheRef.current.get(thread.id);
      const preview =
        cached && cached.content === thread.entry.body
          ? cached.preview
          : commentThreadPreview(thread.entry.body ?? "");
      nextCache.set(thread.id, { content: thread.entry.body, preview });
      const authorName = getActorName(
        thread.entry.author_kind ?? "human",
        thread.entry.author_id,
      );
      const title = preview.title || authorName;
      return {
        thread,
        title,
        excerpt: preview.body,
        authorName,
        group: threadDayGroup(thread.entry.created_at, nowMs),
        haystack: `${title}\n${preview.body}\n${authorName}`.toLowerCase(),
      };
    });
    previewCacheRef.current = nextCache;
    return rows;
  }, [threads, getActorName]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return prepared.filter(
      (row) =>
        matchesFilter(row.thread, filter) &&
        (needle === "" || row.haystack.includes(needle)),
    );
  }, [prepared, filter, query]);

  const counts = useMemo(
    () => ({
      all: threads.length,
      unresolved: threads.filter((th) => !th.resolved).length,
      resolved: threads.filter((th) => th.resolved).length,
      mine: threads.filter((th) => th.involvesMe).length,
    }),
    [threads],
  );

  const openRef = useRef(open);
  useEffect(() => {
    if (open && !openRef.current) {
      setQuery("");
      setFilter("all");
      setActiveIndex(0);
    }
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    setActiveIndex((prev) =>
      prev >= rows.length ? Math.max(0, rows.length - 1) : prev,
    );
  }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    const row = rows[activeIndex];
    if (!row) return;
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-thread-id="${CSS.escape(row.thread.id)}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, rows]);

  const pin = useCallback(() => onOpenChange(true, true), [onOpenChange]);

  useEffect(() => {
    if (!open || !pinned) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, pinned]);

  const close = useCallback(() => {
    onHoverThread(null);
    onOpenChange(false, false);
  }, [onHoverThread, onOpenChange]);

  const jump = useCallback(
    (threadId: string) => {
      onHoverThread(null);
      onJump(threadId);
      onOpenChange(false, false);
    },
    [onHoverThread, onJump, onOpenChange],
  );

  const handleOpenChange = useCallback(
    (next: boolean, details: { reason?: string }) => {
      const reason = details?.reason;
      if (next) {
        if (reason === "trigger-press") pin();
        else onOpenChange(true, false);
        return;
      }
      if (reason === "trigger-press" && !pinned) {
        pin();
        return;
      }
      if (pinned && reason === "trigger-hover") return;
      close();
    },
    [close, pin, pinned, onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.target !== searchRef.current) return;
      const direction = pickerNavigationDirection(e.nativeEvent);
      if (direction) {
        e.preventDefault();
        if (rows.length === 0) return;
        const step = direction === "next" ? 1 : -1;
        setActiveIndex((prev) => (prev + step + rows.length) % rows.length);
        return;
      }
      if (e.key === "Enter") {
        const row = rows[activeIndex];
        if (!row) return;
        e.preventDefault();
        jump(row.thread.id);
      }
    },
    [activeIndex, jump, rows],
  );

  if (threads.length < MIN_THREADS) return null;

  const buttonLabel = t("tasks.detail.thread_nav.button_label", {
    count: threads.length,
  });

  const filterPills: { id: ThreadNavFilter; label: string; count: number }[] = [
    {
      id: "all",
      label: t("tasks.detail.thread_nav.filter_all"),
      count: counts.all,
    },
    {
      id: "unresolved",
      label: t("tasks.detail.thread_nav.filter_unresolved"),
      count: counts.unresolved,
    },
    {
      id: "resolved",
      label: t("tasks.detail.thread_nav.filter_resolved"),
      count: counts.resolved,
    },
    {
      id: "mine",
      label: t("tasks.detail.thread_nav.filter_mine"),
      count: counts.mine,
    },
  ];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              openOnHover
              delay={HOVER_OPEN_DELAY_MS}
              closeDelay={HOVER_CLOSE_DELAY_MS}
              render={
                <Button
                  type="button"
                  variant={open ? "secondary" : "ghost"}
                  size="sm"
                  aria-label={buttonLabel}
                  data-testid="task-thread-nav-trigger"
                  className={cn(
                    "h-7 gap-1.5 px-2",
                    !open && "text-muted-foreground",
                  )}
                />
              }
            >
              <MessagesSquare className="size-4" aria-hidden />
              <span className="text-caption font-medium tabular-nums">
                {threads.length}
              </span>
            </PopoverTrigger>
          }
        />
        <TooltipContent side="bottom">
          {buttonLabel}
          {openShortcutChord ? (
            <ShortcutKeycaps
              shortcut={openShortcutChord}
              decorative
              className="ml-1.5"
            />
          ) : null}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        alignOffset={24}
        initialFocus={false}
        data-testid="task-thread-nav-panel"
        onKeyDown={handleKeyDown}
        onFocusCapture={pinned ? undefined : pin}
        className="flex w-[400px] flex-col gap-0 p-0"
      >
        <div className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
          <Search className="size-4 shrink-0 text-faint-foreground" aria-hidden />
          <input
            ref={searchRef}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              rows[activeIndex]
                ? optionId(rows[activeIndex]!.thread.id)
                : undefined
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("tasks.detail.thread_nav.search_placeholder")}
            aria-label={t("tasks.detail.thread_nav.search_placeholder")}
            className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-faint-foreground"
          />
          {query.trim() !== "" ? (
            <span className="shrink-0 text-caption tabular-nums text-faint-foreground">
              {t("tasks.detail.thread_nav.match_count", { count: rows.length })}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-2">
          {filterPills.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => {
                setFilter(pill.id);
                setActiveIndex(0);
              }}
              data-active={filter === pill.id || undefined}
              className={cn(
                "flex h-7 items-center gap-1 rounded-full px-2 text-caption text-muted-foreground transition-colors",
                "hover:bg-surface-hover",
                "data-active:bg-surface-selected data-active:font-medium data-active:text-foreground data-active:hover:bg-surface-selected",
              )}
            >
              {pill.label}
              <span className="tabular-nums text-faint-foreground">
                {pill.count}
              </span>
            </button>
          ))}
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t("tasks.detail.thread_nav.search_placeholder")}
          onScroll={pinned ? undefined : pin}
          className="max-h-[26rem] min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-caption text-muted-foreground">
              {t("tasks.detail.thread_nav.empty")}
            </p>
          ) : (
            rows.map((row, i) => {
              const prev = rows[i - 1];
              const showHeader = !prev || prev.group !== row.group;
              return (
                <div key={row.thread.id}>
                  {showHeader ? (
                    <p className="px-2 pb-1 pt-3 text-micro font-medium text-faint-foreground">
                      {t(`tasks.detail.thread_nav.group.${row.group}`)}
                    </p>
                  ) : null}
                  <ThreadNavRow
                    prepared={row}
                    isActive={i === activeIndex}
                    optionId={optionId(row.thread.id)}
                    query={query}
                    onJump={() => jump(row.thread.id)}
                    onHover={onHoverThread}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-3.5 text-micro text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-0.5">
              <ShortcutKeycaps shortcut={KEY_UP} />
              <ShortcutKeycaps shortcut={KEY_DOWN} />
            </span>
            {t("tasks.detail.thread_nav.hint_select")}
          </span>
          <span className="flex items-center gap-1.5">
            <ShortcutKeycaps shortcut={KEY_ENTER} />
            {t("tasks.detail.thread_nav.hint_jump")}
          </span>
          <span className="flex items-center gap-1.5">
            <ShortcutKeycaps shortcut={KEY_ESCAPE} />
            {t("tasks.detail.thread_nav.hint_close")}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
