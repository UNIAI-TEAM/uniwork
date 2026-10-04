"use client";

/**
 * One tab's command row: exactly ONE row of labelled groups separated by a
 * hairline, with a roving tab-index so Tab enters the panel once and arrows
 * move inside it.
 *
 * Two responsive behaviours, never a ragged second row (C7, C12):
 * - wide (>= 768 px): whole trailing groups collapse into a trailing ">>"
 *   overflow menu, measured against the real container width;
 * - narrow (< 768 px): the row becomes a single horizontally scrollable strip
 *   with the tab's `primary` group first, so the most used control is reachable
 *   without opening a menu.
 *
 * Disabled controls stay in the DOM (with their reason) so a keyboard user can
 * hear why a wave-B/C command is not available yet; the roving focus skips them
 * because a disabled button cannot take focus.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { findPptxCommand, type PptxCommand, type PptxCommandId } from "../command-map";
import { PptxCommandButton } from "./command-button";
import { pptxTabDomId, pptxTabPanelId } from "./pptx-tab-strip";
import { computeToolbarOverflow, firstRovingIndex, nextRovingEnabledIndex, orderGroupsForNarrow, type PptxToolbarGroup, type PptxToolbarTab } from "./tabs";

/** Width reserved for the overflow button when deciding how many groups fit. */
const MORE_WIDTH_PX = 40;
/** C12: below this viewport width the command row is one scrollable strip.
 *  Single source of truth for the narrow breakpoint: the shell (`toolbar.tsx`)
 *  imports this instead of keeping a second copy that could drift. */
export const PPTX_NARROW_COMMAND_QUERY = "(max-width: 767px)";

export interface PptxCommandGroupsProps {
  tab: PptxToolbarTab;
  commands: readonly PptxCommand[];
  activeCommand?: PptxCommandId | null;
  /** Narrow viewport: one scrollable row with the primary group first (C12). */
  narrow?: boolean;
  onCommand: (id: PptxCommandId) => void;
  className?: string;
}

interface ResolvedGroup {
  group: PptxToolbarGroup;
  items: PptxCommand[];
}

