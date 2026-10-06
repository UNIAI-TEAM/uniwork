"use client";

/**
 * The PPTX ribbon shell (UNI-927 chrome amendment R, CHROME-R).
 *
 * It is now a thin adapter over the SHARED <OfficeRibbon>: this file maps the
 * lane's command capabilities onto `RibbonTab` data (`pptx-ribbon.ts`), owns
 * the active tab and renders the two tab-row slots the ribbon exposes -
 * quick-access undo/redo at the far left (C6) and the presenter view toggle
 * plus Find at the far right (C6).
 *
 * The public props are unchanged, so `pptx-editor.tsx` keeps compiling and the
 * command paths stay byte-identical. It is still a dumb surface: it has no
 * write port and cannot bypass the save coordinator. Undo/redo availability is
 * passed in so the control shows the engine journal's real state.
 *
 * The find panel (`PptxFindReplacePanel`) and the status bar (C10) stay lane UI
 * and are untouched here.
 */
import { useMemo, useState } from "react";
import { Presentation, Redo2, Search, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { OfficeRibbon } from "../ribbon";
import type { PptxCommand, PptxCommandId } from "./command-map";
import { PptxCommandButton } from "./toolbar/command-button";
import {
  PPTX_FIND_COMMAND,
  PPTX_QUICK_ACCESS_COMMANDS,
  PPTX_VIEW_TOGGLE_COMMAND,
  pptxRibbonTabs,
  type PptxRibbonContextualSelection,
  type PptxRibbonOptions,
  type PptxTabId,
} from "./pptx-ribbon";

export interface PptxToolbarProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  /** Default tab on mount; the ribbon remembers the user's choice afterwards. */
  defaultTab?: PptxTabId;
  /** Controlled active tab; when supplied the toolbar no longer owns the state,
   *  so the editor can derive the side panel from the same value (UNI-927
   *  WIRE-PANEL-TABS). Omit it (and `onActiveTabChange`) to keep the previous
   *  uncontrolled behaviour for callers that do not pass them. */
  activeTab?: PptxTabId;
  /** Notifies the owner of a tab change; only meaningful with `activeTab`. */
  onActiveTabChange?: (tab: PptxTabId) => void;
  /** Engine-journal availability, so a toolbar Undo/Redo is disabled with the
   *  rest of the ribbon instead of pretending there is history. */
  canUndo?: boolean;
  canRedo?: boolean;
  /** Presenter open state; drives the tab-row view toggle's aria-pressed (C6). */
  presenterOpen?: boolean;
  /** F9: element ref for the Find trigger, so closing the find bar can return
   *  focus to the control that opened it. */
  findButtonRef?: (element: HTMLButtonElement | null) => void;
  /** R4: which contextual tabs the caller says are live. Absent = none. */
  contextual?: PptxRibbonContextualSelection;
  /** Side panel currently open; its ribbon toggle renders pressed. */
  activePanel?: PptxRibbonOptions["activePanel"];
  /** Ribbon panel items and dialog launchers call this. */
  onOpenPanel?: PptxRibbonOptions["onOpenPanel"];
  /** Panel kind -> full i18n reason key; that panel item is disabled. */
  panelDisabled?: PptxRibbonOptions["panelDisabled"];
  /** Items the editor injects into ribbon groups, keyed by group id. */
  groupItems?: PptxRibbonOptions["groupItems"];
  /** Ribbon toggle commands that render pressed (e.g. the Slide master toggle). */
  pressedCommands?: readonly PptxCommandId[];
  className?: string;
}

/** Commands that the engine journal owns: when the caller reports no history
 * the control is forced disabled even though the command map marks it
 * available. The reason is the engine's, not a fake capability. */
const HISTORY_COMMANDS: readonly PptxCommandId[] = ["undo", "redo"];

const QUICK_ACCESS_ICONS: Partial<Record<PptxCommandId, typeof Undo2>> = { undo: Undo2, redo: Redo2 };

export function PptxToolbar({
  commands,
  onCommand,
  defaultTab = "home",
  activeTab,
  onActiveTabChange,
  canUndo,
  canRedo,
  presenterOpen = false,
  findButtonRef,
  contextual,
  activePanel,
  onOpenPanel,
  panelDisabled,
  groupItems,
  pressedCommands,
  className,
}: PptxToolbarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [ownTab, setOwnTab] = useState<PptxTabId>(defaultTab);
  // Controlled when the owner passes `activeTab`; otherwise the toolbar keeps
  // owning the tab (the pre-WIRE-PANEL-TABS behaviour).
  const tab = activeTab ?? ownTab;
  const setTab = (next: PptxTabId) => {
    setOwnTab(next);
    onActiveTabChange?.(next);
  };
  const resolved = useMemo(
    () =>
      commands.map((command) => {
        if (!HISTORY_COMMANDS.includes(command.id)) return command;
        const blocked = command.id === "undo" ? canUndo === false : canRedo === false;
        if (!blocked || command.capability.hidden === true) return command;
        return { ...command, capability: { status: "unavailable" as const, reason: t("history_empty") } };
      }),
    [canRedo, canUndo, commands, t],
  );
  const tabs = useMemo(
    () =>
      pptxRibbonTabs(resolved, {
        onCommand,
        ...(contextual ? { contextual } : {}),
        ...(activePanel !== undefined ? { activePanel } : {}),
        ...(onOpenPanel ? { onOpenPanel } : {}),
        ...(panelDisabled ? { panelDisabled } : {}),
        ...(groupItems ? { groupItems } : {}),
        ...(pressedCommands ? { pressedCommands } : {}),
      }),
    [activePanel, contextual, groupItems, onCommand, onOpenPanel, panelDisabled, pressedCommands, resolved],
  );

  // X4fix F8: the tab-row controls honour `hidden` the same way the ribbon groups do.
  const shown = (id: PptxCommandId) => resolved.find((entry) => entry.id === id && entry.capability.hidden !== true);
  const quickAccess = (
    <div className="flex shrink-0 items-center gap-0.5" data-pptx-quick-access>
      {PPTX_QUICK_ACCESS_COMMANDS.map((id) => {
        const command = shown(id);
        if (!command) return null;
        const Icon = QUICK_ACCESS_ICONS[id];
        return (
          <PptxCommandButton
            key={id}
            command={command}
            onCommand={onCommand}
            icon={Icon ? <Icon aria-hidden /> : undefined}
            hint={t(command.labelKey)}
          />
        );
      })}
    </div>
  );

  const presenter = shown(PPTX_VIEW_TOGGLE_COMMAND);
  const find = shown(PPTX_FIND_COMMAND);
  const trailing = (
    <div className="flex shrink-0 items-center gap-1" data-pptx-tab-row-trailing>
      {presenter ? <PptxCommandButton command={presenter} pressed={presenterOpen} onCommand={onCommand} compactIcon={<Presentation aria-hidden />} tooltipAlign="end" /> : null}
      {find ? (
        <PptxCommandButton
          command={find}
          onCommand={onCommand}
          icon={<Search aria-hidden />}
          hint={t("find_hint")}
          tooltipAlign="end"
          buttonRef={findButtonRef}
        />
      ) : null}
    </div>
  );

  return (
    <div className={cn("flex min-w-0 shrink-0 flex-col", className)} data-pptx-toolbar>
      <OfficeRibbon
        scope="pptx"
        tabs={tabs}
        activeTabId={tab}
        onActiveTabChange={(id) => setTab(id as PptxTabId)}
        quickAccess={quickAccess}
        trailing={trailing}
      />
    </div>
  );
}
