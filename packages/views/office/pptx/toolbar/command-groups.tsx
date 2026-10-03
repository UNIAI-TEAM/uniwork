"use client";

/**
 * One tab's command groups: labelled group boxes separated by a hairline, with
 * the measured overflow collapsing trailing groups into a "more" menu, and a
 * roving tab-index so Tab enters the panel once and arrows move inside it.
 *
 * Disabled controls stay in the DOM (with their reason) so a keyboard user can
 * hear why a wave-B/C command is not available yet; the roving focus skips them
 * because a disabled button cannot take focus.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { findPptxCommand, type PptxCommand, type PptxCommandId } from "../command-map";
import { PptxCommandButton } from "./command-button";
import { pptxTabDomId, pptxTabPanelId } from "./pptx-tab-strip";
import { computeToolbarOverflow, firstRovingIndex, nextRovingEnabledIndex, type PptxToolbarGroup, type PptxToolbarTab } from "./tabs";

/** Width reserved for the overflow button when deciding how many groups fit. */
const MORE_WIDTH_PX = 40;

export interface PptxCommandGroupsProps {
  tab: PptxToolbarTab;
  commands: readonly PptxCommand[];
  activeCommand?: PptxCommandId | null;
  onCommand: (id: PptxCommandId) => void;
  className?: string;
}

interface ResolvedGroup {
  group: PptxToolbarGroup;
  items: PptxCommand[];
}

export function PptxCommandGroups({ tab, commands, activeCommand, onCommand, className }: PptxCommandGroupsProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const groups = useMemo<ResolvedGroup[]>(
    () =>
      tab.groups
        .map((group) => ({
          group,
          items: group.commands
            .map((id) => findPptxCommand(commands, id))
            .filter((command): command is PptxCommand => Boolean(command)),
        }))
        .filter((entry) => entry.items.length > 0),
    [commands, tab],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Array<HTMLDivElement | null>>([]);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [sizes, setSizes] = useState<{ container: number; groups: number[] }>({ container: 0, groups: [] });
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    const measure = () => {
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
        className={cn("min-h-9 px-2 py-1.5 text-caption text-muted-foreground", className)}
        data-pptx-tab-panel={tab.id}
        data-pptx-tab-empty
      >
        {t("tab_empty")}
      </div>
    );
  }

  const { visible } = computeToolbarOverflow(sizes.groups, sizes.container, MORE_WIDTH_PX);
  const inlineCount = Math.max(1, visible);
  const inline = groups.slice(0, inlineCount);
  const overflow = groups.slice(inlineCount);
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
    <div
      ref={containerRef}
      role="tabpanel"
      id={pptxTabPanelId(tab.id)}
      aria-labelledby={pptxTabDomId(tab.id)}
      className={cn("flex min-h-9 items-stretch gap-1 overflow-hidden px-2 py-1.5", className)}
      data-pptx-tab-panel={tab.id}
    >
      {inline.map((entry, groupIndex) => (
        <div key={entry.group.id} ref={(element) => { groupRefs.current[groupIndex] = element; }} className="flex shrink-0 items-center gap-1" data-pptx-group={entry.group.id}>
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
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto min-w-44">
            {overflow.map((entry) => (
              <div key={entry.group.id} className="flex flex-col gap-0.5 p-0.5" data-pptx-overflow-group={entry.group.id}>
                <span className="px-1.5 py-0.5 text-caption text-muted-foreground">{t(entry.group.labelKey)}</span>
                {entry.items.map((command) => (
                  <PptxCommandButton key={command.id} command={command} active={activeCommand === command.id} onCommand={onCommand} compact />
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
