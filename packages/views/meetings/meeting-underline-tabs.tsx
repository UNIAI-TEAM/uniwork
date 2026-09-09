"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

const ACTIVE_TAB_INDICATOR =
  "shadow-[inset_0_-2px_0_0_var(--brand)]";

export function MeetingUnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  badge,
  className,
  spread = false,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  label: (tab: T) => string;
  badge?: (tab: T) => ReactNode;
  className?: string;
  /**
   * Spread tabs across the row at their natural width. Equal columns cannot
   * hold a full title plus its badge in a 22rem sidebar, which is what pushed
   * "Mọi người" onto a second line.
   */
  spread?: boolean;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "isolate shrink-0 border-b border-border",
        spread
          ? "flex w-full items-stretch justify-between gap-0.5"
          : "flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab === value;
        const text = label(tab);
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={text}
            className={cn(
              "min-w-0 border-0 bg-transparent px-1.5 py-2 text-caption font-medium leading-tight whitespace-nowrap text-center transition-[color,box-shadow] duration-200",
              spread ? "flex min-h-10 items-center justify-center" : "min-h-9",
              active
                ? cn("text-brand", ACTIVE_TAB_INDICATOR)
                : "text-muted-foreground shadow-none hover:text-foreground",
            )}
            onClick={() => onChange(tab)}
          >
            <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-1">
              <span className="min-w-0 truncate">{text}</span>
              {badge?.(tab) ?? null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MeetingUnderlineTabBadge({
  children,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-brand-foreground tabular-nums"
    >
      {children}
    </span>
  );
}
