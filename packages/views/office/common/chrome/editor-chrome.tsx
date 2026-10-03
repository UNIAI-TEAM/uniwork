"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronsRight, Redo2, Search, Undo2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { hiddenGroupIndexes, visibleGroupIndexes } from "./overflow";
import type { EditorChromeCommandGroup, EditorChromeCommandItem, EditorChromeProps } from "./types";

/* C12 geometry at 1440: tabs 40, commands 44, status 28. `min-h-*` rather than
   `h-*` so a coarse pointer can grow a row to its 44px targets. */
const TAB_ROW = "flex min-h-10 shrink-0 items-center gap-1 border-b border-border px-2";
const COMMAND_ROW = "flex min-h-11 shrink-0 items-center gap-1 border-b border-border px-2";
const STATUS_ROW = "flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border px-2 text-caption text-muted-foreground";
const GROUP = "flex shrink-0 items-center gap-0.5";
const CONTROL = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";
/** Below `md` the command row is one scrollable strip instead of "»". */
const COMPACT_QUERY = "(max-width: 767px)";
/** The command row's own horizontal padding (`px-2`), excluded from the fit. */
const ROW_PADDING = 16;
/** Footprint of the trailing "»" control, including the separator before it. */
const OVERFLOW_BUTTON_WIDTH = 36;
/** What one group costs beyond its own width: two `gap-1` (4px) plus the 1px rule. */
const GROUP_SEPARATOR_WIDTH = 9;

