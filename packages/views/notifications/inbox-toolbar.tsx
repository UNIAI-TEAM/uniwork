"use client";

import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
import { CATEGORY_TONE, INBOX_CATEGORIES, type InboxCategory } from "./notification-category";
import { useScrollEdges } from "./use-scroll-edges";

export type ReadFilter = "all" | "unread";
export type CategoryFilter = InboxCategory | "any";

const CHIP =
  "h-8 gap-1.5 rounded-md border border-transparent px-2.5 text-label font-medium text-muted-foreground pointer-coarse:h-11 " +
  "hover:bg-surface-hover hover:text-foreground aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)]";

/**
 * A two-way switch, not two buttons: a grey track with the chosen side
 * raised on it as a white thumb (the same raised surface a pressed category
 * chip takes), so which one is on reads without comparing two pale fills.
 */
const SEGMENT =
  "h-7 gap-1.5 rounded-md border border-transparent px-3 text-label font-medium text-muted-foreground pointer-coarse:h-10 " +
  "hover:bg-transparent hover:text-foreground aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)] aria-pressed:hover:bg-surface";

/**
 * The inbox's triage row: what kind of thing (left, one tap per category,
 * each with its module's dot and its unread count) and whether to see what
 * was already read (right). Counts are shown only when they are the whole
 * truth — when every unread row of the workspace is loaded — so a chip never
 * says "2" while a third sits on a page not fetched yet. On a phone the chips
 * scroll sideways, and an edge with more behind it fades.
 */
export function InboxToolbar({
  category,
  onCategory,
  read,
  onRead,
  unreadCounts,
  unreadTotal,
  ref,
}: {
  category: CategoryFilter;
  onCategory: (c: CategoryFilter) => void;
  read: ReadFilter;
  onRead: (r: ReadFilter) => void;
  /** Absent when the loaded rows do not hold every unread row. */
  unreadCounts?: Record<InboxCategory, number>;
  /** The workspace's unread count, from the server's badge. */
  unreadTotal: number;
  /** The toolbar's root: where focus goes when the inbox runs out of rows. */
  ref?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const strip = useScrollEdges<HTMLDivElement>();
  return (
    // Side by side from sm; on a phone the categories get the full width to
    // scroll in and the read filter sits on its own line under them.
    <div ref={ref} className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div
        ref={strip.ref}
        style={strip.style}
        className="-mx-1 w-full min-w-0 flex-1 overflow-x-auto px-1 py-1 [scrollbar-width:none] sm:w-auto"
      >
        <ToggleGroup
          value={[category]}
          onValueChange={(v) => {
            const next = v[0] as CategoryFilter | undefined;
            if (next) onCategory(next);
          }}
          aria-label={t("notifications.category_label")}
          spacing={1}
          className="w-max"
        >
          <ToggleGroupItem value="any" className={CHIP}>
            {t("notifications.category.any")}
          </ToggleGroupItem>
          {INBOX_CATEGORIES.map((c) => {
            const count = unreadCounts?.[c] ?? 0;
            return (
              <ToggleGroupItem key={c} value={c} className={CHIP}>
                <span aria-hidden className={cn("size-2 rounded-full", tintSolidClass[CATEGORY_TONE[c]])} />
                {t(`notifications.category.${c}`)}
                {count > 0 ? (
                  <>
                    <span
                      aria-hidden
                      className="min-w-5 rounded-sm bg-brand-subtle px-1 text-center text-micro leading-5 font-semibold tabular-nums text-brand-subtle-foreground"
                    >
                      {count}
                    </span>
                    <span className="sr-only">{`, ${t("notifications.category_unread", { count })}`}</span>
                  </>
                ) : null}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      <ToggleGroup
        value={[read]}
        onValueChange={(v) => {
          const next = v[0] as ReadFilter | undefined;
          if (next) onRead(next);
        }}
        aria-label={t("notifications.filter")}
        spacing={0.5}
        className="shrink-0 rounded-lg bg-muted p-0.5 pointer-coarse:p-0.5"
      >
        <ToggleGroupItem value="all" className={SEGMENT}>
          {t("notifications.filter_all")}
        </ToggleGroupItem>
        <ToggleGroupItem value="unread" className={SEGMENT}>
          {t("notifications.filter_unread")}
          {unreadTotal > 0 ? (
            <>
              <span aria-hidden className="text-caption font-semibold tabular-nums text-brand-subtle-foreground">
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
              <span className="sr-only">{`, ${t("notifications.category_unread", { count: unreadTotal })}`}</span>
            </>
          ) : null}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
