"use client";

/**
 * The ribbon tab strip: `role="tablist"` with one `role="tab"` per tab, roving
 * tab-index (arrows wrap, Home/End jump) and `aria-controls` pointing at the
 * panel the toolbar renders below it.
 */
import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { nextTabIndex, type PptxTabId, type PptxToolbarTab } from "./tabs";

export interface PptxTabStripProps {
  tabs: readonly PptxToolbarTab[];
  activeTab: PptxTabId;
  onSelect: (tab: PptxTabId) => void;
  className?: string;
}

/** Stable DOM id for a tab, used by `aria-controls`/`aria-labelledby`. */
export function pptxTabDomId(id: string): string {
  return `pptx-tab-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Stable DOM id for the panel a tab controls. */
export function pptxTabPanelId(id: string): string {
  return `${pptxTabDomId(id)}-panel`;
}

export function PptxTabStrip({ tabs, activeTab, onSelect, className }: PptxTabStripProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(index, tabs.length, event.key);
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next]!;
    onSelect(tab.id);
    refs.current[tab.id]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("toolbar_label")}
      className={cn("flex min-h-8 items-end gap-1 overflow-x-auto", className)}
      data-pptx-tabstrip
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(element) => { refs.current[tab.id] = element; }}
            type="button"
            role="tab"
            id={pptxTabDomId(tab.id)}
            aria-controls={pptxTabPanelId(tab.id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-pptx-tab={tab.id}
            className={cn(
              "min-h-8 shrink-0 rounded-t-md border-b-2 border-transparent px-2.5 text-label text-muted-foreground hover:text-foreground",
              selected && "border-primary text-foreground",
            )}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