function useCompactCommandRow(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(COMPACT_QUERY).matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(COMPACT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    setCompact(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);
  return compact;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function tabDomId(id: string): string {
  return `editor-chrome-tab-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function QuickAccessButton({
  label,
  disabled,
  onClick,
  testId,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={CONTROL}
            aria-label={label}
            disabled={disabled}
            data-testid={testId}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function CommandItemControl({ item }: { item: EditorChromeCommandItem }) {
  if (item.render) return <>{item.render}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={CONTROL}
            aria-label={item.label}
            aria-pressed={item.pressed}
            disabled={item.disabled}
            data-chrome-command={item.id}
            onClick={() => item.onSelect?.()}
          />
        }
      >
        {item.icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function OverflowMenu({
  groups,
  indexes,
  label,
}: {
  groups: readonly EditorChromeCommandGroup[];
  indexes: readonly number[];
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={cn(CONTROL, "ml-auto")}
            aria-label={label}
            data-testid="editor-chrome-overflow"
          />
        }
      >
        <ChevronsRight aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {indexes.map((index, position) => {
          const group = groups[index];
          if (!group) return null;
          return (
            <div key={group.id} data-chrome-overflow-group={group.id}>
              {position > 0 ? <DropdownMenuSeparator /> : null}
              {/* Menu.Group is required around a group label, and it also gives
                  the menu the same group boundaries the row has. */}
              <DropdownMenuGroup>
                {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
                {group.items.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={item.disabled}
                    data-chrome-overflow-item={item.id}
                    onClick={() => item.onSelect?.()}
                  >
                    {item.icon}
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The one chrome skeleton every office format mounts into (brief C6-C11):
 * a tab row (quick access, tabs, find, view segmented control), ONE command row
 * whose groups overflow as whole groups into a trailing "»", and a status bar.
 * Format-agnostic: the caller supplies the tabs, the per-tab command groups,
 * the view modes and the status items. No floating controls come from here.
 */
export function EditorChrome({
  tabs = [],
  activeTabId,
  onTabChange,
  onUndo,
  onRedo,
  canUndo = true,
  canRedo = true,
  onFind,
  findLabel,
  tabsLabel,
  viewLabel,
  viewModes = [],
  activeViewMode,
  onViewModeChange,
  status,
  statusLabel,
  commandsLabel,
  overflowLabel,
  overflowButtonWidth = OVERFLOW_BUTTON_WIDTH,
  className,
}: EditorChromeProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.common.chrome" });
  const compact = useCompactCommandRow();
  const rowRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const groupListRef = useRef<readonly EditorChromeCommandGroup[]>([]);
  // Last measured width per group. A group the overflow decision moved into "»"
  // is no longer in the DOM, so its live measurement reads 0 - keeping the last
  // real width stops the decision from oscillating around its own output.
  const widthCache = useRef<Record<string, number>>({});
  const [rowWidth, setRowWidth] = useState(0);
  const [groupWidths, setGroupWidths] = useState<readonly number[]>([]);

  const selectedTabId = activeTabId ?? tabs[0]?.id;
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId);
  const groups = (selectedTab?.groups ?? []).filter((group) => group.items.length > 0);
  const groupsKey = groups.map((group) => group.id).join("|");
  groupListRef.current = groups;

  const showQuickAccess = Boolean(onUndo || onRedo);
  const showFind = Boolean(onFind);
  const showViewControl = viewModes.length > 1;
  const hasTabRow = tabs.length > 0 || showQuickAccess || showFind || showViewControl;
  const hasCommandRow = groups.length > 0;
  const hasStatusRow = Boolean(status?.left || status?.right);

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const nextRowWidth = Math.max(0, row.getBoundingClientRect().width - ROW_PADDING);
    const nextWidths = groupListRef.current.map((group) => {
      const live = groupRefs.current[group.id]?.getBoundingClientRect().width ?? 0;
      if (live > 0) widthCache.current[group.id] = live;
      return widthCache.current[group.id] ?? 0;
    });
    setRowWidth((previous) => (previous === nextRowWidth ? previous : nextRowWidth));
    setGroupWidths((previous) => (sameNumbers(previous, nextWidths) ? previous : nextWidths));
  }, []);

  useLayoutEffect(() => {
    if (compact || !hasCommandRow) return;
    measure();
    if (typeof ResizeObserver === "undefined" || !rowRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(rowRef.current);
    return () => observer.disconnect();
    // `groups` is read through `groupListRef`: keying on the id list keeps a
    // parent that rebuilds its group array on every keystroke from forcing a
    // layout read per keystroke.
  }, [compact, hasCommandRow, groupsKey, measure]);

  // Until the row has a real width and every group a real width, show them all:
  // a first pass that guessed would hide a control for a frame. The row never
  // wraps either way, so an unmeasured pass clips instead of going ragged.
  const measured =
    !compact && groupWidths.length === groups.length && groupWidths.every((width) => width > 0) && rowWidth > 0;
  const fit = { groupWidths, containerWidth: rowWidth, overflowButtonWidth, separatorWidth: GROUP_SEPARATOR_WIDTH };
  const visible = measured ? visibleGroupIndexes(fit) : groups.map((_, index) => index);
  const hidden = measured ? hiddenGroupIndexes(fit) : [];

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    onTabChange?.(next.id);
    const element = document.getElementById(tabDomId(next.id));
    element?.focus();
  };

  const renderGroup = (group: EditorChromeCommandGroup, previousVisible: number | null) => (
    <div className="flex shrink-0 items-center gap-1" key={group.id}>
      {previousVisible !== null ? <Separator orientation="vertical" className="h-5" /> : null}
      <div
        className={GROUP}
        role="group"
        aria-label={group.label}
        data-chrome-group={group.id}
        ref={(element) => {
          groupRefs.current[group.id] = element;
        }}
      >
        {group.items.map((item) => (
          <CommandItemControl item={item} key={item.id} />
        ))}
      </div>
    </div>
  );

  return (
    <div
      className={cn("flex min-w-0 flex-col bg-background text-foreground", className)}
      data-testid="editor-chrome"
      data-chrome-compact={compact ? "true" : "false"}
    >
      {hasTabRow ? (
        <div className={TAB_ROW} data-testid="editor-chrome-tabs" data-chrome-row="tabs">
          {showQuickAccess ? (
            <div className="flex shrink-0 items-center gap-0.5" data-testid="editor-chrome-quick-access">
              <QuickAccessButton
                label={t("undo")}
                disabled={!canUndo}
                onClick={() => onUndo?.()}
                testId="editor-chrome-undo"
              >
                <Undo2 aria-hidden />
              </QuickAccessButton>
              <QuickAccessButton
                label={t("redo")}
                disabled={!canRedo}
                onClick={() => onRedo?.()}
                testId="editor-chrome-redo"
              >
                <Redo2 aria-hidden />
              </QuickAccessButton>
              {tabs.length > 0 ? <Separator orientation="vertical" className="mx-0.5 h-5" /> : null}
            </div>
          ) : null}
          {tabs.length > 0 ? (
            <div
              role="tablist"
              aria-label={tabsLabel ?? t("tabs")}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
              data-testid="editor-chrome-tablist"
            >
              {tabs.map((tab, index) => {
                const selected = tab.id === selectedTabId;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={tabDomId(tab.id)}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    data-chrome-tab={tab.id}
                    className={cn(
                      "flex min-h-8 shrink-0 items-center gap-1 rounded-control border-b-2 border-transparent px-2.5 text-label font-medium whitespace-nowrap text-muted-foreground transition-colors pointer-coarse:min-h-11",
                      selected && "border-primary text-foreground",
                    )}
                    onClick={() => onTabChange?.(tab.id)}
                    onKeyDown={(event) => moveTab(event, index)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <div className="flex shrink-0 items-center gap-1">
            {showFind ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="toolbar"
                      size="icon-sm"
                      className={CONTROL}
                      aria-label={findLabel ?? t("find")}
                      data-testid="editor-chrome-find"
                      onClick={() => onFind?.()}
                    />
                  }
                >
                  <Search aria-hidden />
                </TooltipTrigger>
                <TooltipContent side="bottom">{findLabel ?? t("find")}</TooltipContent>
              </Tooltip>
            ) : null}
            {showViewControl ? (
              <ToggleGroup
                value={activeViewMode ? [activeViewMode] : []}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next) onViewModeChange?.(next);
                }}
                aria-label={viewLabel ?? t("view")}
                data-testid="editor-chrome-view"
                className="rounded-control bg-muted p-0.5 dark:bg-surface-hover/60"
              >
                {viewModes.map((mode) => (
                  <ToggleGroupItem
                    key={mode.id}
                    value={mode.id}
                    className="h-7 min-w-0 rounded-md border-0 px-2 text-label font-medium text-muted-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                    data-chrome-view-mode={mode.id}
                  >
                    {mode.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasCommandRow ? (
        <div
          ref={rowRef}
          role="toolbar"
          aria-label={commandsLabel ?? t("commands")}
          className={cn(
            COMMAND_ROW,
            compact ? "overflow-x-auto" : "overflow-hidden",
          )}
          data-testid="editor-chrome-commands"
          data-chrome-row="commands"
        >
          {visible.map((groupIndex, position) =>
            groups[groupIndex]
              ? renderGroup(groups[groupIndex]!, position > 0 ? visible[position - 1]! : null)
              : null,
          )}
          {hidden.length > 0 ? (
            <OverflowMenu groups={groups} indexes={hidden} label={overflowLabel ?? t("more")} />
          ) : null}
        </div>
      ) : null}

      {hasStatusRow ? (
        <div className={STATUS_ROW} role="group" aria-label={statusLabel ?? t("status")} data-testid="editor-chrome-status">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">{status?.left}</div>
          <div className="flex shrink-0 items-center gap-2">{status?.right}</div>
        </div>
      ) : null}
    </div>
  );
}