export function PptxCommandGroups({ tab, commands, activeCommand, narrow = false, onCommand, className }: PptxCommandGroupsProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const groups = useMemo<ResolvedGroup[]>(() => {
    const ordered = narrow ? orderGroupsForNarrow(tab.groups) : [...tab.groups];
    return ordered
      .map((group) => ({
        group,
        items: group.commands
          .map((id) => findPptxCommand(commands, id))
          .filter((command): command is PptxCommand => Boolean(command)),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [commands, narrow, tab]);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Array<HTMLDivElement | null>>([]);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [sizes, setSizes] = useState<{ container: number; groups: number[] }>({ container: 0, groups: [] });
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    const measure = () => {
      // F5: the group nodes measured here live in a hidden, full-width measure row
      // that always renders EVERY group at its natural width, so a collapsed group
      // never reports 0 and can never pop back inline into a clipped, menu-less row.
      setSizes({
        container: containerRef.current?.getBoundingClientRect().width ?? 0,
        groups: groups.map((_entry, index) => groupRefs.current[index]?.getBoundingClientRect().width ?? 0),
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    for (const node of groupRefs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [groups]);

  useEffect(() => { setFocusIndex(0); }, [tab.id]);

  if (groups.length === 0) {
    return (
      <div
        role="tabpanel"
        id={pptxTabPanelId(tab.id)}
        aria-labelledby={pptxTabDomId(tab.id)}
        className={cn("min-h-11 px-2 py-1.5 text-caption text-muted-foreground", className)}
        data-pptx-tab-panel={tab.id}
        // F5: an empty tab still carries the command-row marker, so "exactly
        // one command row" is queryable across all eight tabs, not just Home.
        data-pptx-command-row="empty"
        data-pptx-tab-empty
      >
        {t("tab_empty")}
      </div>
    );
  }

  // Narrow is one scrollable strip: every group stays inline and the row scrolls.
  const { visible } = narrow ? { visible: groups.length } : computeToolbarOverflow(sizes.groups, sizes.container, MORE_WIDTH_PX);
  const inlineCount = Math.max(1, visible);
  const inline = groups.slice(0, inlineCount);
  const overflow = narrow ? [] : groups.slice(inlineCount);
  // Roving focus covers the controls actually rendered inline; the overflow
  // menu is a popup with its own focus management.
  const flat = inline.flatMap((entry) => entry.items);
  const enabled = flat.map((command) => command.capability.status === "available");
  const activeIndex = enabled[focusIndex] ? focusIndex : firstRovingIndex(enabled);
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingEnabledIndex(index, enabled, event.key);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    buttonRefs.current[next]?.focus();
  };
  let flatIndex = -1;
  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="tabpanel"
        id={pptxTabPanelId(tab.id)}
        aria-labelledby={pptxTabDomId(tab.id)}
        // ONE row, never wrapping: `flex-nowrap` plus a scroll on narrow keeps a
        // ragged second row from ever forming (C7).
        className={cn(
          "flex min-h-11 items-stretch gap-1 overflow-x-auto overflow-y-hidden px-2 py-1.5",
          narrow ? "flex-nowrap" : "overflow-hidden",
          className,
        )}
        data-pptx-tab-panel={tab.id}
        data-pptx-command-row={narrow ? "scroll" : "overflow"}
      >
        {inline.map((entry, groupIndex) => (
          <div key={entry.group.id} className="flex shrink-0 items-center gap-1" data-pptx-group={entry.group.id}>
            {groupIndex > 0 ? <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" /> : null}
            <span className="sr-only">{t(entry.group.labelKey)}</span>
            {entry.items.map((command) => {
              flatIndex += 1;
              const index = flatIndex;
              return (
                <PptxCommandButton
                  key={command.id}
                  command={command}
                  active={activeCommand === command.id}
                  onCommand={onCommand}
                  tabIndex={activeIndex === index ? 0 : -1}
                  onKeyDown={(event) => moveFocus(event, index)}
                  buttonRef={(element) => { buttonRefs.current[index] = element; }}
                />
              );
            })}
          </div>
        ))}
        {overflow.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" size="sm" variant="ghost" aria-label={t("overflow_label")} data-pptx-overflow-trigger />}
            >
              <ChevronsRight aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              {overflow.map((entry) => (
                <DropdownMenuGroup key={entry.group.id} data-pptx-overflow-group={entry.group.id}>
                  <DropdownMenuLabel>{t(entry.group.labelKey)}</DropdownMenuLabel>
                  {entry.items.map((command) => {
                    const enabledCommand = command.capability.status === "available";
                    return (
                      <DropdownMenuItem
                        key={command.id}
                        disabled={!enabledCommand}
                        onClick={() => enabledCommand && onCommand(command.id)}
                        data-command={command.id}
                        data-capability={command.capability.status}
                        {...(command.capability.reason ? { title: command.capability.reason } : {})}
                      >
                        {t(command.labelKey)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {/* F5: hidden, full-width measure row holding EVERY group at its natural width so
          the overflow math never reads a collapsed group as 0. `inert` + `aria-hidden`
          keep it out of the a11y tree and the tab order; spans (not buttons) avoid a
          duplicate accessible control, and `buttonVariants` gives them the exact size
          of the real command buttons. */}
      <div
        aria-hidden="true"
        inert
        className="pointer-events-none absolute left-0 top-0 -z-10 flex w-max items-stretch gap-1 px-2 py-1.5 opacity-0"
      >
        {groups.map((entry, index) => (
          <div key={entry.group.id} ref={(element) => { groupRefs.current[index] = element; }} className="flex shrink-0 items-center gap-1" data-pptx-group-measure={entry.group.id}>
            {index > 0 ? <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" /> : null}
            {entry.items.map((command) => (
              <span key={command.id} className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}>{t(command.labelKey)}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
