"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export function MeetingUnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  equalWidth = false,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  label: (tab: T) => string;
  className?: string;
  /** Distribute tabs evenly so full titles fit without horizontal scroll. */
  equalWidth?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={label(value)}
      className={cn(
        equalWidth
          ? "grid shrink-0 overflow-hidden border-b border-border"
          : "flex shrink-0 gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={equalWidth ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
    >
      {tabs.map((tab) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            title={label(tab)}
            className={cn(
              "relative min-w-0 overflow-hidden border-0 border-b-2 border-transparent px-1.5 py-2 text-caption font-medium leading-tight whitespace-normal text-center transition-[color,border-color] duration-200",
              equalWidth && "flex items-center justify-center",
              active
                ? "border-brand font-semibold text-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(tab)}
          >
            <span className={cn(equalWidth && "line-clamp-2")}>{label(tab)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MeetingUnderlineTabBadge({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-caption font-medium text-destructive-foreground tabular-nums">
      {children}
    </span>
  );
}
