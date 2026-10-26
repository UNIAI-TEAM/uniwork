"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import { tablistKeyTarget } from "./tablist-keys";

/**
 * A tab's news. `info` is something new to read (unread chat, new items);
 * `attention` is something waiting on the viewer (people at the door, a vote).
 * Without a count it is a dot. `srLabel` joins the tab's own name.
 */
export type RoomPanelBadge = { tone: "info" | "attention"; count?: number; srLabel: string };

/**
 * The room panel's tab row: a track with the active tab as a pill carrying its
 * label, the others as icons. Every tab is named by `aria-label` (label, then
 * the badge's meaning), so an icon tab reads the same as the pill. `end` closes the row.
 */
export function RoomPanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  icon,
  badge,
  panelId,
  ariaLabel,
  end,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  label: (tab: T) => string;
  icon: (tab: T) => ReactNode;
  badge?: (tab: T) => RoomPanelBadge | null;
  /** DOM id of the panel a tab controls; wired on the active tab only, since only its panel is rendered. */
  panelId?: (tab: T) => string;
  ariaLabel: string;
  /** After the tabs: the collapse button on a wide screen, the close button on the sheet. */
  end?: ReactNode;
}) {
  const baseId = useId();
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());

  // Only the active tab sits in the Tab order; arrows/Home/End move focus and select in one step.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = tablistKeyTarget(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    tabRefs.current.get(target)?.focus();
    if (target !== value) onChange(target);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="tablist"
        aria-orientation="horizontal"
        aria-label={ariaLabel}
        className="flex min-w-0 items-center gap-0.5 rounded-xl bg-surface-hover p-[3px]"
      >
        {tabs.map((tab, index) => {
          const active = tab === value;
          const news = badge?.(tab) ?? null;
          const text = label(tab);
          return (
            <button
              key={tab}
              ref={(node) => {
                if (node) tabRefs.current.set(tab, node);
                else tabRefs.current.delete(tab);
              }}
              id={`${baseId}-tab-${tab}`}
              type="button"
              role="tab"
              aria-label={news ? `${text}, ${news.srLabel}` : text}
              aria-selected={active}
              aria-controls={active ? panelId?.(tab) : undefined}
              tabIndex={active ? 0 : -1}
              className={cn(
                "relative inline-flex h-8.5 items-center justify-center rounded-[9px] border-0 transition-colors duration-standard focus-visible:-outline-offset-2 pointer-coarse:h-11",
                active
                  ? "min-w-0 gap-1.5 bg-surface pr-2.5 pl-2 text-label font-semibold text-foreground shadow-sm"
                  : "w-10 shrink-0 bg-transparent text-muted-foreground hover:text-foreground pointer-coarse:w-11",
              )}
              onClick={() => onChange(tab)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {icon(tab)}
              {active ? <span className="truncate">{text}</span> : null}
              {news ? <TabBadge badge={news} floating={!active} /> : null}
            </button>
          );
        })}
      </div>
      {end ? <div className="ml-auto flex shrink-0 items-center">{end}</div> : null}
    </div>
  );
}

/** Pinned to an icon tab's corner, ringed in the track colour; inline after the label on the pill. */
function TabBadge({ badge, floating }: { badge: RoomPanelBadge; floating: boolean }) {
  const counted = badge.count !== undefined;
  return (
    <span
      aria-hidden
      data-slot="tab-badge"
      className={cn(
        "rounded-full",
        badge.tone === "attention"
          ? "bg-badge-attention font-bold text-badge-attention-foreground"
          : "bg-brand font-semibold text-brand-foreground",
        counted
          ? "inline-flex h-4 min-w-4 items-center justify-center px-1 text-micro leading-none tabular-nums"
          : "size-2",
        floating
          ? cn("absolute ring-2 ring-surface-hover", counted ? "top-0.5 right-0.5" : "top-1.25 right-1.75")
          : "shrink-0",
      )}
    >
      {badge.count === undefined ? null : badge.count > 9 ? "9+" : badge.count}
    </span>
  );
}
