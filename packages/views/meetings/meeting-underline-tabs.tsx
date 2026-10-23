"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export function MeetingUnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  badge,
  panelId,
  className,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  label: (tab: T) => string;
  badge?: (tab: T) => ReactNode;
  /**
   * DOM id of the panel a tab controls; wires `aria-controls` on the active
   * tab only, since only its panel is rendered.
   */
  panelId?: (tab: T) => string;
  className?: string;
}) {
  const baseId = useId();
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());

  // WAI-ARIA tabs pattern, automatic activation: arrows/Home/End move focus
  // and select in one step; only the active tab sits in the Tab order.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    tabRefs.current.get(target)?.focus();
    if (target !== value) onChange(target);
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        "isolate flex w-full min-w-0 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const active = tab === value;
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
            aria-selected={active}
            aria-controls={active ? panelId?.(tab) : undefined}
            tabIndex={active ? 0 : -1}
            className={cn(
              "relative min-h-10 shrink-0 rounded-md border-0 bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 px-2.5 py-2 text-caption font-medium leading-tight whitespace-nowrap transition-colors duration-standard pointer-coarse:min-h-11",
              active ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => onKeyDown(event, index)}
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
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-micro font-semibold leading-none text-brand-foreground tabular-nums"
    >
      {children}
    </span>
  );
}
