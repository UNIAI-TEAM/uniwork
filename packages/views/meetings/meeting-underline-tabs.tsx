"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import { useScrollEdges } from "../notifications/use-scroll-edges";

export function MeetingUnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  icon,
  badge,
  panelId,
  ariaLabel,
  className,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  label: (tab: T) => string;
  /** A glyph before the label, e.g. Sparkles on the UNI tab. */
  icon?: (tab: T) => ReactNode;
  badge?: (tab: T) => ReactNode;
  /**
   * DOM id of the panel a tab controls; wires `aria-controls` on the active
   * tab only, since only its panel is rendered.
   */
  panelId?: (tab: T) => string;
  /** The tablist's name; two tab rows on one screen must not both read as "tab list". */
  ariaLabel?: string;
  className?: string;
}) {
  const baseId = useId();
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const edges = useScrollEdges<HTMLDivElement>();

  // A row that overflows keeps the picked tab in view, whoever picked it (a badge, a deep link).
  useEffect(() => {
    const list = edges.ref.current;
    const tab = tabRefs.current.get(value);
    if (!list || !tab) return;
    if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
    }
  }, [value, edges.ref]);

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

  // Tight padding so the room's five tabs fit a 384px sidebar whole; the row
  // still scrolls when badges push it past the edge, and the hidden-scrollbar
  // edge fades so the cut-off tab reads as more to come. `relative` makes the
  // row the tabs' offsetParent, which the scroll-into-view above measures from.
  return (
    <div
      ref={edges.ref}
      role="tablist"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      style={edges.style}
      className={cn(
        "relative isolate flex w-full min-w-0 shrink-0 items-stretch overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
              "relative min-h-10 shrink-0 rounded-md border-0 bg-transparent focus-visible:-outline-offset-2 px-2 py-2 text-caption font-medium leading-tight whitespace-nowrap transition-colors duration-standard pointer-coarse:min-h-11",
              active ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="inline-flex items-center gap-1">
              {icon?.(tab) ?? null}
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

/**
 * A count on a tab. `srLabel` says what the count means ("3 unread
 * messages") as part of the tab's own name; the bare digits stay visual.
 */
export function MeetingUnderlineTabBadge({ children, srLabel }: { children: ReactNode; srLabel?: string }) {
  return (
    <>
      <span
        aria-hidden={srLabel ? true : undefined}
        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-micro font-semibold leading-none text-brand-foreground tabular-nums"
      >
        {children}
      </span>
      {srLabel ? <span className="sr-only">{`, ${srLabel}`}</span> : null}
    </>
  );
}
