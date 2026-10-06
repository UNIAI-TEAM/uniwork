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

/** Ribbon commands that edit (or open a panel that edits) the deck slide. */
const SLIDE_EDIT_COMMANDS: readonly PptxCommandId[] = ["edit-text", "edit-shape-image", "speaker-notes", "animations", "charts", "tables"];

const MASTER_VIEW_REASON = "office.pptx.reasons.master_view";

/** Pure: the commands with the slide-edit ones disabled. A hidden command stays hidden. */
function gatePptxCommandsForMasterView(commands: readonly PptxCommand[], masterViewOpen: boolean): readonly PptxCommand[] {
  if (!masterViewOpen) return commands;
  return commands.map((command) =>
    SLIDE_EDIT_COMMANDS.includes(command.id) && command.capability.hidden !== true
      ? { ...command, capability: { status: "unavailable" as const, reason: MASTER_VIEW_REASON } }
      : command,
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
