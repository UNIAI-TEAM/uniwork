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
 * The Find bar body (`PptxFindBar`) and the status bar (C10) stay lane UI and
 * are untouched here.
 */
import { useMemo, useState } from "react";
import { Redo2, Search, Undo2 } from "lucide-react";
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
  type PptxTabId,
} from "./pptx-ribbon";

export interface PptxToolbarProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  activeCommand?: PptxCommandId | null;
  /** Default tab on mount; the ribbon remembers the user's choice afterwards. */
  defaultTab?: PptxTabId;
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
  canUndo,
  canRedo,
  presenterOpen = false,
  findButtonRef,
  contextual,
  className,
}: PptxToolbarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [tab, setTab] = useState<PptxTabId>(defaultTab);
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
  const tabs = useMemo(
    () => pptxRibbonTabs(resolved, { onCommand, ...(contextual ? { contextual } : {}) }),
    [contextual, onCommand, resolved],
  );

  const quickAccess = (
    <div className="flex shrink-0 items-center gap-0.5" data-pptx-quick-access>
      {PPTX_QUICK_ACCESS_COMMANDS.map((id) => {
        const command = resolved.find((entry) => entry.id === id);
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

  const presenter = resolved.find((entry) => entry.id === PPTX_VIEW_TOGGLE_COMMAND);
  const find = resolved.find((entry) => entry.id === PPTX_FIND_COMMAND);
  const trailing = (
    <div className="flex shrink-0 items-center gap-1" data-pptx-tab-row-trailing>
      {presenter ? <PptxCommandButton command={presenter} pressed={presenterOpen} onCommand={onCommand} /> : null}
      {find ? (
        <PptxCommandButton
          command={find}
          onCommand={onCommand}
          icon={<Search aria-hidden />}
          hint={t("find_hint")}
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