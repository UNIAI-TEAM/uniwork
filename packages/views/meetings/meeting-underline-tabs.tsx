"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export function MeetingUnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  badge,
  className,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  label: (tab: T) => string;
  badge?: (tab: T) => ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "isolate flex w-full min-w-0 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
              "relative min-h-10 shrink-0 border-0 bg-transparent px-2.5 py-2 text-caption font-medium leading-tight whitespace-nowrap transition-colors duration-200 pointer-coarse:min-h-11",
              active ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(tab)}
          >
            <span className="inline-flex items-center gap-1">
              <span>{text}</span>
              {badge?.(tab) ?? null}
            </span>
            {active ? (
              <span
                aria-hidden
                data-slot="tab-indicator"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-brand"
              />
            ) : null}
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
