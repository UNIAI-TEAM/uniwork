"use client";

import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { toolbarPanelDomId, toolbarTabDomId, XLSX_TOOLBAR_TABS } from "./tabs";
import type { XlsxToolbarTabId } from "./types";

/** The ARIA tablist. Focus and activation are separate on purpose: ArrowLeft /
 *  ArrowRight / Home / End only move focus (roving tabindex), Enter or Space
 *  activates the focused tab, and a click activates directly. The active tab
 *  is UI state owned by the shell, never persisted. */
export function XlsxToolbarTabStrip({ activeTab, onActivate }: { activeTab: XlsxToolbarTabId; onActivate: (tab: XlsxToolbarTabId) => void }) {
  const { t } = useTranslation();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']"));
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current === -1) return;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      tabs[(current + step + tabs.length) % tabs.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      tabs[event.key === "Home" ? 0 : tabs.length - 1]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const next = tabs[current]?.dataset.xlsxToolbarTab;
      if (next) {
        event.preventDefault();
        onActivate(next as XlsxToolbarTabId);
      }
    }
  };

  return (
    <div role="tablist" tabIndex={-1} aria-label={t("office.xlsx.toolbar.tabs.label")} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-0.5 px-1.5 pt-1">
      {XLSX_TOOLBAR_TABS.map((tab) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={toolbarTabDomId(tab.id)}
            aria-selected={selected}
            aria-controls={toolbarPanelDomId(tab.id)}
            tabIndex={selected ? 0 : -1}
            data-xlsx-toolbar-tab={tab.id}
            data-testid={`xlsx-toolbar-tab-${tab.id}`}
            onClick={() => onActivate(tab.id)}
            className={cn(
              "cursor-pointer rounded-t-md border-b-2 border-transparent px-2.5 py-1 text-label whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground max-sm:px-2 max-sm:text-caption",
              selected && "border-primary bg-background font-medium text-foreground",
            )}
          >
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
