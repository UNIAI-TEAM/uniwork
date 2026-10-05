"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeRibbonCollapsed } from "@uniwork/core/office/ribbon-preferences";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { cn } from "@uniwork/ui/lib/utils";
import { planRibbonStages, ribbonStepCount, textMeasure } from "./layout";
import { RibbonGroupButton, RibbonGroupView } from "./ribbon-group";
import { RibbonTabRow } from "./ribbon-tab-row";
import type { RibbonTab } from "./types";
import { useElementWidth, useOverflowCorrection } from "./use-ribbon-measure";
import { useRovingFocus } from "./use-roving-focus";

/** Phones and touch-first devices get the simplified ribbon (R6). */
const SIMPLIFIED_QUERY = "(max-width: 640px), (pointer: coarse)";

/** Presses inside these stay "inside" the peeked ribbon: its own popups are
 * portalled out of the ribbon DOM. */
const RIBBON_POPUP_SELECTOR = "[data-ribbon-portal], [role='listbox'], [data-slot='tooltip-content']";

export interface OfficeRibbonProps {
  /** Fixed tabs first, contextual ones anywhere: the ribbon orders them. */
  tabs: readonly RibbonTab[];
  /** Key of the persisted collapse preference, one per format ("docx"). */
  scope: string;
  /** Controlled active tab; omit to let the ribbon keep it. */
  activeTabId?: string;
  onActiveTabChange?: (tabId: string) => void;
  /** Left of the tabs: undo/redo (C6). */
  quickAccess?: ReactNode;
  /** Right of the tabs: Find, per-format view toggles (C6, C11). */
  trailing?: ReactNode;
  /** `auto` picks the simplified ribbon on phones / coarse pointers. */
  layout?: "auto" | "full" | "simplified";
  /** i18next key naming the ribbon landmark. */
  labelKey?: string;
  className?: string;
}

function orderTabs(tabs: readonly RibbonTab[]): RibbonTab[] {
  const fixed = tabs.filter((tab) => !tab.contextual);
  const contextual = tabs.filter((tab) => tab.contextual?.when === true);
  return [...fixed, ...contextual];
}

/**
 * The shared Office ribbon (UNI-931, chrome amendment R): a tab row and a body
 * of labelled groups that collapse by measured width, can fold to tabs only
 * (toggle, Ctrl+F1, double-click a tab; a tab click then peeks the body as an
 * overlay) and becomes one scrollable row of group buttons on phones.
 */
export function OfficeRibbon({
  tabs,
  scope,
  activeTabId,
  onActiveTabChange,
  quickAccess,
  trailing,
  layout = "auto",
  labelKey = "office.ribbon.label",
  className,
}: OfficeRibbonProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const ids = useMemo(() => ({ tab: (id: string) => `${baseId}-tab-${id}`, panel: `${baseId}-panel` }), [baseId]);
  const visibleTabs = useMemo(() => orderTabs(tabs), [tabs]);
  const [ownActive, setOwnActive] = useState<string | null>(null);
  const requested = activeTabId ?? ownActive;
  const active = visibleTabs.find((tab) => tab.id === requested) ?? visibleTabs[0] ?? null;

  const [collapsed, setCollapsed] = useOfficeRibbonCollapsed(scope);
  const [peek, setPeek] = useState(false);
  const smallScreen = useMediaQuery(SIMPLIFIED_QUERY);
  const simplified = layout === "simplified" || (layout === "auto" && smallScreen);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!collapsed);
    setPeek(false);
  }, [collapsed, setCollapsed]);

  const select = useCallback(
    (id: string, via: "pointer" | "keyboard") => {
      if (collapsed && via === "pointer") setPeek((open) => !(open && id === active?.id));
      setOwnActive(id);
      if (id !== active?.id) onActiveTabChange?.(id);
    },
    [active?.id, collapsed, onActiveTabChange],
  );

  // Ctrl+F1 toggles the ribbon, like Office on Windows; key repeat does not.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F1" || !event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
      event.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  // A peeked body closes on a press outside the ribbon (its own popups count
  // as inside), on Escape and when the window loses focus.
  useEffect(() => {
    if (!collapsed || !peek) return undefined;
    const close = () => setPeek(false);
    const onPress = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || rootRef.current?.contains(target) || target.closest(RIBBON_POPUP_SELECTOR)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [collapsed, peek]);

  const groups = useMemo(() => active?.groups ?? [], [active]);
  const measure = useMemo(() => textMeasure((key) => t(key)), [t]);
  const width = useElementWidth(simplified ? null : scroller);
  const maxSteps = useMemo(() => ribbonStepCount(groups, measure), [groups, measure]);
  const extra = useOverflowCorrection(simplified ? null : scroller, width, maxSteps, active?.id ?? "");
  const stages = useMemo(() => planRibbonStages(groups, width, measure, extra), [groups, width, measure, extra]);

  const focusActiveTab = useCallback(() => {
    if (active) document.getElementById(ids.tab(active.id))?.focus();
  }, [active, ids]);
  useRovingFocus(panel, focusActiveTab);
  const enterBody = useCallback(() => {
    panel?.querySelector<HTMLElement>("[data-ribbon-current='true']")?.focus();
  }, [panel]);

  if (!active) return null;
  const bodyShown = !collapsed || peek;

  return (
    <div
      ref={rootRef}
      className={cn("relative z-20 min-w-0 shrink-0 border-b border-border bg-office-band font-sans", className)}
      aria-label={t(labelKey)}
      role="region"
      data-office-ribbon={scope}
      data-ribbon-collapsed={collapsed ? "true" : "false"}
      data-ribbon-layout={simplified ? "simplified" : "full"}
    >
      <RibbonTabRow
        tabs={visibleTabs}
        activeId={active.id}
        ids={ids}
        collapsed={collapsed}
        peek={peek}
        quickAccess={quickAccess}
        trailing={trailing}
        onSelect={select}
        onToggleCollapsed={toggleCollapsed}
        onEnterBody={enterBody}
      />
      <div
        ref={setPanel}
        role="tabpanel"
        id={ids.panel}
        aria-labelledby={ids.tab(active.id)}
        hidden={!bodyShown}
        data-ribbon-body=""
        data-ribbon-peek={collapsed && peek ? "true" : undefined}
        className={cn(
          simplified ? "h-12 pointer-coarse:h-14" : "h-24",
          collapsed && peek && "absolute inset-x-0 top-full border-b border-border bg-office-band shadow-[var(--menu-shadow)]",
        )}
      >
        {simplified ? (
          <div
            role="toolbar"
            aria-label={t("office.ribbon.groups")}
            className="flex h-full items-center gap-1 overflow-x-auto px-2"
            data-ribbon-simplified=""
          >
            {groups.map((group) => (
              <RibbonGroupButton key={group.id} group={group} variant="chip" />
            ))}
          </div>
        ) : (
          <div ref={setScroller} className="flex h-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden px-1 py-1">
            {groups.map((group, index) => (
              <RibbonGroupView key={group.id} group={group} stage={stages[index] ?? 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
