"use client";

/**
 * While the slide master view is open the canvas shows a master/layout preview,
 * not a deck slide (visual fix MAJOR-2), so a command that edits the deck slide
 * would act on something the user cannot see. This gate drops the slide
 * selection when the view opens and disables the ribbon commands that write the
 * slide, with a reason; Close master, the View tab and save/undo/redo stay usable.
 */
import { useEffect, useMemo, useRef } from "react";
import type { PptxCommand, PptxCommandId } from "./command-map";
import { PPTX_MASTER_VIEW_REASON } from "./pptx-ribbon-master-gate";

/**
 * Commands that stay usable in master view: Close master, the file/view/show
 * commands and history. Everything else is locked, so a command added later
 * (or a tab-row one such as Find, which can replace deck text) waits for Close
 * master unless it is listed here on purpose.
 */
const MASTER_VIEW_LIVE_COMMANDS: readonly PptxCommandId[] = [
  "slideMaster", "undo", "redo", "save", "open", "export-pdf", "print", "render-fidelity", "fullscreen", "presenter",
];

/** Pure: the commands outside the allowlist disabled. A hidden command stays hidden. */
function gatePptxCommandsForMasterView(commands: readonly PptxCommand[], masterViewOpen: boolean): readonly PptxCommand[] {
  if (!masterViewOpen) return commands;
  return commands.map((command) =>
    MASTER_VIEW_LIVE_COMMANDS.includes(command.id) || command.capability.hidden === true
      ? command
      : { ...command, capability: { status: "unavailable" as const, reason: PPTX_MASTER_VIEW_REASON } },
  );
}

export function usePptxMasterViewGate({ open, commands, clearSelection }: { open: boolean; commands: readonly PptxCommand[]; clearSelection: () => void }): readonly PptxCommand[] {
  // The selection belongs to a slide that is no longer on screen: drop it once on open.
  const clear = useRef(clearSelection);
  clear.current = clearSelection;
  useEffect(() => {
    if (open) clear.current();
  }, [open]);
  return useMemo(() => gatePptxCommandsForMasterView(commands, open), [commands, open]);
}
