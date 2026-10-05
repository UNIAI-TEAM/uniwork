"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { RibbonAccent, RibbonTab } from "./types";

export const RIBBON_TOGGLE_SHORTCUT = "Ctrl+F1";

const ACCENT_CLASS: Record<RibbonAccent, string> = {
  brand: "border-t-brand bg-brand-subtle text-brand-subtle-foreground aria-selected:text-brand-subtle-foreground",
  info: "border-t-info bg-info-soft text-info-soft-foreground aria-selected:text-info-soft-foreground",
  success: "border-t-success bg-success-soft text-success-soft-foreground aria-selected:text-success-soft-foreground",
  warning: "border-t-warning bg-warning-soft text-warning-soft-foreground aria-selected:text-warning-soft-foreground",
};

export interface RibbonTabRowProps {
  tabs: readonly RibbonTab[];
  activeId: string;
  ids: { tab: (id: string) => string; panel: string };
  collapsed: boolean;
  peek: boolean;
  quickAccess?: ReactNode;
  trailing?: ReactNode;
  onSelect: (id: string, via: "pointer" | "keyboard") => void;
  onToggleCollapsed: () => void;
  /** ArrowDown from a tab moves focus into the body. */
  onEnterBody: () => void;
}

/** Tab row: quick access (↶ ↷) left, tabs, contextual tabs after the fixed
 * ones, then the trailing slot (Find, view toggles) and the collapse toggle. */
export function RibbonTabRow({
  tabs,
  activeId,
  ids,
  collapsed,
  peek,
  quickAccess,
  trailing,
  onSelect,
  onToggleCollapsed,
  onEnterBody,
}: RibbonTabRowProps) {
  const { t } = useTranslation();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const [fadeEnd, setFadeEnd] = useState(false);

  // The selected tab stays visible when the row scrolls (phones).
  useEffect(() => {
    tabRefs.current.get(activeId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  // A fade on the right edge shows there are more tabs, instead of a hard clip.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const update = () => setFadeEnd(list.scrollWidth - list.clientWidth - list.scrollLeft > 1);
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [tabs]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "ArrowDown" && (!collapsed || peek)) {
      event.preventDefault();
      onEnterBody();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.id, "keyboard");
    tabRefs.current.get(tab.id)?.focus();
  };

  const toggleLabel = t(collapsed ? (peek ? "office.ribbon.pin" : "office.ribbon.expand") : "office.ribbon.collapse");
  const toggleTitle = t("office.ribbon.withShortcut", { label: toggleLabel, shortcut: RIBBON_TOGGLE_SHORTCUT });
  const ToggleIcon = collapsed ? (peek ? Pin : ChevronDown) : ChevronUp;

  return (
    <div className="flex h-9 min-w-0 items-stretch gap-1 px-1.5 pointer-coarse:h-11" data-ribbon-tab-row="">
      {quickAccess ? (
        <div
          role="toolbar"
          aria-label={t("office.ribbon.quickAccess")}
          className="flex shrink-0 items-center gap-0.5 border-r border-border pr-1"
          data-ribbon-quick-access=""
        >
          {quickAccess}
        </div>
      ) : null}
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("office.ribbon.tabs")}
        // Tabs scroll rather than clip when they outgrow the row (phones, many
        // contextual tabs); the simplified layout relies on it.
        className={cn(
          "flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]",
          fadeEnd && "[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]",
        )}
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          const accent = tab.contextual ? (tab.contextual.accent ?? "brand") : null;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={ids.tab(tab.id)}
              aria-selected={selected}
              aria-controls={ids.panel}
              tabIndex={selected ? 0 : -1}
              data-ribbon-tab={tab.id}
              data-ribbon-contextual={accent ?? undefined}
              className={cn(
                "relative shrink-0 cursor-pointer rounded-t-sm px-3 text-label whitespace-nowrap text-muted-foreground transition-colors select-none hover:bg-surface-hover hover:text-foreground aria-selected:font-medium aria-selected:text-foreground pointer-coarse:min-h-11",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full aria-selected:after:bg-brand",
                accent && "border-t-2",
                accent && ACCENT_CLASS[accent],
              )}
              onClick={() => onSelect(tab.id, "pointer")}
              onDoubleClick={onToggleCollapsed}
              onKeyDown={(event) => move(event, index)}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-0.5" data-ribbon-trailing="">
          {trailing}
        </div>
      ) : null}
      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={toggleLabel}
          title={toggleTitle}
          aria-expanded={!collapsed || peek}
          aria-controls={ids.panel}
          data-ribbon-collapse-toggle=""
          onClick={onToggleCollapsed}
        >
          <ToggleIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}
