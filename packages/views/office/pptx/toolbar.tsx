"use client";

/**
 * The PPTX ribbon shell: the tab row (quick access + tabs + view toggle + Find)
 * and the active tab's ONE command row.
 *
 * Replaces the raw command-id row with the UniWork pattern (packages/ui
 * primitives + semantic tokens). It is still a dumb surface: it has no write
 * port and cannot bypass the save coordinator. Undo/redo are passed in as
 * availability flags so the toolbar shows the engine journal's real state
 * instead of assuming the commands are always usable.
 *
 * C6: undo/redo quick access at the far LEFT of the tab row; the presenter view
 * toggle and Find at the far RIGHT. C7: the command row is exactly one row.
 * C12: 40 px tab row, 44 px command row; at <= 767 px the tabs become a
 * horizontally scrollable strip and the command row a single scrollable row.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxCommand, PptxCommandId } from "./command-map";
import { PptxCommandGroups, PPTX_NARROW_COMMAND_QUERY } from "./toolbar/command-groups";
import { PptxTabStrip } from "./toolbar/pptx-tab-strip";
import { PptxQuickAccess, PptxTabRowTrailing } from "./toolbar/tab-row-controls";
import { PPTX_TOOLBAR_TABS, type PptxTabId } from "./toolbar/tabs";

export interface PptxToolbarProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  activeCommand?: PptxCommandId | null;
  /** Default tab on mount; the shell remembers the user's choice afterwards. */
  defaultTab?: PptxTabId;
  /** Engine-journal availability, so a toolbar Undo/Redo is disabled with the
   * rest of the ribbon instead of pretending there is history. */
  canUndo?: boolean;
  canRedo?: boolean;
  /** Presenter open state; drives the tab-row view toggle's aria-pressed (C6). */
  presenterOpen?: boolean;
  /** F9: element ref for the Find trigger, so closing the find bar can return
   *  focus to the control that opened it. */
  findButtonRef?: (element: HTMLButtonElement | null) => void;
  className?: string;
}

/** Commands that the engine journal owns: when the caller reports no history
 * the control is forced disabled even though the command map marks it
 * available. The reason is the engine's, not a fake capability. */
const HISTORY_COMMANDS: readonly PptxCommandId[] = ["undo", "redo"];

export function PptxToolbar({
  commands,
  onCommand,
  activeCommand,
  defaultTab = "home",
  canUndo,
  canRedo,
  presenterOpen = false,
  findButtonRef,
  className,
}: PptxToolbarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [tab, setTab] = useState<PptxTabId>(defaultTab);
  const narrow = useMediaQuery(PPTX_NARROW_COMMAND_QUERY);
  const active = PPTX_TOOLBAR_TABS.find((entry) => entry.id === tab) ?? PPTX_TOOLBAR_TABS[0]!;
  const resolved = useMemo(
    () =>
      commands.map((command) => {
        if (!HISTORY_COMMANDS.includes(command.id)) return command;
        const blocked = command.id === "undo" ? canUndo === false : canRedo === false;
        if (!blocked) return command;
        return { ...command, capability: { status: "unavailable" as const, reason: t("history_empty") } };
      }),
    [canRedo, canUndo, commands, t],
  );
  return (
    <div
      className={cn("flex min-w-0 shrink-0 flex-col border-b border-border bg-muted/20", className)}
      data-pptx-toolbar
      data-pptx-ribbon-width={narrow ? "narrow" : "wide"}
    >
      {/* C12 tab row: 40 px. Quick access far left, tabs in the middle, the
          presenter view toggle and Find far right. */}
      <div className="flex h-10 min-w-0 items-center gap-1 px-2" data-pptx-tab-row>
        <PptxQuickAccess commands={resolved} onCommand={onCommand} />
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
        <PptxTabStrip tabs={PPTX_TOOLBAR_TABS} activeTab={active.id} onSelect={setTab} className="min-w-0 flex-1" />
        <PptxTabRowTrailing commands={resolved} onCommand={onCommand} presenterOpen={presenterOpen} findButtonRef={findButtonRef} />
      </div>
      {/* C12 command row: 44 px, exactly one row. */}
      <PptxCommandGroups tab={active} commands={resolved} activeCommand={activeCommand} narrow={narrow} onCommand={onCommand} />
    </div>
  );
}
