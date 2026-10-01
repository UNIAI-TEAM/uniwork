"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Expand, Minimize2, PanelRight, Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OfficeState, SaveCoordinatorState } from "@uniwork/core/office";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { BreadcrumbHeader, type BreadcrumbSegment } from "../layout/breadcrumb-header";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { SaveStatus, type OfficeSaveStatusKind } from "./save-status";

export interface OfficeSaveCoordinatorLike {
  save(entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry"): Promise<unknown>;
  getState(): SaveCoordinatorState;
  subscribe?(listener: (state: SaveCoordinatorState) => void): () => void;
}

export interface OfficeShellTab {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

export interface OfficeShellProps {
  title: ReactNode;
  breadcrumbs?: BreadcrumbSegment[];
  editor: ReactNode;
  toolbar?: ReactNode;
  actions?: ReactNode;
  desktopAction?: ReactNode;
  panel?: ReactNode;
  panelLabel?: string;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  tabs?: OfficeShellTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  saveCoordinator?: OfficeSaveCoordinatorLike;
  saveState?: Pick<SaveCoordinatorState, "state" | "error"> | null;
  saveStatus?: OfficeSaveStatusKind | OfficeState;
  onSave?: () => void;
  editorReady?: boolean;
  className?: string;
}

function useCoordinatorState(coordinator?: OfficeSaveCoordinatorLike, provided?: OfficeShellProps["saveState"]) {
  const [state, setState] = useState<OfficeShellProps["saveState"]>(() => provided ?? coordinator?.getState() ?? null);
  useEffect(() => {
    if (provided) {
      setState(provided);
      return;
    }
    if (!coordinator) return;
    setState(coordinator.getState());
    return coordinator.subscribe?.((next) => setState(next));
  }, [coordinator, provided]);
  return state;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => observer.disconnect();
  }, []);

  return dark;
}

function tabDomId(id: string): string {
  return `office-tab-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** One responsive shell shared by the browser and desktop hosts. */
export function OfficeShell({
  title,
  breadcrumbs = [],
  editor,
  toolbar,
  actions,
  desktopAction,
  panel,
  panelLabel,
  panelOpen = false,
  onPanelOpenChange,
  tabs = [],
  activeTab,
  onTabChange,
  fullscreen = false,
  onFullscreenChange,
  saveCoordinator,
  saveState,
  saveStatus,
  onSave,
  editorReady = false,
  className,
}: OfficeShellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office" });
  const shellRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const coordinatorState = useCoordinatorState(saveCoordinator, saveState);
  const selectedTabId = activeTab ?? tabs[0]?.id;
  const selectedTab = selectedTabId ? tabs.find((tab) => tab.id === selectedTabId) : undefined;
  const rightPanel = selectedTab?.panel ?? panel;
  const isWideViewport = useMediaQuery("(min-width: 1024px)");
  const isDarkTheme = useDarkTheme();
  const effectiveSaving = coordinatorState?.state === "saving";
  const saveLabel = t("save.action.save_to_cloud");
  // Keep the control in the tab order while an intent is running so its
  // disabled state communicates the single coordinator guard.
  const canSave = editorReady && Boolean(saveCoordinator || onSave);
  const [internalPanelOpen, setInternalPanelOpen] = useState(panelOpen);
  const isPanelOpen = onPanelOpenChange ? panelOpen : internalPanelOpen;
  const setPanelOpen = (open: boolean) => {
    if (onPanelOpenChange) onPanelOpenChange(open);
    else setInternalPanelOpen(open);
  };
  const performSave = () => {
    if (!canSave) return;
    if (saveCoordinator) {
      void saveCoordinator.save("button");
    } else {
      onSave?.();
    }
  };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!tabs.length) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex]!;
    onTabChange?.(next.id);
    tabRefs.current[next.id]?.focus();
  };
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s" || event.isComposing) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      if (canSave && !effectiveSaving) {
        if (saveCoordinator) void saveCoordinator.save("shortcut");
        else onSave?.();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [canSave, effectiveSaving, onSave, saveCoordinator]);
  const headerActions = (
    <div className="flex min-w-0 items-center gap-1">
      <SaveStatus status={saveStatus} coordinatorState={coordinatorState} />
      {canSave ? (
        <Button size="sm" onClick={performSave} disabled={effectiveSaving} aria-label={saveLabel}>
          <Save aria-hidden />
          {effectiveSaving ? t("saving") : saveLabel}
        </Button>
      ) : null}
      {rightPanel ? (
        <Button size="icon" variant="ghost" aria-label={t(isPanelOpen ? "panel_close" : "panel_open")} aria-expanded={isPanelOpen} onClick={() => setPanelOpen(!isPanelOpen)}>
          <PanelRight aria-hidden />
        </Button>
      ) : null}
      {onFullscreenChange ? (
        <Button size="icon" variant="ghost" aria-label={t(fullscreen ? "exit_fullscreen" : "fullscreen")} aria-pressed={fullscreen} onClick={() => onFullscreenChange(!fullscreen)}>
          {fullscreen ? <Minimize2 aria-hidden /> : <Expand aria-hidden />}
        </Button>
      ) : null}
      {desktopAction}
      {actions}
    </div>
  );

  return (
    <div
      ref={shellRef}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground", fullscreen && "fixed inset-0 z-40", className)}
      data-office-shell
      data-fullscreen={fullscreen}
      data-theme={isDarkTheme ? "dark" : "light"}
    >
      <BreadcrumbHeader segments={breadcrumbs} leaf={title} actions={headerActions} />
      <div className={cn(PAGE_TOOLBAR, "border-b border-border bg-muted/20")}>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">{toolbar}</div>
      </div>
      {tabs.length > 0 ? (
        <div role="tablist" aria-label={t("tabs")} className="flex min-h-10 shrink-0 items-end gap-1 border-b border-border px-4">
          {tabs.map((tab, index) => {
            const tabId = tabDomId(tab.id);
            const panelId = `${tabId}-panel`;
            const selected = selectedTabId === tab.id;
            return (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[tab.id] = element; }}
              type="button"
              role="tab"
              id={tabId}
              aria-controls={panelId}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={cn("min-h-11 border-b-2 px-3 text-label text-muted-foreground", selected && "border-primary text-foreground")}
              onClick={() => onTabChange?.(tab.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {tab.label}
            </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <main className="flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden p-3">{editor}</main>
      {rightPanel && isPanelOpen ? (
          <aside
            className="fixed inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100vw-2rem))] flex-col border-l border-border bg-background shadow-lg lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:shadow-none"
            aria-label={panelLabel ?? t("panel")}
            role={selectedTab ? "tabpanel" : undefined}
            id={selectedTab ? `${tabDomId(selectedTab.id)}-panel` : undefined}
            aria-labelledby={selectedTab ? tabDomId(selectedTab.id) : undefined}
            data-office-panel
            data-panel-mode={isWideViewport ? "static" : "drawer"}
          >
            <div className="flex min-h-10 items-center justify-between border-b border-border px-3 text-label">
              <span>{panelLabel ?? t("panel")}</span>
              <Button size="icon-xs" variant="ghost" aria-label={t("panel_close")} onClick={() => setPanelOpen(false)}><X aria-hidden /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">{rightPanel}</div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
