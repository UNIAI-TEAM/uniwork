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
import { cn } from "@uniwork/ui/lib/utils";
import { findPptxCommand, type PptxCommand, type PptxCommandId } from "../command-map";
import { PptxCommandButton } from "./command-button";
import { PPTX_FIND_COMMAND, PPTX_QUICK_ACCESS_COMMANDS, PPTX_VIEW_TOGGLE_COMMAND } from "./tabs";

export interface PptxQuickAccessProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  className?: string;
}

/** Far-left quick access: undo/redo as compact icon buttons (C6).
 *
 * They render through `PptxCommandButton` so a disabled history shows the
 * engine's reason in the shared hover/focus tooltip (F4) rather than in a
 * native `title`, which a disabled control cannot show. The journal
 * availability remap lives once, in the shell (`toolbar.tsx`). */
export function PptxQuickAccess({ commands, onCommand, className }: PptxQuickAccessProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const icon: Partial<Record<PptxCommandId, typeof Undo2>> = { undo: Undo2, redo: Redo2 };
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)} data-pptx-quick-access>
      {PPTX_QUICK_ACCESS_COMMANDS.map((id) => {
        const command = findPptxCommand(commands, id);
        if (!command) return null;
        const Icon = icon[id];
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
}

export interface PptxTabRowTrailingProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  /** Presenter is open; drives the view toggle's aria-pressed (C6). */
  presenterOpen?: boolean;
  /** F9: the Find trigger element, so closing the find bar can return focus
   *  to the control that opened it instead of dropping to `document.body`. */
  findButtonRef?: (element: HTMLButtonElement | null) => void;
  className?: string;
}

/** Far-right of the tab row: the presenter view toggle, then Find (C6). */
export function PptxTabRowTrailing({ commands, onCommand, presenterOpen = false, findButtonRef, className }: PptxTabRowTrailingProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const presenter = findPptxCommand(commands, PPTX_VIEW_TOGGLE_COMMAND);
  const find = findPptxCommand(commands, PPTX_FIND_COMMAND);
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)} data-pptx-tab-row-trailing>
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
}
