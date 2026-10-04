"use client";

/**
 * The two clusters the ribbon TAB ROW owns besides the tabs themselves (C6):
 *
 * - quick access at the FAR LEFT, before the tabs: undo / redo. They read the
 *   engine journal's availability through `canUndo` / `canRedo` so a dead
 *   history disables the control instead of pretending there is one.
 * - trailing at the FAR RIGHT: the present/slideshow VIEW TOGGLE
 *   (`aria-pressed`, it reflects whether the presenter is open) and the Find
 *   entry point (Ctrl+F) as the rightmost control.
 *
 * No selection or position text lives here: that readout belongs to the status
 * bar (C6/C10).
 */
import { Redo2, Search, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { findPptxCommand, type PptxCommand, type PptxCommandId } from "../command-map";
import { PptxCommandButton } from "./command-button";
import { PPTX_FIND_COMMAND, PPTX_QUICK_ACCESS_COMMANDS, PPTX_VIEW_TOGGLE_COMMAND } from "./tabs";

export interface PptxQuickAccessProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  /** Engine-journal availability; undefined leaves the command map's own state. */
  canUndo?: boolean;
  canRedo?: boolean;
  className?: string;
}

/** Far-left quick access: undo/redo as compact icon buttons (C6). */
export function PptxQuickAccess({ commands, onCommand, canUndo, canRedo, className }: PptxQuickAccessProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const icon: Partial<Record<PptxCommandId, typeof Undo2>> = { undo: Undo2, redo: Redo2 };
  const historyBlocked = (id: PptxCommandId) => (id === "undo" ? canUndo === false : id === "redo" ? canRedo === false : false);
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)} data-pptx-quick-access>
      {PPTX_QUICK_ACCESS_COMMANDS.map((id) => {
        const command = findPptxCommand(commands, id);
        if (!command) return null;
        const Icon = icon[id];
        const enabled = command.capability.status === "available" && !historyBlocked(id);
        const label = t(command.labelKey);
        return (
          <Button
            key={id}
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            title={enabled ? label : command.capability.reason ?? t("history_empty")}
            disabled={!enabled}
            data-command={id}
            data-capability={command.capability.status}
            onClick={() => enabled && onCommand(id)}
          >
            {Icon ? <Icon aria-hidden /> : label}
          </Button>
        );
      })}
    </div>
  );
}

export interface PptxTabRowTrailingProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  /** Presenter is open; drives the view toggle's aria-pressed (C6). */
  presenterOpen?: boolean;
  className?: string;
}

/** Far-right of the tab row: the presenter view toggle, then Find (C6). */
export function PptxTabRowTrailing({ commands, onCommand, presenterOpen = false, className }: PptxTabRowTrailingProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const presenter = findPptxCommand(commands, PPTX_VIEW_TOGGLE_COMMAND);
  const find = findPptxCommand(commands, PPTX_FIND_COMMAND);
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)} data-pptx-tab-row-trailing>
      {presenter ? <PptxCommandButton command={presenter} pressed={presenterOpen} onCommand={onCommand} /> : null}
      {find ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t(find.labelKey)}
          title={t("find_hint")}
          disabled={find.capability.status !== "available"}
          data-command={find.id}
          data-capability={find.capability.status}
          onClick={() => find.capability.status === "available" && onCommand(find.id)}
        >
          <Search aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}