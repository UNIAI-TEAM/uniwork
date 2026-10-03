"use client";

/**
 * The PPTX ribbon shell: the tab strip plus the active tab's command groups.
 *
 * Replaces the raw command-id row with the UniWork pattern (packages/ui
 * primitives + semantic tokens). It is still a dumb surface: it has no write
 * port and cannot bypass the save coordinator. Undo/redo are passed in as
 * availability flags so the toolbar shows the engine journal's real state
 * instead of assuming the commands are always usable.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxCommand, PptxCommandId } from "./command-map";
import { PptxCommandGroups } from "./toolbar/command-groups";
import { PptxTabStrip } from "./toolbar/pptx-tab-strip";
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
  className,
}: PptxToolbarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [tab, setTab] = useState<PptxTabId>(defaultTab);
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
    >
      <PptxTabStrip tabs={PPTX_TOOLBAR_TABS} activeTab={active.id} onSelect={setTab} className="px-2 pt-1" />
      <PptxCommandGroups tab={active} commands={resolved} activeCommand={activeCommand} onCommand={onCommand} />
    </div>
  );
}
